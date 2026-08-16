import hashlib
import logging
import secrets
import random
from datetime import datetime, timedelta, timezone
import json
import requests
import jwt
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, status

from config import Config
from db import is_db_active, get_db_cursor, get_authenticated_cursor
from schemas.auth import (
    AuthResponse,
    LoginRequest,
    LoginResponse,
    RegisterRequest,
    SendOtpRequest,
    SendOtpResponse,
    SessionResponse,
    VerifyOtpRequest,
    VerifyOtpResponse,
)

logger = logging.getLogger("auth")
router = APIRouter(prefix="/auth", tags=["auth"])

# Temporary in-memory stores for authentication records and active sessions (fallback mode).
_in_memory_auth_store: dict[UUID, dict] = {}
_in_memory_session_store: dict[str, dict] = {}

# --- OTP store/helpers ---
# In-memory only: DATABASE.md does not define an OTP table, and OTPs are
# short-lived, non-critical data, so no schema change is needed here.
_otp_store: dict[str, dict] = {}
_OTP_TTL_MINUTES = 5
_OTP_MAX_ATTEMPTS = 5


def generate_otp() -> str:
    return f"{random.randint(0, 999999):06d}"


def hash_otp(otp: str, phone: str) -> str:
    return hashlib.sha256(f"{otp}:{phone}".encode()).hexdigest()


def _get_email_from_username(username: str) -> str:
    if "@" in username:
        return username
    return f"{username}@smarttouristsafety.com"


def _hash_password(password: str, salt: str | None = None) -> str:
    if salt is None:
        salt = secrets.token_hex(16)
    key = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        100000,
    )
    return f"{salt}${key.hex()}"


def _verify_password(password: str, password_hash: str) -> bool:
    try:
        salt, key_hex = password_hash.split("$")
        recalculated = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt.encode("utf-8"),
            100000,
        ).hex()
        return secrets.compare_digest(recalculated, key_hex)
    except Exception:
        return False


def get_current_user(
    authorization: str | None = Header(None),
    x_session_token: str | None = Header(None, alias="X-Session-Token"),
) -> SessionResponse:
    token = None
    if authorization:
        if authorization.lower().startswith("bearer "):
            token = authorization.split(" ", 1)[1].strip()
        else:
            token = authorization.strip()
    elif x_session_token:
        token = x_session_token.strip()

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 1. Fallback / Mock Mode
    if not is_db_active():
        session_data = _in_memory_session_store.get(token)
        if not session_data:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired session token",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return SessionResponse(**session_data)

    # 2. Database Mode: JWT Session Decoding
    try:
        if not Config.JWT_SECRET:
            # JWT_SECRET must be the Supabase project's JWT secret. Without
            # it we cannot verify the token signature; decoding unsigned
            # (verify_signature=False) would let anyone forge a token with
            # an arbitrary "sub" claim and authenticate as any user. Fail
            # closed instead of silently accepting unverified tokens.
            logger.error("JWT_SECRET is not configured; refusing to accept unverified tokens.")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Authentication is not correctly configured on the server.",
            )
        claims = jwt.decode(
            token,
            Config.JWT_SECRET,
            algorithms=["HS256"],
            options={"verify_aud": False}
        )
        
        auth_user_id = claims.get("sub")
        if not auth_user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token payload: missing sub claim",
            )
        
        # Look up authentication and profiles in DB
        with get_db_cursor() as cur:
            cur.execute("""
                SELECT auth_id, auth_user_id, tourist_id, authority_id, username, mfa_enabled, last_login_at
                FROM public.authentication
                WHERE auth_user_id = %s;
            """, (auth_user_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="User profile not found in database",
                )
            
            user_type = "tourist" if row[2] is not None else "authority"
            return SessionResponse(
                auth_id=row[0],
                auth_user_id=row[1],
                username=row[4],
                user_type=user_type,
                tourist_id=row[2],
                authority_id=row[3],
                mfa_enabled=row[5],
                last_login_at=row[6],
            )
            
    except jwt.PyJWTError as jwt_err:
        logger.warning(f"JWT decode error: {jwt_err}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except Exception as e:
        logger.error(f"Error in session verification: {e}")
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error during authentication",
        )


def require_authority(
    current_user: SessionResponse = Depends(get_current_user),
) -> SessionResponse:
    if current_user.user_type != "authority" or current_user.authority_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Authority access required",
        )
    return current_user


