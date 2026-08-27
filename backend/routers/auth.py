import hashlib
import logging
import secrets
import random
import re
import time
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
    RefreshRequest,
    RefreshResponse,
    RegisterRequest,
    SendOtpRequest,
    SendOtpResponse,
    SendEmailOtpRequest,
    SessionResponse,
    ValidatePhoneRequest,
    ValidatePhoneResponse,
    VerifyOtpRequest,
    VerifyOtpResponse,
    VerifyEmailOtpRequest,
)

logger = logging.getLogger("auth")
router = APIRouter(prefix="/auth", tags=["auth"])

# Temporary in-memory stores for authentication records and active sessions (fallback mode).
_in_memory_auth_store: dict[UUID, dict] = {}
_in_memory_session_store: dict[str, dict] = {}
_in_memory_refresh_store: dict[str, str] = {}  # refresh_token -> access_token, offline mode only

# In-memory caches to prevent connection pool exhaustion and Supabase network blocks under heavy load.
_session_cache = {}  # token -> (expiry_time, SessionResponse)
_SESSION_CACHE_TTL = 10  # Cache session verification for 10 seconds (adequate for telemetry/pings)
_jwks_cache = None   # Cached JWKS response dictionary
_jwks_cache_expiry = 0  # Timestamp when JWKS cache expires
_JWKS_CACHE_TTL = 3600  # Cache JWKS keys for 1 hour since they change very infrequently

# --- OTP store/helpers ---
# In-memory only: DATABASE.md does not define an OTP table, and OTPs are
# short-lived, non-critical data, so no schema change is needed here.
_otp_store: dict[str, dict] = {}
_OTP_TTL_MINUTES = 5
_OTP_MAX_ATTEMPTS = 5


def generate_otp() -> str:
    return f"{random.randint(0, 999999):06d}"


def hash_otp(otp: str, identifier: str) -> str:
    return hashlib.sha256(f"{otp}:{identifier}".encode()).hexdigest()


_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _email_domain_exists(email: str) -> bool:
    """
    Best-effort "does this email actually exist" check: confirms the
    domain has valid MX records (i.e. it's a real, mail-receiving domain),
    not that the specific mailbox exists — there's no free/local way to
    verify a specific mailbox without actually attempting delivery (which
    the OTP send itself effectively does). A domain with no MX records
    can't receive mail at all, so this catches typos and made-up domains
    before wasting an OTP send on them.
    """
    if not _EMAIL_RE.match(email):
        return False
    domain = email.rsplit("@", 1)[-1]
    try:
        import dns.resolver
        answers = dns.resolver.resolve(domain, "MX", lifetime=5)
        return len(answers) > 0
    except Exception:
        return False


def _send_email(to_email: str, subject: str, body: str) -> bool:
    """
    Sends a real email via SMTP if Config.is_smtp_configured(), else logs
    it (mirroring the existing phone-OTP behavior when no SMS gateway is
    configured — see Config.OTP_DEBUG_LOG). Returns True if the email was
    handed off successfully (sent, or logged in debug mode); False on a
    genuine send failure so the caller can surface an error.
    """
    if not Config.is_smtp_configured():
        if Config.OTP_DEBUG_LOG:
            logger.info(f"[EMAIL OTP DEBUG] To: {to_email} | Subject: {subject} | Body: {body}")
        return True
    try:
        import smtplib
        from email.mime.text import MIMEText
        msg = MIMEText(body)
        msg["Subject"] = subject
        msg["From"] = Config.SMTP_FROM
        msg["To"] = to_email
        with smtplib.SMTP(Config.SMTP_HOST, Config.SMTP_PORT, timeout=10) as server:
            server.starttls()
            server.login(Config.SMTP_USER, Config.SMTP_PASSWORD)
            server.sendmail(Config.SMTP_FROM, [to_email], msg.as_string())
        return True
    except Exception as e:
        logger.error(f"Failed to send email to {to_email}: {e}")
        return False


