from datetime import datetime, timezone
import hashlib
import secrets
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, status

from schemas.auth import (
    AuthResponse,
    LoginRequest,
    LoginResponse,
    RegisterRequest,
    SessionResponse,
)

router = APIRouter(prefix="/auth", tags=["auth"])

# Temporary in-memory stores for authentication records and active sessions.
# Replace with PostgreSQL queries when database connection details are provided.
_in_memory_auth_store: dict[UUID, dict] = {}
_in_memory_session_store: dict[str, dict] = {}


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

    session_data = _in_memory_session_store.get(token)
    if not session_data:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return SessionResponse(**session_data)


def require_authority(
    current_user: SessionResponse = Depends(get_current_user),
) -> SessionResponse:
    if current_user.user_type != "authority" and current_user.authority_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Authority access required",
        )
    return current_user


def require_tourist(
    current_user: SessionResponse = Depends(get_current_user),
) -> SessionResponse:
    if current_user.user_type != "tourist" and current_user.tourist_id is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tourist access required",
        )
    return current_user


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest) -> AuthResponse:
    for record in _in_memory_auth_store.values():
        if record["username"].lower() == payload.username.lower():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Username already registered",
            )

    now = datetime.now(timezone.utc)
    auth_id = uuid4()
    user_type = payload.user_type.lower()
    if user_type not in ("tourist", "authority"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User type must be 'tourist' or 'authority'",
        )

    auth_record = {
        "auth_id": auth_id,
        "tourist_id": payload.tourist_id if user_type == "tourist" else None,
        "authority_id": payload.authority_id if user_type == "authority" else None,
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


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest) -> LoginResponse:
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

    if token and token in _in_memory_session_store:
        del _in_memory_session_store[token]

    return {"message": "logged out"}


@router.get("/session", response_model=SessionResponse)
def get_session(current_user: SessionResponse = Depends(get_current_user)) -> SessionResponse:
    return current_user