def require_tourist(
    current_user: SessionResponse = Depends(get_current_user),
) -> SessionResponse:
    if current_user.user_type != "tourist" or current_user.tourist_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tourist access required",
        )
    return current_user


@router.post("/send-otp", response_model=SendOtpResponse)
def send_otp(payload: SendOtpRequest) -> SendOtpResponse:
    phone = payload.phone.strip()
    if not phone:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Phone number is required",
        )

    otp = generate_otp()
    _otp_store[phone] = {
        "otp_hash": hash_otp(otp, phone),
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=_OTP_TTL_MINUTES),
        "attempts": 0,
    }

    if Config.OTP_DEBUG_LOG:
        masked = phone[:-4].replace(phone[:-4], "*" * len(phone[:-4])) + phone[-4:] if len(phone) > 4 else phone
        logger.info(f"[OTP DEBUG] OTP generated for {masked}: {otp}")

    return SendOtpResponse(message="OTP sent")


@router.post("/verify-otp", response_model=VerifyOtpResponse)
def verify_otp(payload: VerifyOtpRequest) -> VerifyOtpResponse:
    phone = payload.phone.strip()
    otp = payload.otp.strip()

    record = _otp_store.get(phone)
    if not record:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No OTP was requested for this phone number. Please request a new OTP.",
        )

    if datetime.now(timezone.utc) > record["expires_at"]:
        del _otp_store[phone]
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="OTP has expired. Please request a new OTP.",
        )

    if record["attempts"] >= _OTP_MAX_ATTEMPTS:
        del _otp_store[phone]
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many incorrect attempts. Please request a new OTP.",
        )

    if not secrets.compare_digest(hash_otp(otp, phone), record["otp_hash"]):
        record["attempts"] += 1
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect OTP. Please try again.",
        )

    # OTP is single-use: remove it once successfully verified.
    del _otp_store[phone]
    return VerifyOtpResponse(verified=True, message="OTP verified")


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest) -> AuthResponse:
    user_type = payload.user_type.lower()
    if user_type not in ("tourist", "authority"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User type must be 'tourist' or 'authority'",
        )

    # 1. Fallback / Mock Mode
    if not is_db_active():
        for record in _in_memory_auth_store.values():
            if record["username"].lower() == payload.username.lower():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Username already registered",
                )

        now = datetime.now(timezone.utc)
        auth_id = uuid4()
        auth_user_id = uuid4()
        tourist_id = payload.tourist_id if user_type == "tourist" else None
        if user_type == "tourist" and not tourist_id:
            tourist_id = uuid4()
            
        authority_id = payload.authority_id if user_type == "authority" else None
        if user_type == "authority" and not authority_id:
            authority_id = uuid4()

        # Seed local tourist store to allow profile queries immediately
        if user_type == "tourist":
            from routers.tourists import _in_memory_tourist_store
            from schemas.tourist import TouristResponse
            _in_memory_tourist_store[tourist_id] = TouristResponse(
                tourist_id=tourist_id,
                digital_id=f"DIG-{uuid4().hex[:8].upper()}",
                full_name=payload.username,
                kyc_document_type=None,
                kyc_verified=False,
                phone=None,
                email=f"{payload.username}@smarttouristsafety.com",
                emergency_contact=None,
                preferred_language="EN",
                created_at=now
            )

        auth_record = {
            "auth_id": auth_id,
            "auth_user_id": auth_user_id,
            "tourist_id": tourist_id,
            "authority_id": authority_id,
            "username": payload.username,
            "password_hash": _hash_password(payload.password),
            "user_type": user_type,
            "mfa_enabled": payload.mfa_enabled,
            "last_login_at": None,
            "created_at": now,
        }
        _in_memory_auth_store[auth_id] = auth_record

        return AuthResponse(
            auth_id=auth_record["auth_id"],
            tourist_id=auth_record["tourist_id"],
            authority_id=auth_record["authority_id"],
            username=auth_record["username"],
            user_type=auth_record["user_type"],
            mfa_enabled=auth_record["mfa_enabled"],
            last_login_at=auth_record["last_login_at"],
            created_at=auth_record["created_at"],
        )

    # 2. Database Mode: Supabase Auth Signup + Profile Creation
    email_str = _get_email_from_username(payload.username)
    
    # Sign up via Supabase Auth API
    if not Config.is_supabase_configured():
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Supabase is not configured on the backend.",
        )
        
    signup_url = f"{Config.SUPABASE_URL}/auth/v1/signup"
    headers = {
        "apikey": Config.SUPABASE_ANON_KEY,
        "Content-Type": "application/json"
    }
    body = {
        "email": email_str,
        "password": payload.password
    }
    
    try:
        resp = requests.post(signup_url, headers=headers, json=body, timeout=10)
        if resp.status_code != 200:
            err_detail = resp.json().get("msg", "Failed to sign up with Supabase Auth.")
            raise HTTPException(
                status_code=resp.status_code,
                detail=err_detail
            )
        
        sb_user = resp.json().get("user", {})
        auth_user_id = sb_user.get("id")
        if not auth_user_id:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Supabase Auth did not return a user ID.",
            )
            
        now = datetime.now(timezone.utc)
        auth_id = uuid4()
        tourist_id = payload.tourist_id if user_type == "tourist" else None
        authority_id = payload.authority_id if user_type == "authority" else None
        
        # Insert profile into tourists or authorities table, and authentication table
        with get_db_cursor(commit=True) as cur:
            if user_type == "tourist":
                if not tourist_id:
                    tourist_id = uuid4()
                digital_id = f"DIG-{uuid4().hex[:8].upper()}"
                cur.execute("""
                    INSERT INTO public.tourists (tourist_id, auth_user_id, digital_id, full_name, email, kyc_verified, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s);
                """, (tourist_id, auth_user_id, digital_id, payload.username, email_str, False, now))
            else:
                if not authority_id:
                    authority_id = uuid4()
                cur.execute("""
                    INSERT INTO public.authorities (authority_id, auth_user_id, agency_name, contact_email)
                    VALUES (%s, %s, %s, %s);
                """, (authority_id, auth_user_id, payload.username, email_str))
                
            cur.execute("""
                INSERT INTO public.authentication (auth_id, auth_user_id, tourist_id, authority_id, username, mfa_enabled, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s);
            """, (auth_id, auth_user_id, tourist_id, authority_id, payload.username, payload.mfa_enabled, now))
            
        return AuthResponse(
            auth_id=auth_id,
            tourist_id=tourist_id,
            authority_id=authority_id,
            username=payload.username,
            user_type=user_type,
            mfa_enabled=payload.mfa_enabled,
            last_login_at=None,
            created_at=now,
        )
        
    except Exception as e:
        logger.error(f"Registration database error: {e}")
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Registration failed: {str(e)}"
        )


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest) -> LoginResponse:
    # 1. Fallback / Mock Mode
    if not is_db_active():
        target_record = None
        for record in _in_memory_auth_store.values():
            if record["username"].lower() == payload.username.lower():
                target_record = record
                break

        if not target_record or not _verify_password(payload.password, target_record["password_hash"]):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid username or password",
            )

        now = datetime.now(timezone.utc)
        target_record["last_login_at"] = now

        token = secrets.token_hex(32)
        session_info = {
            "auth_id": target_record["auth_id"],
            "auth_user_id": target_record["auth_user_id"],
            "username": target_record["username"],
            "user_type": target_record["user_type"],
            "tourist_id": target_record["tourist_id"],
            "authority_id": target_record["authority_id"],
            "mfa_enabled": target_record["mfa_enabled"],
            "last_login_at": now,
        }
        _in_memory_session_store[token] = session_info

        return LoginResponse(
            access_token=token,
            token_type="bearer",
            auth_id=target_record["auth_id"],
            username=target_record["username"],
            user_type=target_record["user_type"],
            tourist_id=target_record["tourist_id"],
            authority_id=target_record["authority_id"],
            mfa_enabled=target_record["mfa_enabled"],
            last_login_at=now,
        )

    # 2. Database Mode: Supabase Auth Login + last_login_at update
    if not Config.is_supabase_configured():
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Supabase is not configured on the backend.",
        )
        
    email_str = _get_email_from_username(payload.username)
    login_url = f"{Config.SUPABASE_URL}/auth/v1/token?grant_type=password"
    headers = {
        "apikey": Config.SUPABASE_ANON_KEY,
        "Content-Type": "application/json"
    }
    body = {
        "email": email_str,
        "password": payload.password
    }
    
    try:
        resp = requests.post(login_url, headers=headers, json=body, timeout=10)
        if resp.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid username or password",
            )
            
        data = resp.json()
        access_token = data.get("access_token")
        sb_user = data.get("user", {})
        auth_user_id = sb_user.get("id")
        
        now = datetime.now(timezone.utc)
        
        # Retrieve profile mapping and update last login time
        with get_db_cursor(commit=True) as cur:
            cur.execute("""
                SELECT auth_id, auth_user_id, tourist_id, authority_id, username, mfa_enabled
                FROM public.authentication
                WHERE auth_user_id = %s;
            """, (auth_user_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Linked profile not found in application database.",
                )
                
            cur.execute("""
                UPDATE public.authentication
                SET last_login_at = %s
                WHERE auth_user_id = %s;
            """, (now, auth_user_id))
            
            user_type = "tourist" if row[2] is not None else "authority"
            
            return LoginResponse(
                access_token=access_token,
                token_type="bearer",
                auth_id=row[0],
                username=row[4],
                user_type=user_type,
                tourist_id=row[2],
                authority_id=row[3],
                mfa_enabled=row[5],
                last_login_at=now,
            )
            
    except Exception as e:
        logger.error(f"Login database error: {e}")
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Login failed: {str(e)}"
        )


@router.post("/logout")
def logout(
    authorization: str | None = Header(None),
    x_session_token: str | None = Header(None, alias="X-Session-Token"),
) -> dict:
    token = None
    if authorization:
        if authorization.lower().startswith("bearer "):
            token = authorization.split(" ", 1)[1].strip()
        else:
            token = authorization.strip()
    elif x_session_token:
        token = x_session_token.strip()

    if not is_db_active():
        if token and token in _in_memory_session_store:
            del _in_memory_session_store[token]
    else:
        # For Supabase, the client normally clears the token. 
        # Server side logout is stateless unless we call Supabase logout API.
        if token and Config.is_supabase_configured():
            logout_url = f"{Config.SUPABASE_URL}/auth/v1/logout"
            headers = {
                "apikey": Config.SUPABASE_ANON_KEY,
                "Authorization": f"Bearer {token}"
            }
            try:
                requests.post(logout_url, headers=headers, timeout=5)
            except Exception as e:
                logger.warning(f"Failed to logout from Supabase: {e}")

    return {"message": "logged out"}


@router.get("/session", response_model=SessionResponse)
def get_session(current_user: SessionResponse = Depends(get_current_user)) -> SessionResponse:
    return current_user