def _get_email_from_username(username: str) -> str:
    if "@" in username:
        return username
    return f"{username}@smarttouristsafety.com"


def _generate_tourist_code() -> str:
    """
    Public-facing tourist identifier, format TOUR-YYYY-[HEX] per the
    directive. Duplicated from routers/tourists.py (rather than imported)
    because tourists.py imports get_current_user from this module —
    importing back would be circular. Generated at registration time now,
    not gated behind KYC completion, since KYC was made optional/deferred
    to the profile screen and a tourist otherwise never got an ID at all.
    """
    year = datetime.now(timezone.utc).year
    return f"TOUR-{year}-{uuid4().hex[:8].upper()}"


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


def resolve_session(token: str | None) -> SessionResponse:
    """
    Shared token->session resolution used by both the HTTP dependency
    (get_current_user, below) and the WebSocket endpoints in routers/ws.py,
    which can't use FastAPI's Header()-based dependency injection the same
    way during the WS handshake.
    """
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Check session cache to throttle database queries/JWKS network requests
    now_ts = time.time()
    if token in _session_cache:
        cache_exp, cached_res = _session_cache[token]
        if now_ts < cache_exp:
            return cached_res
        else:
            del _session_cache[token]

    # 1. Fallback / Mock Mode
    if not is_db_active():
        session_data = _in_memory_session_store.get(token)
        if not session_data:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired session token",
                headers={"WWW-Authenticate": "Bearer"},
            )
        session_resp = SessionResponse(**session_data)
        _session_cache[token] = (time.time() + _SESSION_CACHE_TTL, session_resp)
        return session_resp

    # 2. Database Mode: JWT Session Decoding
    try:
        header = jwt.get_unverified_header(token)
        alg = header.get("alg", "HS256")
        
        claims = None
        # Asymmetric algorithms (Supabase's new JWT Signing Keys default to
        # ES256/ECC; RS256/RSA is also supported). Route both through the
        # same JWKS-based manual-verification path, since PyJWT's built-in
        # PEM loading is what was throwing "Unable to load PEM file ...
        # MalformedFraming" when an EC-signed (ES256) token fell through to
        # the HS256/shared-secret branch below.
        if alg in ("RS256", "ES256", "PS256"):
            global _jwks_cache, _jwks_cache_expiry
            now_ts = time.time()
            if _jwks_cache is None or now_ts >= _jwks_cache_expiry:
                if not Config.SUPABASE_URL:
                    logger.error(f"SUPABASE_URL is not configured; cannot fetch JWKS keys for {alg}.")
                    raise HTTPException(
                        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                        detail="Authentication is not correctly configured on the server.",
                    )
                jwks_url = f"{Config.SUPABASE_URL.rstrip('/')}/auth/v1/.well-known/jwks.json"
                resp = requests.get(jwks_url, timeout=10)
                if resp.status_code != 200:
                    logger.error(f"Failed to fetch JWKS from {jwks_url}: status={resp.status_code}")
                    raise HTTPException(
                        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                        detail="Authentication server could not be reached.",
                    )
                _jwks_cache = resp.json()
                _jwks_cache_expiry = now_ts + _JWKS_CACHE_TTL
            jwks = _jwks_cache

            # Find the key matching the token's kid
            kid = header.get("kid")
            jwk_dict = None
            for key_dict in jwks.get("keys", []):
                if key_dict.get("kid") == kid:
                    jwk_dict = key_dict
                    break

            if not jwk_dict:
                logger.error(f"Key ID {kid} not found in JWKS.")
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid authentication token signature key.",
                )

            import base64
            from cryptography.hazmat.backends import default_backend
            from cryptography.hazmat.primitives import hashes
            from cryptography.hazmat.primitives.asymmetric import padding, ec, utils as asym_utils

            def base64url_decode(s: str) -> bytes:
                s = s.strip()
                rem = len(s) % 4
                if rem > 0:
                    s += '=' * (4 - rem)
                return base64.urlsafe_b64decode(s)

            kty = jwk_dict.get("kty")
            try:
                if kty == "RSA":
                    from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicNumbers
                    n_int = int.from_bytes(base64url_decode(jwk_dict["n"]), byteorder="big")
                    e_int = int.from_bytes(base64url_decode(jwk_dict["e"]), byteorder="big")
                    key = RSAPublicNumbers(e_int, n_int).public_key(default_backend())
                elif kty == "EC":
                    curve_name = jwk_dict.get("crv", "P-256")
                    curve = {"P-256": ec.SECP256R1(), "P-384": ec.SECP384R1(), "P-521": ec.SECP521R1()}.get(curve_name)
                    if curve is None:
                        raise ValueError(f"Unsupported EC curve: {curve_name}")
                    x_int = int.from_bytes(base64url_decode(jwk_dict["x"]), byteorder="big")
                    y_int = int.from_bytes(base64url_decode(jwk_dict["y"]), byteorder="big")
                    key = ec.EllipticCurvePublicNumbers(x_int, y_int, curve).public_key(default_backend())
                else:
                    raise ValueError(f"Unsupported JWK key type: {kty}")
            except Exception as parse_err:
                logger.error(f"Failed to construct public key from JWK (kty={kty}): {parse_err}")
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Failed to parse signature verification key.",
                )

            # Verify the signature manually to bypass PyJWT PEM-loading bugs
            parts = token.split(".")
            if len(parts) != 3:
                raise jwt.PyJWTError("Invalid token format")

            message = f"{parts[0]}.{parts[1]}".encode("ascii")
            try:
                sig_bytes = base64url_decode(parts[2])
            except Exception:
                raise jwt.PyJWTError("Invalid base64 in signature")

            try:
                if kty == "RSA":
                    key.verify(sig_bytes, message, padding.PKCS1v15(), hashes.SHA256())
                elif kty == "EC":
                    # JWS EC signatures are raw (r || s) fixed-width concatenation,
                    # not DER — convert before handing to cryptography's verify().
                    half = len(sig_bytes) // 2
                    r = int.from_bytes(sig_bytes[:half], byteorder="big")
                    s = int.from_bytes(sig_bytes[half:], byteorder="big")
                    der_sig = asym_utils.encode_dss_signature(r, s)
                    key.verify(der_sig, message, ec.ECDSA(hashes.SHA256()))
            except Exception as sig_err:
                logger.warning(f"Signature verification failed: {sig_err}")
                raise jwt.PyJWTError("Signature verification failed")

            # Signature verified successfully! Decode the payload without verification
            claims = jwt.decode(
                token,
                "",
                options={"verify_signature": False, "verify_aud": False}
            )
        else:
            jwt_secret = Config.JWT_SECRET.strip().strip('"').strip("'").replace("\\n", "\n")
            if not jwt_secret:
                logger.error("JWT_SECRET is not configured; refusing to accept unverified HS256 tokens.")
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Authentication is not correctly configured on the server.",
                )
            
            # If it's a PEM key (e.g. asymmetric public key configured as JWT_SECRET)
            if jwt_secret.startswith("-----BEGIN"):
                key = jwt_secret
            else:
                # Try to base64-decode it because Supabase signs HS256 tokens using base64-decoded bytes.
                # Fallback to the raw string if base64 decoding fails.
                import base64
                try:
                    # Pad the secret if necessary
                    padded = jwt_secret + "=" * (-len(jwt_secret) % 4)
                    key = base64.urlsafe_b64decode(padded)
                except Exception:
                    key = jwt_secret.encode("utf-8")
            
            claims = jwt.decode(
                token,
                key,
                algorithms=[alg],
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
                SELECT auth_id, auth_user_id, tourist_profile_id, authority_id, username, mfa_enabled, last_login_at
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
            session_resp = SessionResponse(
                auth_id=row[0],
                auth_user_id=row[1],
                username=row[4],
                user_type=user_type,
                tourist_profile_id=row[2],
                authority_id=row[3],
                mfa_enabled=row[5],
                last_login_at=row[6],
            )
            _session_cache[token] = (time.time() + _SESSION_CACHE_TTL, session_resp)
            return session_resp
            
    except jwt.PyJWTError as jwt_err:
        logger.warning(f"JWT decode error: {jwt_err}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except Exception as e:
        logger.error(f"Error in session verification: {e}", exc_info=True)
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Internal server error during authentication: {type(e).__name__}: {str(e)}",
        )


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

    return resolve_session(token)


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
    if current_user.user_type != "tourist" or current_user.tourist_profile_id is None:
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


@router.post("/send-email-otp", response_model=SendOtpResponse)
def send_email_otp(payload: SendEmailOtpRequest) -> SendOtpResponse:
    email = payload.email.strip().lower()
    if not _EMAIL_RE.match(email):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Enter a valid email address.")
    if not _email_domain_exists(email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This email's domain doesn't appear to accept mail. Please check for a typo.",
        )

    otp = generate_otp()
    otp_key = f"email:{email}"
    _otp_store[otp_key] = {
        "otp_hash": hash_otp(otp, otp_key),
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=_OTP_TTL_MINUTES),
        "attempts": 0,
    }

    sent = _send_email(
        email,
        "Your Suraksha Setu verification code",
        f"Your verification code is {otp}. It expires in {_OTP_TTL_MINUTES} minutes.\n\nIf you didn't request this, you can ignore this email.",
    )
    if not sent:
        del _otp_store[otp_key]
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Couldn't send the verification email. Please try again.")

    return SendOtpResponse(message="OTP sent")


@router.post("/verify-email-otp", response_model=VerifyOtpResponse)
def verify_email_otp(payload: VerifyEmailOtpRequest) -> VerifyOtpResponse:
    email = payload.email.strip().lower()
    otp = payload.otp.strip()
    otp_key = f"email:{email}"

    record = _otp_store.get(otp_key)
    if not record:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No OTP was requested for this email. Please request a new OTP.",
        )
    if datetime.now(timezone.utc) > record["expires_at"]:
        del _otp_store[otp_key]
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="OTP has expired. Please request a new OTP.")
    if record["attempts"] >= _OTP_MAX_ATTEMPTS:
        del _otp_store[otp_key]
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many incorrect attempts. Please request a new OTP.")
    if not secrets.compare_digest(hash_otp(otp, otp_key), record["otp_hash"]):
        record["attempts"] += 1
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Incorrect OTP. Please try again.")

    del _otp_store[otp_key]
    return VerifyOtpResponse(verified=True, message="OTP verified")


@router.post("/validate-phone", response_model=ValidatePhoneResponse)
def validate_phone(payload: ValidatePhoneRequest) -> ValidatePhoneResponse:
    """
    Format/region validity check via Google's libphonenumber (the
    phonenumbers package) — confirms the number is a plausible, correctly
    structured number for the selected country. This is NOT a live
    carrier lookup (e.g. Twilio Lookup), which would require a paid API
    and isn't configured here; it catches typos, wrong digit counts, and
    made-up numbers, but can't confirm the number is currently active/
    reachable the way phone OTP delivery itself effectively does.
    """
    try:
        import phonenumbers
        parsed = phonenumbers.parse(payload.phone.strip(), payload.country_code.strip().upper())
        if not phonenumbers.is_valid_number(parsed):
            return ValidatePhoneResponse(valid=False, reason="This doesn't look like a valid phone number for the selected country.")
        return ValidatePhoneResponse(valid=True, e164=phonenumbers.format_number(parsed, phonenumbers.PhoneNumberFormat.E164))
    except Exception:
        return ValidatePhoneResponse(valid=False, reason="Enter a valid phone number.")


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
        tourist_profile_id = payload.tourist_profile_id if user_type == "tourist" else None
        if user_type == "tourist" and not tourist_profile_id:
            tourist_profile_id = uuid4()
            
        authority_id = payload.authority_id if user_type == "authority" else None
        if user_type == "authority" and not authority_id:
            authority_id = uuid4()

        # Seed local tourist store to allow profile queries immediately
        if user_type == "tourist":
            from routers.tourists import _in_memory_tourist_store
            from schemas.tourist import TouristResponse
            _in_memory_tourist_store[tourist_profile_id] = TouristResponse(
                id=tourist_profile_id,
                tourist_id=_generate_tourist_code(),
                username=payload.username,
                full_name=payload.full_name or payload.username,
                phone_number=payload.phone_number,
                email=_get_email_from_username(payload.username),
                emergency_contacts=[],
                govt_id_type=None,
                govt_id_number=None,
                id_photo_url=None,
                kyc_status="PENDING",
                preferred_language="EN",
                created_at=now
            )

        auth_record = {
            "auth_id": auth_id,
            "auth_user_id": auth_user_id,
            "tourist_profile_id": tourist_profile_id,
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
            tourist_profile_id=auth_record["tourist_profile_id"],
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

    # App users are already verified out-of-band via phone OTP (see
    # /auth/send-otp, /auth/verify-otp) before this endpoint is ever called.
    # The email address used here is synthetic
    # (tourist-<phone>@smarttouristsafety.com) — it isn't a real inbox, so
    # Supabase's normal signup endpoint can never actually deliver/have its
    # confirmation link clicked. That endpoint also queues a confirmation
    # email on every call regardless, which both (a) permanently blocks
    # login until a confirmation that can never happen, and (b) burns
    # Supabase's project-wide email rate limit, eventually failing signup
    # itself with "email rate limit exceeded".
    #
    # When a service-role key is configured, use the Admin API instead: it
    # creates the account already confirmed and sends no email at all. This
    # doesn't skip verification — it substitutes the (unreachable) email
    # link for the OTP check the app already performed. Without a
    # service-role key configured, fall back to the original public signup
    # endpoint unchanged, so existing deployments keep working exactly as
    # before until SUPABASE_SERVICE_ROLE_KEY is set.
    use_admin_api = Config.has_service_role()
    if use_admin_api:
        signup_url = f"{Config.SUPABASE_URL}/auth/v1/admin/users"
        headers = {
            "apikey": Config.SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {Config.SUPABASE_SERVICE_ROLE_KEY}",
            "Content-Type": "application/json"
        }
        body = {
            "email": email_str,
            "password": payload.password,
            "email_confirm": True,
        }
    else:
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
        if resp.status_code not in (200, 201):
            try:
                err_json = resp.json()
            except Exception:
                err_json = {}
            err_detail = (
                err_json.get("msg")
                or err_json.get("message")
                or err_json.get("error_description")
                or "Failed to sign up with Supabase Auth."
            )
            logger.warning(f"Supabase {'admin ' if use_admin_api else ''}signup failed for {email_str}: status={resp.status_code} detail={err_detail}")
            if resp.status_code == 422 and "already been registered" in err_detail.lower():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Username already registered"
                )
            raise HTTPException(
                status_code=resp.status_code,
                detail=err_detail
            )

        resp_json = resp.json()
        # Admin API returns the user object directly; the public signup
        # endpoint returns {"user": {...}, "session": ...}.
        sb_user = resp_json.get("user") if "user" in resp_json else resp_json
        auth_user_id = (sb_user or {}).get("id")
        if not auth_user_id:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Supabase Auth did not return a user ID.",
            )
            
        now = datetime.now(timezone.utc)
        auth_id = uuid4()
        tourist_profile_id = payload.tourist_profile_id if user_type == "tourist" else None
        authority_id = payload.authority_id if user_type == "authority" else None
        
        # Insert profile into tourist_profiles or authorities table, and authentication table
        with get_db_cursor(commit=True) as cur:
            if user_type == "tourist":
                if not tourist_profile_id:
                    tourist_profile_id = uuid4()
                cur.execute("""
                    INSERT INTO public.tourist_profiles (id, user_id, username, full_name, phone_number, email, kyc_status, tourist_id, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s);
                """, (tourist_profile_id, auth_user_id, payload.username, payload.full_name or payload.username, payload.phone_number, email_str, "PENDING", _generate_tourist_code(), now))
            else:
                if not authority_id:
                    authority_id = uuid4()
                cur.execute("""
                    INSERT INTO public.authorities (authority_id, auth_user_id, agency_name, contact_email)
                    VALUES (%s, %s, %s, %s);
                """, (authority_id, auth_user_id, payload.username, email_str))
                
            cur.execute("""
                INSERT INTO public.authentication (auth_id, auth_user_id, tourist_profile_id, authority_id, username, mfa_enabled, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s);
            """, (auth_id, auth_user_id, tourist_profile_id, authority_id, payload.username, payload.mfa_enabled, now))
            
        return AuthResponse(
            auth_id=auth_id,
            tourist_profile_id=tourist_profile_id,
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
        refresh_token = secrets.token_hex(32)
        session_info = {
            "auth_id": target_record["auth_id"],
            "auth_user_id": target_record["auth_user_id"],
            "username": target_record["username"],
            "user_type": target_record["user_type"],
            "tourist_profile_id": target_record["tourist_profile_id"],
            "authority_id": target_record["authority_id"],
            "mfa_enabled": target_record["mfa_enabled"],
            "last_login_at": now,
        }
        _in_memory_session_store[token] = session_info
        # Offline-mode refresh tokens just mint a fresh opaque access token
        # for the same session record — see refresh_session() below.
        _in_memory_refresh_store[refresh_token] = token

        return LoginResponse(
            access_token=token,
            refresh_token=refresh_token,
            token_type="bearer",
            auth_id=target_record["auth_id"],
            username=target_record["username"],
            user_type=target_record["user_type"],
            tourist_profile_id=target_record["tourist_profile_id"],
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
            # Root cause of the "Registration failed" bug: every non-200
            # Supabase response (wrong password, unconfirmed email, locked
            # account, etc.) was previously collapsed into a generic
            # "Invalid username or password" 401. registerAndLoginTourist()
            # calls login() immediately after signup, using a synthetic
            # per-phone email (tourist-<phone>@smarttouristsafety.com) that
            # can never receive/click a real confirmation link. If the
            # Supabase project has "Confirm email" enabled (the default),
            # signup succeeds but this immediate login always fails with
            # Supabase's "Email not confirmed" error — which was being
            # silently relabeled as bad credentials, then swallowed again by
            # the frontend into "Registration failed. Please check your
            # details and try again." Surface the real reason instead.
            try:
                err_body = resp.json()
            except Exception:
                err_body = {}
            err_code = (err_body.get("error_code") or err_body.get("error") or "").lower()
            err_msg = err_body.get("msg") or err_body.get("error_description") or ""
            logger.warning(f"Supabase login failed for {email_str}: status={resp.status_code} code={err_code} msg={err_msg}")

            if "email_not_confirmed" in err_code or "not confirmed" in err_msg.lower():
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Account created but not yet confirmed. Email confirmation is required before you can sign in — please confirm your account and try again.",
                )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid username or password",
            )
            
        data = resp.json()
        access_token = data.get("access_token")
        refresh_token = data.get("refresh_token")
        sb_user = data.get("user", {})
        auth_user_id = sb_user.get("id")
        
        now = datetime.now(timezone.utc)
        
        # Retrieve profile mapping and update last login time
        with get_db_cursor(commit=True) as cur:
            cur.execute("""
                SELECT auth_id, auth_user_id, tourist_profile_id, authority_id, username, mfa_enabled
                FROM public.authentication
                WHERE auth_user_id = %s;
            """, (auth_user_id,))
            row = cur.fetchone()
            
            if not row:
                # Auto-recovery for orphaned Supabase Auth users who don't have a database profile yet
                logger.info(f"Auto-recovering database profile for user: {payload.username} ({auth_user_id})")
                auth_id = uuid4()
                username = payload.username
                user_type = "tourist" if ("@" in username or username.startswith("tourist-")) else "authority"
                
                tourist_profile_id = uuid4() if user_type == "tourist" else None
                authority_id = uuid4() if user_type == "authority" else None
                
                if user_type == "tourist":
                    cur.execute("""
                        INSERT INTO public.tourist_profiles (id, user_id, username, full_name, email, kyc_status, tourist_id, created_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s);
                    """, (tourist_profile_id, auth_user_id, username, username, email_str, "PENDING", _generate_tourist_code(), now))
                else:
                    cur.execute("""
                        INSERT INTO public.authorities (authority_id, auth_user_id, agency_name, contact_email)
                        VALUES (%s, %s, %s, %s);
                    """, (authority_id, auth_user_id, username, email_str))
                    
                cur.execute("""
                    INSERT INTO public.authentication (auth_id, auth_user_id, tourist_profile_id, authority_id, username, mfa_enabled, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s);
                """, (auth_id, auth_user_id, tourist_profile_id, authority_id, username, False, now))
                
                # Fetch the newly created row to populate variables
                cur.execute("""
                    SELECT auth_id, auth_user_id, tourist_profile_id, authority_id, username, mfa_enabled
                    FROM public.authentication
                    WHERE auth_user_id = %s;
                """, (auth_user_id,))
                row = cur.fetchone()
                
            cur.execute("""
                UPDATE public.authentication
                SET last_login_at = %s
                WHERE auth_user_id = %s;
            """, (now, auth_user_id))
            
            user_type = "tourist" if row[2] is not None else "authority"
            
            return LoginResponse(
                access_token=access_token,
                refresh_token=refresh_token,
                token_type="bearer",
                auth_id=row[0],
                username=row[4],
                user_type=user_type,
                tourist_profile_id=row[2],
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


@router.post("/refresh", response_model=RefreshResponse)
def refresh_session(payload: RefreshRequest) -> RefreshResponse:
    """
    Exchanges a refresh token for a new access token, so the frontend can
    silently re-authenticate on boot/on a 401 instead of forcing the user
    back to the login screen every time the ~1hr Supabase access token
    expires — previously there was no refresh mechanism at all, so any
    page load after the access token expired hit a 401 on the profile
    fetch and force-cleared the session.
    """
    # Offline/fallback mode: the "refresh token" is just a lookup key for
    # the still-active in-memory access token (opaque tokens don't expire
    # in this mode, so this mainly exists to keep both code paths uniform).
    if not is_db_active():
        access_token = _in_memory_refresh_store.get(payload.refresh_token)
        if not access_token or access_token not in _in_memory_session_store:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token.")
        return RefreshResponse(access_token=access_token, refresh_token=payload.refresh_token, token_type="bearer")

    if not Config.is_supabase_configured():
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Supabase is not configured on the backend.",
        )

    refresh_url = f"{Config.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token"
    headers = {"apikey": Config.SUPABASE_ANON_KEY, "Content-Type": "application/json"}
    try:
        resp = requests.post(refresh_url, headers=headers, json={"refresh_token": payload.refresh_token}, timeout=10)
        if resp.status_code != 200:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired. Please sign in again.")
        data = resp.json()
        return RefreshResponse(
            access_token=data.get("access_token"),
            # Supabase rotates refresh tokens on use — the frontend must
            # store this new one and discard the old, or the next refresh
            # attempt will fail even though this one succeeded.
            refresh_token=data.get("refresh_token"),
            token_type="bearer",
        )
    except requests.RequestException as e:
        logger.error(f"Refresh token exchange failed: {e}")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired. Please sign in again.")


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