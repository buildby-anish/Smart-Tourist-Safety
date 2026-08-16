# Smart Tourist Safety - Codebase Documentation

This document serves as the canonical reference for the **Smart-Tourist-Safety** codebase, detailing the file structure, overall architecture, database relationships, API routing, configurations, and the exact current source code of all active files.

Regenerated at the end of the production-readiness correction pass (see `SESSION_REPORT.md` for the full change log). Secrets are redacted as `<ENV_VALUE>`; none were found hardcoded in this codebase — all credentials are loaded via `os.getenv`/`Config` on the backend and `import.meta.env` / `localStorage` session tokens on the frontend.

---

## 1. Complete File Tree

```text
Smart-Tourist-Safety/
├── .gitignore
├── DATABASE.md
├── codebase.md
├── databasetobackend.md
├── frontendconnectbackend.md
├── README.md
├── database/
│   └── migrations/
│       └── 001_add_audit_logs.sql   [NEW]
├── docs/
│   └── .gitkeep
├── backend/
│   ├── config.py
│   ├── db.py
│   ├── main.py                      [MODIFIED]
│   ├── requirements.txt
│   ├── routers/
│   │   ├── alerts.py
│   │   ├── audit_logs.py            [NEW]
│   │   ├── auth.py
│   │   ├── authority.py             [MODIFIED]
│   │   ├── incidents.py             [MODIFIED]
│   │   ├── itinerary.py             [NEW]
│   │   ├── locations.py
│   │   ├── sos.py
│   │   └── tourists.py
│   ├── schemas/
│   │   ├── alert.py
│   │   ├── audit_log.py             [NEW]
│   │   ├── auth.py
│   │   ├── incident.py              [MODIFIED]
│   │   ├── itinerary.py             [NEW]
│   │   ├── location.py
│   │   ├── response.py              [NEW]
│   │   ├── sos.py                   [MODIFIED]
│   │   └── tourist.py
│   └── tests/
│       └── test_api.py              [MODIFIED - 3 new tests]
└── frontend/
    └── src/
        ├── App.tsx                  [MODIFIED]
        ├── main.tsx
        ├── types.ts                 [MODIFIED]
        ├── index.css
        ├── components/
        │   ├── ActualGoogleMap.tsx
        │   ├── CrowdHeatmap.tsx
        │   ├── Gateway.tsx           [MODIFIED]
        │   ├── Header.tsx
        │   ├── InterceptionModal.tsx
        │   ├── ModuleAIHub.tsx
        │   ├── ModuleAnalyticsAudit.tsx
        │   ├── ModuleBroadcast.tsx
        │   ├── ModuleSOSMap.tsx
        │   ├── ModuleTouristTracking.tsx
        │   ├── Sidebar.tsx
        │   └── TouristPortal.tsx     [MODIFIED]
        ├── data/
        │   ├── i18n.ts               [MODIFIED]
        │   └── mockData.ts
        └── lib/
            ├── api.ts                [MODIFIED]
            ├── db.ts
            └── location.ts
```

---

## 2. Source Files

### `backend/config.py`

```python
import os
from dotenv import load_dotenv

# Load env variables from backend/.env if it exists
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

class Config:
    DATABASE_URL = os.getenv("DATABASE_URL", "")
    SUPABASE_URL = os.getenv("SUPABASE_URL", "")
    SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", os.getenv("SUPABASE_PUBLISHABLE_KEY", ""))
    JWT_SECRET = os.getenv("JWT_SECRET", "")
    CORS_ALLOWED_ORIGINS = [
        o.strip() for o in os.getenv("CORS_ALLOWED_ORIGINS", "").split(",") if o.strip()
    ]

    @classmethod
    def is_supabase_configured(cls) -> bool:
        return bool(cls.SUPABASE_URL and cls.SUPABASE_ANON_KEY)
```

### `backend/db.py`

```python
import json
import logging
from contextlib import contextmanager
import psycopg2
from psycopg2.pool import ThreadedConnectionPool
from config import Config

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("db")

pool = None
DB_ACTIVE = False

if Config.DATABASE_URL:
    try:
        # Initialize the threaded connection pool
        pool = ThreadedConnectionPool(
            minconn=1,
            maxconn=20,
            dsn=Config.DATABASE_URL
        )
        # Test connection
        conn = pool.getconn()
        with conn.cursor() as cur:
            cur.execute("SELECT 1;")
        pool.putconn(conn)
        DB_ACTIVE = True
        logger.info("Database connection pool initialized successfully.")
    except Exception as e:
        logger.warning(f"Failed to connect to database: {e}. Falling back to in-memory mode.")
        pool = None
        DB_ACTIVE = False
else:
    logger.info("DATABASE_URL not configured. Running in mock offline mode.")


def is_db_active() -> bool:
    return DB_ACTIVE


@contextmanager
def get_db_cursor(commit: bool = False):
    if not DB_ACTIVE or pool is None:
        raise RuntimeError("Database connection is not active.")
    conn = pool.getconn()
    cur = conn.cursor()
    try:
        yield cur
        if commit:
            conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cur.close()
        pool.putconn(conn)


@contextmanager
def get_authenticated_cursor(auth_user_id, commit: bool = False):
    if not DB_ACTIVE or pool is None:
        raise RuntimeError("Database connection is not active.")
    conn = pool.getconn()
    cur = conn.cursor()
    try:
        # Set JWT claims in the transaction
        claims_str = json.dumps({"sub": str(auth_user_id), "role": "authenticated"})
        cur.execute("SELECT set_config('request.jwt.claims', %s, true);", (claims_str,))
        # Set local role to authenticated
        cur.execute("SET LOCAL ROLE authenticated;")
        
        yield cur
        if commit:
            conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cur.close()
        pool.putconn(conn)
```

### `backend/main.py`

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import Config
from routers import alerts, audit_logs, auth, authority, incidents, itinerary, locations, sos, tourists

app = FastAPI(title="Smart Tourist Safety API")

# Starlette's CORSMiddleware raises a ValueError at startup if
# allow_credentials=True is combined with a wildcard ("*") origin, and an
# empty allow_origins list is equally unusable for a credentialed API. If
# CORS_ALLOWED_ORIGINS is unset/empty or contains "*", fall back to explicit
# localhost defaults so local development keeps working out-of-the-box
# without crashing the server on boot.
_configured_origins = Config.CORS_ALLOWED_ORIGINS
if not _configured_origins or "*" in _configured_origins:
    _cors_origins = ["http://localhost:3000", "http://localhost:5173"]
else:
    _cors_origins = _configured_origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/v1")
app.include_router(tourists.router, prefix="/api/v1")
app.include_router(incidents.router, prefix="/api/v1")
app.include_router(sos.router, prefix="/api/v1")
app.include_router(alerts.router, prefix="/api/v1")
app.include_router(authority.router, prefix="/api/v1")
app.include_router(locations.router, prefix="/api/v1")
app.include_router(itinerary.router, prefix="/api/v1")
app.include_router(audit_logs.router, prefix="/api/v1")
```

### `backend/routers/alerts.py`

```python
from datetime import datetime, timezone
from uuid import UUID, uuid4
from fastapi import APIRouter, Depends, HTTPException, status

from db import is_db_active, get_db_cursor, get_authenticated_cursor
from routers.auth import get_current_user
from schemas.auth import SessionResponse
from schemas.alert import AlertCreate, AlertResponse

router = APIRouter(prefix="/alerts", tags=["alerts"])

# Temporary in-memory storage for local API development only (fallback).
_in_memory_alert_store: dict[UUID, AlertResponse] = {}


@router.post("", response_model=AlertResponse, status_code=status.HTTP_201_CREATED)
def create_alert(
    payload: AlertCreate,
    current_user: SessionResponse = Depends(get_current_user)
) -> AlertResponse:
    # 1. Fallback Mode
    if not is_db_active():
        from routers.incidents import _get_incident_or_404
        _get_incident_or_404(payload.incident_id)

        alert = AlertResponse(
            alert_id=uuid4(),
            incident_id=payload.incident_id,
            channel=payload.channel,
            recipient=payload.recipient,
            sent_at=payload.sent_at or datetime.now(timezone.utc),
        )
        _in_memory_alert_store[alert.alert_id] = alert
        return alert

    # 2. Database Mode
    now = datetime.now(timezone.utc)
    alert_id = uuid4()
    sent_at = payload.sent_at or now
    
    try:
        with get_authenticated_cursor(current_user.auth_user_id, commit=True) as cur:
            # Verify incident exists
            cur.execute("SELECT incident_id FROM public.incidents WHERE incident_id = %s;", (payload.incident_id,))
            if not cur.fetchone():
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Incident not found",
                )
                
            cur.execute("""
                INSERT INTO public.alerts (alert_id, incident_id, channel, recipient, sent_at)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING alert_id, incident_id, channel, recipient, sent_at;
            """, (alert_id, payload.incident_id, payload.channel, payload.recipient, sent_at))
            
            row = cur.fetchone()
            return AlertResponse(
                alert_id=row[0],
                incident_id=row[1],
                channel=row[2],
                recipient=row[3],
                sent_at=row[4]
            )
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create alert: {str(e)}"
        )


@router.get("", response_model=list[AlertResponse])
def list_alerts(
    incident_id: UUID | None = None,
    current_user: SessionResponse = Depends(get_current_user)
) -> list[AlertResponse]:
    # 1. Fallback Mode
    if not is_db_active():
        alerts = list(_in_memory_alert_store.values())
        if incident_id is not None:
            alerts = [a for a in alerts if a.incident_id == incident_id]
        return alerts

    # 2. Database Mode
    try:
        with get_authenticated_cursor(current_user.auth_user_id) as cur:
            if incident_id is not None:
                cur.execute("""
                    SELECT alert_id, incident_id, channel, recipient, sent_at
                    FROM public.alerts
                    WHERE incident_id = %s;
                """, (incident_id,))
            else:
                cur.execute("""
                    SELECT alert_id, incident_id, channel, recipient, sent_at
                    FROM public.alerts;
                """)
                
            rows = cur.fetchall()
            return [
                AlertResponse(
                    alert_id=row[0],
                    incident_id=row[1],
                    channel=row[2],
                    recipient=row[3],
                    sent_at=row[4]
                )
                for row in rows
            ]
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve alerts: {str(e)}"
        )
```

### `backend/routers/audit_logs.py`

```python
from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, status

from db import is_db_active, get_authenticated_cursor
from routers.auth import require_authority
from schemas.auth import SessionResponse
from schemas.audit_log import AuditLogCreate, AuditLogRecord

router = APIRouter(prefix="/audit-logs", tags=["audit-logs"])

# Temporary in-memory storage for local API development only (fallback).
_in_memory_audit_log_store: dict[UUID, AuditLogRecord] = {}


@router.post("", response_model=AuditLogRecord, status_code=status.HTTP_201_CREATED)
def create_audit_log(
    payload: AuditLogCreate,
    request: Request,
    current_user: SessionResponse = Depends(require_authority)
) -> AuditLogRecord:
    now = datetime.now(timezone.utc)
    audit_id = uuid4()
    ip_address = payload.ip_address or (request.client.host if request.client else None)

    # 1. Fallback Mode
    if not is_db_active():
        record = AuditLogRecord(
            audit_id=audit_id,
            authority_id=current_user.authority_id,
            action_type=payload.action_type,
            target_id=payload.target_id,
            reason=payload.reason,
            details=payload.details,
            ip_address=ip_address,
            created_at=now,
        )
        _in_memory_audit_log_store[audit_id] = record
        return record

    # 2. Database Mode
    try:
        with get_authenticated_cursor(current_user.auth_user_id, commit=True) as cur:
            cur.execute("""
                INSERT INTO public.audit_logs (audit_id, authority_id, action_type, target_id, reason, details, ip_address, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING audit_id, authority_id, action_type, target_id, reason, details, ip_address, created_at;
            """, (
                audit_id, current_user.authority_id, payload.action_type, payload.target_id,
                payload.reason, payload.details, ip_address, now
            ))
            row = cur.fetchone()
            return AuditLogRecord(
                audit_id=row[0],
                authority_id=row[1],
                action_type=row[2],
                target_id=row[3],
                reason=row[4],
                details=row[5],
                ip_address=row[6],
                created_at=row[7],
            )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to persist audit log: {str(e)}"
        )


@router.get("", response_model=list[AuditLogRecord])
def list_audit_logs(
    current_user: SessionResponse = Depends(require_authority)
) -> list[AuditLogRecord]:
    # 1. Fallback Mode
    if not is_db_active():
        return sorted(_in_memory_audit_log_store.values(), key=lambda r: r.created_at, reverse=True)

    # 2. Database Mode
    try:
        with get_authenticated_cursor(current_user.auth_user_id) as cur:
            cur.execute("""
                SELECT audit_id, authority_id, action_type, target_id, reason, details, ip_address, created_at
                FROM public.audit_logs
                ORDER BY created_at DESC;
            """)
            rows = cur.fetchall()
            return [
                AuditLogRecord(
                    audit_id=row[0],
                    authority_id=row[1],
                    action_type=row[2],
                    target_id=row[3],
                    reason=row[4],
                    details=row[5],
                    ip_address=row[6],
                    created_at=row[7],
                )
                for row in rows
            ]
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve audit logs: {str(e)}"
        )
```

### `backend/routers/auth.py`

```python
import hashlib
import logging
import secrets
from datetime import datetime, timezone
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
    SessionResponse,
)

logger = logging.getLogger("auth")
router = APIRouter(prefix="/auth", tags=["auth"])

# Temporary in-memory stores for authentication records and active sessions (fallback mode).
_in_memory_auth_store: dict[UUID, dict] = {}
_in_memory_session_store: dict[str, dict] = {}


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
        if Config.JWT_SECRET:
            claims = jwt.decode(
                token,
                Config.JWT_SECRET,
                algorithms=["HS256"],
                options={"verify_aud": False}
            )
        else:
            claims = jwt.decode(token, options={"verify_signature": False})
        
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
```

### `backend/routers/authority.py`

```python
from uuid import UUID
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status

from db import is_db_active, get_db_cursor, get_authenticated_cursor
from routers.auth import login as auth_login, require_authority
from schemas.auth import LoginRequest, LoginResponse, SessionResponse
from schemas.alert import AlertResponse
from schemas.incident import IncidentResponse
from schemas.location import LocationResponse
from schemas.tourist import TouristResponse

router = APIRouter(prefix="/authority", tags=["authority"])


@router.post("/login", response_model=LoginResponse)
def authority_login(payload: LoginRequest) -> LoginResponse:
    login_resp = auth_login(payload)
    if login_resp.user_type != "authority":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account is not an authority account",
        )
    return login_resp


@router.get("/alerts", response_model=list[AlertResponse])
def get_authority_alerts(
    current_user: SessionResponse = Depends(require_authority)
) -> list[AlertResponse]:
    # 1. Fallback Mode
    if not is_db_active():
        from routers.alerts import _in_memory_alert_store
        return list(_in_memory_alert_store.values())

    # 2. Database Mode
    try:
        with get_authenticated_cursor(current_user.auth_user_id) as cur:
            cur.execute("""
                SELECT alert_id, incident_id, channel, recipient, sent_at
                FROM public.alerts;
            """)
            rows = cur.fetchall()
            return [
                AlertResponse(
                    alert_id=row[0],
                    incident_id=row[1],
                    channel=row[2],
                    recipient=row[3],
                    sent_at=row[4]
                )
                for row in rows
            ]
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve authority alerts: {str(e)}"
        )


@router.get("/incidents", response_model=list[IncidentResponse])
def get_authority_incidents(
    current_user: SessionResponse = Depends(require_authority)
) -> list[IncidentResponse]:
    # 1. Fallback Mode
    if not is_db_active():
        from routers.incidents import _in_memory_incident_store
        return list(_in_memory_incident_store.values())

    # 2. Database Mode
    try:
        with get_authenticated_cursor(current_user.auth_user_id) as cur:
            # New SOS-triggered incidents are created with authority_id = NULL
            # (unassigned/unclaimed). RLS on this table only allows an
            # authority to read incidents assigned to them, which would hide
            # every unassigned incident from every authority dashboard.
            # Explicitly widen the query to also include unassigned
            # incidents so dispatchers can see and claim new incidents.
            cur.execute("""
                SELECT incident_id, tourist_id, location_id, incident_type, severity, status, description, created_at, authority_id
                FROM public.incidents
                WHERE authority_id IS NULL OR authority_id = %s;
            """, (current_user.authority_id,))
            rows = cur.fetchall()
            return [
                IncidentResponse(
                    incident_id=row[0],
                    tourist_id=row[1],
                    location_id=row[2],
                    incident_type=row[3],
                    severity=row[4],
                    status=row[5],
                    description=row[6],
                    created_at=row[7],
                    authority_id=row[8]
                )
                for row in rows
            ]
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve authority incidents: {str(e)}"
        )


@router.get("/tourists/{tourist_id}", response_model=TouristResponse)
def get_authority_tourist_details(
    tourist_id: UUID,
    current_user: SessionResponse = Depends(require_authority)
) -> TouristResponse:
    # 1. Fallback Mode
    if not is_db_active():
        from routers.tourists import _get_tourist_or_404
        return _get_tourist_or_404(tourist_id)

    # 2. Database Mode
    try:
        with get_authenticated_cursor(current_user.auth_user_id) as cur:
            cur.execute("""
                SELECT tourist_id, digital_id, full_name, kyc_document_type, kyc_verified, phone, email, emergency_contact, preferred_language, created_at
                FROM public.tourists
                WHERE tourist_id = %s;
            """, (tourist_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Tourist profile not found",
                )
            return TouristResponse(
                tourist_id=row[0],
                digital_id=row[1],
                full_name=row[2],
                kyc_document_type=row[3],
                kyc_verified=row[4],
                phone=row[5],
                email=row[6],
                emergency_contact=row[7],
                preferred_language=row[8],
                created_at=row[9]
            )
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve tourist profile: {str(e)}"
        )


@router.get("/incidents/{incident_id}/location", response_model=LocationResponse)
def get_authority_incident_location(
    incident_id: UUID,
    current_user: SessionResponse = Depends(require_authority)
) -> LocationResponse:
    # 1. Fallback Mode
    if not is_db_active():
        from routers.incidents import _get_incident_or_404
        from routers.locations import _in_memory_location_store
        
        incident = _get_incident_or_404(incident_id)
        if incident.location_id is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Incident has no location assigned",
            )
        location = _in_memory_location_store.get(incident.location_id)
        if location is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Location not found",
            )
        return location

    # 2. Database Mode
    try:
        with get_authenticated_cursor(current_user.auth_user_id) as cur:
            cur.execute("SELECT location_id FROM public.incidents WHERE incident_id = %s;", (incident_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Incident not found",
                )
            loc_id = row[0]
            if not loc_id:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Incident has no location assigned",
                )
                
            cur.execute("""
                SELECT location_id, name, latitude, longitude, risk_level, recorded_at
                FROM public.locations
                WHERE location_id = %s;
            """, (loc_id,))
            loc_row = cur.fetchone()
            if not loc_row:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Location not found",
                )
            return LocationResponse(
                location_id=loc_row[0],
                name=loc_row[1],
                latitude=float(loc_row[2]) if loc_row[2] is not None else None,
                longitude=float(loc_row[3]) if loc_row[3] is not None else None,
                risk_level=loc_row[4],
                recorded_at=loc_row[5]
            )
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve incident location: {str(e)}"
        )
```

### `backend/routers/incidents.py`

```python
from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status

from db import is_db_active, get_db_cursor, get_authenticated_cursor
from routers.auth import get_current_user, require_authority
from schemas.auth import SessionResponse
from schemas.incident import IncidentCreate, IncidentResponse, IncidentUpdate
from schemas.location import LocationResponse
from schemas.response import ResponseCreate, ResponseRecord

router = APIRouter(prefix="/incidents", tags=["incidents"])

# Temporary in-memory storage for local API development only (fallback).
_in_memory_incident_store: dict[UUID, IncidentResponse] = {}
_in_memory_response_store: dict[UUID, ResponseRecord] = {}


def _get_incident_or_404(incident_id: UUID, current_user: SessionResponse | None = None) -> IncidentResponse:
    # 1. Fallback Mode
    if not is_db_active():
        incident = _in_memory_incident_store.get(incident_id)
        if incident is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Incident not found",
            )
        return incident

    # 2. Database Mode
    try:
        if current_user:
            cursor_ctx = get_authenticated_cursor(current_user.auth_user_id)
        else:
            cursor_ctx = get_db_cursor()
            
        with cursor_ctx as cur:
            cur.execute("""
                SELECT incident_id, tourist_id, location_id, incident_type, severity, status, description, created_at, authority_id
                FROM public.incidents
                WHERE incident_id = %s;
            """, (incident_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Incident not found",
                )
            return IncidentResponse(
                incident_id=row[0],
                tourist_id=row[1],
                location_id=row[2],
                incident_type=row[3],
                severity=row[4],
                status=row[5],
                description=row[6],
                created_at=row[7],
                authority_id=row[8]
            )
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database query failed: {str(e)}"
        )


@router.post("", response_model=IncidentResponse, status_code=status.HTTP_201_CREATED)
def create_incident(
    payload: IncidentCreate,
    current_user: SessionResponse = Depends(get_current_user)
) -> IncidentResponse:
    # 1. Fallback Mode
    if not is_db_active():
        from routers.tourists import _get_tourist_or_404
        from routers.locations import _in_memory_location_store
        
        _get_tourist_or_404(payload.tourist_id)

        now = datetime.now(timezone.utc)
        if payload.location_id is not None and payload.location_id not in _in_memory_location_store:
            _in_memory_location_store[payload.location_id] = LocationResponse(
                location_id=payload.location_id,
                recorded_at=now,
            )

        incident = IncidentResponse(
            incident_id=uuid4(),
            tourist_id=payload.tourist_id,
            location_id=payload.location_id,
            incident_type=payload.incident_type or "OTHER",
            severity=payload.severity or "MEDIUM",
            status=payload.status or "OPEN",
            description=payload.description,
            created_at=now,
            authority_id=payload.authority_id,
        )
        _in_memory_incident_store[incident.incident_id] = incident
        return incident

    # 2. Database Mode
    now = datetime.now(timezone.utc)
    incident_id = uuid4()
    
    try:
        with get_authenticated_cursor(current_user.auth_user_id, commit=True) as cur:
            # Verify tourist profile exists
            cur.execute("SELECT tourist_id FROM public.tourists WHERE tourist_id = %s;", (payload.tourist_id,))
            if not cur.fetchone():
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Tourist profile not found",
                )
                
            # Verify location exists, or resolve/create one — incidents.location_id is NOT NULL
            loc_id = payload.location_id
            if loc_id:
                cur.execute("SELECT location_id FROM public.locations WHERE location_id = %s;", (loc_id,))
                if not cur.fetchone():
                    # Generate automatic location entry
                    cur.execute("""
                        INSERT INTO public.locations (location_id, name, latitude, longitude, risk_level, recorded_at)
                        VALUES (%s, %s, %s, %s, %s, %s);
                    """, (loc_id, "Geocoded Tourist Incident Location", 0.0, 0.0, "LOW", now))
            else:
                # No location_id provided — create one from supplied coordinates (or a default placeholder)
                loc_id = uuid4()
                cur.execute("""
                    INSERT INTO public.locations (location_id, name, latitude, longitude, risk_level, recorded_at)
                    VALUES (%s, %s, %s, %s, %s, %s);
                """, (
                    loc_id, "Geocoded Tourist Incident Location",
                    payload.latitude if payload.latitude is not None else 0.0,
                    payload.longitude if payload.longitude is not None else 0.0,
                    "LOW", now
                ))
            
            cur.execute("""
                INSERT INTO public.incidents (incident_id, tourist_id, location_id, incident_type, severity, status, description, created_at, authority_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING incident_id, tourist_id, location_id, incident_type, severity, status, description, created_at, authority_id;
            """, (
                incident_id, payload.tourist_id, loc_id, payload.incident_type or "OTHER",
                payload.severity or "MEDIUM", payload.status or "OPEN", payload.description, now, payload.authority_id
            ))
            row = cur.fetchone()
            return IncidentResponse(
                incident_id=row[0],
                tourist_id=row[1],
                location_id=row[2],
                incident_type=row[3],
                severity=row[4],
                status=row[5],
                description=row[6],
                created_at=row[7],
                authority_id=row[8]
            )
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create incident: {str(e)}"
        )


@router.get("", response_model=list[IncidentResponse])
def list_incidents(
    status_filter: str | None = Query(default=None, alias="status"),
    current_user: SessionResponse = Depends(get_current_user)
) -> list[IncidentResponse]:
    # 1. Fallback Mode
    if not is_db_active():
        incidents = list(_in_memory_incident_store.values())
        if status_filter is not None:
            incidents = [i for i in incidents if i.status.lower() == status_filter.lower()]
        return incidents

    # 2. Database Mode
    try:
        # Run using user authenticated cursor so RLS policies automatically filter incidents
        with get_authenticated_cursor(current_user.auth_user_id) as cur:
            # New SOS-triggered incidents are created with authority_id = NULL
            # (unassigned/unclaimed). RLS only allows an authority to read
            # incidents assigned to them, which would hide every unassigned
            # incident from every authority dashboard. For authority users,
            # explicitly widen the query to also include unassigned
            # incidents. Tourist users are left on the original RLS-only
            # query, which already scopes correctly to their own incidents.
            is_authority = current_user.user_type == "authority"

            if status_filter and is_authority:
                cur.execute("""
                    SELECT incident_id, tourist_id, location_id, incident_type, severity, status, description, created_at, authority_id
                    FROM public.incidents
                    WHERE status = %s AND (authority_id IS NULL OR authority_id = %s);
                """, (status_filter, current_user.authority_id))
            elif status_filter:
                cur.execute("""
                    SELECT incident_id, tourist_id, location_id, incident_type, severity, status, description, created_at, authority_id
                    FROM public.incidents
                    WHERE status = %s;
                """, (status_filter,))
            elif is_authority:
                cur.execute("""
                    SELECT incident_id, tourist_id, location_id, incident_type, severity, status, description, created_at, authority_id
                    FROM public.incidents
                    WHERE authority_id IS NULL OR authority_id = %s;
                """, (current_user.authority_id,))
            else:
                cur.execute("""
                    SELECT incident_id, tourist_id, location_id, incident_type, severity, status, description, created_at, authority_id
                    FROM public.incidents;
                """)
                
            rows = cur.fetchall()
            return [
                IncidentResponse(
                    incident_id=row[0],
                    tourist_id=row[1],
                    location_id=row[2],
                    incident_type=row[3],
                    severity=row[4],
                    status=row[5],
                    description=row[6],
                    created_at=row[7],
                    authority_id=row[8]
                )
                for row in rows
            ]
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve incidents: {str(e)}"
        )


@router.get("/{incident_id}", response_model=IncidentResponse)
def get_incident(
    incident_id: UUID,
    current_user: SessionResponse = Depends(get_current_user)
) -> IncidentResponse:
    return _get_incident_or_404(incident_id, current_user)


@router.patch("/{incident_id}", response_model=IncidentResponse)
def update_incident(
    incident_id: UUID,
    payload: IncidentUpdate,
    current_user: SessionResponse = Depends(get_current_user)
) -> IncidentResponse:
    # 1. Fallback Mode
    if not is_db_active():
        incident = _get_incident_or_404(incident_id)
        update_data = payload.model_dump(exclude_unset=True)
        updated = incident.model_copy(update=update_data)
        _in_memory_incident_store[incident_id] = updated
        return updated

    # 2. Database Mode
    _get_incident_or_404(incident_id, current_user) # Verify existence/RLS permissions first
    
    update_data = payload.model_dump(exclude_unset=True)
    if not update_data:
        return _get_incident_or_404(incident_id, current_user)

    # When an authority dispatches to an incident (status -> RESPONDING),
    # link that authority to the incident record if it isn't already
    # assigned. This resolves incidents created with authority_id = NULL
    # into claimed, assigned incidents at the moment of dispatch.
    if (
        update_data.get("status") == "RESPONDING"
        and current_user.user_type == "authority"
        and "authority_id" not in update_data
    ):
        update_data["authority_id"] = current_user.authority_id

    set_clauses = []
    params = []
    for k, v in update_data.items():
        set_clauses.append(f"{k} = %s")
        params.append(v)
        
    params.append(incident_id)
    query = f"UPDATE public.incidents SET {', '.join(set_clauses)} WHERE incident_id = %s RETURNING incident_id, tourist_id, location_id, incident_type, severity, status, description, created_at, authority_id;"
    
    try:
        with get_authenticated_cursor(current_user.auth_user_id, commit=True) as cur:
            cur.execute(query, tuple(params))
            row = cur.fetchone()
            if not row:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Incident not found or unauthorized to update",
                )
            return IncidentResponse(
                incident_id=row[0],
                tourist_id=row[1],
                location_id=row[2],
                incident_type=row[3],
                severity=row[4],
                status=row[5],
                description=row[6],
                created_at=row[7],
                authority_id=row[8]
            )
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update incident: {str(e)}"
        )


# ---------------------------------------------------------------------------
# Responses (public.responses) — dispatch action logging
# ---------------------------------------------------------------------------

@router.post("/{incident_id}/responses", response_model=ResponseRecord, status_code=status.HTTP_201_CREATED)
def create_incident_response(
    incident_id: UUID,
    payload: ResponseCreate,
    current_user: SessionResponse = Depends(require_authority)
) -> ResponseRecord:
    authority_id = payload.authority_id or current_user.authority_id

    # 1. Fallback Mode
    if not is_db_active():
        incident = _in_memory_incident_store.get(incident_id)
        if incident is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Incident not found",
            )
        record = ResponseRecord(
            response_id=uuid4(),
            incident_id=incident_id,
            responder_unit=payload.responder_unit,
            action_taken=payload.action_taken,
            resolved_at=payload.resolved_at,
            authority_id=authority_id,
        )
        _in_memory_response_store[record.response_id] = record
        return record

    # 2. Database Mode
    response_id = uuid4()
    try:
        with get_authenticated_cursor(current_user.auth_user_id, commit=True) as cur:
            cur.execute("SELECT incident_id FROM public.incidents WHERE incident_id = %s;", (incident_id,))
            if not cur.fetchone():
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Incident not found",
                )

            cur.execute("""
                INSERT INTO public.responses (response_id, incident_id, responder_unit, action_taken, resolved_at, authority_id)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING response_id, incident_id, responder_unit, action_taken, resolved_at, authority_id;
            """, (response_id, incident_id, payload.responder_unit, payload.action_taken, payload.resolved_at, authority_id))

            row = cur.fetchone()
            return ResponseRecord(
                response_id=row[0],
                incident_id=row[1],
                responder_unit=row[2],
                action_taken=row[3],
                resolved_at=row[4],
                authority_id=row[5],
            )
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create response log: {str(e)}"
        )


@router.get("/{incident_id}/responses", response_model=list[ResponseRecord])
def list_incident_responses(
    incident_id: UUID,
    current_user: SessionResponse = Depends(get_current_user)
) -> list[ResponseRecord]:
    # 1. Fallback Mode
    if not is_db_active():
        return [r for r in _in_memory_response_store.values() if r.incident_id == incident_id]

    # 2. Database Mode
    try:
        with get_authenticated_cursor(current_user.auth_user_id) as cur:
            cur.execute("""
                SELECT response_id, incident_id, responder_unit, action_taken, resolved_at, authority_id
                FROM public.responses
                WHERE incident_id = %s;
            """, (incident_id,))
            rows = cur.fetchall()
            return [
                ResponseRecord(
                    response_id=row[0],
                    incident_id=row[1],
                    responder_unit=row[2],
                    action_taken=row[3],
                    resolved_at=row[4],
                    authority_id=row[5],
                )
                for row in rows
            ]
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve response logs: {str(e)}"
        )
```

### `backend/routers/itinerary.py`

```python
from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status

from db import is_db_active, get_authenticated_cursor
from routers.auth import require_tourist
from schemas.auth import SessionResponse
from schemas.itinerary import ItineraryEntryCreate, ItineraryEntryResponse

router = APIRouter(prefix="/itinerary", tags=["itinerary"])

# Temporary in-memory storage for local API development only (fallback).
_in_memory_itinerary_store: dict[UUID, ItineraryEntryResponse] = {}


@router.post("", response_model=ItineraryEntryResponse, status_code=status.HTTP_201_CREATED)
def create_itinerary_entry(
    payload: ItineraryEntryCreate,
    current_user: SessionResponse = Depends(require_tourist)
) -> ItineraryEntryResponse:
    tourist_id = current_user.tourist_id

    # 1. Fallback Mode
    if not is_db_active():
        location_id = payload.location_id or uuid4()
        entry = ItineraryEntryResponse(
            itinerary_id=uuid4(),
            tourist_id=tourist_id,
            location_id=location_id,
            location_name=payload.destination_name,
            planned_arrival=payload.planned_arrival,
            planned_departure=payload.planned_departure,
        )
        _in_memory_itinerary_store[entry.itinerary_id] = entry
        return entry

    # 2. Database Mode
    now = datetime.now(timezone.utc)
    itinerary_id = uuid4()

    try:
        with get_authenticated_cursor(current_user.auth_user_id, commit=True) as cur:
            loc_id = payload.location_id
            loc_name = payload.destination_name

            if loc_id:
                cur.execute("SELECT location_id, name FROM public.locations WHERE location_id = %s;", (loc_id,))
                row = cur.fetchone()
                if not row:
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail="Location not found",
                    )
                loc_name = row[1]
            else:
                # No location_id supplied — resolve/create one from the
                # destination name and optional coordinates, matching the
                # existing location-resolution pattern used by incidents/SOS.
                loc_id = uuid4()
                cur.execute("""
                    INSERT INTO public.locations (location_id, name, latitude, longitude, risk_level, recorded_at)
                    VALUES (%s, %s, %s, %s, %s, %s);
                """, (
                    loc_id, payload.destination_name or "Itinerary Destination",
                    payload.latitude if payload.latitude is not None else 0.0,
                    payload.longitude if payload.longitude is not None else 0.0,
                    "LOW", now
                ))

            cur.execute("""
                INSERT INTO public.itinerary_entries (itinerary_id, tourist_id, location_id, planned_arrival, planned_departure)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING itinerary_id, tourist_id, location_id, planned_arrival, planned_departure;
            """, (itinerary_id, tourist_id, loc_id, payload.planned_arrival, payload.planned_departure))

            row = cur.fetchone()
            return ItineraryEntryResponse(
                itinerary_id=row[0],
                tourist_id=row[1],
                location_id=row[2],
                location_name=loc_name,
                planned_arrival=row[3],
                planned_departure=row[4],
            )
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create itinerary entry: {str(e)}"
        )


@router.get("", response_model=list[ItineraryEntryResponse])
def list_itinerary_entries(
    current_user: SessionResponse = Depends(require_tourist)
) -> list[ItineraryEntryResponse]:
    tourist_id = current_user.tourist_id

    # 1. Fallback Mode
    if not is_db_active():
        return [e for e in _in_memory_itinerary_store.values() if e.tourist_id == tourist_id]

    # 2. Database Mode
    try:
        with get_authenticated_cursor(current_user.auth_user_id) as cur:
            cur.execute("""
                SELECT ie.itinerary_id, ie.tourist_id, ie.location_id, l.name, ie.planned_arrival, ie.planned_departure
                FROM public.itinerary_entries ie
                LEFT JOIN public.locations l ON l.location_id = ie.location_id
                WHERE ie.tourist_id = %s;
            """, (tourist_id,))
            rows = cur.fetchall()
            return [
                ItineraryEntryResponse(
                    itinerary_id=row[0],
                    tourist_id=row[1],
                    location_id=row[2],
                    location_name=row[3],
                    planned_arrival=row[4],
                    planned_departure=row[5],
                )
                for row in rows
            ]
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve itinerary entries: {str(e)}"
        )


@router.delete("/{itinerary_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_itinerary_entry(
    itinerary_id: UUID,
    current_user: SessionResponse = Depends(require_tourist)
) -> None:
    # 1. Fallback Mode
    if not is_db_active():
        entry = _in_memory_itinerary_store.get(itinerary_id)
        if entry is None or entry.tourist_id != current_user.tourist_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Itinerary entry not found",
            )
        del _in_memory_itinerary_store[itinerary_id]
        return None

    # 2. Database Mode
    try:
        with get_authenticated_cursor(current_user.auth_user_id, commit=True) as cur:
            cur.execute("""
                DELETE FROM public.itinerary_entries
                WHERE itinerary_id = %s AND tourist_id = %s
                RETURNING itinerary_id;
            """, (itinerary_id, current_user.tourist_id))
            row = cur.fetchone()
            if not row:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Itinerary entry not found or unauthorized to delete",
                )
            return None
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete itinerary entry: {str(e)}"
        )
```

### `backend/routers/locations.py`

```python
from uuid import UUID
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, status, Depends

from db import is_db_active, get_authenticated_cursor
from routers.auth import get_current_user
from schemas.auth import SessionResponse
from schemas.location import LocationResponse

router = APIRouter(prefix="/locations", tags=["locations"])

# Temporary in-memory location storage for local API development only (fallback).
_in_memory_location_store: dict[UUID, LocationResponse] = {}


def _get_location_or_404(location_id: UUID, current_user: SessionResponse) -> LocationResponse:
    # 1. Fallback Mode
    if not is_db_active():
        location = _in_memory_location_store.get(location_id)
        if location is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Location not found",
            )
        return location

    # 2. Database Mode
    try:
        with get_authenticated_cursor(current_user.auth_user_id) as cur:
            cur.execute("""
                SELECT location_id, name, latitude, longitude, risk_level, recorded_at
                FROM public.locations
                WHERE location_id = %s;
            """, (location_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Location not found",
                )
            return LocationResponse(
                location_id=row[0],
                name=row[1],
                latitude=float(row[2]) if row[2] is not None else None,
                longitude=float(row[3]) if row[3] is not None else None,
                risk_level=row[4],
                recorded_at=row[5]
            )
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database query failed: {str(e)}"
        )


@router.get("", response_model=list[LocationResponse])
def list_locations(current_user: SessionResponse = Depends(get_current_user)) -> list[LocationResponse]:
    # 1. Fallback Mode
    if not is_db_active():
        return list(_in_memory_location_store.values())

    # 2. Database Mode
    try:
        with get_authenticated_cursor(current_user.auth_user_id) as cur:
            cur.execute("""
                SELECT location_id, name, latitude, longitude, risk_level, recorded_at
                FROM public.locations
                ORDER BY recorded_at DESC;
            """)
            rows = cur.fetchall()
            return [
                LocationResponse(
                    location_id=row[0],
                    name=row[1],
                    latitude=float(row[2]) if row[2] is not None else None,
                    longitude=float(row[3]) if row[3] is not None else None,
                    risk_level=row[4],
                    recorded_at=row[5]
                )
                for row in rows
            ]
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve locations: {str(e)}"
        )


@router.get("/{location_id}", response_model=LocationResponse)
def get_location(
    location_id: UUID,
    current_user: SessionResponse = Depends(get_current_user)
) -> LocationResponse:
    return _get_location_or_404(location_id, current_user)
```

### `backend/routers/sos.py`

```python
from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status

from db import is_db_active, get_db_cursor, get_authenticated_cursor
from routers.auth import get_current_user
from schemas.auth import SessionResponse
from schemas.incident import IncidentResponse
from schemas.location import LocationResponse
from schemas.sos import SOSCreate, SOSResponse

router = APIRouter(prefix="/sos", tags=["sos"])

# Temporary in-memory storage for local API development only (fallback).
_in_memory_sos_store: dict[UUID, SOSResponse] = {}


@router.post("", response_model=SOSResponse, status_code=status.HTTP_201_CREATED)
def create_sos(
    payload: SOSCreate,
    current_user: SessionResponse = Depends(get_current_user)
) -> SOSResponse:
    # 1. Fallback Mode
    if not is_db_active():
        from routers.tourists import _get_tourist_or_404
        from routers.incidents import _in_memory_incident_store
        from routers.locations import _in_memory_location_store
        
        _get_tourist_or_404(payload.tourist_id)

        now = datetime.now(timezone.utc)
        location_id = uuid4()
        location = LocationResponse(
            location_id=location_id,
            name=f"SOS Alarm - {payload.tourist_id}",
            latitude=payload.latitude,
            longitude=payload.longitude,
            risk_level="HIGH",
            recorded_at=now,
        )
        _in_memory_location_store[location_id] = location

        incident_id = uuid4()
        incident = IncidentResponse(
            incident_id=incident_id,
            tourist_id=payload.tourist_id,
            location_id=location_id,
            incident_type="SOS",
            severity="HIGH",
            status="OPEN",
            description="SOS Alarm Triggered",
            created_at=now,
            authority_id=None,
        )
        _in_memory_incident_store[incident_id] = incident

        sos = SOSResponse(
            sos_id=uuid4(),
            tourist_id=payload.tourist_id,
            incident_id=incident_id,
            location_id=location_id,
            incident_type="SOS",
            severity="HIGH",
            status="OPEN",
            description="SOS Alarm Triggered",
            triggered_at=now,
            created_at=now,
            trigger_source=payload.trigger_source or "APP",
            sos_status="ACTIVE"
        )
        _in_memory_sos_store[sos.sos_id] = sos
        return sos

    # 2. Database Mode
    now = datetime.now(timezone.utc)
    location_id = uuid4()
    incident_id = uuid4()
    sos_id = uuid4()
    
    try:
        with get_authenticated_cursor(current_user.auth_user_id, commit=True) as cur:
            # Verify tourist profile exists
            cur.execute("SELECT tourist_id FROM public.tourists WHERE tourist_id = %s;", (payload.tourist_id,))
            if not cur.fetchone():
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Tourist profile not found",
                )
                
            # Create a location record for this SOS coordinate
            cur.execute("""
                INSERT INTO public.locations (location_id, name, latitude, longitude, risk_level, recorded_at)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING location_id;
            """, (location_id, f"SOS Alarm - {payload.tourist_id}", payload.latitude, payload.longitude, "HIGH", now))
            
            # Create an incident record linking to the location
            cur.execute("""
                INSERT INTO public.incidents (incident_id, tourist_id, location_id, incident_type, severity, status, description, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING incident_id;
            """, (incident_id, payload.tourist_id, location_id, "SOS", "HIGH", "OPEN", "SOS Alarm Triggered", now))
            
            # Create the SOS request record
            cur.execute("""
                INSERT INTO public.sos_requests (sos_id, tourist_id, incident_id, location_id, trigger_source, sos_status, triggered_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING sos_id, tourist_id, incident_id, location_id, trigger_source, sos_status, triggered_at;
            """, (sos_id, payload.tourist_id, incident_id, location_id, payload.trigger_source or "APP", "ACTIVE", now))
            
            row = cur.fetchone()
            return SOSResponse(
                sos_id=row[0],
                tourist_id=row[1],
                incident_id=row[2],
                location_id=row[3],
                incident_type="SOS",
                severity="HIGH",
                status="OPEN",
                description="SOS Alarm Triggered",
                triggered_at=row[6],
                created_at=row[6],
                trigger_source=row[4],
                sos_status=row[5]
            )
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to activate SOS alarm: {str(e)}"
        )
```

### `backend/routers/tourists.py`

```python
from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status

from db import is_db_active, get_db_cursor, get_authenticated_cursor
from routers.auth import get_current_user
from schemas.auth import SessionResponse
from schemas.tourist import DigitalIdResponse, TouristCreate, TouristResponse, TouristUpdate

router = APIRouter(prefix="/tourists", tags=["tourists"])

# Temporary in-memory storage for local API development only (fallback).
_in_memory_tourist_store: dict[UUID, TouristResponse] = {}


def _get_tourist_or_404(tourist_id: UUID, current_user: SessionResponse | None = None) -> TouristResponse:
    # 1. Fallback Mode
    if not is_db_active():
        tourist = _in_memory_tourist_store.get(tourist_id)
        if tourist is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Tourist not found",
            )
        return tourist

    # 2. Database Mode
    # If a current user is present, use their authenticated cursor (RLS policy applies).
    # Otherwise, fallback to system db cursor (e.g. for registration or system actions).
    try:
        if current_user and current_user.user_type == "tourist":
            cursor_ctx = get_authenticated_cursor(current_user.auth_user_id)
        else:
            cursor_ctx = get_db_cursor()
            
        with cursor_ctx as cur:
            cur.execute("""
                SELECT tourist_id, digital_id, full_name, kyc_document_type, kyc_verified, phone, email, emergency_contact, preferred_language, created_at
                FROM public.tourists
                WHERE tourist_id = %s;
            """, (tourist_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Tourist profile not found",
                )
            return TouristResponse(
                tourist_id=row[0],
                digital_id=row[1],
                full_name=row[2],
                kyc_document_type=row[3],
                kyc_verified=row[4],
                phone=row[5],
                email=row[6],
                emergency_contact=row[7],
                preferred_language=row[8],
                created_at=row[9]
            )
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database query failed: {str(e)}"
        )


@router.post("", response_model=TouristResponse, status_code=status.HTTP_201_CREATED)
def create_tourist(
    payload: TouristCreate,
    current_user: SessionResponse = Depends(get_current_user)
) -> TouristResponse:
    # 1. Fallback Mode
    if not is_db_active():
        tourist = TouristResponse(
            tourist_id=uuid4(),
            digital_id=payload.digital_id,
            full_name=payload.full_name,
            kyc_document_type=payload.kyc_document_type,
            kyc_verified=payload.kyc_verified,
            phone=payload.phone,
            email=payload.email,
            emergency_contact=payload.emergency_contact,
            preferred_language=payload.preferred_language,
            created_at=datetime.now(timezone.utc),
        )
        _in_memory_tourist_store[tourist.tourist_id] = tourist
        return tourist

    # 2. Database Mode
    now = datetime.now(timezone.utc)
    tourist_id = uuid4()
    digital_id = payload.digital_id or f"DIG-{uuid4().hex[:8].upper()}"
    
    try:
        # Run under the current user's authenticated transaction
        with get_authenticated_cursor(current_user.auth_user_id, commit=True) as cur:
            cur.execute("""
                INSERT INTO public.tourists (
                    tourist_id, auth_user_id, digital_id, full_name, kyc_document_type, 
                    kyc_verified, phone, email, emergency_contact, preferred_language, created_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING tourist_id, digital_id, full_name, kyc_document_type, kyc_verified, phone, email, emergency_contact, preferred_language, created_at;
            """, (
                tourist_id, current_user.auth_user_id, digital_id, payload.full_name, payload.kyc_document_type,
                payload.kyc_verified or False, payload.phone, payload.email, payload.emergency_contact, payload.preferred_language, now
            ))
            row = cur.fetchone()
            
            # Map this profile to authentication table as well if needed
            cur.execute("""
                UPDATE public.authentication
                SET tourist_id = %s
                WHERE auth_user_id = %s;
            """, (tourist_id, current_user.auth_user_id))
            
            return TouristResponse(
                tourist_id=row[0],
                digital_id=row[1],
                full_name=row[2],
                kyc_document_type=row[3],
                kyc_verified=row[4],
                phone=row[5],
                email=row[6],
                emergency_contact=row[7],
                preferred_language=row[8],
                created_at=row[9]
            )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create tourist profile: {str(e)}"
        )


@router.get("/{tourist_id}", response_model=TouristResponse)
def get_tourist(
    tourist_id: UUID,
    current_user: SessionResponse = Depends(get_current_user)
) -> TouristResponse:
    return _get_tourist_or_404(tourist_id, current_user)


@router.get("/{tourist_id}/digital-id", response_model=DigitalIdResponse)
def get_tourist_digital_id(
    tourist_id: UUID,
    current_user: SessionResponse = Depends(get_current_user)
) -> DigitalIdResponse:
    tourist = _get_tourist_or_404(tourist_id, current_user)
    return DigitalIdResponse.model_validate(tourist)


@router.patch("/{tourist_id}", response_model=TouristResponse)
def update_tourist(
    tourist_id: UUID,
    payload: TouristUpdate,
    current_user: SessionResponse = Depends(get_current_user)
) -> TouristResponse:
    # 1. Fallback Mode
    if not is_db_active():
        tourist = _get_tourist_or_404(tourist_id)
        update_data = payload.model_dump(exclude_unset=True)
        updated = tourist.model_copy(update=update_data)
        _in_memory_tourist_store[tourist_id] = updated
        return updated

    # 2. Database Mode
    _get_tourist_or_404(tourist_id, current_user)  # Verify existence and RLS permission first
    
    update_data = payload.model_dump(exclude_unset=True)
    if not update_data:
        return _get_tourist_or_404(tourist_id, current_user)
        
    set_clauses = []
    params = []
    for k, v in update_data.items():
        set_clauses.append(f"{k} = %s")
        params.append(v)
        
    params.append(tourist_id)
    query = f"UPDATE public.tourists SET {', '.join(set_clauses)} WHERE tourist_id = %s RETURNING tourist_id, digital_id, full_name, kyc_document_type, kyc_verified, phone, email, emergency_contact, preferred_language, created_at;"
    
    try:
        with get_authenticated_cursor(current_user.auth_user_id, commit=True) as cur:
            cur.execute(query, tuple(params))
            row = cur.fetchone()
            return TouristResponse(
                tourist_id=row[0],
                digital_id=row[1],
                full_name=row[2],
                kyc_document_type=row[3],
                kyc_verified=row[4],
                phone=row[5],
                email=row[6],
                emergency_contact=row[7],
                preferred_language=row[8],
                created_at=row[9]
            )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update tourist profile: {str(e)}"
        )
```

### `backend/schemas/alert.py`

```python
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class AlertCreate(BaseModel):
    incident_id: UUID
    channel: str
    recipient: str
    sent_at: datetime | None = None


class AlertResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    alert_id: UUID
    incident_id: UUID
    channel: str
    recipient: str
    sent_at: datetime
```

### `backend/schemas/audit_log.py`

```python
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class AuditLogCreate(BaseModel):
    action_type: str
    target_id: str
    reason: str | None = None
    details: str | None = None
    ip_address: str | None = None


class AuditLogRecord(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    audit_id: UUID
    authority_id: UUID
    action_type: str
    target_id: str
    reason: str | None = None
    details: str | None = None
    ip_address: str | None = None
    created_at: datetime
```

### `backend/schemas/auth.py`

```python
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class RegisterRequest(BaseModel):
    username: str
    password: str
    user_type: str = "tourist"  # "tourist" or "authority"
    tourist_id: UUID | None = None
    authority_id: UUID | None = None
    mfa_enabled: bool = False


class LoginRequest(BaseModel):
    username: str
    password: str


class AuthResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    auth_id: UUID
    tourist_id: UUID | None = None
    authority_id: UUID | None = None
    username: str
    user_type: str
    mfa_enabled: bool
    last_login_at: datetime | None = None
    created_at: datetime


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    auth_id: UUID
    username: str
    user_type: str
    tourist_id: UUID | None = None
    authority_id: UUID | None = None
    mfa_enabled: bool
    last_login_at: datetime | None = None


class SessionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    auth_id: UUID
    auth_user_id: UUID
    username: str
    user_type: str
    tourist_id: UUID | None = None
    authority_id: UUID | None = None
    mfa_enabled: bool
    last_login_at: datetime | None = None
```

### `backend/schemas/incident.py`

```python
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class IncidentCreate(BaseModel):
    tourist_id: UUID
    location_id: UUID | None = None
    latitude: float | None = None
    longitude: float | None = None
    incident_type: str | None = "OTHER"
    severity: str | None = "MEDIUM"
    status: str = "OPEN"
    description: str | None = None
    authority_id: UUID | None = None


class IncidentUpdate(BaseModel):
    status: str | None = None
    severity: str | None = None
    description: str | None = None
    authority_id: UUID | None = None


class IncidentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    incident_id: UUID
    tourist_id: UUID
    location_id: UUID | None = None
    incident_type: str | None = None
    severity: str | None = None
    status: str
    description: str | None = None
    created_at: datetime
    authority_id: UUID | None = None
```

### `backend/schemas/itinerary.py`

```python
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class ItineraryEntryCreate(BaseModel):
    location_id: UUID | None = None
    # Optional convenience fields — when location_id is not supplied, a
    # location record is resolved/created from a plain destination name
    # (and optional coordinates), mirroring how incidents/sos resolve
    # locations elsewhere in the backend.
    destination_name: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    planned_arrival: datetime | None = None
    planned_departure: datetime | None = None


class ItineraryEntryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    itinerary_id: UUID
    tourist_id: UUID
    location_id: UUID
    location_name: str | None = None
    planned_arrival: datetime | None = None
    planned_departure: datetime | None = None
```

### `backend/schemas/location.py`

```python
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class LocationCreate(BaseModel):
    name: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    risk_level: str | None = None
    recorded_at: datetime | None = None


class LocationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    location_id: UUID
    name: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    risk_level: str | None = None
    recorded_at: datetime | None = None
```

### `backend/schemas/response.py`

```python
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class ResponseCreate(BaseModel):
    responder_unit: str | None = None
    action_taken: str | None = None
    resolved_at: datetime | None = None
    # Optional explicit override — defaults to the authenticated authority's
    # own authority_id when omitted.
    authority_id: UUID | None = None


class ResponseRecord(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    response_id: UUID
    incident_id: UUID
    responder_unit: str | None = None
    action_taken: str | None = None
    resolved_at: datetime | None = None
    authority_id: UUID
```

### `backend/schemas/sos.py`

```python
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class SOSCreate(BaseModel):
    tourist_id: UUID
    location_id: UUID | None = None
    latitude: float | None = None
    longitude: float | None = None
    description: str | None = None
    severity: str | None = "HIGH"
    trigger_source: str | None = "APP"


class SOSResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    sos_id: UUID
    tourist_id: UUID
    incident_id: UUID | None = None
    location_id: UUID | None = None
    incident_type: str = "SOS"
    severity: str | None = None
    status: str = "OPEN"
    description: str | None = None
    triggered_at: datetime
    created_at: datetime
    trigger_source: str | None = "APP"
    sos_status: str = "ACTIVE"
```

### `backend/schemas/tourist.py`

```python
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class TouristCreate(BaseModel):
    full_name: str
    digital_id: str | None = None
    kyc_document_type: str | None = None
    kyc_verified: bool | None = None
    phone: str | None = None
    email: str | None = None
    emergency_contact: str | None = None
    preferred_language: str | None = None


class TouristUpdate(BaseModel):
    digital_id: str | None = None
    full_name: str | None = None
    kyc_document_type: str | None = None
    kyc_verified: bool | None = None
    phone: str | None = None
    email: str | None = None
    emergency_contact: str | None = None
    preferred_language: str | None = None


class TouristResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    tourist_id: UUID
    digital_id: str | None = None
    full_name: str | None = None
    kyc_document_type: str | None = None
    kyc_verified: bool | None = None
    phone: str | None = None
    email: str | None = None
    emergency_contact: str | None = None
    preferred_language: str | None = None
    created_at: datetime


class DigitalIdResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    tourist_id: UUID
    digital_id: str | None = None
    full_name: str | None = None
    kyc_document_type: str | None = None
    kyc_verified: bool | None = None
```

### `backend/tests/test_api.py`

```python
import os
import sys
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient

# Ensure backend root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.dirname(os.path.dirname(__file__))))

from main import app

client = TestClient(app)

@pytest.fixture
def auth_headers_tourist():
    # Register tourist
    username = f"tourist_{uuid4().hex[:6]}"
    reg_payload = {
        "username": username,
        "password": "Password123!",
        "user_type": "tourist",
        "mfa_enabled": False
    }
    reg_resp = client.post("/api/v1/auth/register", json=reg_payload)
    assert reg_resp.status_code == 201
    
    # Login tourist
    login_resp = client.post("/api/v1/auth/login", json={
        "username": username,
        "password": "Password123!"
    })
    assert login_resp.status_code == 200
    token = login_resp.json()["access_token"]
    tourist_id = login_resp.json()["tourist_id"]
    return {
        "Authorization": f"Bearer {token}",
        "tourist_id": tourist_id,
        "username": username
    }

@pytest.fixture
def auth_headers_authority():
    # Register authority
    username = f"auth_{uuid4().hex[:6]}"
    reg_payload = {
        "username": username,
        "password": "Password123!",
        "user_type": "authority",
        "mfa_enabled": False
    }
    reg_resp = client.post("/api/v1/auth/register", json=reg_payload)
    assert reg_resp.status_code == 201
    
    # Login authority
    login_resp = client.post("/api/v1/auth/login", json={
        "username": username,
        "password": "Password123!"
    })
    assert login_resp.status_code == 200
    token = login_resp.json()["access_token"]
    authority_id = login_resp.json()["authority_id"]
    return {
        "Authorization": f"Bearer {token}",
        "authority_id": authority_id,
        "username": username
    }

def test_auth_flows(auth_headers_tourist):
    headers = {"Authorization": auth_headers_tourist["Authorization"]}
    session_resp = client.get("/api/v1/auth/session", headers=headers)
    assert session_resp.status_code == 200
    assert session_resp.json()["username"] == auth_headers_tourist["username"]
    assert session_resp.json()["user_type"] == "tourist"

def test_tourist_profile(auth_headers_tourist):
    headers = {"Authorization": auth_headers_tourist["Authorization"]}
    tourist_id = auth_headers_tourist["tourist_id"]
    
    # Retrieve profile
    get_resp = client.get(f"/api/v1/tourists/{tourist_id}", headers=headers)
    assert get_resp.status_code == 200
    
    # Get digital ID
    did_resp = client.get(f"/api/v1/tourists/{tourist_id}/digital-id", headers=headers)
    assert did_resp.status_code == 200
    assert "digital_id" in did_resp.json()
    
    # Update profile
    patch_resp = client.patch(f"/api/v1/tourists/{tourist_id}", headers=headers, json={
        "full_name": "Updated Full Name",
        "phone": "+1234567890",
        "emergency_contact": "Emergency Contact Info"
    })
    assert patch_resp.status_code == 200
    assert patch_resp.json()["full_name"] == "Updated Full Name"
    assert patch_resp.json()["phone"] == "+1234567890"

def test_incident_flows(auth_headers_tourist, auth_headers_authority):
    t_headers = {"Authorization": auth_headers_tourist["Authorization"]}
    a_headers = {"Authorization": auth_headers_authority["Authorization"]}
    tourist_id = auth_headers_tourist["tourist_id"]
    
    # 1. Create location first
    location_id = str(uuid4())
    
    # 2. Create incident
    inc_payload = {
        "tourist_id": tourist_id,
        "location_id": location_id,
        "incident_type": "THEFT",
        "severity": "HIGH",
        "status": "OPEN",
        "description": "Stolen backpack at monument"
    }
    
    create_resp = client.post("/api/v1/incidents", json=inc_payload, headers=t_headers)
    assert create_resp.status_code == 201
    incident_id = create_resp.json()["incident_id"]
    
    # 3. Retrieve incident
    get_resp = client.get(f"/api/v1/incidents/{incident_id}", headers=t_headers)
    assert get_resp.status_code == 200
    assert get_resp.json()["description"] == "Stolen backpack at monument"
    
    # 4. List incidents
    list_resp = client.get("/api/v1/incidents", headers=t_headers)
    assert list_resp.status_code == 200
    assert len(list_resp.json()) >= 1
    
    # 5. Patch incident
    patch_resp = client.patch(f"/api/v1/incidents/{incident_id}", json={"status": "RESOLVED"}, headers=t_headers)
    assert patch_resp.status_code == 200
    assert patch_resp.json()["status"] == "RESOLVED"

def test_sos_alarm(auth_headers_tourist):
    headers = {"Authorization": auth_headers_tourist["Authorization"]}
    tourist_id = auth_headers_tourist["tourist_id"]
    
    sos_payload = {
        "tourist_id": tourist_id,
        "latitude": 40.7128,
        "longitude": -74.0060
    }
    
    resp = client.post("/api/v1/sos", json=sos_payload, headers=headers)
    assert resp.status_code == 201
    data = resp.json()
    assert data["sos_status"] == "ACTIVE"
    assert data["status"] == "OPEN"
    assert data["tourist_id"] == tourist_id
    assert data["location_id"] is not None
    assert data["incident_id"] is not None

def test_alerts(auth_headers_tourist):
    headers = {"Authorization": auth_headers_tourist["Authorization"]}
    tourist_id = auth_headers_tourist["tourist_id"]
    
    # Create incident first
    inc_payload = {
        "tourist_id": tourist_id,
        "incident_type": "WEATHER",
        "severity": "MEDIUM",
        "status": "OPEN",
        "description": "Heavy rainfall"
    }
    inc_resp = client.post("/api/v1/incidents", json=inc_payload, headers=headers)
    assert inc_resp.status_code == 201
    incident_id = inc_resp.json()["incident_id"]
    
    # Create alert
    alert_payload = {
        "incident_id": incident_id,
        "channel": "SMS",
        "recipient": "+1987654321"
    }
    create_resp = client.post("/api/v1/alerts", json=alert_payload, headers=headers)
    assert create_resp.status_code == 201
    
    # List alerts
    list_resp = client.get(f"/api/v1/alerts?incident_id={incident_id}", headers=headers)
    assert list_resp.status_code == 200
    assert len(list_resp.json()) >= 1
    assert list_resp.json()[0]["incident_id"] == incident_id

def test_locations(auth_headers_tourist):
    headers = {"Authorization": auth_headers_tourist["Authorization"]}
    
    # Get locations
    resp = client.get("/api/v1/locations", headers=headers)
    assert resp.status_code == 200

def test_authority_endpoints(auth_headers_tourist, auth_headers_authority):
    a_headers = {"Authorization": auth_headers_authority["Authorization"]}
    t_headers = {"Authorization": auth_headers_tourist["Authorization"]}
    tourist_id = auth_headers_tourist["tourist_id"]
    
    # 1. Accessing authority details as tourist should fail (403)
    fail_resp = client.get("/api/v1/authority/incidents", headers=t_headers)
    assert fail_resp.status_code == 403
    
    # 2. Get authority incidents
    resp = client.get("/api/v1/authority/incidents", headers=a_headers)
    assert resp.status_code == 200
    
    # 3. Get tourist details
    tourist_resp = client.get(f"/api/v1/authority/tourists/{tourist_id}", headers=a_headers)
    assert tourist_resp.status_code == 200
    assert tourist_resp.json()["tourist_id"] == tourist_id


def test_itinerary_flows(auth_headers_tourist):
    headers = {"Authorization": auth_headers_tourist["Authorization"]}

    create_payload = {
        "destination_name": "Rohtang Pass Viewpoint",
        "latitude": 32.3728,
        "longitude": 77.2491,
    }
    create_resp = client.post("/api/v1/itinerary", json=create_payload, headers=headers)
    assert create_resp.status_code == 201
    itinerary_id = create_resp.json()["itinerary_id"]
    assert create_resp.json()["tourist_id"] == auth_headers_tourist["tourist_id"]

    list_resp = client.get("/api/v1/itinerary", headers=headers)
    assert list_resp.status_code == 200
    assert any(e["itinerary_id"] == itinerary_id for e in list_resp.json())

    delete_resp = client.delete(f"/api/v1/itinerary/{itinerary_id}", headers=headers)
    assert delete_resp.status_code == 204

    list_resp_after = client.get("/api/v1/itinerary", headers=headers)
    assert list_resp_after.status_code == 200
    assert not any(e["itinerary_id"] == itinerary_id for e in list_resp_after.json())


def test_incident_response_logging(auth_headers_tourist, auth_headers_authority):
    t_headers = {"Authorization": auth_headers_tourist["Authorization"]}
    a_headers = {"Authorization": auth_headers_authority["Authorization"]}
    tourist_id = auth_headers_tourist["tourist_id"]

    inc_payload = {
        "tourist_id": tourist_id,
        "incident_type": "MEDICAL",
        "severity": "HIGH",
        "status": "OPEN",
        "description": "Tourist requires medical assistance",
    }
    inc_resp = client.post("/api/v1/incidents", json=inc_payload, headers=t_headers)
    assert inc_resp.status_code == 201
    incident_id = inc_resp.json()["incident_id"]

    # A tourist may not log a dispatch response (authority-only action).
    forbidden_resp = client.post(
        f"/api/v1/incidents/{incident_id}/responses",
        json={"responder_unit": "PCR-12", "action_taken": "Dispatched"},
        headers=t_headers,
    )
    assert forbidden_resp.status_code == 403

    response_resp = client.post(
        f"/api/v1/incidents/{incident_id}/responses",
        json={"responder_unit": "PCR-12", "action_taken": "Unit dispatched to scene"},
        headers=a_headers,
    )
    assert response_resp.status_code == 201
    assert response_resp.json()["incident_id"] == incident_id
    assert response_resp.json()["authority_id"] == auth_headers_authority["authority_id"]

    list_resp = client.get(f"/api/v1/incidents/{incident_id}/responses", headers=a_headers)
    assert list_resp.status_code == 200
    assert len(list_resp.json()) >= 1


def test_audit_logs(auth_headers_tourist, auth_headers_authority):
    a_headers = {"Authorization": auth_headers_authority["Authorization"]}
    t_headers = {"Authorization": auth_headers_tourist["Authorization"]}

    # Tourists may not write compliance audit logs.
    forbidden_resp = client.post(
        "/api/v1/audit-logs",
        json={"action_type": "TOURIST_LOOKUP", "target_id": "TR-1"},
        headers=t_headers,
    )
    assert forbidden_resp.status_code == 403

    create_resp = client.post(
        "/api/v1/audit-logs",
        json={
            "action_type": "TOURIST_LOOKUP",
            "target_id": "TR-1",
            "reason": "Routine check",
            "details": "Looked up tourist profile during patrol",
        },
        headers=a_headers,
    )
    assert create_resp.status_code == 201
    assert create_resp.json()["authority_id"] == auth_headers_authority["authority_id"]

    list_resp = client.get("/api/v1/audit-logs", headers=a_headers)
    assert list_resp.status_code == 200
    assert any(l["target_id"] == "TR-1" for l in list_resp.json())
```

### `database/migrations/001_add_audit_logs.sql`

```sql
-- Migration: Add public.audit_logs table
--
-- Why: Task 7.3 of the production-readiness correction requires persisting
-- authority search/interception compliance logs to the database instead of
-- an in-memory array in the frontend (App.tsx). This table is new — it is
-- not part of the original 9-table schema documented in DATABASE.md — so
-- per DATABASE.md section 26 (Schema Change Policy) this migration and the
-- corresponding DATABASE.md addendum accompany the code change.
--
-- Run this against the Supabase project before deploying the audit-logs
-- backend router.

CREATE TABLE IF NOT EXISTS public.audit_logs (
    audit_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    authority_id UUID NOT NULL REFERENCES public.authorities(authority_id) ON DELETE CASCADE,
    action_type  VARCHAR(50) NOT NULL,
    target_id    VARCHAR(255) NOT NULL,
    reason       TEXT,
    details      TEXT,
    ip_address   VARCHAR(64),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_authority_id ON public.audit_logs(authority_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Authorities may insert their own audit log entries.
CREATE POLICY audit_logs_insert_own ON public.audit_logs
    FOR INSERT
    WITH CHECK (
        authority_id IN (
            SELECT authority_id FROM public.authorities WHERE auth_user_id = auth.uid()
        )
    );

-- Any authenticated authority may read the compliance log (read-only
-- oversight/audit trail is intentionally visible across the authority pool,
-- matching a shared compliance-review use case).
CREATE POLICY audit_logs_select_authority ON public.audit_logs
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.authorities WHERE auth_user_id = auth.uid()
        )
    );
```

### `frontend/src/App.tsx`

```tsx
import React, { useState, useEffect } from 'react';
import {
  Language,
  UserRole,
  ActiveModule,
  TouristProfile,
  SOSIncident,
  PatrollingUnit,
  PoliceStation,
  AnomalyCluster,
  BroadcastAlert,
  AuditLog,
  AILog
} from './types';
import {
  INITIAL_TOURISTS,
  INITIAL_INCIDENTS,
  INITIAL_PATROL_UNITS,
  POLICE_STATIONS,
  ANOMALY_CLUSTERS,
  INITIAL_BROADCASTS,
  INITIAL_AUDIT_LOGS,
  INITIAL_AI_LOGS
} from './data/mockData';
import { Header } from './components/Header';
import { Gateway } from './components/Gateway';
import { TouristPortal } from './components/TouristPortal';
import { ModuleAIHub } from './components/ModuleAIHub';
import { ModuleTouristTracking } from './components/ModuleTouristTracking';
import { ModuleSOSMap } from './components/ModuleSOSMap';
import { ModuleBroadcast } from './components/ModuleBroadcast';
import { ModuleAnalyticsAudit } from './components/ModuleAnalyticsAudit';
import {
  authenticateAuthority,
  getAuthorityIncidents,
  getAuthorityTourist,
  getAuthorityIncidentLocation,
  updateIncidentStatus,
  createIncidentResponse,
  createAlert,
  clearSession,
  logoutUser,
  getAuthorityId,
  getUsername,
  createAuditLog,
  listAuditLogs
} from './lib/api';

export default function App() {
  const [language, setLanguage] = useState<Language>('en');
  const [darkMode, setDarkMode] = useState<boolean>(false);
  const [userRole, setUserRole] = useState<UserRole>('gateway');
  const [activeModule, setActiveModule] = useState<ActiveModule>('ai_hub');

  // Master Data State
  const [tourists, setTourists] = useState<TouristProfile[]>(INITIAL_TOURISTS);
  const [incidents, setIncidents] = useState<SOSIncident[]>(INITIAL_INCIDENTS);
  const [units, setUnits] = useState<PatrollingUnit[]>(INITIAL_PATROL_UNITS);
  const [stations] = useState<PoliceStation[]>(POLICE_STATIONS);
  const [clusters] = useState<AnomalyCluster[]>(ANOMALY_CLUSTERS);
  const [broadcasts, setBroadcasts] = useState<BroadcastAlert[]>(INITIAL_BROADCASTS);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(INITIAL_AUDIT_LOGS);
  const [aiLogs] = useState<AILog[]>(INITIAL_AI_LOGS);

  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [prefilledTouristId, setPrefilledTouristId] = useState('');
  const [authorityAuthError, setAuthorityAuthError] = useState('');

  // Register service worker for offline PWA compliance
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch((err) => {
          console.warn('Service worker registration failed:', err);
        });
      });
    }
  }, []);

  // Audit Logging helper — persists to public.audit_logs on the backend
  // (see lib/api.ts createAuditLog) while also updating local state
  // immediately so the UI doesn't wait on the network round-trip. Uses the
  // actual signed-in authority's identity instead of a hardcoded officer.
  const handleLogAudit = (
    actionType: 'TOURIST_LOOKUP' | 'DISPATCH_UNIT' | 'BROADCAST_SENT' | 'TICKET_STATUS_CHANGE' | 'AUTHORITY_LOGIN',
    targetId: string,
    reason: string,
    details: string
  ) => {
    const officerBadge = getUsername() || 'Unknown Officer';
    const localId = `AUD-${Math.floor(1000 + Math.random() * 9000)}`;
    const newLog: AuditLog = {
      id: localId,
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
      officerName: officerBadge,
      officerBadge,
      actionType,
      targetId,
      reason,
      details,
      ipAddress: 'Client-reported (see server audit log for source IP)'
    };
    setAuditLogs((prev) => [newLog, ...prev]);

    createAuditLog({
      action_type: actionType,
      target_id: targetId,
      reason,
      details
    })
      .then((saved) => {
        if (saved?.audit_id) {
          setAuditLogs((prev) =>
            prev.map((l) => (l.id === localId ? { ...l, backendAuditId: saved.audit_id } : l))
          );
        }
      })
      .catch((err) => {
        console.warn('Failed to persist audit log to backend:', err);
      });
  };

  // Pull persisted audit log entries from the backend and merge them with
  // any local-only entries not yet confirmed as saved.
  const refreshAuditLogsFromBackend = async () => {
    try {
      const backendLogs = await listAuditLogs();
      const mapped: AuditLog[] = backendLogs.map((log: any) => ({
        id: `BE-${log.audit_id}`,
        backendAuditId: log.audit_id,
        timestamp: log.created_at
          ? new Date(log.created_at).toISOString().replace('T', ' ').substring(0, 19)
          : new Date().toISOString().replace('T', ' ').substring(0, 19),
        officerName: getUsername() || 'Officer',
        officerBadge: getUsername() || 'Officer',
        actionType: log.action_type,
        targetId: log.target_id,
        reason: log.reason,
        details: log.details || '',
        ipAddress: log.ip_address || 'Server-recorded'
      }));

      setAuditLogs((prev) => {
        const backendIds = new Set(mapped.map((m) => m.backendAuditId));
        const localOnly = prev.filter((p) => !p.backendAuditId || !backendIds.has(p.backendAuditId));
        return [...mapped, ...localOnly];
      });
    } catch (err) {
      console.warn('Failed to refresh audit logs from backend:', err);
    }
  };

  // Map a backend incident status onto the existing local SOSStatus enum.
  const mapBackendStatus = (status: string): SOSIncident['status'] => {
    const s = (status || '').toUpperCase();
    if (s === 'RESOLVED' || s === 'CLOSED') return 'Resolved';
    if (s === 'RESPONDING') return 'Units Dispatched';
    return 'New';
  };

  const mapBackendSeverity = (severity: string | null | undefined): SOSIncident['severity'] => {
    const s = (severity || '').toUpperCase();
    if (s === 'CRITICAL' || s === 'HIGH') return 'Critical';
    if (s === 'MEDIUM') return 'Warning';
    return 'Advisory';
  };

  // Pull real incidents (created via the Tourist Portal's SOS/incident flows)
  // from the backend and merge them into the existing local incidents state,
  // resolving tourist and location details on a best-effort basis so the
  // existing Kanban/Map UI can render them without any structural changes.
  const refreshIncidentsFromBackend = async () => {
    try {
      const backendIncidents = await getAuthorityIncidents();
      const mapped: SOSIncident[] = await Promise.all(
        backendIncidents.map(async (inc: any) => {
          let touristName = 'Registered Tourist';
          let touristPhone = '';
          const localTourist = tourists.find((t) => t.tourist_id === inc.tourist_id);
          if (localTourist) {
            touristName = localTourist.full_name || localTourist.name;
            touristPhone = localTourist.phone;
          } else {
            try {
              const backendTourist = await getAuthorityTourist(inc.tourist_id);
              touristName = backendTourist.full_name || touristName;
              touristPhone = backendTourist.phone || '';
            } catch (e) {
              // Tourist lookup failed (e.g. RLS/not found) — keep placeholder.
            }
          }

          let lat = 32.2432;
          let lng = 77.1892;
          let address = inc.description || `${inc.incident_type || 'Incident'} report`;
          try {
            const loc = await getAuthorityIncidentLocation(inc.incident_id);
            if (loc.latitude != null) lat = loc.latitude;
            if (loc.longitude != null) lng = loc.longitude;
            if (loc.name) address = loc.name;
          } catch (e) {
            // Location lookup failed — keep defaults.
          }

          const result: SOSIncident = {
            id: `BE-${inc.incident_id}`,
            backendIncidentId: inc.incident_id,
            touristId: localTourist?.id || inc.tourist_id,
            touristName,
            touristPhone,
            location: { lat, lng, address },
            timestamp: inc.created_at
              ? new Date(inc.created_at).toISOString().replace('T', ' ').substring(0, 19)
              : new Date().toISOString().replace('T', ' ').substring(0, 19),
            status: mapBackendStatus(inc.status),
            severity: mapBackendSeverity(inc.severity),
            hazardType: inc.incident_type || 'OTHER',
            notes: inc.description || 'Incident synced from backend.'
          };
          return result;
        })
      );

      setIncidents((prev) => {
        const backendIds = new Set(mapped.map((m) => m.backendIncidentId));
        const localOnly = prev.filter((p) => !p.backendIncidentId || !backendIds.has(p.backendIncidentId));
        return [...mapped, ...localOnly];
      });
    } catch (err) {
      console.warn('Failed to refresh incidents from backend:', err);
    }
  };

  // Authority MFA Authenticate — backed by the real /authority/login
  // endpoint (see lib/api.ts authenticateAuthority for the credential
  // mapping). Login fails outright for a badge that isn't registered —
  // there is no auto-registration fallback.
  const handleAuthenticateAuthority = async (badgeId: string, otp: string): Promise<boolean> => {
    setAuthorityAuthError('');
    const result = await authenticateAuthority(badgeId, otp);
    if (!result) {
      setAuthorityAuthError('Authentication failed.');
      return false;
    }

    setUserRole('authority');
    setActiveModule('ai_hub');
    handleLogAudit(
      'AUTHORITY_LOGIN',
      `Officer ${badgeId}`,
      'MFA Verification',
      'Successful 2FA login to National Command Center'
    );

    // Populate the dashboard with real backend incidents (in addition to the
    // existing local demo data) now that we have an authenticated session.
    refreshIncidentsFromBackend();
    refreshAuditLogsFromBackend();

    return true;
  };

  // Global search trigger
  const handleExecuteGlobalSearch = () => {
    if (!globalSearchQuery.trim()) return;
    setPrefilledTouristId(globalSearchQuery.trim());
    setActiveModule('tourist_tracking');
  };

  // Trigger SOS from Tourist Portal
  const handleTouristTriggerSos = (touristName: string, locationStr: string, touristId?: string, touristPhone?: string) => {
    const resolvedTouristId = touristId || 'UNKNOWN';
    const newIncident: SOSIncident = {
      id: `SOS-${Math.floor(9000 + Math.random() * 999)}`,
      touristId: resolvedTouristId,
      touristName,
      touristPhone: touristPhone || '',
      location: {
        lat: 32.2432,
        lng: 77.1892,
        address: locationStr
      },
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
      status: 'New',
      severity: 'Critical',
      hazardType: '1-Tap Emergency Panic Button Press',
      notes: 'Direct panic beacon press from tourist mobile safety portal.'
    };

    setIncidents((prev) => [newIncident, ...prev]);
    
    // Update tourist safety status
    setTourists((prev) =>
      prev.map((t) =>
        t.id === resolvedTouristId ? { ...t, safetyStatus: 'SOS Active' } : t
      )
    );

    handleLogAudit(
      'TICKET_STATUS_CHANGE',
      newIncident.id,
      'Active SOS Response',
      `New panic signal received from ${touristName} at ${locationStr}`
    );
  };

  // Dispatch Responder Unit
  const handleDispatchUnit = async (incidentId: string, unitId: string) => {
    const targetUnit = units.find((u) => u.id === unitId);
    const targetIncident = incidents.find((i) => i.id === incidentId);

    if (!targetIncident) return;

    // Update incident status
    setIncidents((prev) =>
      prev.map((i) =>
        i.id === incidentId
          ? { ...i, status: 'Units Dispatched', unitAssigned: targetUnit?.unitName || unitId }
          : i
      )
    );

    // Update unit status
    if (targetUnit) {
      setUnits((prev) =>
        prev.map((u) =>
          u.id === unitId ? { ...u, status: 'Dispatched', assignedIncidentId: incidentId } : u
        )
      );
    }

    // If this incident has a real backend counterpart, persist the status
    // change via PATCH /api/v1/incidents/{incident_id}, including the
    // dispatching authority's own authority_id so the backend can link the
    // incident to this authority at the moment of dispatch. Also log the
    // dispatch action itself to public.responses.
    if (targetIncident.backendIncidentId) {
      const authorityId = getAuthorityId();
      try {
        await updateIncidentStatus(targetIncident.backendIncidentId, {
          status: 'RESPONDING',
          ...(authorityId ? { authority_id: authorityId } : {})
        });
      } catch (err) {
        console.warn('Failed to persist dispatch status to backend:', err);
      }
      try {
        await createIncidentResponse(targetIncident.backendIncidentId, {
          responder_unit: targetUnit?.unitName || unitId,
          action_taken: `Unit ${targetUnit?.unitName || unitId} dispatched to incident.`,
          ...(authorityId ? { authority_id: authorityId } : {})
        });
      } catch (err) {
        console.warn('Failed to log dispatch response to backend:', err);
      }
    }

    handleLogAudit(
      'DISPATCH_UNIT',
      unitId,
      'Active SOS Response',
      `Dispatched unit ${targetUnit?.unitName || unitId} to SOS Incident ${incidentId}`
    );
  };

  // Resolve Incident
  const handleResolveIncident = async (incidentId: string) => {
    const targetIncident = incidents.find((i) => i.id === incidentId);

    setIncidents((prev) =>
      prev.map((i) => (i.id === incidentId ? { ...i, status: 'Resolved' } : i))
    );

    if (targetIncident) {
      setTourists((prev) =>
        prev.map((t) =>
          t.id === targetIncident.touristId ? { ...t, safetyStatus: 'Safe' } : t
        )
      );
    }

    if (targetIncident?.backendIncidentId) {
      try {
        await updateIncidentStatus(targetIncident.backendIncidentId, { status: 'RESOLVED' });
      } catch (err) {
        console.warn('Failed to persist resolution status to backend:', err);
      }
    }

    handleLogAudit(
      'TICKET_STATUS_CHANGE',
      incidentId,
      'Incident Resolution',
      `Marked SOS Incident ${incidentId} as Resolved. Tourist confirmed safe.`
    );
  };

  // Mark tourist safe from the Tourist Tracking module — resolves that
  // tourist's most recent open backend incident (if any) via PATCH, mirroring
  // handleResolveIncident above.
  const handleMarkTouristSafe = async (touristId: string) => {
    setTourists((prev) =>
      prev.map((t) => (t.id === touristId ? { ...t, safetyStatus: 'Safe' } : t))
    );

    const openIncident = incidents.find(
      (i) => i.touristId === touristId && i.status !== 'Resolved' && i.backendIncidentId
    );
    if (openIncident?.backendIncidentId) {
      setIncidents((prev) =>
        prev.map((i) => (i.id === openIncident.id ? { ...i, status: 'Resolved' } : i))
      );
      try {
        await updateIncidentStatus(openIncident.backendIncidentId, { status: 'RESOLVED' });
      } catch (err) {
        console.warn('Failed to persist mark-safe resolution to backend:', err);
      }
    }
  };

  // Send Broadcast Alert
  const handleSendBroadcast = (
    newAlert: Omit<BroadcastAlert, 'id' | 'timestamp' | 'deliveredCount' | 'status'>
  ) => {
    const createdAlert: BroadcastAlert = {
      ...newAlert,
      id: `BC-${Math.floor(500 + Math.random() * 500)}`,
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
      deliveredCount: Math.round(newAlert.recipientCount * 0.98),
      status: 'Completed'
    };

    setBroadcasts((prev) => [createdAlert, ...prev]);

    // The backend's `alerts` table models a notification tied to one
    // incident + one recipient/channel — there is no backend concept of a
    // region-wide broadcast campaign (see DATABASE.md §5.7). As the closest
    // faithful mapping without inventing new backend behavior, publishing a
    // broadcast also logs a real SMS alert record against every currently
    // active backend-linked incident. This is best-effort and non-blocking;
    // the existing local broadcast history/UI is unaffected either way.
    incidents
      .filter((i) => i.status !== 'Resolved' && i.backendIncidentId)
      .forEach((i) => {
        createAlert({
          incident_id: i.backendIncidentId as string,
          channel: 'SMS',
          recipient: newAlert.region
        }).catch((err) => console.warn('Failed to log backend alert for broadcast:', err));
      });

    handleLogAudit(
      'BROADCAST_SENT',
      `Geofence ${newAlert.region}`,
      'Emergency Hazard Alert',
      `Pushed ${newAlert.severity} alert to ~${newAlert.recipientCount} active tourist devices.`
    );
  };

  // Add mock SOS trigger for testing
  const handleAddMockSos = () => {
    const randomTourist = tourists[Math.floor(Math.random() * tourists.length)];
    const newInc: SOSIncident = {
      id: `SOS-${Math.floor(9100 + Math.random() * 899)}`,
      touristId: randomTourist.id,
      touristName: randomTourist.name,
      touristPhone: randomTourist.phone,
      location: randomTourist.currentLocation,
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
      status: 'New',
      severity: 'Critical',
      hazardType: 'Simulated High Altitude Signal Anomaly',
      notes: 'Continuous panic signal generated via test control console.'
    };

    setIncidents((prev) => [newInc, ...prev]);
    setTourists((prev) =>
      prev.map((t) => (t.id === randomTourist.id ? { ...t, safetyStatus: 'SOS Active' } : t))
    );

    handleLogAudit(
      'TICKET_STATUS_CHANGE',
      newInc.id,
      'Active SOS Response',
      `Simulated SOS incident created for ${randomTourist.name}`
    );
  };

  const activeSosCount = incidents.filter((i) => i.status !== 'Resolved').length;

  return (
    <div className={`min-h-screen ${darkMode ? 'bg-slate-950 text-slate-100' : 'bg-[#F4F6F9] text-slate-900'} flex flex-col font-sans transition-colors duration-200`}>
      
      {/* Command Header */}
      <Header
        language={language}
        onLanguageChange={setLanguage}
        darkMode={darkMode}
        onToggleDarkMode={() => setDarkMode(!darkMode)}
        userRole={userRole}
        onLogout={() => {
          logoutUser().finally(() => clearSession());
          setUserRole('gateway');
        }}
        activeModule={activeModule}
        onSelectModule={setActiveModule}
        globalSearchQuery={globalSearchQuery}
        onGlobalSearchChange={setGlobalSearchQuery}
        onExecuteGlobalSearch={handleExecuteGlobalSearch}
        activeSosCount={activeSosCount}
      />

      {/* Main Content Area */}
      {userRole === 'gateway' ? (
        <Gateway
          language={language}
          onSelectRole={(role) => setUserRole(role)}
          onAuthenticateAuthority={handleAuthenticateAuthority}
        />
      ) : userRole === 'tourist' ? (
        <TouristPortal
          language={language}
          onLanguageChange={(lang) => setLanguage(lang)}
          onTriggerSos={handleTouristTriggerSos}
          onReturnToGateway={() => setUserRole('gateway')}
          onRegisterTourist={(newTourist) => setTourists((prev) => [newTourist, ...prev.filter(t => t.id !== newTourist.id)])}
          existingTourists={tourists}
        />
      ) : (
        <div className="flex-1 flex flex-col max-w-[1700px] w-full mx-auto">
          
          {/* Module Screen Content */}
          <main className="flex-1 p-4 sm:p-6 overflow-y-auto">
            {activeModule === 'ai_hub' && (
              <ModuleAIHub
                language={language}
                clusters={clusters}
                aiLogs={aiLogs}
                onInvestigateCluster={(cluster) => {
                  setPrefilledTouristId('TR-88219');
                  setActiveModule('tourist_tracking');
                }}
                onNavigateToMap={() => setActiveModule('sos_map')}
              />
            )}

            {activeModule === 'tourist_tracking' && (
              <ModuleTouristTracking
                language={language}
                tourists={tourists}
                onLogAudit={handleLogAudit}
                onDispatchToTourist={(tourist) => {
                  setActiveModule('sos_map');
                }}
                onSendSmsToTourist={(tourist) => {
                  setActiveModule('broadcast');
                }}
                onMarkSafe={handleMarkTouristSafe}
                prefilledTouristId={prefilledTouristId}
              />
            )}

            {activeModule === 'sos_map' && (
              <ModuleSOSMap
                language={language}
                incidents={incidents}
                units={units}
                stations={stations}
                onDispatchUnit={handleDispatchUnit}
                onResolveIncident={handleResolveIncident}
                onAddMockSos={handleAddMockSos}
              />
            )}

            {activeModule === 'broadcast' && (
              <ModuleBroadcast
                language={language}
                broadcasts={broadcasts}
                onSendBroadcast={handleSendBroadcast}
              />
            )}

            {activeModule === 'analytics_audit' && (
              <ModuleAnalyticsAudit
                language={language}
                auditLogs={auditLogs}
              />
            )}
          </main>

        </div>
      )}

    </div>
  );
}
```

### `frontend/src/components/ActualGoogleMap.tsx`

```tsx
import React, { useState } from 'react';
import { APIProvider, Map, AdvancedMarker, Pin, InfoWindow, useAdvancedMarkerRef } from '@vis.gl/react-google-maps';
import { MapPin, Navigation, Users, ShieldCheck, AlertTriangle, Layers, ExternalLink, ShieldAlert, Shield } from 'lucide-react';
import { GeoFenceZone } from '../types';

export interface MapClusterMarker {
  id: string;
  lat: number;
  lng: number;
  title: string;
  subtitle?: string;
  crowdLevel?: 'extreme' | 'high' | 'medium' | 'low';
  crowdCount?: number;
  type?: 'crowd' | 'user' | 'police' | 'hotel' | 'alert' | 'geofence';
}

interface ActualGoogleMapProps {
  center?: { lat: number; lng: number };
  zoom?: number;
  markers?: MapClusterMarker[];
  geofenceZones?: GeoFenceZone[];
  activeZoneId?: string;
  origin?: string;
  destination?: string;
  height?: string;
  onMarkerClick?: (marker: MapClusterMarker) => void;
  selectedMarkerId?: string;
  mapTypeControl?: boolean;
}


const API_KEY =
  process.env.GOOGLE_MAPS_PLATFORM_KEY ||
  (import.meta as any).env?.VITE_GOOGLE_MAPS_PLATFORM_KEY ||
  (globalThis as any).GOOGLE_MAPS_PLATFORM_KEY ||
  '';

const hasValidKey = Boolean(API_KEY) && API_KEY !== 'YOUR_API_KEY';

export const ActualGoogleMap: React.FC<ActualGoogleMapProps> = ({
  center = { lat: 32.2432, lng: 77.1892 }, // Manali default
  zoom = 12,
  markers = [],
  geofenceZones = [],
  activeZoneId,
  origin,
  destination,
  height = '320px',
  onMarkerClick,
  selectedMarkerId,
  mapTypeControl = true
}) => {

  const [activeMarker, setActiveMarker] = useState<MapClusterMarker | null>(null);
  const [mapMode, setMapMode] = useState<'m' | 'k' | 'p'>('m'); // m: roadmap, k: satellite, p: terrain

  const handleSelectMarker = (m: MapClusterMarker) => {
    setActiveMarker(m);
    if (onMarkerClick) onMarkerClick(m);
  };

  // If valid API key is supplied, use @vis.gl/react-google-maps
  if (hasValidKey) {
    return (
      <div className="relative w-full rounded-2xl overflow-hidden border border-slate-300 shadow-sm" style={{ height }}>
        <APIProvider apiKey={API_KEY} version="weekly">
          <Map
            defaultCenter={center}
            defaultZoom={zoom}
            mapId="DEMO_MAP_ID"
            internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
            style={{ width: '100%', height: '100%' }}
          >
            {markers.map((m) => {
              let pinBg = '#3B82F6';
              if (m.crowdLevel === 'extreme' || m.crowdLevel === 'high') pinBg = '#EF4444';
              else if (m.crowdLevel === 'medium') pinBg = '#F59E0B';
              else if (m.crowdLevel === 'low') pinBg = '#10B981';
              if (m.type === 'police') pinBg = '#138808';

              return (
                <AdvancedMarker
                  key={m.id}
                  position={{ lat: m.lat, lng: m.lng }}
                  onClick={() => handleSelectMarker(m)}
                >
                  <Pin background={pinBg} glyphColor="#FFFFFF" />
                </AdvancedMarker>
              );
            })}
          </Map>
        </APIProvider>
      </div>
    );
  }

  // Fallback Google Map View using Google Maps embed query + custom crowd/route overlays
  // Google Map embed URL with dynamic query / coordinates
  const searchLocation = destination ? encodeURIComponent(destination) : `${center.lat},${center.lng}`;
  const embedUrl = `https://maps.google.com/maps?q=${searchLocation}&t=${mapMode}&z=${zoom}&ie=UTF8&iwloc=&output=embed`;

  return (
    <div className="relative w-full rounded-2xl overflow-hidden border-2 border-slate-300 shadow-sm bg-slate-900" style={{ height }}>
      
      {/* Live Google Map Iframe Layer */}
      <iframe
        title="Google Maps Location View"
        src={embedUrl}
        className="w-full h-full border-0 filter brightness-95 contrast-105"
        loading="lazy"
        allowFullScreen
      />

      {/* Map Control Bar Top */}
      <div className="absolute top-3 left-3 right-3 z-10 flex items-center justify-between pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-1.5 bg-slate-900/90 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-700 shadow-md text-white text-xs font-bold">
          <MapPin className="w-3.5 h-3.5 text-red-500 animate-pulse" />
          <span className="truncate max-w-[180px] sm:max-w-[280px]">
            {destination ? `${origin || 'My Location'} ➔ ${destination}` : 'Live Google Maps View'}
          </span>
        </div>

        {mapTypeControl && (
          <div className="pointer-events-auto flex items-center bg-slate-900/90 backdrop-blur-md p-1 rounded-xl border border-slate-700 shadow-md">
            <button
              onClick={() => setMapMode('m')}
              className={`px-2 py-1 text-[10px] font-black rounded-lg transition ${
                mapMode === 'm' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-white'
              }`}
            >
              Map
            </button>
            <button
              onClick={() => setMapMode('k')}
              className={`px-2 py-1 text-[10px] font-black rounded-lg transition ${
                mapMode === 'k' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-white'
              }`}
            >
              Satellite
            </button>
            <button
              onClick={() => setMapMode('p')}
              className={`px-2 py-1 text-[10px] font-black rounded-lg transition ${
                mapMode === 'p' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-white'
              }`}
            >
              Terrain
            </button>
          </div>
        )}
      </div>

      {/* Interactive People Clusters Floating Overlay on the Map */}
      {(markers.length > 0 || geofenceZones.length > 0) && (
        <div className="absolute bottom-3 left-3 right-3 z-10 pointer-events-auto flex gap-2 overflow-x-auto pb-1 max-w-full scrollbar-thin">
          {geofenceZones.map((z) => {
            const isActive = activeZoneId === z.id;
            let badgeBg = 'bg-slate-900/85 text-slate-200 border-slate-700';
            if (z.riskLevel === 'Unsafe') {
              badgeBg = isActive ? 'bg-red-600 border-red-400 text-white ring-2 ring-white scale-105' : 'bg-red-950/80 border-red-700 text-red-200';
            } else if (z.riskLevel === 'Caution') {
              badgeBg = isActive ? 'bg-amber-500 border-amber-300 text-slate-950 ring-2 ring-white scale-105' : 'bg-amber-950/80 border-amber-700 text-amber-200';
            } else if (z.riskLevel === 'Safe') {
              badgeBg = isActive ? 'bg-emerald-600 border-emerald-300 text-white ring-2 ring-white scale-105' : 'bg-emerald-950/80 border-emerald-700 text-emerald-200';
            }

            return (
              <div
                key={z.id}
                className={`flex-shrink-0 px-3 py-1.5 rounded-xl border text-xs font-black flex items-center gap-1.5 shadow-lg backdrop-blur-md ${badgeBg}`}
              >
                {z.riskLevel === 'Unsafe' && <ShieldAlert className="w-3.5 h-3.5 text-red-400" />}
                {z.riskLevel === 'Caution' && <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />}
                {z.riskLevel === 'Safe' && <Shield className="w-3.5 h-3.5 text-emerald-400" />}
                <span>{z.name}</span>
                <span className="px-1.5 py-0.2 rounded bg-black/30 text-[9px] uppercase font-bold">
                  {z.riskLevel}
                </span>
              </div>
            );
          })}

          {markers.map((m) => {

            const isSelected = selectedMarkerId === m.id || activeMarker?.id === m.id;
            let badgeBg = 'bg-blue-600 border-blue-400 text-white';
            if (m.crowdLevel === 'extreme' || m.crowdLevel === 'high') {
              badgeBg = 'bg-red-600 border-red-400 text-white';
            } else if (m.crowdLevel === 'medium') {
              badgeBg = 'bg-amber-500 border-amber-300 text-slate-950';
            } else if (m.crowdLevel === 'low') {
              badgeBg = 'bg-emerald-600 border-emerald-300 text-white';
            }

            return (
              <button
                key={m.id}
                onClick={() => handleSelectMarker(m)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-xl border text-xs font-black transition flex items-center gap-1.5 shadow-lg backdrop-blur-md ${
                  isSelected
                    ? `${badgeBg} ring-2 ring-white scale-105`
                    : 'bg-slate-900/85 text-slate-200 border-slate-700 hover:bg-slate-800'
                }`}
              >
                {m.type === 'crowd' && <Users className="w-3.5 h-3.5" />}
                {m.type === 'police' && <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />}
                {m.type === 'user' && <MapPin className="w-3.5 h-3.5 text-blue-400" />}
                <span>{m.title}</span>
                {m.crowdCount !== undefined && (
                  <span className="px-1.5 py-0.2 rounded bg-black/30 text-[10px]">
                    👥 {m.crowdCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* External Google Maps Button */}
      <a
        href={`https://www.google.com/maps/search/?api=1&query=${searchLocation}`}
        target="_blank"
        rel="noopener noreferrer"
        className="absolute top-3 right-3 z-20 hidden sm:flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-white/90 hover:bg-white text-slate-900 font-extrabold text-[11px] shadow border border-slate-300 transition"
      >
        <span>Open Google Maps</span>
        <ExternalLink className="w-3.5 h-3.5 text-blue-600" />
      </a>

    </div>
  );
};
```

### `frontend/src/components/CrowdHeatmap.tsx`

```tsx
import React, { useState } from 'react';
import { Users, AlertTriangle, ShieldCheck, Search, MapPin, ArrowRight, RefreshCw, Clock, CheckCircle2, Sparkles, Filter, Layers } from 'lucide-react';

export interface CrowdCluster {
  id: string;
  name: string;
  region: string;
  coordinates: { lat: number; lng: number };
  crowdCount: number;
  capacityPercentage: number; // 0 - 100
  crowdLevel: 'extreme' | 'high' | 'medium' | 'low';
  peakHours: string;
  avgWaitMinutes: number;
  statusNotice: string;
  suggestedAlternative: {
    name: string;
    crowdCount: number;
    capacityPercentage: number;
    distance: string;
    description: string;
  };
}

export const CROWD_CLUSTERS: CrowdCluster[] = [
  {
    id: 'cluster-1',
    name: 'Manali Mall Road & Town Square',
    region: 'Central Manali',
    coordinates: { lat: 32.2396, lng: 77.1887 },
    crowdCount: 1850,
    capacityPercentage: 94,
    crowdLevel: 'extreme',
    peakHours: '12:00 PM - 6:30 PM',
    avgWaitMinutes: 45,
    statusNotice: 'Severe pedestrian congestion & parking gridlock. 45 min entry delay.',
    suggestedAlternative: {
      name: 'Vashisht Village & Ancient Hot Springs',
      crowdCount: 280,
      capacityPercentage: 22,
      distance: '2.8 km away',
      description: 'Peaceful traditional timber village with open views and thermal spring baths.'
    }
  },
  {
    id: 'cluster-2',
    name: 'Solang Valley Ropeway & Activity Hub',
    region: 'North Manali',
    coordinates: { lat: 32.3167, lng: 77.1574 },
    crowdCount: 1240,
    capacityPercentage: 82,
    crowdLevel: 'high',
    peakHours: '10:00 AM - 3:30 PM',
    avgWaitMinutes: 60,
    statusNotice: 'Long token queues for paragliding & ropeway rides.',
    suggestedAlternative: {
      name: 'Gulaba Alpine Snow Meadows',
      crowdCount: 340,
      capacityPercentage: 35,
      distance: '6.5 km away',
      description: 'Quiet high-altitude meadow with pristine mountain vistas and low crowd density.'
    }
  },
  {
    id: 'cluster-3',
    name: 'Rohtang Pass Crest & Snow Ridge',
    region: 'Lahaul Border',
    coordinates: { lat: 32.3716, lng: 77.2466 },
    crowdCount: 1410,
    capacityPercentage: 88,
    crowdLevel: 'high',
    peakHours: '9:00 AM - 2:00 PM',
    avgWaitMinutes: 50,
    statusNotice: 'Permit checkpoint slowdown. Heavy vehicle queue at pass summit.',
    suggestedAlternative: {
      name: 'Hampta Pass Trailhead & Sethan Village',
      crowdCount: 210,
      capacityPercentage: 25,
      distance: '12.0 km away',
      description: 'Scenic pine forest sanctuary and quiet igloo village with zero vehicular noise.'
    }
  },
  {
    id: 'cluster-4',
    name: 'Kasol Market & Parvati Riverfront',
    region: 'Parvati Valley',
    coordinates: { lat: 32.0100, lng: 77.3150 },
    crowdCount: 1120,
    capacityPercentage: 86,
    crowdLevel: 'high',
    peakHours: '2:00 PM - 8:00 PM',
    avgWaitMinutes: 35,
    statusNotice: 'River bridge bottleneck. Parking full in central market.',
    suggestedAlternative: {
      name: 'Chalal Pine Forest River Trail',
      crowdCount: 120,
      capacityPercentage: 15,
      distance: '1.2 km walk',
      description: 'Shaded suspension bridge walk along rushing turquoise waters.'
    }
  },
  {
    id: 'cluster-5',
    name: 'Atal Tunnel South Portal',
    region: 'Solang Corridor',
    coordinates: { lat: 32.3582, lng: 77.1625 },
    crowdCount: 620,
    capacityPercentage: 55,
    crowdLevel: 'medium',
    peakHours: '11:00 AM - 4:00 PM',
    avgWaitMinutes: 15,
    statusNotice: 'Moderate tourist influx. Security checks moving steadily.',
    suggestedAlternative: {
      name: 'Sissu North Portal Waterfall Meadow',
      crowdCount: 180,
      capacityPercentage: 18,
      distance: '9.0 km through tunnel',
      description: 'Expansive green valley with roaring waterfall backdrop and calm atmosphere.'
    }
  },
  {
    id: 'cluster-6',
    name: 'Hadimba Devi Temple & Forest Trail',
    region: 'Dungri Woods',
    coordinates: { lat: 32.2483, lng: 77.1802 },
    crowdCount: 510,
    capacityPercentage: 48,
    crowdLevel: 'medium',
    peakHours: '10:00 AM - 1:00 PM',
    avgWaitMinutes: 15,
    statusNotice: 'Moderate queue inside pagoda temple courtyard.',
    suggestedAlternative: {
      name: 'Museum of Himachal Culture & Folk Art',
      crowdCount: 90,
      capacityPercentage: 12,
      distance: '200m walk',
      description: 'Intimate heritage museum showcasing traditional Himachali crafts and architecture.'
    }
  },
  {
    id: 'cluster-7',
    name: 'Old Manali Craft & Cafe Street',
    region: 'Upper Manali',
    coordinates: { lat: 32.2533, lng: 77.1750 },
    crowdCount: 290,
    capacityPercentage: 28,
    crowdLevel: 'low',
    peakHours: '5:00 PM - 9:00 PM',
    avgWaitMinutes: 0,
    statusNotice: 'Low crowd density. Excellent for relaxed strolling and dining.',
    suggestedAlternative: {
      name: 'Currently Peaceful!',
      crowdCount: 290,
      capacityPercentage: 28,
      distance: 'Direct Access',
      description: 'No change needed. This area is currently relaxed and under capacity.'
    }
  }
];

export const REGIONS_LIST = [
  'All Regions',
  'Central Manali',
  'North Manali',
  'Lahaul Border',
  'Parvati Valley',
  'Solang Corridor',
  'Dungri Woods',
  'Upper Manali'
];

interface CrowdHeatmapProps {
  onAddItineraryDestination?: (destName: string) => void;
}

export const CrowdHeatmap: React.FC<CrowdHeatmapProps> = ({ onAddItineraryDestination }) => {
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [densityFilter, setDensityFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [selectedClusterId, setSelectedClusterId] = useState<string>('cluster-1');
  const [planChangedToast, setPlanChangedToast] = useState<string | null>(null);

  // Filter clusters by search query and density filter
  const filteredClusters = CROWD_CLUSTERS.filter((c) => {
    // Search query match (searches across name, region, notice, and suggested alternative)
    if (searchQuery.trim() !== '') {
      const q = searchQuery.toLowerCase().trim();
      const searchableText = `${c.name} ${c.region} ${c.statusNotice} ${c.suggestedAlternative.name} ${c.suggestedAlternative.description}`.toLowerCase();
      
      const terms = q.split(/\s+/).filter(Boolean);
      const matchesSearch = terms.every((term) => searchableText.includes(term));
      if (!matchesSearch) return false;
    }

    // Density filter match
    if (densityFilter === 'high') {
      return c.crowdLevel === 'extreme' || c.crowdLevel === 'high';
    }
    if (densityFilter === 'medium') {
      return c.crowdLevel === 'medium';
    }
    if (densityFilter === 'low') {
      return c.crowdLevel === 'low';
    }
    return true;
  });

  const selectedCluster =
    filteredClusters.find((c) => c.id === selectedClusterId) || filteredClusters[0] || CROWD_CLUSTERS[0];

  const handleSwitchPlan = (alternativeName: string) => {
    if (onAddItineraryDestination) {
      onAddItineraryDestination(alternativeName);
    }
    setPlanChangedToast(`Plan Updated! Added "${alternativeName}" to your itinerary planner.`);
    setTimeout(() => setPlanChangedToast(null), 4000);
  };

  return (
    <div className="space-y-5 text-left">
      
      {/* Toast Notification for changing plan */}
      {planChangedToast && (
        <div className="p-3.5 bg-[#138808] text-white rounded-xl shadow-lg border-2 border-emerald-300 text-xs font-black flex items-center justify-between animate-bounce">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-amber-300" />
            <span>{planChangedToast}</span>
          </div>
          <button onClick={() => setPlanChangedToast(null)} className="text-white hover:text-slate-200 font-bold">✕</button>
        </div>
      )}

      {/* SEARCH BAR & HEADER TOP */}
      <div className="bg-slate-900 text-white p-4 rounded-2xl border-2 border-slate-800 shadow-md space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-red-600/30 border border-red-500 flex items-center justify-center text-red-400 shrink-0">
            <Users className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-black text-white flex items-center gap-2">
              <span>Regional Footfall Heatmap & Density Search</span>
              <span className="px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 border border-red-500/40 text-[9px] font-black uppercase">
                LIVE TELEMETRY
              </span>
            </h3>
            <p className="text-[11px] text-slate-400 font-medium">
              Search for any area or location to view real-time tourist density clusters.
            </p>
          </div>
        </div>

        {/* Search Bar & Density Pills */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3 pt-2 border-t border-slate-800 items-center">
          <div className="md:col-span-7 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search area (e.g., Mall Road, Solang, Kasol, Hadimba, Vashisht)..."
              className="w-full pl-10 pr-9 py-2.5 rounded-xl bg-slate-800 border border-slate-700 text-white text-xs font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-400"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs font-bold px-1.5 py-0.5 rounded hover:bg-slate-700"
                title="Clear search"
              >
                ✕
              </button>
            )}
          </div>

          <div className="md:col-span-5 flex items-center justify-start md:justify-end gap-1.5 flex-wrap">
            <button
              onClick={() => setDensityFilter('all')}
              className={`px-3 py-2 rounded-xl text-[11px] font-black transition ${
                densityFilter === 'all' ? 'bg-blue-600 text-white shadow' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              All Densities
            </button>
            <button
              onClick={() => setDensityFilter('high')}
              className={`px-3 py-2 rounded-xl text-[11px] font-black transition ${
                densityFilter === 'high' ? 'bg-red-600 text-white shadow' : 'bg-slate-800 text-red-400 hover:bg-slate-700'
              }`}
            >
              🔴 Heavy ({CROWD_CLUSTERS.filter(c => c.crowdLevel === 'extreme' || c.crowdLevel === 'high').length})
            </button>
            <button
              onClick={() => setDensityFilter('medium')}
              className={`px-3 py-2 rounded-xl text-[11px] font-black transition ${
                densityFilter === 'medium' ? 'bg-amber-500 text-slate-950 shadow' : 'bg-slate-800 text-amber-400 hover:bg-slate-700'
              }`}
            >
              🟡 Moderate
            </button>
            <button
              onClick={() => setDensityFilter('low')}
              className={`px-3 py-2 rounded-xl text-[11px] font-black transition ${
                densityFilter === 'low' ? 'bg-emerald-600 text-white shadow' : 'bg-slate-800 text-emerald-400 hover:bg-slate-700'
              }`}
            >
              🟢 Low
            </button>
          </div>
        </div>
      </div>

      {/* HEATMAP VISUAL GRID DISPLAY & DENSITY DETAILS */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        
        {/* LEFT: CUSTOM VISUAL DENSITY HEATMAP CANVAS */}
        <div className="lg:col-span-7 space-y-3">
          
          {/* Heatmap Visual Canvas */}
          <div className="relative w-full h-[350px] bg-slate-950 rounded-2xl overflow-hidden border-2 border-slate-800 shadow-xl p-4 text-white flex flex-col justify-between">
            {/* Background Grid Pattern */}
            <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1.5px,transparent_1.5px)] [background-size:20px_20px] opacity-40 pointer-events-none"></div>

            {/* Top Canvas Header */}
            <div className="relative z-10 flex items-center justify-between bg-slate-900/90 backdrop-blur-md px-3 py-2 rounded-xl border border-slate-800 text-xs">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-amber-400 animate-spin-slow" />
                <span className="font-extrabold text-white">
                  Area Density Layer {searchQuery ? `- "${searchQuery}"` : ''}
                </span>
              </div>
              <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950 px-2 py-0.5 rounded border border-emerald-800 font-bold">
                {filteredClusters.length} Clusters Found
              </span>
            </div>

            {/* Interactive Footfall Heat Clusters Layer */}
            {filteredClusters.length === 0 ? (
              <div className="relative z-10 my-auto text-center space-y-2 p-6 bg-slate-900/60 rounded-2xl border border-slate-800">
                <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto" />
                <h4 className="text-sm font-bold text-white">No crowd clusters match your search query</h4>
                <p className="text-xs text-slate-400">Try adjusting or clearing your search input.</p>
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setDensityFilter('all');
                  }}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition"
                >
                  Clear Search & Filters
                </button>
              </div>
            ) : (
              <div className="relative z-10 my-auto grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[220px] overflow-y-auto pr-1 scrollbar-thin">
                {filteredClusters.map((cluster) => {
                  const isSelected = selectedCluster?.id === cluster.id;
                  let gradientBg = 'from-emerald-900/70 to-emerald-950/90 border-emerald-500/60 text-emerald-100';
                  let glowColor = 'bg-emerald-500/30';
                  let badgeText = '🟢 Low Density';

                  if (cluster.crowdLevel === 'extreme' || cluster.crowdLevel === 'high') {
                    gradientBg = 'from-red-950/90 to-red-900/80 border-red-500/80 text-red-100';
                    glowColor = 'bg-red-500/40 animate-pulse';
                    badgeText = '🔴 Heavy Congestion';
                  } else if (cluster.crowdLevel === 'medium') {
                    gradientBg = 'from-amber-950/80 to-amber-900/70 border-amber-500/70 text-amber-100';
                    glowColor = 'bg-amber-500/30';
                    badgeText = '🟡 Moderate Load';
                  }

                  return (
                    <button
                      key={cluster.id}
                      onClick={() => setSelectedClusterId(cluster.id)}
                      className={`relative p-3 rounded-2xl border text-left transition backdrop-blur-md bg-gradient-to-br shadow-md flex flex-col justify-between ${gradientBg} ${
                        isSelected ? 'ring-2 ring-white scale-[1.02] shadow-2xl' : 'hover:border-white/50 opacity-90 hover:opacity-100'
                      }`}
                    >
                      {/* Radial Heat Blob Glow effect */}
                      <div className={`absolute -top-4 -right-4 w-16 h-16 rounded-full blur-xl pointer-events-none ${glowColor}`}></div>

                      <div>
                        <div className="flex items-center justify-between text-[10px] font-mono text-slate-300">
                          <span className="uppercase font-bold tracking-wide">{cluster.region}</span>
                          <span className="font-extrabold px-1.5 py-0.5 rounded bg-black/40 border border-white/20">
                            {badgeText}
                          </span>
                        </div>
                        <h5 className="text-xs font-black text-white mt-1 leading-snug">
                          {cluster.name}
                        </h5>
                      </div>

                      <div className="mt-2 pt-2 border-t border-white/10 flex items-center justify-between text-[11px] font-mono">
                        <span className="font-extrabold flex items-center gap-1">
                          <Users className="w-3.5 h-3.5 text-amber-300" />
                          <span>{cluster.crowdCount} people</span>
                        </span>
                        <span className="font-bold text-slate-200">
                          {cluster.capacityPercentage}% Cap
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Bottom Heatmap Legend */}
            <div className="relative z-10 flex flex-wrap items-center justify-between gap-2 bg-slate-900/90 backdrop-blur-md p-2 rounded-xl border border-slate-800 text-[10px] text-slate-300">
              <span className="font-bold">Heat Legend:</span>
              <div className="flex items-center gap-3 font-semibold">
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500"></span> &gt;80% Overcrowded</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-amber-400"></span> 40-80% Moderate</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-400"></span> &lt;40% Sparse</span>
              </div>
            </div>
          </div>

          {/* Quick Area Cards List */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {filteredClusters.map((c) => {
              const isSelected = selectedCluster?.id === c.id;
              let borderCol = 'border-slate-200';
              if (c.crowdLevel === 'extreme' || c.crowdLevel === 'high') borderCol = 'border-red-300 bg-red-50/60';
              else if (c.crowdLevel === 'medium') borderCol = 'border-amber-300 bg-amber-50/60';
              else if (c.crowdLevel === 'low') borderCol = 'border-emerald-300 bg-emerald-50/60';

              return (
                <button
                  key={c.id}
                  onClick={() => setSelectedClusterId(c.id)}
                  className={`p-3 rounded-xl text-left transition border shadow-2xs space-y-1.5 ${borderCol} ${
                    isSelected ? 'ring-2 ring-[#0B2447] bg-white font-bold' : 'hover:bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-black">
                    <span className="truncate text-slate-900">{c.name}</span>
                  </div>
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-slate-600 font-mono">👥 {c.crowdCount} tourists</span>
                    <span className={`font-black ${
                      c.capacityPercentage > 80 ? 'text-red-600' : c.capacityPercentage > 50 ? 'text-amber-600' : 'text-emerald-600'
                    }`}>
                      {c.capacityPercentage}% Load
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

        </div>

        {/* RIGHT: DETAILED DENSITY ANALYTICS & ALTERNATIVE REROUTE CARD */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white border-2 border-slate-200 rounded-2xl p-4 shadow-sm space-y-4 text-left">
            
            {/* Cluster Header */}
            <div className="flex items-start justify-between pb-3 border-b border-slate-200">
              <div>
                <span className="text-[10px] font-black uppercase text-slate-500 tracking-wider">
                  {selectedCluster.region}
                </span>
                <h4 className="text-base font-black text-slate-900 mt-0.5">
                  {selectedCluster.name}
                </h4>
              </div>

              {selectedCluster.capacityPercentage >= 80 ? (
                <span className="px-2.5 py-1 rounded-full bg-red-100 text-red-800 border border-red-300 text-xs font-black flex items-center gap-1 animate-pulse">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-600" /> Heavy Overcrowding
                </span>
              ) : selectedCluster.capacityPercentage >= 50 ? (
                <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-xs font-black flex items-center gap-1">
                  🟡 Moderate Crowd
                </span>
              ) : (
                <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-[#138808] border border-emerald-300 text-xs font-black flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-[#138808]" /> Low Density
                </span>
              )}
            </div>

            {/* Density Metrics Grid */}
            <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 p-3 rounded-xl border border-slate-200">
              <div>
                <div className="text-slate-500 text-[10px] font-extrabold uppercase">Live Footfall</div>
                <div className="text-base font-black text-slate-900 flex items-center gap-1 mt-0.5">
                  <Users className="w-4 h-4 text-red-500" />
                  <span>{selectedCluster.crowdCount} tourists</span>
                </div>
              </div>

              <div>
                <div className="text-slate-500 text-[10px] font-extrabold uppercase">Est. Queue / Delay</div>
                <div className="text-base font-black text-slate-900 flex items-center gap-1 mt-0.5">
                  <Clock className="w-4 h-4 text-amber-600" />
                  <span>{selectedCluster.avgWaitMinutes} mins</span>
                </div>
              </div>
            </div>

            {/* Capacity Progress Bar */}
            <div className="space-y-1">
              <div className="flex justify-between text-[11px] font-black">
                <span className="text-slate-600">Footfall Capacity Meter</span>
                <span className={selectedCluster.capacityPercentage >= 80 ? 'text-red-600' : 'text-slate-900'}>
                  {selectedCluster.capacityPercentage}% Capacity
                </span>
              </div>
              <div className="w-full bg-slate-200 h-2.5 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-500 rounded-full ${
                    selectedCluster.capacityPercentage >= 80
                      ? 'bg-gradient-to-r from-red-500 to-red-600'
                      : selectedCluster.capacityPercentage >= 50
                      ? 'bg-gradient-to-r from-amber-400 to-amber-500'
                      : 'bg-gradient-to-r from-emerald-400 to-emerald-500'
                  }`}
                  style={{ width: `${selectedCluster.capacityPercentage}%` }}
                ></div>
              </div>
            </div>

            {/* Status Notice Box */}
            <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-xl text-xs text-amber-950 font-semibold space-y-1">
              <div className="font-extrabold text-amber-900 flex items-center gap-1 text-[11px]">
                <Clock className="w-3.5 h-3.5 text-amber-600" />
                <span>Peak Traffic Window: {selectedCluster.peakHours}</span>
              </div>
              <p className="text-[11px] leading-relaxed text-amber-900">
                {selectedCluster.statusNotice}
              </p>
            </div>

            {/* SUGGESTED PEACEFUL ALTERNATIVE CARD & CHANGE PLAN ACTION */}
            <div className="p-4 bg-emerald-50/90 border-2 border-emerald-300 rounded-2xl space-y-3">
              <div className="flex items-center justify-between">
                <span className="px-2 py-0.5 rounded bg-[#138808] text-white text-[9px] font-black uppercase flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-amber-300" /> Quiet Alternative
                </span>
                <span className="text-[10px] font-extrabold text-emerald-800">
                  {selectedCluster.suggestedAlternative.distance}
                </span>
              </div>

              <div>
                <h5 className="text-sm font-black text-slate-900">
                  {selectedCluster.suggestedAlternative.name}
                </h5>
                <p className="text-[11px] text-slate-600 font-medium mt-1 leading-relaxed">
                  {selectedCluster.suggestedAlternative.description}
                </p>
              </div>

              <div className="flex items-center justify-between text-xs bg-white p-2 rounded-xl border border-emerald-200 font-bold">
                <span className="text-emerald-800">Crowd Load:</span>
                <span className="text-[#138808] font-black">
                  👥 {selectedCluster.suggestedAlternative.crowdCount} tourists ({selectedCluster.suggestedAlternative.capacityPercentage}% capacity)
                </span>
              </div>

              {/* CHANGE PLAN BUTTON */}
              <button
                onClick={() => handleSwitchPlan(selectedCluster.suggestedAlternative.name)}
                className="w-full py-3 px-4 bg-[#138808] hover:bg-emerald-800 text-white text-xs font-black rounded-xl shadow-md transition flex items-center justify-center gap-2 group cursor-pointer"
              >
                <RefreshCw className="w-4 h-4 text-amber-300 group-hover:rotate-180 transition-transform duration-500" />
                <span>Change Plan: Switch to {selectedCluster.suggestedAlternative.name}</span>
                <ArrowRight className="w-4 h-4 text-white group-hover:translate-x-1 transition-transform" />
              </button>
            </div>

          </div>
        </div>

      </div>

    </div>
  );
};
```

### `frontend/src/components/Gateway.tsx`

```tsx
import React, { useState } from 'react';
import {
  ShieldAlert,
  UserCheck,
  Smartphone,
  Lock,
  ArrowRight,
  Shield,
  KeyRound,
  Radio,
  Sparkles,
  MapPin,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';
import { Language, UserRole } from '../types';
import { i18n } from '../data/i18n';

interface GatewayProps {
  language: Language;
  onSelectRole: (role: UserRole) => void;
  onAuthenticateAuthority: (badgeId: string, otp: string) => Promise<boolean>;
}

export const Gateway: React.FC<GatewayProps> = ({
  language,
  onSelectRole,
  onAuthenticateAuthority
}) => {
  const t = i18n[language];
  const [showMfaModal, setShowMfaModal] = useState(false);
  const [badgeId, setBadgeId] = useState('');
  const [otp, setOtp] = useState('');
  const [mfaError, setMfaError] = useState('');
  const [mfaSubmitting, setMfaSubmitting] = useState(false);

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!badgeId.trim() || !otp.trim()) {
      setMfaError('Please provide both Badge ID and MFA Auth Code.');
      return;
    }
    setMfaError('');
    setMfaSubmitting(true);
    try {
      const success = await onAuthenticateAuthority(badgeId, otp);
      if (!success) {
        setMfaError('Could not verify credentials against the command server. Please try again.');
      } else {
        setShowMfaModal(false);
      }
    } finally {
      setMfaSubmitting(false);
    }
  };

  return (
    <div className="min-h-[calc(100vh-80px)] bg-[#F8FAFC] text-slate-900 flex flex-col justify-between relative overflow-hidden">
      {/* Background Decorative Grid */}
      <div className="absolute inset-0 bg-[radial-gradient(#e2e8f0_1px,transparent_1px)] [background-size:24px_24px] opacity-70 pointer-events-none"></div>
      
      {/* Top Banner Accent */}
      <div className="relative max-w-6xl mx-auto px-4 py-12 sm:py-16 text-center z-10">
        
        {/* Emblem & Badge */}
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white border border-[#FF9933] text-[#0B2447] text-xs font-bold uppercase tracking-wider mb-6 shadow-sm">
          <ShieldAlert className="w-4 h-4 text-[#FF9933]" />
          <span>{t.gatewayTitle} • Govt. of India</span>
        </div>

        <h1 className="text-3xl sm:text-5xl font-black tracking-tight text-[#0B2447] max-w-4xl mx-auto leading-tight uppercase">
          SURAKSHA <span className="text-[#FF9933]">SETU</span>
        </h1>

        <p className="mt-4 text-base sm:text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed font-medium">
          {t.gatewaySub}
        </p>

        {/* 2 Main Selection Cards */}
        <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-8 text-left max-w-4xl mx-auto">
          
          {/* TOURIST CARD */}
          <div
            onClick={() => onSelectRole('tourist')}
            className="group relative bg-white rounded-2xl p-6 sm:p-8 border-2 border-slate-200 hover:border-[#138808] transition-all duration-300 shadow-sm hover:shadow-xl cursor-pointer flex flex-col justify-between overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-[#138808]/10 rounded-full blur-2xl group-hover:bg-[#138808]/20 transition-all"></div>
            
            <div>
              <div className="w-14 h-14 rounded-xl bg-emerald-50 border border-emerald-300 text-[#138808] flex items-center justify-center mb-6 shadow-sm group-hover:scale-110 transition-transform">
                <Smartphone className="w-8 h-8 text-[#138808]" />
              </div>

              <div className="inline-block px-2.5 py-0.5 rounded bg-emerald-100/80 text-emerald-800 border border-emerald-200 text-xs font-extrabold mb-3">
                PUBLIC MOBILE APP
              </div>

              <h2 className="text-2xl font-black text-slate-900 group-hover:text-[#138808] transition-colors">
                {t.forTouristsTitle}
              </h2>

              <p className="mt-3 text-sm text-slate-600 leading-relaxed font-medium">
                {t.forTouristsDesc}
              </p>

              <div className="mt-6 space-y-2 text-xs text-slate-700">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#138808]" />
                  <span className="font-semibold">Instant 1-Tap SOS Panic Trigger</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#138808]" />
                  <span className="font-semibold">GPS Coordinate Telemetry Beacon</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#138808]" />
                  <span className="font-semibold">Directory of Emergency Helplines (112 / 100)</span>
                </div>
              </div>
            </div>

            <div className="mt-8 pt-4 border-t border-slate-100 flex items-center justify-between font-black text-[#138808] group-hover:translate-x-1 transition-transform">
              <span>{t.enterTouristPortal}</span>
              <ArrowRight className="w-5 h-5" />
            </div>
          </div>

          {/* AUTHORITY CARD */}
          <div
            onClick={() => setShowMfaModal(true)}
            className="group relative bg-white rounded-2xl p-6 sm:p-8 border-2 border-slate-200 hover:border-[#0B2447] transition-all duration-300 shadow-sm hover:shadow-xl cursor-pointer flex flex-col justify-between overflow-hidden"
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-[#0B2447]/10 rounded-full blur-2xl group-hover:bg-[#0B2447]/20 transition-all"></div>
            
            <div>
              <div className="w-14 h-14 rounded-xl bg-slate-100 border border-[#0B2447]/30 text-[#0B2447] flex items-center justify-center mb-6 shadow-sm group-hover:scale-110 transition-transform">
                <Shield className="w-8 h-8 text-[#0B2447]" />
              </div>

              <div className="inline-block px-2.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 text-xs font-extrabold mb-3">
                MFA RESTRICTED ACCESS
              </div>

              <h2 className="text-2xl font-black text-slate-900 group-hover:text-[#0B2447] transition-colors">
                {t.forAuthoritiesTitle}
              </h2>

              <p className="mt-3 text-sm text-slate-600 leading-relaxed font-medium">
                {t.forAuthoritiesDesc}
              </p>

              <div className="mt-6 space-y-2 text-xs text-slate-700">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#FF9933]" />
                  <span className="font-semibold">Module 1: AI Anomaly & Threat Predictor</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#FF9933]" />
                  <span className="font-semibold">Module 2: Tourist Interception & Profile Tracking</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#FF9933]" />
                  <span className="font-semibold">Module 3: Live GIS SOS Map & Dispatch Ticketing</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#FF9933]" />
                  <span className="font-semibold">Module 4: Geofenced Emergency SMS Broadcast</span>
                </div>
              </div>
            </div>

            <div className="mt-8 pt-4 border-t border-slate-100 flex items-center justify-between font-black text-[#0B2447] group-hover:translate-x-1 transition-transform">
              <span>{t.enterAuthorityPortal}</span>
              <Lock className="w-5 h-5 text-[#FF9933]" />
            </div>
          </div>

        </div>

        {/* Footnote */}
        <div className="mt-12 text-xs text-slate-500 flex items-center justify-center space-x-4 font-medium">
          <span className="flex items-center gap-1 text-slate-600">
            <Radio className="w-3.5 h-3.5 text-emerald-600" /> Encrypted Protocol NIC-v4.2
          </span>
          <span>•</span>
          <span>Digital India Civil Safety Command Framework</span>
        </div>

      </div>

      {/* MFA VERIFICATION MODAL */}
      {showMfaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white border-2 border-[#FF9933] rounded-2xl max-w-md w-full p-6 sm:p-8 shadow-2xl relative text-left">
            
            <div className="flex items-center space-x-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-amber-100 border border-[#FF9933] flex items-center justify-center text-[#0B2447]">
                <KeyRound className="w-6 h-6 text-[#0B2447]" />
              </div>
              <div>
                <h3 className="text-xl font-black text-slate-900">
                  {t.mfaModalTitle}
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  Authentication & Badge Verification
                </p>
              </div>
            </div>

            <form onSubmit={handleMfaSubmit} className="space-y-4">
              {mfaError && (
                <div className="p-3 bg-red-50 border border-red-300 text-red-800 text-xs rounded-lg flex items-center gap-2 font-bold">
                  <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
                  <span>{mfaError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {t.mfaBadgeIdLabel}
                </label>
                <input
                  type="text"
                  value={badgeId}
                  onChange={(e) => setBadgeId(e.target.value)}
                  placeholder="IPS-7742"
                  className="w-full px-3.5 py-2 rounded-lg bg-slate-50 border border-slate-300 text-slate-900 font-mono text-sm focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#FF9933]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {t.mfaOtpLabel}
                </label>
                <input
                  type="password"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  placeholder="789012"
                  className="w-full px-3.5 py-2 rounded-lg bg-slate-50 border border-slate-300 text-slate-900 font-mono text-sm tracking-widest focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#FF9933]"
                />
              </div>

              <div className="p-2.5 bg-amber-50 rounded-lg border border-amber-200 text-[11px] text-amber-900 font-mono font-medium">
                ℹ️ {t.mfaDemoNote}
              </div>

              <div className="pt-2 flex items-center space-x-3">
                <button
                  type="button"
                  onClick={() => setShowMfaModal(false)}
                  className="flex-1 px-4 py-2.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 text-sm font-bold transition"
                >
                  {t.cancelBtn}
                </button>
                <button
                  type="submit"
                  disabled={mfaSubmitting}
                  className="flex-1 px-4 py-2.5 rounded-lg bg-[#0B2447] hover:bg-[#071933] disabled:opacity-60 text-white text-sm font-extrabold transition shadow-lg flex items-center justify-center gap-2"
                >
                  <span>{mfaSubmitting ? 'Verifying…' : t.mfaVerifyBtn}</span>
                  <ArrowRight className="w-4 h-4 text-[#FF9933]" />
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

    </div>
  );
};
```

### `frontend/src/components/Header.tsx`

```tsx
import React from 'react';
import {
  Brain,
  UserCheck,
  MapPin,
  Radio,
  BarChart3,
  Search,
  Globe,
  Sun,
  Moon,
  LogOut,
  Compass,
  ShieldAlert
} from 'lucide-react';
import { Language, UserRole, ActiveModule } from '../types';
import { i18n } from '../data/i18n';

interface HeaderProps {
  language: Language;
  onLanguageChange: (lang: Language) => void;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  userRole: UserRole;
  onLogout: () => void;
  activeModule: ActiveModule;
  onSelectModule: (mod: ActiveModule) => void;
  globalSearchQuery: string;
  onGlobalSearchChange: (q: string) => void;
  onExecuteGlobalSearch: () => void;
  activeSosCount: number;
}

export const Header: React.FC<HeaderProps> = ({
  language,
  onLanguageChange,
  darkMode,
  onToggleDarkMode,
  userRole,
  onLogout,
  activeModule,
  onSelectModule,
  globalSearchQuery,
  onGlobalSearchChange,
  onExecuteGlobalSearch,
  activeSosCount
}) => {
  const t = i18n[language];

  // Navigation items matching exact requested titles and badges
  const navItems = [
    {
      id: 'ai_hub' as ActiveModule,
      icon: Brain,
      titleEn: 'AI Anomaly & Prediction Hub',
      badge: 'AI ACTIVE',
      badgeStyle: 'bg-amber-500/20 text-[#FF9933] border-amber-500/40'
    },
    {
      id: 'tourist_tracking' as ActiveModule,
      icon: UserCheck,
      titleEn: 'Tourist Detail Tracking',
      badge: null,
      badgeStyle: ''
    },
    {
      id: 'sos_map' as ActiveModule,
      icon: MapPin,
      titleEn: 'SOS Alert & Command Map',
      badge: `${activeSosCount} SOS`,
      badgeStyle: 'bg-red-500/20 text-red-400 border-red-500/40 font-black animate-pulse'
    },
    {
      id: 'broadcast' as ActiveModule,
      icon: Radio,
      titleEn: 'Broadcast & Geofenced Alerts',
      badge: null,
      badgeStyle: ''
    },
    {
      id: 'analytics_audit' as ActiveModule,
      icon: BarChart3,
      titleEn: 'Audit Logs & Analytics',
      badge: null,
      badgeStyle: ''
    }
  ];

  return (
    <header className="sticky top-0 z-50 bg-[#0C2340] text-white shadow-xl border-b border-slate-800">
      
      {/* Tricolor Top Bar Accent */}
      <div className="h-1 w-full flex">
        <div className="h-full w-1/3 bg-[#FF9933]"></div>
        <div className="h-full w-1/3 bg-white"></div>
        <div className="h-full w-1/3 bg-[#138808]"></div>
      </div>

      {/* ROW 1: DARK NAVY BAR WITH BRAND & HORIZONTAL NAV TABS */}
      <div className="max-w-[1700px] mx-auto px-4 sm:px-6 lg:px-8 py-2">
        <div className="flex flex-col xl:flex-row items-center justify-between gap-3">
          
          {/* Brand Logo & Emblem */}
          <div
            className="flex items-center space-x-3 cursor-pointer group flex-shrink-0"
            onClick={() => userRole === 'authority' && onSelectModule('ai_hub')}
          >
            {/* Round White Wheel Emblem */}
            <div className="w-9 h-9 rounded-full bg-white text-[#0C2340] flex items-center justify-center font-bold shadow-sm border border-slate-200 group-hover:scale-105 transition-transform">
              <Compass className="w-5 h-5 text-[#0C2340]" />
            </div>

            <div className="flex flex-col leading-tight">
              <span className="text-sm font-black tracking-wider text-white uppercase whitespace-nowrap">
                SURAKSHA SETU
              </span>
              <span className="text-[10px] font-bold text-[#FF9933] whitespace-nowrap">
                सुरक्षा सेतु • National Portal
              </span>
            </div>
          </div>

          {/* Horizontal Nav Tabs (Requested Modules) */}
          {userRole === 'authority' && (
            <div className="flex items-center space-x-1.5 sm:space-x-2 overflow-x-auto w-full xl:w-auto py-1 no-scrollbar">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeModule === item.id;

                return (
                  <button
                    key={item.id}
                    onClick={() => onSelectModule(item.id)}
                    className={`flex items-center space-x-2.5 px-3.5 py-2 rounded-xl text-left transition-all flex-shrink-0 cursor-pointer ${
                      isActive
                        ? 'bg-[#153462] border border-[#234F8C] shadow-md ring-1 ring-[#FF9933]/40'
                        : 'bg-transparent hover:bg-white/5 text-slate-300 hover:text-white border border-transparent'
                    }`}
                  >
                    <Icon
                      className={`w-4 h-4 flex-shrink-0 ${
                        isActive ? 'text-[#FF9933]' : 'text-slate-300'
                      }`}
                    />
                    <span
                      className={`text-xs whitespace-nowrap font-bold ${
                        isActive ? 'text-white' : 'text-slate-200'
                      }`}
                    >
                      {item.titleEn}
                    </span>

                    {item.badge && (
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded border uppercase tracking-wider font-extrabold ${item.badgeStyle}`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

        </div>
      </div>

      {/* ROW 2: LIGHT SUB-BAR WITH PAGE TITLE, SEARCH & OFFICER PROFILE */}
      <div className="bg-[#F8FAFC] text-slate-900 border-t border-slate-700/50 border-b border-slate-200 py-2.5">
        <div className="max-w-[1700px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-3">
            
            {/* Title & Subtitle */}
            <div className="flex flex-col">
              <h1 className="text-lg sm:text-xl font-black text-[#0C2340] tracking-tight whitespace-nowrap uppercase">
                {t.nationalPortalName}
              </h1>
              <p className="text-xs text-slate-600 font-semibold mt-0.5 whitespace-nowrap">
                {t.nationalPortalName} • {language === 'hi' ? 'हिमाचल प्रदेश राज्य' : 'Himachal Pradesh State'}
              </p>
            </div>

            {/* Right Controls: Search, Profile & Action Utilities */}
            <div className="flex items-center space-x-3 w-full md:w-auto justify-end">
              
              {/* Search Box */}
              {userRole === 'authority' && (
                <div className="relative flex-1 md:flex-initial">
                  <input
                    type="text"
                    placeholder="Search districts or schemes..."
                    value={globalSearchQuery}
                    onChange={(e) => onGlobalSearchChange(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && onExecuteGlobalSearch()}
                    className="w-full md:w-72 lg:w-80 pl-9 pr-8 py-1.5 text-xs rounded-full bg-white border border-slate-300 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-[#0C2340] focus:ring-1 focus:ring-[#0C2340] shadow-sm font-medium transition-all"
                  />
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                  {globalSearchQuery && (
                    <button
                      onClick={onExecuteGlobalSearch}
                      className="absolute right-2 top-1.5 px-2 py-0.5 bg-[#0C2340] text-white text-[10px] font-bold rounded-full hover:bg-slate-800"
                    >
                      GO
                    </button>
                  )}
                </div>
              )}

              {/* Active SOS Badge Banner */}
              {userRole === 'authority' && activeSosCount > 0 && (
                <button
                  onClick={() => onSelectModule('sos_map')}
                  className="flex items-center space-x-1.5 bg-red-600 hover:bg-red-700 text-white px-3 py-1.5 rounded-full text-xs font-black shadow-sm border border-red-400/40 whitespace-nowrap animate-pulse transition-all cursor-pointer"
                >
                  <ShieldAlert className="w-3.5 h-3.5 text-white" />
                  <span>{activeSosCount} Active SOS</span>
                </button>
              )}

              {/* Officer Profile Badge */}
              {userRole === 'authority' ? (
                <div className="flex items-center space-x-2.5 border-l border-slate-300 pl-3">
                  <img
                    src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80"
                    alt="Rajesh Kumar, IAS"
                    className="w-8 h-8 rounded-full border border-slate-300 object-cover shadow-xs flex-shrink-0"
                  />
                  <div className="flex flex-col leading-tight">
                    <span className="text-xs font-extrabold text-[#0C2340] whitespace-nowrap">
                      Rajesh Kumar, IAS
                    </span>
                    <span className="text-[10px] text-slate-500 font-medium whitespace-nowrap">
                      State Chief Administrator
                    </span>
                  </div>
                </div>
              ) : null}

              {/* Utilities: Language, Theme & Logout */}
              <div className="flex items-center space-x-1.5 border-l border-slate-300 pl-2">
                
                {/* Language Switcher */}
                <div className="flex items-center bg-slate-200/80 border border-slate-300 rounded-lg p-0.5 gap-0.5">
                  <Globe className="w-3 h-3 text-slate-600 ml-1" />
                  <button
                    onClick={() => onLanguageChange('en')}
                    className={`px-1.5 py-0.5 text-[10px] font-extrabold rounded ${
                      language === 'en'
                        ? 'bg-[#0C2340] text-white shadow-xs'
                        : 'text-slate-700 hover:text-slate-900'
                    }`}
                  >
                    EN
                  </button>
                  <button
                    onClick={() => onLanguageChange('hi')}
                    className={`px-1.5 py-0.5 text-[10px] font-extrabold rounded ${
                      language === 'hi'
                        ? 'bg-[#0C2340] text-white shadow-xs'
                        : 'text-slate-700 hover:text-slate-900'
                    }`}
                  >
                    हिंदी
                  </button>
                </div>

                {/* Theme Toggle */}
                <button
                  onClick={onToggleDarkMode}
                  className="p-1.5 rounded-lg bg-slate-200/80 border border-slate-300 text-slate-700 hover:bg-slate-300 transition-colors"
                  title="Toggle High-Contrast Theme"
                >
                  {darkMode ? <Sun className="w-3.5 h-3.5 text-amber-500" /> : <Moon className="w-3.5 h-3.5 text-slate-700" />}
                </button>

                {/* Logout / Switch Gateway */}
                <button
                  onClick={onLogout}
                  className="p-1.5 rounded-lg bg-red-100 hover:bg-red-200 border border-red-300 text-red-800 transition-colors"
                  title={t.logoutBtn}
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>

              </div>

            </div>

          </div>
        </div>
      </div>

    </header>
  );
};
```

### `frontend/src/components/InterceptionModal.tsx`

```tsx
import React, { useState } from 'react';
import {
  Lock,
  ShieldAlert,
  FileCheck2,
  AlertOctagon,
  Scale,
  Search,
  X,
  FileText
} from 'lucide-react';
import { Language, InterceptionReason } from '../types';
import { i18n } from '../data/i18n';

interface InterceptionModalProps {
  language: Language;
  touristId: string;
  onConfirm: (reason: InterceptionReason, notes: string) => void;
  onCancel: () => void;
}

export const InterceptionModal: React.FC<InterceptionModalProps> = ({
  language,
  touristId,
  onConfirm,
  onCancel
}) => {
  const t = i18n[language];
  const [selectedReason, setSelectedReason] = useState<InterceptionReason>('Active SOS Response');
  const [officerNotes, setOfficerNotes] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConfirm(selectedReason, officerNotes);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="bg-slate-900 border-2 border-[#FF9933] rounded-2xl max-w-lg w-full p-6 sm:p-8 shadow-2xl relative text-left">
        
        {/* Close Button */}
        <button
          onClick={onCancel}
          className="absolute top-4 right-4 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Title Header */}
        <div className="flex items-center space-x-3 mb-4">
          <div className="w-12 h-12 rounded-xl bg-amber-950/90 border border-[#FF9933] flex items-center justify-center text-[#FF9933] flex-shrink-0 shadow-lg">
            <ShieldAlert className="w-7 h-7" />
          </div>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-[#FF9933] flex items-center gap-1">
              <Lock className="w-3.5 h-3.5" /> STATUTORY INTERCEPTION PROTOCOL
            </div>
            <h3 className="text-xl font-extrabold text-white">
              {t.interceptionTitle}
            </h3>
          </div>
        </div>

        {/* Notice Disclaimer */}
        <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 text-xs text-slate-300 mb-5 leading-relaxed">
          {t.interceptionDesc}
          <div className="mt-2 font-mono font-bold text-amber-300">
            Target ID: <span className="underline decoration-[#FF9933]">{touristId}</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          
          {/* Reason Radio Group */}
          <div>
            <label className="block text-xs font-bold text-slate-200 uppercase tracking-wider mb-2">
              {t.selectReasonLabel} *
            </label>

            <div className="space-y-2">
              
              {/* Reason 1 */}
              <label
                onClick={() => setSelectedReason('Active SOS Response')}
                className={`flex items-center space-x-3 p-3 rounded-xl border cursor-pointer transition ${
                  selectedReason === 'Active SOS Response'
                    ? 'bg-red-950/60 border-red-500 text-white'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <AlertOctagon className={`w-5 h-5 ${selectedReason === 'Active SOS Response' ? 'text-red-400' : 'text-slate-500'}`} />
                <div className="flex-1">
                  <div className="text-sm font-bold">{t.reasonActiveSos}</div>
                  <div className="text-[11px] text-slate-400">Emergency beacon active or continuous heart-rate anomaly detected.</div>
                </div>
              </label>

              {/* Reason 2 */}
              <label
                onClick={() => setSelectedReason('Filed Missing Person Report')}
                className={`flex items-center space-x-3 p-3 rounded-xl border cursor-pointer transition ${
                  selectedReason === 'Filed Missing Person Report'
                    ? 'bg-amber-950/60 border-amber-500 text-white'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <FileCheck2 className={`w-5 h-5 ${selectedReason === 'Filed Missing Person Report' ? 'text-amber-400' : 'text-slate-500'}`} />
                <div className="flex-1">
                  <div className="text-sm font-bold">{t.reasonMissing}</div>
                  <div className="text-[11px] text-slate-400">Formal missing report logged by embassy or family member.</div>
                </div>
              </label>

              {/* Reason 3 */}
              <label
                onClick={() => setSelectedReason('Designated Check-in Routine')}
                className={`flex items-center space-x-3 p-3 rounded-xl border cursor-pointer transition ${
                  selectedReason === 'Designated Check-in Routine'
                    ? 'bg-emerald-950/60 border-emerald-500 text-white'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <Search className={`w-5 h-5 ${selectedReason === 'Designated Check-in Routine' ? 'text-emerald-400' : 'text-slate-500'}`} />
                <div className="flex-1">
                  <div className="text-sm font-bold">{t.reasonRoutine}</div>
                  <div className="text-[11px] text-slate-400">Scheduled checkpoint audit for high-risk trekking circuits.</div>
                </div>
              </label>

              {/* Reason 4 */}
              <label
                onClick={() => setSelectedReason('Judicial / Legal Warrant')}
                className={`flex items-center space-x-3 p-3 rounded-xl border cursor-pointer transition ${
                  selectedReason === 'Judicial / Legal Warrant'
                    ? 'bg-blue-950/60 border-blue-500 text-white'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <Scale className={`w-5 h-5 ${selectedReason === 'Judicial / Legal Warrant' ? 'text-blue-400' : 'text-slate-500'}`} />
                <div className="flex-1">
                  <div className="text-sm font-bold">{t.reasonWarrant}</div>
                  <div className="text-[11px] text-slate-400">Court order or law enforcement investigative request.</div>
                </div>
              </label>

            </div>
          </div>

          {/* Notes Input */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1 flex items-center gap-1">
              <FileText className="w-3.5 h-3.5 text-slate-400" />
              <span>{t.officerNotesLabel}</span>
            </label>
            <input
              type="text"
              value={officerNotes}
              onChange={(e) => setOfficerNotes(e.target.value)}
              placeholder="e.g., FIR-902/2026 or Solang Patrol Ref #4"
              className="w-full px-3.5 py-2 rounded-lg bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#FF9933]"
            />
          </div>

          {/* Buttons */}
          <div className="pt-2 flex items-center space-x-3">
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 px-4 py-2.5 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 text-sm font-semibold transition"
            >
              {t.cancelBtn}
            </button>
            <button
              type="submit"
              className="flex-1 px-4 py-2.5 rounded-xl bg-[#FF9933] hover:bg-amber-500 text-slate-950 text-sm font-black transition shadow-lg"
            >
              {t.confirmAccessBtn}
            </button>
          </div>

        </form>

      </div>
    </div>
  );
};
```

### `frontend/src/components/ModuleAIHub.tsx`

```tsx
import React, { useState } from 'react';
import {
  BrainCircuit,
  Flame,
  AlertTriangle,
  Activity,
  MapPin,
  TrendingUp,
  Cpu,
  Eye,
  ShieldAlert,
  ArrowRight,
  Filter,
  CheckCircle2,
  RefreshCw
} from 'lucide-react';
import { Language, AnomalyCluster, AILog } from '../types';
import { i18n } from '../data/i18n';

interface ModuleAIHubProps {
  language: Language;
  clusters: AnomalyCluster[];
  aiLogs: AILog[];
  onInvestigateCluster: (cluster: AnomalyCluster) => void;
  onNavigateToMap: () => void;
}

export const ModuleAIHub: React.FC<ModuleAIHubProps> = ({
  language,
  clusters,
  aiLogs,
  onInvestigateCluster,
  onNavigateToMap
}) => {
  const t = i18n[language];
  const [selectedClusterId, setSelectedClusterId] = useState<string>(clusters[0]?.id || '');
  const [activeTab, setActiveTab] = useState<'heatmaps' | 'clusters' | 'logs'>('heatmaps');

  const selectedCluster = clusters.find((c) => c.id === selectedClusterId) || clusters[0];

  return (
    <div className="space-y-6">
      
      {/* Top Banner Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        
        {/* Stat 1 */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between shadow-sm">
          <div>
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">{t.riskScore}</div>
            <div className="text-2xl font-black text-[#0B2447] mt-1">88 / 100</div>
            <div className="text-[11px] text-amber-700 font-bold mt-0.5">High Risk in Kullu Sector</div>
          </div>
          <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-[#FF9933]">
            <Flame className="w-6 h-6 text-[#FF9933] animate-pulse" />
          </div>
        </div>

        {/* Stat 2 */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between shadow-sm">
          <div>
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">Active Threat Clusters</div>
            <div className="text-2xl font-black text-red-600 mt-1">{clusters.length} Zones</div>
            <div className="text-[11px] text-slate-500 mt-0.5">3 Critical AI Flags</div>
          </div>
          <div className="w-12 h-12 rounded-xl bg-red-50 border border-red-200 flex items-center justify-center text-red-600">
            <AlertTriangle className="w-6 h-6 text-red-600" />
          </div>
        </div>

        {/* Stat 3 */}
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between shadow-sm">
          <div>
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">{t.confidenceLevel}</div>
            <div className="text-2xl font-black text-[#138808] mt-1">94.2%</div>
            <div className="text-[11px] text-slate-500 mt-0.5">Model Anomaly-v4.2</div>
          </div>
          <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-[#138808]">
            <Cpu className="w-6 h-6 text-[#138808]" />
          </div>
        </div>

      </div>

      {/* Main Grid: Interactive Map Heatmap & Cluster Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left 2 Cols: High-Risk Map Heatmap Visualization Mockup */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col justify-between">
          
          <div className="flex items-center justify-between mb-4 border-b border-slate-200 pb-3">
            <div className="flex items-center space-x-2">
              <BrainCircuit className="w-5 h-5 text-[#FF9933]" />
              <h3 className="text-base font-bold text-slate-900">
                {t.highRiskHeatmap}
              </h3>
            </div>
            
            <button
              onClick={onNavigateToMap}
              className="text-xs font-extrabold text-[#0B2447] hover:underline flex items-center gap-1"
            >
              <span>{t.viewInMap}</span>
              <ArrowRight className="w-3.5 h-3.5 text-[#FF9933]" />
            </button>
          </div>

          {/* SIMULATED HIGH-RISK HEATMAP VECTOR CANVAS */}
          <div className="relative w-full h-80 bg-slate-100 rounded-xl border border-slate-200 overflow-hidden flex items-center justify-center">
            
            {/* Grid Overlay */}
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#cbd5e1_1px,transparent_1px),linear-gradient(to_bottom,#cbd5e1_1px,transparent_1px)] bg-[size:2rem_2rem] opacity-40"></div>

            {/* Radar Sweep Effect */}
            <div className="absolute inset-0 rounded-full border border-amber-500/20 animate-ping pointer-events-none"></div>

            {/* Heatmap Pulsing Rings for Clusters */}
            {clusters.map((cluster) => {
              const isSelected = cluster.id === selectedCluster.id;
              
              // Position mapping for mock map
              const leftPos = cluster.id === 'AC-101' ? '30%' : cluster.id === 'AC-102' ? '65%' : '48%';
              const topPos = cluster.id === 'AC-101' ? '25%' : cluster.id === 'AC-102' ? '55%' : '75%';

              return (
                <div
                  key={cluster.id}
                  onClick={() => setSelectedClusterId(cluster.id)}
                  style={{ left: leftPos, top: topPos }}
                  className="absolute cursor-pointer -translate-x-1/2 -translate-y-1/2 group"
                >
                  {/* Heat gradient aura */}
                  <div className={`w-24 h-24 rounded-full blur-xl animate-pulse transition-all ${
                    cluster.riskScore > 80 ? 'bg-red-500/30' : 'bg-amber-500/30'
                  }`}></div>

                  {/* Marker Pin */}
                  <div className={`relative w-8 h-8 rounded-full border-2 flex items-center justify-center font-bold text-xs shadow-md transition-transform ${
                    isSelected
                      ? 'bg-red-600 border-white text-white scale-125 z-20'
                      : 'bg-[#0B2447] border-[#FF9933] text-white group-hover:scale-110'
                  }`}>
                    {cluster.riskScore}
                  </div>

                  {/* Tooltip */}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-slate-900 border border-slate-700 text-slate-100 text-[11px] px-2.5 py-1 rounded shadow-xl whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-30 pointer-events-none">
                    <div className="font-bold">{cluster.regionName}</div>
                    <div className="text-[10px] text-amber-400">Risk: {cluster.riskScore}/100 • {cluster.anomalyType}</div>
                  </div>
                </div>
              );
            })}

            {/* Legend & Controls */}
            <div className="absolute bottom-3 left-3 bg-white/95 border border-slate-200 rounded-lg p-2.5 text-[10px] space-y-1 shadow-md text-slate-800">
              <div className="font-extrabold text-[#0B2447]">HEATMAP INTENSITY</div>
              <div className="flex items-center gap-1 font-semibold">
                <span className="w-3 h-3 rounded bg-red-600"></span> 80-100 Critical Hazard
              </div>
              <div className="flex items-center gap-1 font-semibold">
                <span className="w-3 h-3 rounded bg-amber-500"></span> 60-79 Moderate Anomaly
              </div>
            </div>

          </div>

          {/* Selected Cluster Details Card below map */}
          {selectedCluster && (
            <div className="mt-4 p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <div className="font-bold text-slate-900 text-sm flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-red-600" />
                  <span>{selectedCluster.regionName}</span>
                </div>
                <span className="px-2 py-0.5 rounded bg-red-100 text-red-800 border border-red-200 font-extrabold">
                  {selectedCluster.anomalyType}
                </span>
              </div>

              <p className="mt-2 text-slate-700 leading-relaxed font-medium">
                {language === 'hi' ? selectedCluster.descriptionHi : selectedCluster.descriptionEn}
              </p>

              <div className="mt-3 p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 font-medium">
                <strong>Recommended Action:</strong> {language === 'hi' ? selectedCluster.recommendedActionHi : selectedCluster.recommendedActionEn}
              </div>
            </div>
          )}

        </div>

        {/* Right Col: Incident Clusters List Cards */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4 border-b border-slate-200 pb-3">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Flame className="w-5 h-5 text-red-600" />
                <span>{t.incidentClusters}</span>
              </h3>
              <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 font-mono text-[10px] font-bold">
                {clusters.length} Active
              </span>
            </div>

            <div className="space-y-3">
              {clusters.map((c) => (
                <div
                  key={c.id}
                  onClick={() => setSelectedClusterId(c.id)}
                  className={`p-3.5 rounded-xl border cursor-pointer transition ${
                    selectedClusterId === c.id
                      ? 'bg-amber-50/80 border-[#FF9933] shadow-sm'
                      : 'bg-slate-50 border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-extrabold text-slate-900">{c.regionName}</span>
                    <span className="font-mono font-bold text-red-700 bg-red-100 px-1.5 py-0.5 rounded border border-red-200">
                      {c.riskScore}% Risk
                    </span>
                  </div>

                  <div className="text-[11px] text-slate-600 line-clamp-2 font-medium">
                    {language === 'hi' ? c.descriptionHi : c.descriptionEn}
                  </div>

                  <div className="mt-2.5 flex items-center justify-between text-[10px] text-slate-500">
                    <span>Density: {c.touristDensity} travelers</span>
                    <span className="text-[#138808] font-extrabold">Confidence: {c.confidenceScore}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-100 text-center">
            <span className="text-[11px] text-slate-500 font-medium">Continuous AI Anomaly Model: Active Stream</span>
          </div>
        </div>

      </div>

      {/* AI Contextual Stream Logs */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-4">
          <div className="flex items-center space-x-2">
            <Activity className="w-5 h-5 text-[#138808] animate-pulse" />
            <h3 className="text-base font-bold text-slate-900">
              {t.contextualAnalysis}
            </h3>
          </div>
          <span className="text-xs font-mono text-[#138808] flex items-center gap-1 font-bold">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Live Telemetry
          </span>
        </div>

        <div className="space-y-2 font-mono text-xs">
          {aiLogs.map((log) => (
            <div
              key={log.id}
              className={`p-3 rounded-lg border flex items-start space-x-3 ${
                log.severity === 'critical'
                  ? 'bg-red-50 border-red-200 text-red-950'
                  : log.severity === 'warning'
                  ? 'bg-amber-50 border-amber-200 text-amber-950'
                  : 'bg-slate-50 border-slate-200 text-slate-900'
              }`}
            >
              <span className="text-slate-500 flex-shrink-0 text-[10px] pt-0.5">[{log.timestamp}]</span>
              <div className="flex-1">
                <div className="font-bold">{language === 'hi' ? log.messageHi : log.messageEn}</div>
                <div className="text-[10px] opacity-80 mt-0.5">Region: {log.region} • Confidence Index: {log.modelConfidence}%</div>
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
};
```

### `frontend/src/components/ModuleAnalyticsAudit.tsx`

```tsx
import React, { useState } from 'react';
import {
  BarChart3,
  FileCheck2,
  Download,
  Search,
  ShieldCheck,
  TrendingUp,
  Clock,
  CheckCircle2,
  MapPin,
  Calendar,
  Filter
} from 'lucide-react';
import { Language, AuditLog } from '../types';
import { i18n } from '../data/i18n';

interface ModuleAnalyticsAuditProps {
  language: Language;
  auditLogs: AuditLog[];
}

export const ModuleAnalyticsAudit: React.FC<ModuleAnalyticsAuditProps> = ({
  language,
  auditLogs
}) => {
  const t = i18n[language];
  const [searchFilter, setSearchFilter] = useState('');
  const [actionFilter, setActionFilter] = useState<string>('ALL');

  const filteredLogs = auditLogs.filter((log) => {
    const matchesSearch =
      log.officerName.toLowerCase().includes(searchFilter.toLowerCase()) ||
      log.targetId.toLowerCase().includes(searchFilter.toLowerCase()) ||
      (log.reason && log.reason.toLowerCase().includes(searchFilter.toLowerCase())) ||
      log.details.toLowerCase().includes(searchFilter.toLowerCase());

    const matchesAction = actionFilter === 'ALL' || log.actionType === actionFilter;

    return matchesSearch && matchesAction;
  });

  const exportCsv = () => {
    const headers = ['ID', 'Timestamp', 'Officer', 'Badge', 'Action', 'Target ID', 'Reason', 'Details', 'IP'];
    const rows = auditLogs.map((l) => [
      l.id,
      l.timestamp,
      `"${l.officerName}"`,
      l.officerBadge,
      l.actionType,
      `"${l.targetId}"`,
      `"${l.reason || ''}"`,
      `"${l.details}"`,
      l.ipAddress
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `Safety_Command_AuditLogs_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      
      {/* PERFORMANCE METRICS BAR */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center space-x-2 border-b border-slate-200 pb-3 mb-4">
          <BarChart3 className="w-5 h-5 text-[#FF9933]" />
          <h3 className="text-base font-bold text-slate-900">
            {t.performanceTitle}
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
            <div className="text-slate-500 text-xs font-bold uppercase">{t.avgResponseTime}</div>
            <div className="text-2xl font-black text-[#138808] mt-1 font-mono">4.2 min</div>
            <div className="text-[11px] text-[#138808] font-bold mt-0.5">↓ 18% improvement vs Q2</div>
          </div>

          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
            <div className="text-slate-500 text-xs font-bold uppercase">{t.resolutionRate}</div>
            <div className="text-2xl font-black text-[#0B2447] mt-1 font-mono">96.4%</div>
            <div className="text-[11px] text-blue-700 font-bold mt-0.5">342 incidents resolved</div>
          </div>

          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
            <div className="text-slate-500 text-xs font-bold uppercase">Statutory Compliance</div>
            <div className="text-2xl font-black text-[#FF9933] mt-1 font-mono">100% Audit</div>
            <div className="text-[11px] text-slate-600 font-medium mt-0.5">0 unverified search breaches</div>
          </div>

          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
            <div className="text-slate-500 text-xs font-bold uppercase">Monthly Inflow Sync</div>
            <div className="text-2xl font-black text-purple-700 mt-1 font-mono">1.42 Lakhs</div>
            <div className="text-[11px] text-slate-600 font-medium mt-0.5">Verified tourist check-ins</div>
          </div>

        </div>

        {/* Visual Charts / Breakdown Mockup */}
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* Chart 1: Frequent Incident Zones Bar */}
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-3">
            <div className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
              {t.frequentZones}
            </div>

            <div className="space-y-2">
              <div>
                <div className="flex justify-between text-slate-700 mb-1 font-medium">
                  <span>1. Solang Trekking Trail, Kullu (HP)</span>
                  <span className="font-mono text-[#0B2447] font-bold">42 incidents</span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
                  <div className="h-full bg-[#FF9933] w-[84%]"></div>
                </div>
              </div>

              <div>
                <div className="flex justify-between text-slate-700 mb-1 font-medium">
                  <span>2. Dashashwamedh Ghat Alleys, Varanasi (UP)</span>
                  <span className="font-mono text-[#0B2447] font-bold">28 incidents</span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
                  <div className="h-full bg-[#FF9933] w-[56%]"></div>
                </div>
              </div>

              <div>
                <div className="flex justify-between text-slate-700 mb-1 font-medium">
                  <span>3. Canacona Tidal Cliffs, Goa</span>
                  <span className="font-mono text-[#0B2447] font-bold">19 incidents</span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-200 overflow-hidden">
                  <div className="h-full bg-[#FF9933] w-[38%]"></div>
                </div>
              </div>
            </div>
          </div>

          {/* Chart 2: Tourist Inflow vs Anomaly Trend */}
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-3">
            <div className="font-bold text-slate-800 uppercase tracking-wider text-[11px]">
              {t.inflowVsRisk}
            </div>

            <div className="h-32 flex items-end justify-between gap-2 pt-4 px-2 border-b border-slate-200">
              {['May', 'Jun', 'Jul', 'Aug (Cur)'].map((m, idx) => {
                const heightPct = [40, 65, 85, 55][idx];
                return (
                  <div key={m} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                    <div
                      style={{ height: `${heightPct}%` }}
                      className="w-full bg-gradient-to-t from-[#0B2447] to-[#FF9933] rounded-t hover:brightness-110 transition shadow-sm"
                    ></div>
                    <span className="text-[10px] text-slate-600 font-bold">{m}</span>
                  </div>
                );
              })}
            </div>
          </div>

        </div>
      </div>

      {/* AUDIT LOGS TABLE & EXPORT */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-slate-200 pb-4 mb-4">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-[#138808]" />
              <span>{t.auditLogsTitle}</span>
            </h3>
            <p className="text-xs text-slate-500 font-medium">{t.auditLogsDesc}</p>
          </div>

          <button
            onClick={exportCsv}
            className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-sm"
          >
            <Download className="w-4 h-4 text-[#FF9933]" />
            <span>{t.exportCsvBtn}</span>
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-3 mb-4 text-xs">
          <div className="relative flex-1">
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Search by Officer, Target ID, Reason, or Details..."
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-50 border border-slate-300 text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-[#FF9933] focus:bg-white"
            />
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          </div>

          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-300 text-slate-800 font-semibold focus:outline-none focus:bg-white"
          >
            <option value="ALL">All Action Types</option>
            <option value="TOURIST_LOOKUP">TOURIST_LOOKUP</option>
            <option value="DISPATCH_UNIT">DISPATCH_UNIT</option>
            <option value="BROADCAST_SENT">BROADCAST_SENT</option>
          </select>
        </div>

        {/* Audit Log Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-slate-50 text-slate-600 uppercase font-mono text-[10px] border-b border-slate-200">
              <tr>
                <th className="p-3">{t.colTimestamp}</th>
                <th className="p-3">{t.colOfficer}</th>
                <th className="p-3">{t.colAction}</th>
                <th className="p-3">{t.colTarget}</th>
                <th className="p-3">{t.colReason}</th>
                <th className="p-3">Details</th>
                <th className="p-3">{t.colIp}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-500 font-medium">
                    No matching audit logs found.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-50 transition font-mono">
                    <td className="p-3 text-slate-500 whitespace-nowrap">{log.timestamp}</td>
                    <td className="p-3 text-slate-900 font-bold">{log.officerName} ({log.officerBadge})</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold ${
                        log.actionType === 'TOURIST_LOOKUP'
                          ? 'bg-amber-100 text-amber-900 border border-amber-200'
                          : log.actionType === 'DISPATCH_UNIT'
                          ? 'bg-red-100 text-red-800 border border-red-200'
                          : 'bg-blue-100 text-blue-800 border border-blue-200'
                      }`}>
                        {log.actionType}
                      </span>
                    </td>
                    <td className="p-3 text-[#0B2447] font-bold">{log.targetId}</td>
                    <td className="p-3 text-[#138808] font-bold">{log.reason || 'N/A'}</td>
                    <td className="p-3 text-slate-700 max-w-xs truncate font-sans font-medium">{log.details}</td>
                    <td className="p-3 text-slate-400 text-[10px]">{log.ipAddress}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

      </div>

    </div>
  );
};
```

### `frontend/src/components/ModuleBroadcast.tsx`

```tsx
import React, { useState } from 'react';
import {
  Radio,
  Send,
  Users,
  AlertTriangle,
  Sliders,
  MapPin,
  FileText,
  CheckCircle2,
  History
} from 'lucide-react';
import { Language, BroadcastAlert, AlertSeverity } from '../types';
import { i18n } from '../data/i18n';

interface ModuleBroadcastProps {
  language: Language;
  broadcasts: BroadcastAlert[];
  onSendBroadcast: (newAlert: Omit<BroadcastAlert, 'id' | 'timestamp' | 'deliveredCount' | 'status'>) => void;
}

export const ModuleBroadcast: React.FC<ModuleBroadcastProps> = ({
  language,
  broadcasts,
  onSendBroadcast
}) => {
  const t = i18n[language];

  const [region, setRegion] = useState('Himachal Pradesh (Solang Valley & Rohtang Sector)');
  const [radiusKm, setRadiusKm] = useState<number>(10);
  const [severity, setSeverity] = useState<AlertSeverity>('Critical');
  const [titleEn, setTitleEn] = useState('');
  const [titleHi, setTitleHi] = useState('');
  const [bodyEn, setBodyEn] = useState('');
  const [bodyHi, setBodyHi] = useState('');

  const [toastNotice, setToastNotice] = useState('');

  // Estimate audience mathematically based on radius
  const estimatedRecipients = Math.round(1800 * (radiusKm / 5));

  const handlePublish = (e: React.FormEvent) => {
    e.preventDefault();
    if (!titleEn.trim() || !bodyEn.trim()) return;

    onSendBroadcast({
      senderBadge: 'IPS-7742 (Rajesh Kumar)',
      region,
      radiusKm,
      titleEn,
      titleHi,
      bodyEn,
      bodyHi,
      severity,
      recipientCount: estimatedRecipients
    });

    setToastNotice(`🚀 Emergency Alert Broadcasted to ${estimatedRecipients.toLocaleString()} devices in ${radiusKm}km radius!`);
    setTimeout(() => setToastNotice(''), 5000);
  };

  return (
    <div className="space-y-6">
      
      {toastNotice && (
        <div className="p-4 bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs font-bold rounded-2xl flex items-center justify-between shadow-md animate-bounce">
          <span>{toastNotice}</span>
          <span className="font-mono text-[10px] text-[#138808] font-bold">NIC Geofence Gateway v4</span>
        </div>
      )}

      {/* DRAFTING FORM GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left 2 Cols: Broadcast Form Inputs */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-5">
          
          <div className="flex items-center space-x-2 border-b border-slate-200 pb-3">
            <Radio className="w-5 h-5 text-[#FF9933]" />
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {t.broadcastTitle}
              </h3>
              <p className="text-xs text-slate-500 font-medium">{t.broadcastSub}</p>
            </div>
          </div>

          <form onSubmit={handlePublish} className="space-y-4 text-xs">
            
            {/* Region & Radius */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  {t.selectRegion}
                </label>
                <select
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  className="w-full p-2.5 rounded-xl bg-slate-50 border border-slate-300 text-slate-900 font-medium focus:ring-2 focus:ring-[#FF9933] focus:bg-white"
                >
                  <option value="Himachal Pradesh (Solang Valley & Rohtang Sector)">Himachal Pradesh (Solang / Rohtang)</option>
                  <option value="Varanasi Ghats Heritage Area (UP)">Varanasi Ghats Heritage Corridor</option>
                  <option value="Central Delhi & Connaught Place Circle">Central Delhi & Connaught Place</option>
                  <option value="South Goa Coastal Beach Circuit">South Goa Coastal Beach Circuit</option>
                  <option value="Uttarakhand (Rishikesh - Haridwar Belt)">Uttarakhand (Rishikesh - Haridwar Belt)</option>
                </select>
              </div>

              <div>
                <div className="flex justify-between font-bold text-slate-700 mb-1">
                  <span>{t.radiusKm}</span>
                  <span className="text-[#0B2447] font-mono font-extrabold">{radiusKm} km</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="25"
                  value={radiusKm}
                  onChange={(e) => setRadiusKm(Number(e.target.value))}
                  className="w-full accent-[#FF9933] cursor-pointer"
                />
              </div>
            </div>

            {/* Severity Level */}
            <div>
              <label className="block font-bold text-slate-700 mb-1.5">
                {t.severityLabel}
              </label>
              <div className="flex gap-3">
                {(['Critical', 'Warning', 'Advisory'] as AlertSeverity[]).map((sev) => (
                  <button
                    key={sev}
                    type="button"
                    onClick={() => setSeverity(sev)}
                    className={`flex-1 py-2 rounded-xl font-extrabold border transition ${
                      severity === sev
                        ? sev === 'Critical'
                          ? 'bg-red-600 text-white border-red-700 shadow-sm'
                          : sev === 'Warning'
                          ? 'bg-[#FF9933] text-slate-950 border-amber-500 shadow-sm'
                          : 'bg-[#0B2447] text-white border-slate-800 shadow-sm'
                        : 'bg-slate-100 text-slate-600 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    {sev}
                  </button>
                ))}
              </div>
            </div>

            {/* Title & Body */}
            <div className="space-y-2 pt-2 border-t border-slate-200">
              <div>
                <label className="block font-bold text-slate-700 mb-1">{t.titleEnLabel}</label>
                <input
                  type="text"
                  value={titleEn}
                  onChange={(e) => setTitleEn(e.target.value)}
                  className="w-full p-2.5 rounded-xl bg-slate-50 border border-slate-300 text-slate-900 font-medium focus:ring-2 focus:ring-[#FF9933] focus:bg-white"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 mb-1">{t.bodyEnLabel}</label>
                <textarea
                  rows={2}
                  value={bodyEn}
                  onChange={(e) => setBodyEn(e.target.value)}
                  className="w-full p-2.5 rounded-xl bg-slate-50 border border-slate-300 text-slate-900 font-medium focus:ring-2 focus:ring-[#FF9933] focus:bg-white"
                />
              </div>
            </div>

            {/* Submit Button */}
            <div className="pt-3">
              <button
                type="submit"
                className="w-full py-3 bg-[#0B2447] hover:bg-[#071933] text-white font-black rounded-xl text-sm transition shadow-md flex items-center justify-center gap-2"
              >
                <Send className="w-4 h-4 text-[#FF9933]" />
                <span>{t.sendBroadcastBtn}</span>
              </button>
            </div>

          </form>

        </div>

        {/* Right Col: Live Geofence Audience Estimator & Preview Card */}
        <div className="space-y-6">
          
          {/* Audience Counter Box */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm text-center space-y-3">
            <div className="w-12 h-12 rounded-full bg-amber-50 border border-[#FF9933] mx-auto flex items-center justify-center text-[#FF9933]">
              <Users className="w-6 h-6" />
            </div>

            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              {t.estimatedRecipients}
            </div>

            <div className="text-4xl font-black text-[#0B2447] font-mono">
              ~{estimatedRecipients.toLocaleString()}
            </div>

            <p className="text-[11px] text-slate-500 font-medium">
              Active cell towers in {radiusKm} km radius (NIC Telecommunication Gateway Sync)
            </p>
          </div>



        </div>

      </div>

      {/* RECENT BROADCAST LOG TABLE */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center space-x-2 border-b border-slate-200 pb-3 mb-4">
          <History className="w-5 h-5 text-amber-600" />
          <h3 className="text-base font-bold text-slate-900">
            {t.broadcastHistoryTitle}
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="bg-slate-50 text-slate-600 uppercase font-mono text-[10px] border-b border-slate-200">
              <tr>
                <th className="p-3">Broadcast ID</th>
                <th className="p-3">Region & Radius</th>
                <th className="p-3">Title</th>
                <th className="p-3">Severity</th>
                <th className="p-3">Recipients Delivered</th>
                <th className="p-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {broadcasts.map((b) => (
                <tr key={b.id} className="hover:bg-slate-50 transition">
                  <td className="p-3 font-mono font-bold text-[#0B2447]">{b.id}</td>
                  <td className="p-3 font-medium">{b.region} ({b.radiusKm} km)</td>
                  <td className="p-3 font-extrabold text-slate-900">{b.titleEn}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded font-extrabold text-[10px] ${
                      b.severity === 'Critical' ? 'bg-red-100 text-red-800 border border-red-200' : 'bg-amber-100 text-amber-900 border border-amber-200'
                    }`}>
                      {b.severity}
                    </span>
                  </td>
                  <td className="p-3 font-mono text-[#138808] font-bold">{b.deliveredCount.toLocaleString()} / {b.recipientCount.toLocaleString()}</td>
                  <td className="p-3 font-extrabold text-[#138808]">✓ {b.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
};
```

### `frontend/src/components/ModuleSOSMap.tsx`

```tsx
import React, { useState } from 'react';
import {
  MapPin,
  ShieldAlert,
  Radio,
  Building2,
  HeartPulse,
  Flame,
  Layers,
  Plus,
  CheckCircle2,
  Clock,
  ArrowRight,
  Send,
  Check,
  User,
  PhoneCall,
  Navigation
} from 'lucide-react';
import {
  Language,
  SOSIncident,
  PatrollingUnit,
  PoliceStation,
  Hospital,
  SOSStatus
} from '../types';
import { i18n } from '../data/i18n';
import { HOSPITALS } from '../data/mockData';

interface ModuleSOSMapProps {
  language: Language;
  incidents: SOSIncident[];
  units: PatrollingUnit[];
  stations: PoliceStation[];
  hospitals?: Hospital[];
  onDispatchUnit: (incidentId: string, unitId: string) => void;
  onResolveIncident: (incidentId: string) => void;
  onAddMockSos: () => void;
}

export const ModuleSOSMap: React.FC<ModuleSOSMapProps> = ({
  language,
  incidents,
  units,
  stations,
  hospitals = HOSPITALS,
  onDispatchUnit,
  onResolveIncident,
  onAddMockSos
}) => {
  const t = i18n[language];
  
  // Layer toggles
  const [showSosLayer, setShowSosLayer] = useState(true);
  const [showRespondersLayer, setShowRespondersLayer] = useState(true);
  const [showStationsLayer, setShowStationsLayer] = useState(true);
  const [showHospitalsLayer, setShowHospitalsLayer] = useState(true);
  const [showHeatmapLayer, setShowHeatmapLayer] = useState(true);

  const [selectedIncident, setSelectedIncident] = useState<SOSIncident | null>(incidents[0] || null);

  const newTickets = incidents.filter((i) => i.status === 'New');
  const dispatchedTickets = incidents.filter((i) => i.status === 'Units Dispatched');
  const resolvedTickets = incidents.filter((i) => i.status === 'Resolved');

  return (
    <div className="space-y-6">
      
      {/* Top Layer Toggles & Action Bar */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex flex-wrap items-center justify-between gap-4">
        
        {/* Layer Toggles */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-extrabold text-[#0B2447] uppercase tracking-wider text-[11px] flex items-center gap-1">
            <Layers className="w-4 h-4 text-[#FF9933]" />
            <span>{t.layersLabel}</span>
          </span>

          <button
            onClick={() => setShowSosLayer(!showSosLayer)}
            className={`px-3 py-1.5 rounded-lg border font-extrabold transition flex items-center gap-1.5 ${
              showSosLayer
                ? 'bg-red-50 border-red-300 text-red-800'
                : 'bg-slate-100 border-slate-200 text-slate-500'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5 text-red-600" />
            <span>{t.layerSosBeacons}</span>
          </button>

          <button
            onClick={() => setShowRespondersLayer(!showRespondersLayer)}
            className={`px-3 py-1.5 rounded-lg border font-extrabold transition flex items-center gap-1.5 ${
              showRespondersLayer
                ? 'bg-blue-50 border-blue-300 text-blue-800'
                : 'bg-slate-100 border-slate-200 text-slate-500'
            }`}
          >
            <Radio className="w-3.5 h-3.5 text-blue-600" />
            <span>{t.layerResponders}</span>
          </button>

          <button
            onClick={() => setShowStationsLayer(!showStationsLayer)}
            className={`px-3 py-1.5 rounded-lg border font-extrabold transition flex items-center gap-1.5 ${
              showStationsLayer
                ? 'bg-emerald-50 border-emerald-300 text-[#138808]'
                : 'bg-slate-100 border-slate-200 text-slate-500'
            }`}
          >
            <Building2 className="w-3.5 h-3.5 text-[#138808]" />
            <span>{t.layerStations}</span>
          </button>

          <button
            onClick={() => setShowHospitalsLayer(!showHospitalsLayer)}
            className={`px-3 py-1.5 rounded-lg border font-extrabold transition flex items-center gap-1.5 ${
              showHospitalsLayer
                ? 'bg-rose-50 border-rose-300 text-rose-800'
                : 'bg-slate-100 border-slate-200 text-slate-500'
            }`}
          >
            <HeartPulse className="w-3.5 h-3.5 text-rose-600" />
            <span>{t.layerHospitals}</span>
          </button>

          <button
            onClick={() => setShowHeatmapLayer(!showHeatmapLayer)}
            className={`px-3 py-1.5 rounded-lg border font-extrabold transition flex items-center gap-1.5 ${
              showHeatmapLayer
                ? 'bg-amber-50 border-amber-300 text-amber-900'
                : 'bg-slate-100 border-slate-200 text-slate-500'
            }`}
          >
            <Flame className="w-3.5 h-3.5 text-amber-600" />
            <span>{t.layerHeatmap}</span>
          </button>
        </div>



      </div>

      {/* GIS LIVE MAP CANVAS MOCKUP */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm relative overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-4">
          <div className="flex items-center space-x-2">
            <MapPin className="w-5 h-5 text-[#FF9933]" />
            <h3 className="text-base font-bold text-slate-900">
              {t.gisMapTitle}
            </h3>
          </div>
          <span className="text-xs font-mono text-[#138808] font-bold">
            Grid IN-901 • Sat-Link: IRNSS NavIC Active
          </span>
        </div>

        <div className="relative w-full h-[400px] bg-slate-100 rounded-xl border border-slate-200 overflow-hidden flex items-center justify-center">
          
          {/* Custom Stylized Map Grid & Terrain Lines */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#cbd5e1_1px,transparent_1px),linear-gradient(to_bottom,#cbd5e1_1px,transparent_1px)] bg-[size:2.5rem_2.5rem] opacity-40"></div>

          {/* Heatmap Overlay Layer */}
          {showHeatmapLayer && (
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute top-1/4 left-1/3 w-48 h-48 rounded-full bg-red-500/20 blur-2xl animate-pulse"></div>
              <div className="absolute bottom-1/3 right-1/4 w-56 h-56 rounded-full bg-amber-500/20 blur-2xl"></div>
            </div>
          )}

          {/* Active SOS Beacons Layer */}
          {showSosLayer && incidents.map((inc, index) => {
            const leftPct = `${25 + (index * 28)}%`;
            const topPct = `${30 + (index * 20)}%`;
            const isSelected = selectedIncident?.id === inc.id;

            return (
              <div
                key={inc.id}
                onClick={() => setSelectedIncident(inc)}
                style={{ left: leftPct, top: topPct }}
                className="absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer z-20 group"
              >
                {inc.status !== 'Resolved' && (
                  <div className="w-12 h-12 rounded-full bg-red-600/30 border border-red-500 animate-ping absolute"></div>
                )}
                <div className={`w-9 h-9 rounded-full border-2 flex items-center justify-center shadow-2xl transition-transform ${
                  isSelected
                    ? 'bg-red-600 border-white scale-125 z-30'
                    : inc.status === 'Resolved'
                    ? 'bg-[#138808] border-emerald-300 text-white'
                    : 'bg-red-600 border-amber-400 text-white group-hover:scale-110'
                }`}>
                  <ShieldAlert className="w-5 h-5 text-white" />
                </div>

                {/* Hover Tooltip */}
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-slate-900 border border-slate-700 text-white text-[11px] px-2.5 py-1 rounded shadow-2xl whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-40">
                  <div className="font-bold">{inc.touristName}</div>
                  <div className="text-red-400">{inc.hazardType} • [{inc.status}]</div>
                </div>
              </div>
            );
          })}

          {/* Patrolling Units Layer */}
          {showRespondersLayer && units.map((u, index) => {
            const leftPct = `${18 + (index * 24)}%`;
            const topPct = `${60 - (index * 12)}%`;

            return (
              <div
                key={u.id}
                style={{ left: leftPct, top: topPct }}
                className="absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer z-10 group"
              >
                <div className="w-8 h-8 rounded-lg bg-[#0B2447] border-2 border-blue-400 text-white flex items-center justify-center shadow-lg group-hover:scale-110">
                  <Radio className="w-4 h-4 text-amber-300" />
                </div>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 bg-slate-900 border border-slate-800 text-[10px] text-blue-300 px-2 py-0.5 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                  {u.unitName}
                </div>
              </div>
            );
          })}

          {/* Police Stations Layer */}
          {showStationsLayer && stations.map((st, index) => {
            const leftPct = `${70 - (index * 20)}%`;
            const topPct = `${20 + (index * 30)}%`;

            return (
              <div
                key={st.id}
                style={{ left: leftPct, top: topPct }}
                className="absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer z-10 group"
              >
                <div className="w-9 h-9 rounded-lg bg-[#138808] border-2 border-emerald-200 text-white flex items-center justify-center shadow-lg group-hover:scale-110">
                  <Building2 className="w-5 h-5" />
                </div>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 bg-slate-900 border border-slate-800 text-[10px] text-emerald-300 px-2 py-0.5 rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                  {st.name}
                </div>
              </div>
            );
          })}

          {/* Hospitals & Medical Care Layer */}
          {showHospitalsLayer && hospitals.map((hosp, index) => {
            const leftPct = `${48 + (index * 22)}%`;
            const topPct = `${32 + (index * 24)}%`;

            return (
              <div
                key={hosp.id}
                style={{ left: leftPct, top: topPct }}
                className="absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer z-10 group"
              >
                <div className="w-9 h-9 rounded-lg bg-rose-600 border-2 border-rose-200 text-white flex items-center justify-center shadow-lg group-hover:scale-110">
                  <HeartPulse className="w-5 h-5" />
                </div>
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 bg-slate-900 border border-slate-800 text-[10px] text-rose-300 p-2 rounded shadow-2xl whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity z-30">
                  <div className="font-bold text-white text-xs">{hosp.name}</div>
                  <div className="text-rose-200 text-[10px] mt-0.5">
                    🚑 {hosp.ambulancesReady} Ambulances Ready • 🏥 {hosp.icuBedsAvailable} ICU Beds
                  </div>
                  <div className="text-slate-400 text-[9px] mt-0.5">📞 {hosp.contactPhone}</div>
                </div>
              </div>
            );
          })}

        </div>
      </div>

      {/* INCIDENT LIFECYCLE KANBAN TICKETING SYSTEM */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-5">
          <div className="flex items-center space-x-2">
            <Radio className="w-5 h-5 text-[#FF9933]" />
            <h3 className="text-base font-bold text-slate-900">
              {t.kanbanTitle}
            </h3>
          </div>
          <span className="text-xs text-slate-500 font-bold">
            Total Active Tickets: {incidents.length}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          
          {/* COLUMN 1: NEW SOS ALERTS */}
          <div className="bg-red-50/60 border border-red-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-red-200 pb-2">
              <span className="font-extrabold text-xs uppercase text-red-800 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-600 animate-ping"></span>
                {t.kanbanNew}
              </span>
              <span className="px-2 py-0.5 rounded bg-red-200 text-red-900 text-xs font-mono font-extrabold">
                {newTickets.length}
              </span>
            </div>

            {newTickets.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-500 font-medium">
                No unassigned SOS alerts.
              </div>
            ) : (
              newTickets.map((ticket) => (
                <div key={ticket.id} className="p-3.5 bg-white border border-red-200 rounded-xl space-y-2 shadow-sm">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono font-bold text-red-700">{ticket.id}</span>
                    <span className="text-[10px] text-slate-500 font-medium">{ticket.timestamp.split(' ')[1]}</span>
                  </div>

                  <div className="font-bold text-slate-900 text-sm">{ticket.touristName}</div>
                  <div className="text-xs text-slate-600">{ticket.location.address}</div>

                  <div className="text-[11px] p-2 bg-amber-50 rounded border border-amber-200 text-amber-900 font-medium">
                    ⚠️ {ticket.notes}
                  </div>

                  <div className="pt-2 flex flex-col gap-1.5">
                    <span className="text-[10px] font-extrabold text-slate-600 uppercase">Dispatch Responding PCR:</span>
                    <select
                      onChange={(e) => e.target.value && onDispatchUnit(ticket.id, e.target.value)}
                      defaultValue=""
                      className="w-full text-xs p-1.5 rounded bg-slate-50 border border-slate-300 text-slate-900 focus:ring-1 focus:ring-red-500 font-medium"
                    >
                      <option value="" disabled>Select Unit...</option>
                      <option value="Medical">Medical</option>
                      <option value="Police">Police</option>
                      <option value="Patrolling Unit">Patrolling Unit</option>
                    </select>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* COLUMN 2: UNITS DISPATCHED */}
          <div className="bg-amber-50/60 border border-amber-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-amber-200 pb-2">
              <span className="font-extrabold text-xs uppercase text-amber-900 flex items-center gap-1.5">
                <Radio className="w-3.5 h-3.5 text-amber-700" />
                {t.kanbanDispatched}
              </span>
              <span className="px-2 py-0.5 rounded bg-amber-200 text-amber-900 text-xs font-mono font-extrabold">
                {dispatchedTickets.length}
              </span>
            </div>

            {dispatchedTickets.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-500 font-medium">
                No active dispatches in transit.
              </div>
            ) : (
              dispatchedTickets.map((ticket) => (
                <div key={ticket.id} className="p-3.5 bg-white border border-amber-200 rounded-xl space-y-2 shadow-sm">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-mono font-bold text-amber-800">{ticket.id}</span>
                    <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 text-[10px] font-extrabold">DISPATCHED</span>
                  </div>

                  <div className="font-bold text-slate-900 text-sm">{ticket.touristName}</div>
                  <div className="text-xs text-slate-600">{ticket.location.address}</div>

                  <div className="p-2 bg-amber-50 rounded border border-amber-200 text-xs text-amber-900 font-mono font-bold">
                    Assigned: {ticket.unitAssigned || 'PCR Unit'}
                  </div>

                  <button
                    onClick={() => onResolveIncident(ticket.id)}
                    className="w-full mt-2 py-1.5 bg-[#138808] hover:bg-emerald-700 text-white font-bold rounded-lg text-xs transition flex items-center justify-center gap-1.5 shadow"
                  >
                    <Check className="w-4 h-4" />
                    <span>{t.markResolvedBtn}</span>
                  </button>
                </div>
              ))
            )}
          </div>

          {/* COLUMN 3: RESOLVED & SAFE */}
          <div className="bg-emerald-50/60 border border-emerald-200 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between border-b border-emerald-200 pb-2">
              <span className="font-extrabold text-xs uppercase text-[#138808] flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                {t.kanbanResolved}
              </span>
              <span className="px-2 py-0.5 rounded bg-emerald-200 text-emerald-900 text-xs font-mono font-extrabold">
                {resolvedTickets.length}
              </span>
            </div>

            {resolvedTickets.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-500 font-medium">
                No resolved cases today.
              </div>
            ) : (
              resolvedTickets.map((ticket) => (
                <div key={ticket.id} className="p-3.5 bg-white border border-slate-200 rounded-xl space-y-1 text-xs shadow-sm hover:border-slate-300 transition">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-[#138808]">{ticket.id}</span>
                    <span className="text-[10px] text-slate-500">{ticket.timestamp.split(' ')[1]}</span>
                  </div>
                  <div className="font-bold text-slate-900">{ticket.touristName}</div>
                  <div className="text-[11px] text-slate-600">{ticket.hazardType}</div>
                  <div className="text-[10px] text-[#138808] font-bold mt-1">✓ Citizen Marked Safe</div>
                </div>
              ))
            )}
          </div>

        </div>
      </div>

    </div>
  );
};
```

### `frontend/src/components/ModuleTouristTracking.tsx`

```tsx
import React, { useState } from 'react';
import {
  UserSearch,
  Search,
  UserCheck,
  ShieldCheck,
  ShieldAlert,
  Phone,
  Mail,
  PhoneCall,
  MapPin,
  Clock,
  Radio,
  History,
  CheckCircle2,
  FileText,
  User,
  Globe,
  Award,
  Key,
  BadgeCheck,
  Calendar,
  Lock
} from 'lucide-react';
import { Language, TouristProfile, InterceptionReason } from '../types';
import { i18n } from '../data/i18n';
import { InterceptionModal } from './InterceptionModal';
import { getAuthorityTourist } from '../lib/api';

interface ModuleTouristTrackingProps {
  language: Language;
  tourists: TouristProfile[];
  onLogAudit: (
    actionType: 'TOURIST_LOOKUP' | 'DISPATCH_UNIT' | 'BROADCAST_SENT' | 'TICKET_STATUS_CHANGE',
    targetId: string,
    reason: string,
    details: string
  ) => void;
  onDispatchToTourist: (tourist: TouristProfile) => void;
  onSendSmsToTourist: (tourist: TouristProfile) => void;
  onMarkSafe: (touristId: string) => void;
  prefilledTouristId?: string;
}

function formatRegistrationDate(isoString?: string): string {
  if (!isoString) return '15 July 2026, 08:30 UTC';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return isoString;
    
    const day = date.getUTCDate();
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const month = months[date.getUTCMonth()];
    const year = date.getUTCFullYear();
    const hours = date.getUTCHours().toString().padStart(2, '0');
    const minutes = date.getUTCMinutes().toString().padStart(2, '0');

    return `${day} ${month} ${year}, ${hours}:${minutes} UTC`;
  } catch {
    return isoString;
  }
}

export const ModuleTouristTracking: React.FC<ModuleTouristTrackingProps> = ({
  language,
  tourists,
  onLogAudit,
  onDispatchToTourist,
  onSendSmsToTourist,
  onMarkSafe,
  prefilledTouristId
}) => {
  const t = i18n[language];
  const [searchInput, setSearchInput] = useState(prefilledTouristId || 'TR-88219');
  const [selectedTourist, setSelectedTourist] = useState<TouristProfile | null>(
    tourists.find((t) => t.id === (prefilledTouristId || 'TR-88219')) || tourists[0]
  );
  const [pendingTouristId, setPendingTouristId] = useState<string | null>(null);
  const [showInterceptionModal, setShowInterceptionModal] = useState(false);
  const [toastMessage, setToastMessage] = useState('');

  const triggerSearch = (idToSearch: string) => {
    if (!idToSearch.trim()) return;
    setPendingTouristId(idToSearch.trim());
    setShowInterceptionModal(true);
  };

  const handleConfirmInterception = async (reason: InterceptionReason, notes: string) => {
    if (!pendingTouristId) return;

    const found = tourists.find(
      (tp) => tp.id.toLowerCase() === pendingTouristId.toLowerCase() || tp.name.toLowerCase().includes(pendingTouristId.toLowerCase())
    );

    if (found) {
      setSelectedTourist(found);
      onLogAudit(
        'TOURIST_LOOKUP',
        found.id + ' (' + found.name + ')',
        reason,
        `Accessed profile & telemetry. Notes: ${notes || 'None'}`
      );
      setToastMessage(`✓ Interception Verified: Audit Logged for ${found.name}`);

      // If this tourist has a real backend UUID (i.e. registered through the
      // Tourist Portal against the live backend), refresh the record with
      // live data via GET /api/v1/authority/tourists/{tourist_id} so the KYC
      // panel reflects the authoritative source. Falls back silently to the
      // already-displayed local record on any failure.
      if (found.tourist_id) {
        try {
          const live = await getAuthorityTourist(found.tourist_id);
          setSelectedTourist((prev) =>
            prev && prev.id === found.id
              ? {
                  ...prev,
                  full_name: live.full_name,
                  digital_id: live.digital_id,
                  kyc_verified: live.kyc_verified,
                  kyc_document_type: live.kyc_document_type,
                  created_at: live.created_at,
                  phone: live.phone || prev.phone,
                  email: live.email || prev.email
                }
              : prev
          );
        } catch (err) {
          console.warn('Live tourist lookup failed; showing local record only:', err);
        }
      }
    } else {
      setToastMessage(`⚠️ Tourist ID "${pendingTouristId}" not found in database.`);
    }

    setShowInterceptionModal(false);
    setPendingTouristId(null);
    setTimeout(() => setToastMessage(''), 4000);
  };

  return (
    <div className="space-y-6">
      
      {/* Toast Alert Notice */}
      {toastMessage && (
        <div className="p-3 bg-emerald-950 border border-emerald-600 text-emerald-200 text-xs font-bold rounded-xl flex items-center justify-between shadow-lg animate-fade-in">
          <span>{toastMessage}</span>
          <span className="text-[10px] opacity-75">Statutory Audit Log #AUD-LOK</span>
        </div>
      )}

      {/* SEARCH CARD */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <div className="max-w-2xl mx-auto text-center space-y-3">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 border border-[#FF9933] text-[#0B2447] text-xs font-bold uppercase">
            <UserSearch className="w-4 h-4 text-[#FF9933]" />
            <span>{t.touristSearchTitle}</span>
          </div>

          <p className="text-xs text-slate-600 font-medium">
            {t.touristSearchSub}
          </p>

          <div className="flex items-center gap-2 pt-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && triggerSearch(searchInput)}
                placeholder="Enter Tourist ID (e.g., TR-88219, TR-44021)..."
                className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl bg-slate-50 border border-slate-300 text-slate-900 font-mono placeholder-slate-400 focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#FF9933]"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            </div>

            <button
              onClick={() => triggerSearch(searchInput)}
              className="px-5 py-2.5 bg-[#0B2447] hover:bg-[#071933] text-white font-black rounded-xl text-sm transition shadow-md flex items-center gap-2"
            >
              <span>{t.searchBtn}</span>
            </button>
          </div>

          {/* Quick Demo Tourist Pills */}
          <div className="pt-2 flex items-center justify-center gap-2 flex-wrap text-xs">
            <span className="text-slate-500 text-[11px] font-bold">Quick Demo IDs:</span>
            {tourists.map((tp) => (
              <button
                key={tp.id}
                onClick={() => {
                  setSearchInput(tp.id);
                  triggerSearch(tp.id);
                }}
                className={`px-2.5 py-1 rounded-lg border font-mono text-[11px] font-bold transition ${
                  selectedTourist?.id === tp.id
                    ? 'bg-[#FF9933] text-slate-950 border-[#FF9933] shadow-sm'
                    : 'bg-slate-100 text-slate-700 border-slate-200 hover:border-slate-300'
                }`}
              >
                {tp.id} ({tp.name.split(' ')[0]})
              </button>
            ))}
          </div>

        </div>
      </div>

      {/* TOURIST PROFILE DASHBOARD */}
      {selectedTourist && (() => {
        const fullName = selectedTourist.full_name || selectedTourist.name;
        const digitalId = selectedTourist.digital_id || selectedTourist.id;
        const touristUuid = selectedTourist.tourist_id || '8f7a9d1b-3c4e-4f52-a1b2-c3d4e5f67890';
        const docType = selectedTourist.kyc_document_type || 'Passport';
        const isKycVerified = selectedTourist.kyc_verified ?? true;
        const phone = selectedTourist.phone;
        const email = selectedTourist.email || `${fullName.toLowerCase().replace(/\s+/g, '.')}@example.com`;
        const emergencyContact = selectedTourist.emergency_contact || selectedTourist.emergencyContact;
        const languagePref = selectedTourist.preferred_language || 'Spanish';
        const regDateFormatted = formatRegistrationDate(selectedTourist.created_at || '2026-07-15T08:30:00Z');

        return (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            
            {/* Left & Center: Modern Tourist Profile Dashboard Card */}
            <div className="lg:col-span-2 space-y-6">
              
              {/* Main Card Wrapper */}
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                
                {/* 1. Profile Header Banner */}
                <div className="bg-gradient-to-r from-[#0B2447] via-[#0f305c] to-[#143d73] text-white p-6 relative">
                  
                  {/* Subtle decorative background pattern */}
                  <div className="absolute inset-0 bg-[radial-gradient(#ffffff_1px,transparent_1px)] [background-size:16px_16px] opacity-10 pointer-events-none"></div>

                  <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
                    
                    {/* Avatar & Key Profile Info */}
                    <div className="flex items-center gap-4 sm:gap-5">
                      
                      {/* Avatar with Verification Halo */}
                      <div className="relative flex-shrink-0">
                        <img
                          src={selectedTourist.photoUrl}
                          alt={fullName}
                          className="w-20 h-20 rounded-2xl object-cover border-2 border-[#FF9933] shadow-lg"
                        />
                        {isKycVerified && (
                          <div className="absolute -bottom-1 -right-1 bg-emerald-500 text-white rounded-full p-1 border-2 border-[#0B2447] shadow" title="KYC Verified">
                            <BadgeCheck className="w-4 h-4" />
                          </div>
                        )}
                      </div>

                      {/* Name, Digital ID & Badges */}
                      <div className="space-y-1.5">
                        
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="px-2.5 py-0.5 rounded-md bg-white/10 text-amber-300 font-mono text-xs font-extrabold border border-white/20 tracking-wide">
                            {digitalId}
                          </span>

                          {isKycVerified ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 text-xs font-bold border border-emerald-400/30">
                              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                              <span>KYC Verified</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-amber-500/20 text-amber-300 text-xs font-bold border border-amber-400/30">
                              <span>KYC Pending</span>
                            </span>
                          )}

                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-sky-500/20 text-sky-200 text-xs font-semibold border border-sky-400/30">
                            <FileText className="w-3.5 h-3.5 text-sky-300" />
                            <span>{docType}</span>
                          </span>
                        </div>

                        <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                          {fullName}
                        </h2>

                        <div className="text-xs text-slate-300 flex items-center gap-1.5 font-medium">
                          <Globe className="w-3.5 h-3.5 text-[#FF9933]" />
                          <span>Preferred Language: <strong className="text-white">{languagePref}</strong></span>
                        </div>

                      </div>

                    </div>

                    {/* Quick Action Buttons */}
                    <div className="flex items-center gap-2 self-start md:self-auto flex-wrap sm:flex-nowrap">
                      <button
                        onClick={() => onDispatchToTourist(selectedTourist)}
                        className="px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white font-extrabold rounded-xl text-xs transition shadow-md flex items-center gap-2"
                      >
                        <Radio className="w-4 h-4" />
                        <span>{t.dispatchToTourist}</span>
                      </button>

                      {selectedTourist.safetyStatus !== 'Safe' && (
                        <button
                          onClick={() => onMarkSafe(selectedTourist.id)}
                          className="px-3.5 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white font-extrabold rounded-xl text-xs transition shadow-md flex items-center gap-1.5"
                        >
                          <CheckCircle2 className="w-4 h-4" />
                          <span>{t.markSafeBtn}</span>
                        </button>
                      )}
                    </div>

                  </div>

                </div>

                {/* Body Content - 4 Organized Section Cards */}
                <div className="p-6 space-y-6 bg-slate-50/50">
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    
                    {/* 2. Personal Information Section */}
                    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
                      
                      <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                        <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600">
                          <User className="w-4 h-4" />
                        </div>
                        <h3 className="text-sm font-bold text-slate-900">
                          Personal Information
                        </h3>
                      </div>

                      <div className="space-y-3 text-xs">
                        
                        <div className="flex justify-between items-center py-1">
                          <span className="text-slate-500 font-medium">Full Name</span>
                          <span className="font-bold text-slate-900">{fullName}</span>
                        </div>

                        <div className="flex justify-between items-center py-1 border-t border-slate-100">
                          <span className="text-slate-500 font-medium">Digital Tourist ID</span>
                          <span className="font-mono font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                            {digitalId}
                          </span>
                        </div>

                        <div className="flex justify-between items-center py-1 border-t border-slate-100">
                          <span className="text-slate-500 font-medium">Tourist System UUID</span>
                          <span className="font-mono text-[11px] font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded truncate max-w-[170px]" title={touristUuid}>
                            {touristUuid}
                          </span>
                        </div>

                        <div className="flex justify-between items-center py-1 border-t border-slate-100">
                          <span className="text-slate-500 font-medium">Preferred Language</span>
                          <span className="font-bold text-slate-800 flex items-center gap-1.5">
                            <Globe className="w-3.5 h-3.5 text-teal-600" />
                            <span>{languagePref}</span>
                          </span>
                        </div>

                      </div>

                    </div>

                    {/* 3. Contact Information Section */}
                    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
                      
                      <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                        <div className="p-2 rounded-lg bg-sky-50 text-sky-600">
                          <Phone className="w-4 h-4" />
                        </div>
                        <h3 className="text-sm font-bold text-slate-900">
                          Contact Information
                        </h3>
                      </div>

                      <div className="space-y-3 text-xs">
                        
                        <div className="flex justify-between items-center py-1">
                          <span className="text-slate-500 font-medium flex items-center gap-1.5">
                            <Phone className="w-3.5 h-3.5 text-slate-400" />
                            Phone Number
                          </span>
                          <span className="font-mono font-bold text-slate-900">{phone}</span>
                        </div>

                        <div className="flex justify-between items-center py-1 border-t border-slate-100">
                          <span className="text-slate-500 font-medium flex items-center gap-1.5">
                            <Mail className="w-3.5 h-3.5 text-slate-400" />
                            Email Address
                          </span>
                          <span className="font-mono text-slate-900 font-semibold truncate max-w-[180px]" title={email}>
                            {email}
                          </span>
                        </div>

                        <div className="flex justify-between items-center py-1 border-t border-slate-100">
                          <span className="text-slate-500 font-medium flex items-center gap-1.5">
                            <PhoneCall className="w-3.5 h-3.5 text-rose-500" />
                            Emergency Contact
                          </span>
                          <span className="font-mono font-extrabold text-rose-800 bg-rose-50 px-2.5 py-0.5 rounded border border-rose-200">
                            {emergencyContact}
                          </span>
                        </div>

                      </div>

                    </div>

                    {/* 4. Verification & Security Section */}
                    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
                      
                      <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                        <div className="p-2 rounded-lg bg-emerald-50 text-emerald-600">
                          <ShieldCheck className="w-4 h-4" />
                        </div>
                        <h3 className="text-sm font-bold text-slate-900">
                          Verification & Security
                        </h3>
                      </div>

                      <div className="space-y-3 text-xs">
                        
                        <div className="flex justify-between items-center py-1">
                          <span className="text-slate-500 font-medium">KYC Verification</span>
                          {isKycVerified ? (
                            <span className="font-bold text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200 flex items-center gap-1">
                              <BadgeCheck className="w-3.5 h-3.5 text-emerald-600" />
                              <span>Verified</span>
                            </span>
                          ) : (
                            <span className="font-bold text-amber-800 bg-amber-50 px-2.5 py-0.5 rounded-full border border-amber-200">
                              Pending
                            </span>
                          )}
                        </div>

                        <div className="flex justify-between items-center py-1 border-t border-slate-100">
                          <span className="text-slate-500 font-medium">Verification Document</span>
                          <span className="font-bold text-slate-900 bg-slate-100 px-2.5 py-0.5 rounded border border-slate-200">
                            {docType}
                          </span>
                        </div>

                        <div className="flex justify-between items-center py-1 border-t border-slate-100">
                          <span className="text-slate-500 font-medium">Security Status</span>
                          <span className="font-semibold text-slate-700 flex items-center gap-1">
                            <Lock className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Identity Authenticated</span>
                          </span>
                        </div>

                      </div>

                    </div>

                    {/* 5. Account Information Section */}
                    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
                      
                      <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
                        <div className="p-2 rounded-lg bg-amber-50 text-amber-600">
                          <Calendar className="w-4 h-4" />
                        </div>
                        <h3 className="text-sm font-bold text-slate-900">
                          Account Information
                        </h3>
                      </div>

                      <div className="space-y-3 text-xs">
                        
                        <div className="flex justify-between items-center py-1">
                          <span className="text-slate-500 font-medium">Registration Date</span>
                          <span className="font-bold text-slate-900 flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            <span>{regDateFormatted}</span>
                          </span>
                        </div>

                        <div className="flex justify-between items-center py-1 border-t border-slate-100">
                          <span className="text-slate-500 font-medium">System Compliance</span>
                          <span className="font-extrabold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                            Compliant & Active
                          </span>
                        </div>

                        <div className="flex justify-between items-center py-1 border-t border-slate-100">
                          <span className="text-slate-500 font-medium">Digital Safety Band</span>
                          <span className="font-mono text-slate-800 font-bold">
                            {selectedTourist.digitalBandId || 'BAND-8812'}
                          </span>
                        </div>

                      </div>

                    </div>

                  </div>

                </div>

              </div>

            </div>

            {/* Right Column: Live GPS Telemetry & Safety History */}
            <div className="space-y-6">
              
              {/* Live Location Map View */}
              <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                  <div className="flex items-center space-x-2">
                    <MapPin className="w-5 h-5 text-red-600" />
                    <h3 className="text-sm font-bold text-slate-900">
                      {t.liveLocation}
                    </h3>
                  </div>
                  <span className="text-[11px] font-mono text-[#138808] font-bold">
                    {selectedTourist.lastSeenTime}
                  </span>
                </div>

                {/* Map Canvas Mockup */}
                <div className="relative w-full h-52 bg-slate-100 rounded-xl border border-slate-200 overflow-hidden flex items-center justify-center">
                  <div className="absolute inset-0 bg-[linear-gradient(to_right,#cbd5e1_1px,transparent_1px),linear-gradient(to_bottom,#cbd5e1_1px,transparent_1px)] bg-[size:1.5rem_1.5rem] opacity-40"></div>

                  <svg className="absolute inset-0 w-full h-full pointer-events-none">
                    <path
                      d="M 120 180 L 180 140 L 260 110 L 320 80"
                      fill="none"
                      stroke="#FF9933"
                      strokeWidth="3"
                      strokeDasharray="6 4"
                    />
                  </svg>

                  <div className="relative z-10 flex flex-col items-center">
                    <div className="w-10 h-10 rounded-full bg-red-600/20 border border-red-500 flex items-center justify-center animate-ping absolute"></div>
                    <div className="w-8 h-8 rounded-full bg-red-600 border-2 border-white text-white flex items-center justify-center font-bold text-xs shadow-2xl z-10">
                      <MapPin className="w-4 h-4" />
                    </div>
                    <div className="mt-2 bg-white/95 border border-slate-300 px-2.5 py-1 rounded-lg text-[10px] font-mono font-bold text-slate-900 shadow-md max-w-[200px] truncate text-center">
                      {selectedTourist.currentLocation.address}
                    </div>
                  </div>

                  <div className="absolute bottom-2 right-2 bg-white/95 px-2 py-0.5 rounded border border-slate-200 text-[9px] font-mono text-slate-700 shadow">
                    LAT: {selectedTourist.currentLocation.lat.toFixed(4)} • LNG: {selectedTourist.currentLocation.lng.toFixed(4)}
                  </div>
                </div>
              </div>

              {/* Safety Status & SOS History */}
              <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                  <div className="flex items-center space-x-2">
                    <History className="w-4 h-4 text-amber-600" />
                    <h3 className="text-sm font-bold text-slate-900">
                      {t.sosHistory}
                    </h3>
                  </div>
                  <div className={`font-bold px-2 py-0.5 rounded text-[10px] ${
                    selectedTourist.safetyStatus === 'SOS Active'
                      ? 'bg-red-100 text-red-800 border border-red-300 animate-pulse'
                      : selectedTourist.safetyStatus === 'Watch'
                      ? 'bg-amber-100 text-amber-800 border border-amber-300'
                      : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                  }`}>
                    {selectedTourist.safetyStatus}
                  </div>
                </div>

                {selectedTourist.pastSOSHistory.length === 0 ? (
                  <div className="text-center py-4 text-slate-500 text-xs">
                    No prior emergency SOS alerts recorded for this profile.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {selectedTourist.pastSOSHistory.map((rec) => (
                      <div
                        key={rec.id}
                        className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 flex items-center justify-between text-xs"
                      >
                        <div>
                          <div className="font-bold text-slate-900">{rec.location}</div>
                          <div className="text-[10px] text-slate-600 mt-0.5">{rec.reason}</div>
                          <div className="text-[9px] text-slate-500 font-mono mt-0.5">Date: {rec.date}</div>
                        </div>

                        <span className="px-2 py-0.5 rounded bg-emerald-100 border border-emerald-300 text-[#138808] font-extrabold text-[10px]">
                          {rec.status}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>

          </div>
        );
      })()}

      {/* Mandatory Interception Modal */}
      {showInterceptionModal && pendingTouristId && (
        <InterceptionModal
          language={language}
          touristId={pendingTouristId}
          onConfirm={handleConfirmInterception}
          onCancel={() => {
            setShowInterceptionModal(false);
            setPendingTouristId(null);
          }}
        />
      )}

    </div>
  );
};
```

### `frontend/src/components/Sidebar.tsx`

```tsx
import React from 'react';
import {
  BrainCircuit,
  UserSearch,
  MapPin,
  Radio,
  BarChart3,
  ShieldCheck,
  Zap,
  Activity
} from 'lucide-react';
import { Language, ActiveModule } from '../types';
import { i18n } from '../data/i18n';

interface SidebarProps {
  language: Language;
  activeModule: ActiveModule;
  onSelectModule: (mod: ActiveModule) => void;
  activeSosCount: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  language,
  activeModule,
  onSelectModule,
  activeSosCount
}) => {
  const t = i18n[language];

  const navItems = [
    {
      id: 'ai_hub' as ActiveModule,
      label: t.modAiHub,
      icon: BrainCircuit,
      badge: 'AI ACTIVE'
    },
    {
      id: 'tourist_tracking' as ActiveModule,
      label: t.modTouristTracking,
      icon: UserSearch,
      badge: null
    },
    {
      id: 'sos_map' as ActiveModule,
      label: t.modSosMap,
      icon: MapPin,
      badge: activeSosCount > 0 ? `${activeSosCount} SOS` : null,
      badgeColor: 'bg-red-600 text-white animate-pulse'
    },
    {
      id: 'broadcast' as ActiveModule,
      label: t.modBroadcast,
      icon: Radio,
      badge: null
    },
    {
      id: 'analytics_audit' as ActiveModule,
      label: t.modAnalyticsAudit,
      icon: BarChart3,
      badge: 'AUDIT'
    }
  ];

  return (
    <aside className="w-full lg:w-64 bg-white text-slate-800 border-r border-slate-200 flex-shrink-0 flex flex-col justify-between p-3 lg:p-4 shadow-sm">
      
      {/* Module Links */}
      <div className="space-y-1">
        <div className="px-3 py-2 text-[10px] font-extrabold uppercase tracking-widest text-[#0B2447] flex items-center justify-between">
          <span>Command Modules</span>
          <span className="w-2 h-2 rounded-full bg-[#138808]"></span>
        </div>

        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeModule === item.id;

          return (
            <button
              key={item.id}
              onClick={() => onSelectModule(item.id)}
              className={`w-full flex items-center justify-between px-3.5 py-3 rounded-xl text-xs font-bold transition-all ${
                isActive
                  ? 'bg-[#0B2447] text-white shadow-md scale-[1.01]'
                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <div className="flex items-center space-x-3 truncate">
                <Icon className={`w-4 h-4 flex-shrink-0 ${isActive ? 'text-[#FF9933]' : 'text-[#0B2447]'}`} />
                <span className="truncate">{item.label}</span>
              </div>

              {item.badge && (
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-extrabold ${
                    item.badgeColor
                      ? item.badgeColor
                      : isActive
                      ? 'bg-[#FF9933] text-slate-950'
                      : 'bg-slate-100 text-slate-700 border border-slate-200'
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* System Health Widget at Bottom */}
      <div className="mt-6 p-3 bg-slate-50 rounded-xl border border-slate-200 hidden lg:block text-xs">
        <div className="flex items-center justify-between text-slate-500 mb-2">
          <span className="font-mono text-[10px] uppercase font-bold text-slate-600">Telemetry Link</span>
          <span className="flex items-center gap-1 text-emerald-600 font-bold text-[10px]">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping"></span> ONLINE
          </span>
        </div>
        <div className="space-y-1 text-[11px] text-slate-700">
          <div className="flex justify-between">
            <span>Server Cluster:</span>
            <span className="font-mono text-slate-900 font-bold">IN-DELHI-01</span>
          </div>
          <div className="flex justify-between">
            <span>Latency:</span>
            <span className="font-mono text-emerald-600 font-bold">14 ms</span>
          </div>
          <div className="flex justify-between">
            <span>Satellite Sync:</span>
            <span className="font-mono text-slate-900 font-bold">IRNSS-NavIC</span>
          </div>
        </div>
      </div>

    </aside>
  );
};
```

### `frontend/src/components/TouristPortal.tsx`

```tsx
import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  PhoneCall,
  MapPin,
  Battery,
  Wifi,
  Navigation,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  ArrowLeft,
  QrCode,
  Download,
  Copy,
  User,
  FileCheck,
  KeyRound,
  ExternalLink,
  Check,
  X,
  Smartphone,
  LogOut,
  RefreshCw,
  Radio,
  Clock,
  Shield,
  MessageSquare,
  Calendar,
  Map,
  Plus,
  Bell,
  Volume2,
  VolumeX,
  Phone,
  ChevronUp,
  Globe,
  Compass,
  AlertCircle,
  Send,
  Hotel,
  Bot,
  Loader2
} from 'lucide-react';
import { Language, TouristProfile, ItineraryItem, ChatMessage, BroadcastAlert, GeoFenceZone, SosStepState } from '../types';
import { i18n } from '../data/i18n';
import { POLICE_STATIONS, INITIAL_TOURISTS, INITIAL_BROADCASTS, MOCK_GEOFENCE_ZONES } from '../data/mockData';
import { ActualGoogleMap } from './ActualGoogleMap';
import { CrowdHeatmap } from './CrowdHeatmap';
import { getSOSLocation } from '../lib/location';
import { queueSOSRecord } from '../lib/db';
import { submitSOSOnline, syncQueuedSOS, registerAndLoginTourist, loginTouristByPhone, updateIncidentStatus, clearSession, logoutUser, getTouristId, ApiError, createItineraryEntry, deleteItineraryEntry } from '../lib/api';


interface TouristPortalProps {
  language: Language;
  onLanguageChange?: (lang: Language) => void;
  onTriggerSos: (touristName: string, locationStr: string, touristId?: string, touristPhone?: string) => void;
  onReturnToGateway: () => void;
  onRegisterTourist?: (tourist: TouristProfile) => void;
  existingTourists?: TouristProfile[];
}

export const TouristPortal: React.FC<TouristPortalProps> = ({
  language,
  onLanguageChange,
  onTriggerSos,
  onReturnToGateway,
  onRegisterTourist,
  existingTourists = INITIAL_TOURISTS
}) => {
  const t = i18n[language];

  // Auth & Session States
  const [authTab, setAuthTab] = useState<'signin' | 'signup'>('signin');
  const [authenticatedUser, setAuthenticatedUser] = useState<TouristProfile | null>(null);
  const [locationConsent, setLocationConsent] = useState<'granted' | 'declined' | null>(null);

  // Active Dashboard Tab
  const [activeTab, setActiveTab] = useState<'overview' | 'itinerary' | 'heatmap' | 'route_finder'>('overview');

  // Modals & Drawers
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [showDigitalPassModal, setShowDigitalPassModal] = useState(false);
  const [showDigiLockerModal, setShowDigiLockerModal] = useState(false);
  const [showContactsDrawer, setShowContactsDrawer] = useState(false);
  const [showAddItineraryModal, setShowAddItineraryModal] = useState(false);

  // Real-time Geofenced Broadcast Alert Modal State
  const [activeBroadcastModal, setActiveBroadcastModal] = useState<BroadcastAlert | null>(null);

  // Sign Up Form States
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [emergencyContactName, setEmergencyContactName] = useState('');
  const [emergencyRelation, setEmergencyRelation] = useState('Father');
  const [emergencyContactPhone, setEmergencyContactPhone] = useState('');

  // DigiLocker States
  const [digiLockerVerified, setDigiLockerVerified] = useState(false);
  const [digiLockerLoading, setDigiLockerLoading] = useState(false);
  const [digiLockerStep, setDigiLockerStep] = useState<'connect' | 'loading' | 'fetched'>('connect');

  // Sign In Form States
  const [signinTouristId, setSigninTouristId] = useState('');
  const [signinPhone, setSigninPhone] = useState('');

  // OTP Modal States
  const [otpValue, setOtpValue] = useState('');
  const [otpError, setOtpError] = useState('');
  const [otpPendingAction, setOtpPendingAction] = useState<'signup' | 'signin'>('signup');

  // Copy / Download Feedback Toasts
  const [copySuccess, setCopySuccess] = useState(false);
  const [downloadSuccess, setDownloadSuccess] = useState(false);

  // Emergency SOS Panic Trigger State
  const [sosActive, setSosActive] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [batteryLevel] = useState(84);
  const [currentAddress] = useState('Solang Valley North Trail, Kullu, Himachal Pradesh');
  const [lat] = useState(32.2432);
  const [lng] = useState(77.1892);
  const [sirenPlaying, setSirenPlaying] = useState(false);

  // Integrated Multi-Step SOS Flow States
  const [sosStep, setSosStep] = useState<SosStepState>('ready');
  const [sosSendingProgress, setSosSendingProgress] = useState(0);
  const [incidentRef, setIncidentRef] = useState<string | null>(null);
  const [sosErrorMessage, setSosErrorMessage] = useState<string | null>(null);
  const [activeBackendIncidentId, setActiveBackendIncidentId] = useState<string | null>(null);

  // Integrated Geo-Fence States
  const [activeGeoFenceZone, setActiveGeoFenceZone] = useState<GeoFenceZone>(MOCK_GEOFENCE_ZONES[0]); // Solang Valley (Unsafe)

  const handleStartSosConfirmation = () => {
    setSosStep('confirming');
  };

  const handleExecuteSosSend = async (forceError = false) => {
    setSosStep('sending');
    setSosSendingProgress(15);
    setSosErrorMessage(null);

    try {
      // 1. Resolve Location
      const loc = await getSOSLocation();
      setSosSendingProgress(40);

      // 2. Build local SOS record
      // Prefer the real backend tourist UUID (set after registration/sign-in
      // against the backend) over the cosmetic display ID, since the backend
      // requires an existing tourists.tourist_id to accept the SOS request.
      const localRecord = {
        local_sos_id: crypto.randomUUID(),
        tourist_id: authenticatedUser?.tourist_id || getTouristId(),
        triggered_at: new Date().toISOString(),
        latitude: loc.latitude,
        longitude: loc.longitude,
        accuracy: loc.accuracy,
        location_source: loc.location_source,
        description: `Emergency SOS Alert (${loc.location_source})`,
        severity: 'HIGH',
        status: 'QUEUED_OFFLINE'
      };

      // 3. Save to IndexedDB
      await queueSOSRecord(localRecord);
      setSosSendingProgress(60);

      if (forceError) {
        throw new Error('Network signal drop detected in Solang valley sector. Local relay timeout.');
      }

      // 4. Try online transmission
      if (navigator.onLine) {
        setSosSendingProgress(85);
        try {
          const res = await submitSOSOnline(localRecord);
          setSosSendingProgress(100);
          setSosStep('success');
          setIncidentRef(res.incident_id || res.sos_id || `INC-${Math.floor(1000 + Math.random() * 9000)}`);
          if (res.incident_id) setActiveBackendIncidentId(res.incident_id);
          setSosActive(true);
          onTriggerSos(authenticatedUser?.name || 'Tourist', `${loc.latitude?.toFixed(4) || lat.toFixed(4)}, ${loc.longitude?.toFixed(4) || lng.toFixed(4)} (${activeGeoFenceZone.name})`, authenticatedUser?.tourist_id || authenticatedUser?.id, authenticatedUser?.phone);
        } catch (err: any) {
          // A DB/auth-level failure (400/401/404) means the request reached
          // the backend and was rejected — this is a real data/auth problem,
          // not a dropped connection, so it must not be silently queued as
          // an offline record. Only genuine network failures fall through to
          // the offline queue below.
          if (err instanceof ApiError && [400, 401, 404].includes(err.status)) {
            console.error("SOS submission rejected by backend (auth/data error):", err);
            setSosStep('error');
            setSosErrorMessage(err.message || 'Your session or request data was rejected by the server. Please sign in again.');
            return;
          }
          console.warn("Online transmission failed, record queued:", err);
          setSosSendingProgress(100);
          setSosStep('success');
          setIncidentRef('QUEUED-OFFLINE');
          setSosActive(true);
          onTriggerSos(authenticatedUser?.name || 'Tourist', `${loc.latitude?.toFixed(4) || lat.toFixed(4)}, ${loc.longitude?.toFixed(4) || lng.toFixed(4)} (Queued Offline)`, authenticatedUser?.tourist_id || authenticatedUser?.id, authenticatedUser?.phone);
        }
      } else {
        setSosSendingProgress(100);
        setSosStep('success');
        setIncidentRef('QUEUED-OFFLINE');
        setSosActive(true);
        onTriggerSos(authenticatedUser?.name || 'Tourist', `${loc.latitude?.toFixed(4) || lat.toFixed(4)}, ${loc.longitude?.toFixed(4) || lng.toFixed(4)} (Queued Offline)`, authenticatedUser?.tourist_id || authenticatedUser?.id, authenticatedUser?.phone);
      }
    } catch (err: any) {
      setSosStep('error');
      setSosErrorMessage(err.message || 'Failed to trigger SOS');
    }
  };

  const handleResetSosFlow = () => {
    // If this SOS created a real backend incident, mark it resolved server-side
    // (mirrors the authority-side "Resolve Case" / "Mark Safe" PATCH flow).
    if (activeBackendIncidentId) {
      updateIncidentStatus(activeBackendIncidentId, { status: 'RESOLVED' }).catch((err) =>
        console.warn('Failed to resolve backend incident on reset:', err)
      );
    }
    setSosStep('ready');
    setSosActive(false);
    setSirenPlaying(false);
    setIncidentRef(null);
    setActiveBackendIncidentId(null);
    setSosErrorMessage(null);
    setSosSendingProgress(0);
  };


  // Floating Chatbot Widget States
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'm-1',
      sender: 'bot',
      text: 'Namaste! I am Suraksha AI Safety Assistant. How can I assist with your safety, route advice, or emergency info in Himachal Pradesh today?',
      timestamp: 'Just now',
      quickActions: [
        'Is Solang Valley safe right now?',
        'Emergency hotlines in Manali',
        'Altitude sickness tips',
        'Nearest hospital'
      ]
    }
  ]);

  // Itinerary Planner Items State
  const [itinerary, setItinerary] = useState<ItineraryItem[]>([
    {
      id: 'itin-1',
      destination: 'Solang Valley Adventure & Ski Resort',
      date: '2026-08-12',
      hotel: 'Solang Resort & Spa, Manali',
      activities: 'Trekking, Ropeway, Paragliding',
      safetyStatus: 'Safe Corridor',
      coordinates: { lat: 32.2432, lng: 77.1892 }
    },
    {
      id: 'itin-2',
      destination: 'Atal Tunnel North Portal & Sissu Valley',
      date: '2026-08-13',
      hotel: 'Sissu Alpine Retreat',
      activities: 'Scenic mountain drive, Waterfall visit',
      safetyStatus: 'Weather Advisory',
      coordinates: { lat: 32.3582, lng: 77.1625 }
    },
    {
      id: 'itin-3',
      destination: 'Manikaran Sahib & Kasol Valley',
      date: '2026-08-14',
      hotel: 'Kasol Riverside Lodge',
      activities: 'Hot springs, Local pilgrimage, Parvati Valley',
      safetyStatus: 'Safe Corridor',
      coordinates: { lat: 32.0272, lng: 77.3488 }
    }
  ]);

  // New Itinerary Form State
  const [newDest, setNewDest] = useState('');
  const [newDate, setNewDate] = useState('2026-08-15');
  const [newHotel, setNewHotel] = useState('');
  const [newActivities, setNewActivities] = useState('');

  // Add destination to Itinerary from Crowd Heatmap recommendation
  const handleAddItineraryDestination = (destName: string) => {
    const newItem: ItineraryItem = {
      id: `itin-${Date.now()}`,
      destination: destName,
      date: '2026-08-16',
      hotel: 'Verified Safe Hotel / Guesthouse',
      activities: 'Scenic sightseeing, low crowd density area',
      safetyStatus: 'Safe Corridor',
      coordinates: { lat: 32.2432, lng: 77.1892 }
    };
    setItinerary((prev) => [...prev, newItem]);
  };

  // Heatmap Filter State
  const [heatmapFilter, setHeatmapFilter] = useState<'all' | 'high' | 'safe' | 'advisory'>('all');

  // Route Finder States
  const [routeOrigin, setRouteOrigin] = useState('Manali Town');
  const [routeDest, setRouteDest] = useState('Sissu / Lahaul Valley');
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);

  // SOS Countdown timer & Online Sync Event
  useEffect(() => {
    let timer: any = null;
    if (countdown !== null && countdown > 0) {
      timer = setInterval(() => {
        setCountdown((prev) => (prev !== null && prev > 1 ? prev - 1 : 0));
      }, 1000);
    } else if (countdown === 0) {
      // Execute the real SOS send if countdown hits zero instead of doing it immediately.
      handleExecuteSosSend(false);
      setCountdown(null);
      setSirenPlaying(true);
    }

    const handleOnline = () => {
      console.log('Network connected. Triggering auto-sync...');
      syncQueuedSOS();
    };
    window.addEventListener('online', handleOnline);
    if (navigator.onLine) {
      syncQueuedSOS();
    }

    return () => {
      clearInterval(timer);
      window.removeEventListener('online', handleOnline);
    };
  }, [countdown, currentAddress, onTriggerSos, authenticatedUser, lat, lng, activeGeoFenceZone.name]);

  // DigiLocker Connect Simulation
  const handleConnectDigiLocker = () => {
    setDigiLockerLoading(true);
    setDigiLockerStep('loading');
    setTimeout(() => {
      setDigiLockerLoading(false);
      setDigiLockerStep('fetched');
    }, 1500);
  };

  const handleConfirmDigiLocker = () => {
    setDigiLockerVerified(true);
    setShowDigiLockerModal(false);
  };

  // Submit Sign Up Form
  const handleSignUpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setOtpPendingAction('signup');
    setOtpError('');
    setShowOtpModal(true);
  };

  // Submit Sign In Form
  const handleSignInSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!signinTouristId.trim() || !signinPhone.trim()) {
      alert('Please provide both Tourist ID and Registered Phone Number.');
      return;
    }
    setOtpPendingAction('signin');
    setOtpError('');
    setShowOtpModal(true);
  };

  // Verify OTP
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (otpValue.trim().length < 4) {
      setOtpError('Please enter a valid 6-digit OTP code.');
      return;
    }
    setOtpError('');

    if (otpPendingAction === 'signup') {
      // Create a real backend account + tourist profile. If the backend
      // call fails or does not return a tourist record, the sign-up is
      // aborted entirely — the user stays on the auth screen and sees the
      // error instead of being logged in with a mock local-only profile.
      try {
        const backendResult = await registerAndLoginTourist({
          fullName: fullName,
          phone: phone,
          email: email || '',
          emergencyContact: `${emergencyContactName} (${emergencyRelation || 'Father'})`
        });

        if (!backendResult || !backendResult.tourist || !backendResult.tourist.tourist_id) {
          throw new Error('Registration failed. Please check your details and try again.');
        }

        const bt = backendResult.tourist;
        const newProfile: TouristProfile = {
          id: bt.tourist_id,
          name: bt.full_name || fullName,
          nationality: 'India',
          passportHash: digiLockerVerified ? 'Aadhaar XXXX-XXXX-4912' : 'PASSPORT-VERIFIED',
          photoUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=300',
          phone: bt.phone || phone,
          emergencyContact: bt.emergency_contact || `${emergencyContactName} (${emergencyRelation || 'Father'})`,
          emergencyRelation: emergencyRelation || 'Father',
          hotel: 'Solang Resort & Spa, Manali',
          currentLocation: {
            lat: 32.2432,
            lng: 77.1892,
            address: currentAddress
          },
          batteryLevel: 88,
          safetyStatus: 'Safe',
          lastSeenTime: 'Just now',
          digitalBandId: bt.digital_id || bt.tourist_id,
          pastSOSHistory: [],
          email: bt.email || email,
          digiLockerVerified: digiLockerVerified,
          locationConsent: 'granted',
          tourist_id: bt.tourist_id,
          digital_id: bt.digital_id,
          full_name: bt.full_name,
          kyc_verified: bt.kyc_verified,
          emergency_contact: bt.emergency_contact,
          preferred_language: bt.preferred_language,
          created_at: bt.created_at
        };

        setAuthenticatedUser(newProfile);
        setLocationConsent('granted');
        if (onRegisterTourist) {
          onRegisterTourist(newProfile);
        }

        setShowOtpModal(false);
        setShowDigitalPassModal(true);
      } catch (err: any) {
        console.error('Tourist registration failed:', err);
        setOtpError(err?.message || 'Registration failed. Please check your details and try again.');
        // Keep the OTP modal open so the user stays on the auth screen.
        return;
      }

    } else {
      // Re-authenticate against the real backend using the same derived
      // credentials established at sign-up (see lib/api.ts
      // loginTouristByPhone). If the backend call fails or does not
      // resolve a tourist record, the sign-in is aborted — the user stays
      // on the auth screen and sees the error instead of being logged in
      // with a mock local-only profile.
      try {
        const backendResult = await loginTouristByPhone(signinPhone);

        if (!backendResult || !backendResult.tourist || !backendResult.tourist.tourist_id) {
          throw new Error('Sign-in failed. Please check your Tourist ID and phone number.');
        }

        const bt = backendResult.tourist;
        const userProfile: TouristProfile = {
          id: bt.tourist_id,
          name: bt.full_name || 'Tourist',
          nationality: 'India',
          passportHash: 'VERIFIED',
          photoUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=300',
          phone: bt.phone || signinPhone,
          emergencyContact: bt.emergency_contact || '',
          emergencyRelation: '',
          hotel: '',
          currentLocation: {
            lat: 32.2432,
            lng: 77.1892,
            address: currentAddress
          },
          batteryLevel: 84,
          safetyStatus: 'Safe',
          lastSeenTime: 'Just now',
          digitalBandId: bt.digital_id || bt.tourist_id,
          pastSOSHistory: [],
          email: bt.email,
          locationConsent: 'granted',
          tourist_id: bt.tourist_id,
          digital_id: bt.digital_id,
          full_name: bt.full_name,
          kyc_verified: bt.kyc_verified,
          emergency_contact: bt.emergency_contact,
          preferred_language: bt.preferred_language,
          created_at: bt.created_at
        };

        setAuthenticatedUser(userProfile);
        setShowOtpModal(false);
        setShowConsentModal(true);
      } catch (err: any) {
        console.error('Tourist sign-in failed:', err);
        setOtpError(err?.message || 'Sign-in failed. Please check your Tourist ID and phone number.');
        // Keep the OTP modal open so the user stays on the auth screen.
        return;
      }
    }
  };

  const handlePassModalProceed = () => {
    setShowDigitalPassModal(false);
    setShowConsentModal(true);
  };

  const handleGrantConsent = () => {
    setLocationConsent('granted');
    if (authenticatedUser) {
      setAuthenticatedUser({ ...authenticatedUser, locationConsent: 'granted' });
    }
    setShowConsentModal(false);
  };

  const handleDeclineConsent = () => {
    setLocationConsent('declined');
    if (authenticatedUser) {
      setAuthenticatedUser({ ...authenticatedUser, locationConsent: 'declined' });
    }
    setShowConsentModal(false);
  };

  const handleCopyTouristId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2500);
  };

  const handleDownloadPass = () => {
    setDownloadSuccess(true);
    setTimeout(() => setDownloadSuccess(false), 3000);
  };

  const handleSignOut = () => {
    logoutUser().finally(() => clearSession());
    setAuthenticatedUser(null);
    setLocationConsent(null);
    setSosActive(false);
  };

  // Add Item to Itinerary
  const handleAddItinerary = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDest.trim()) return;

    // AI Safety Check Simulation based on destination name
    let status: 'Safe Corridor' | 'Weather Advisory' | 'High Risk Zone' = 'Safe Corridor';
    if (newDest.toLowerCase().includes('rohtang') || newDest.toLowerCase().includes('pass') || newDest.toLowerCase().includes('glacier')) {
      status = 'High Risk Zone';
    } else if (newDest.toLowerCase().includes('tunnel') || newDest.toLowerCase().includes('sissu') || newDest.toLowerCase().includes('river')) {
      status = 'Weather Advisory';
    }

    const newItem: ItineraryItem = {
      id: `itin-${Date.now()}`,
      destination: newDest,
      date: newDate,
      hotel: newHotel || 'Booked Homestay / Hotel',
      activities: newActivities || 'Sightseeing & Local Travel',
      safetyStatus: status
    };

    setItinerary([newItem, ...itinerary]);
    setNewDest('');
    setNewHotel('');
    setNewActivities('');
    setShowAddItineraryModal(false);

    // Persist to the backend (public.itinerary_entries) when signed in. This
    // is best-effort: the entry stays visible locally either way, but a
    // successful save lets it be deleted from the backend too.
    if (authenticatedUser?.tourist_id) {
      try {
        const plannedArrival = newDate ? new Date(newDate).toISOString() : undefined;
        const saved = await createItineraryEntry({
          destination_name: newItem.destination,
          latitude: newItem.coordinates?.lat,
          longitude: newItem.coordinates?.lng,
          planned_arrival: plannedArrival
        });
        if (saved?.itinerary_id) {
          setItinerary((prev) =>
            prev.map((it) => (it.id === newItem.id ? { ...it, backendItineraryId: saved.itinerary_id } : it))
          );
        }
      } catch (err) {
        console.warn('Failed to persist itinerary entry to backend:', err);
      }
    }
  };

  // Delete Itinerary Item
  const handleDeleteItinerary = (id: string) => {
    const target = itinerary.find((item) => item.id === id);
    setItinerary(itinerary.filter((item) => item.id !== id));

    if (target?.backendItineraryId) {
      deleteItineraryEntry(target.backendItineraryId).catch((err) =>
        console.warn('Failed to delete itinerary entry from backend:', err)
      );
    }
  };

  // Chatbot Send Message Handler
  const handleSendMessage = (textToSend?: string) => {
    const text = textToSend || chatInput;
    if (!text.trim()) return;

    const userMsg: ChatMessage = {
      id: `usr-${Date.now()}`,
      sender: 'user',
      text: text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!textToSend) setChatInput('');

    // AI Bot Smart Response
    setTimeout(() => {
      let botAnswer = '';
      const lower = text.toLowerCase();

      if (lower.includes('solang') || lower.includes('safe')) {
        botAnswer = '🟢 Solang Valley is currently classified as a SAFE CORRIDOR with active Police Patrol Unit 4 on standby. Weather is clear (18°C), but avoid venturing near unmonitored river beds after 5 PM.';
      } else if (lower.includes('emergency') || lower.includes('hotline') || lower.includes('number')) {
        botAnswer = '🚨 Himachal Emergency Numbers:\n• Police Control: 100 / 112\n• Medical Ambulance: 108\n• Tourist Helpline: 1363\n• Mountain Rescue Squad: 1800-180-1122';
      } else if (lower.includes('altitude') || lower.includes('sickness') || lower.includes('tips')) {
        botAnswer = '⛰️ High-Altitude Safety Guidelines:\n1. Stay hydrated (min 3L water/day).\n2. Avoid strenuous exertion above 3,000 meters for the first 24 hrs.\n3. Keep Emergency Oxygen kit handy if visiting Rohtang Pass (3,978m).';
      } else if (lower.includes('hospital') || lower.includes('medical') || lower.includes('doctor')) {
        botAnswer = '🏥 Nearest Medical Facility:\nManali District Civil Hospital, Mall Road (3.2 km from your GPS location). Contact: +91 1902 252222.';
      } else {
        botAnswer = `I have logged your safety query regarding "${text}". According to the Suraksha Setu Civil Defense Feed, your current zone (Solang Valley) is normal. If you feel unsafe at any time, tap the red SOS button to alert Himachal Police instantly!`;
      }

      const botMsg: ChatMessage = {
        id: `bot-${Date.now()}`,
        sender: 'bot',
        text: botAnswer,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      setMessages((prev) => [...prev, botMsg]);
    }, 700);
  };

  // Simulate Live Broadcast Push Alert
  const handleTriggerSimulatedAlert = () => {
    const sampleAlert: BroadcastAlert = {
      id: `brd-${Date.now()}`,
      senderBadge: 'HP-DISASTER-CELL-01',
      region: 'Kullu & Solang Sector',
      radiusKm: 15,
      titleEn: '⚠️ CRITICAL WEATHER & AVALANCHE ADVISORY',
      titleHi: '⚠️ गंभीर मौसम एवं हिमस्खलन चेतावनी',
      bodyEn: 'Heavy snowfall and black ice predicted near Atal Tunnel and Rohtang Pass after 3:30 PM. High-altitude tourists are advised to return to hotel base camps before sunset.',
      bodyHi: 'दोपहर 3:30 बजे के बाद अटल टनल और रोहतांग दर्रे के पास भारी बर्फबारी की चेतावनी। पर्यटकों को सूर्यास्त से पहले होटल बेस कैंप लौटने की सलाह दी जाती है।',
      severity: 'Critical',
      timestamp: 'Just now',
      recipientCount: 1420,
      deliveredCount: 1420,
      status: 'Active'
    };

    setActiveBroadcastModal(sampleAlert);
  };

  return (
    <div className="min-h-[calc(100vh-80px)] bg-[#F4F6F9] text-slate-900 p-3 sm:p-5 w-full max-w-none flex flex-col justify-between relative pb-24">
      
      {/* GLOBAL TOP HEADER FOR TOURIST PORTAL */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm mb-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center space-x-3 w-full sm:w-auto">
          {/* TOP LEFT PROFILE BUTTON (If Authenticated) */}
          {authenticatedUser && (
            <button
              onClick={() => setShowProfileModal(true)}
              className="px-3 py-2 bg-[#0B2447] hover:bg-[#071933] text-white text-xs font-black rounded-2xl border-2 border-[#FF9933]/50 shadow-md transition flex items-center gap-2 cursor-pointer flex-shrink-0"
              title="Click to view full Tourist Profile"
            >
              <img
                src={authenticatedUser.photoUrl}
                alt={authenticatedUser.name}
                className="w-8 h-8 rounded-xl border-2 border-[#138808] object-cover flex-shrink-0"
              />
              <div className="text-left hidden sm:block">
                <div className="text-[10px] font-extrabold text-[#FF9933] uppercase">My Profile</div>
                <div className="text-[11px] text-white font-bold truncate max-w-[110px]">{authenticatedUser.name}</div>
              </div>
              <User className="w-4 h-4 text-[#FF9933] sm:hidden" />
            </button>
          )}

          <div className="w-10 h-10 rounded-2xl bg-emerald-50 border border-[#138808] flex items-center justify-center text-[#138808] flex-shrink-0 shadow-sm">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-black text-[#0B2447]">
                {t.touristPortalTitle}
              </h2>
              <span className="px-2 py-0.5 rounded bg-emerald-100 text-[#138808] font-mono text-[10px] font-black border border-emerald-200">
                OFFICIAL MOBILE
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium">
              Suraksha Setu • Government of India Tourist Safety App
            </p>
          </div>
        </div>

        {/* User Info & Controls Header Bar */}
        <div className="flex items-center space-x-2.5 w-full sm:w-auto justify-end flex-wrap gap-y-2">
          
          {/* Quick Profile Button on Right (Mobile fallback) */}
          {authenticatedUser && (
            <button
              onClick={() => setShowProfileModal(true)}
              className="sm:hidden px-3 py-2 bg-[#0B2447] text-white text-xs font-black rounded-xl border border-slate-700 transition flex items-center gap-1.5"
            >
              <User className="w-4 h-4 text-[#FF9933]" />
              <span>Profile</span>
            </button>
          )}
          
          {/* Language Toggle */}
          {onLanguageChange && (
            <button
              onClick={() => onLanguageChange(language === 'en' ? 'hi' : 'en')}
              className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-xl border border-slate-300 transition flex items-center gap-1.5"
            >
              <Globe className="w-4 h-4 text-[#FF9933]" />
              <span>{language === 'en' ? 'हिंदी (HI)' : 'English (EN)'}</span>
            </button>
          )}

          {/* Gateway Return Button */}
          <button
            onClick={onReturnToGateway}
            className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-xl border border-slate-300 transition flex items-center gap-1.5"
          >
            <ArrowLeft className="w-4 h-4 text-slate-600" />
            <span>Gateway</span>
          </button>

          {/* Logout Button (If authenticated) */}
          {authenticatedUser && (
            <button
              onClick={handleSignOut}
              className="px-3 py-2 bg-red-50 hover:bg-red-100 text-red-800 text-xs font-bold rounded-xl border border-red-200 transition flex items-center gap-1.5"
            >
              <LogOut className="w-4 h-4 text-red-600" />
              <span>Logout</span>
            </button>
          )}
        </div>
      </div>

      {/* ========================================================= */}
      {/* CONDITION 1: UNAUTHENTICATED - ONBOARDING & AUTHENTICATION */}
      {/* ========================================================= */}
      {!authenticatedUser ? (
        <div className="bg-white border-2 border-slate-200 rounded-3xl p-6 sm:p-8 shadow-lg">
          
          {/* Header Description */}
          <div className="text-center max-w-lg mx-auto mb-8">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-300 text-[#138808] text-xs font-bold mb-3">
              <Shield className="w-3.5 h-3.5" />
              <span>Official Tourist Onboarding & e-KYC</span>
            </div>
            <h3 className="text-2xl sm:text-3xl font-black text-[#0B2447]">
              {authTab === 'signup' ? t.signUpTitle : t.signInTitle}
            </h3>
            <p className="mt-2 text-xs sm:text-sm text-slate-600 font-medium leading-relaxed">
              {authTab === 'signup' ? t.signUpSub : t.signInSub}
            </p>
          </div>

          {/* AUTH CHOICE TABS */}
          <div className="flex rounded-xl bg-slate-100 p-1.5 border border-slate-200 max-w-md mx-auto mb-8">
            <button
              type="button"
              onClick={() => setAuthTab('signin')}
              className={`flex-1 py-2.5 px-4 rounded-lg text-xs font-black transition-all flex items-center justify-center gap-2 ${
                authTab === 'signin'
                  ? 'bg-white text-[#0B2447] shadow-md border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <KeyRound className="w-4 h-4 text-[#FF9933]" />
              <span>{t.authSignInTab}</span>
            </button>

            <button
              type="button"
              onClick={() => setAuthTab('signup')}
              className={`flex-1 py-2.5 px-4 rounded-lg text-xs font-black transition-all flex items-center justify-center gap-2 ${
                authTab === 'signup'
                  ? 'bg-white text-[#0B2447] shadow-md border border-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <User className="w-4 h-4 text-[#138808]" />
              <span>{t.authSignUpTab}</span>
            </button>
          </div>

          {/* TAB 1: SIGN IN FORM */}
          {authTab === 'signin' ? (
            <form onSubmit={handleSignInSubmit} className="space-y-5 max-w-md mx-auto text-left">
              <div>
                <label className="block text-xs font-extrabold text-slate-700 mb-1">
                  Existing Tourist ID <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={signinTouristId}
                  onChange={(e) => setSigninTouristId(e.target.value)}
                  placeholder="TR-88219 or TR-2026-8942"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-300 text-slate-900 font-mono text-sm uppercase focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#FF9933]"
                />
              </div>

              <div>
                <label className="block text-xs font-extrabold text-slate-700 mb-1">
                  Registered Mobile Phone Number <span className="text-red-500">*</span>
                </label>
                <input
                  type="tel"
                  required
                  value={signinPhone}
                  onChange={(e) => setSigninPhone(e.target.value)}
                  placeholder="+34 612 884 902"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-300 text-slate-900 text-xs font-bold focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#FF9933]"
                />
              </div>

              <div className="p-3 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900 font-medium">
                💡 Enter the Tourist ID and phone number you used when you registered.
              </div>

              <button
                type="submit"
                className="w-full py-3.5 rounded-xl bg-[#0B2447] hover:bg-[#071933] text-white font-black text-sm transition shadow-lg flex items-center justify-center gap-2"
              >
                <KeyRound className="w-5 h-5 text-[#FF9933]" />
                <span>Send OTP & Activate Trip</span>
              </button>
            </form>
          ) : (
            /* TAB 2: SIGN UP FORM */
            <form onSubmit={handleSignUpSubmit} className="space-y-5">
              
              {/* DigiLocker Section */}
              <div className="p-4 bg-emerald-50/80 rounded-2xl border-2 border-emerald-300/80 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center space-x-3">
                  <div className="w-12 h-12 rounded-xl bg-white border border-emerald-300 flex items-center justify-center text-[#138808] shadow-sm flex-shrink-0">
                    <FileCheck className="w-6 h-6 text-[#138808]" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-black text-slate-900">
                        Government DigiLocker e-KYC Integration
                      </span>
                      {digiLockerVerified && (
                        <span className="px-2 py-0.5 rounded bg-emerald-600 text-white text-[10px] font-extrabold flex items-center gap-1">
                          <Check className="w-3 h-3" /> VERIFIED
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-600 font-medium mt-0.5">
                      Skip manual uploads. Auto-retrieve Aadhaar / Passport verified credentials & photo.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowDigiLockerModal(true)}
                  className={`px-4 py-2.5 rounded-xl text-xs font-extrabold transition shadow flex items-center gap-2 whitespace-nowrap ${
                    digiLockerVerified
                      ? 'bg-emerald-100 text-emerald-900 border border-emerald-300 hover:bg-emerald-200'
                      : 'bg-[#138808] hover:bg-emerald-800 text-white'
                  }`}
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>{digiLockerVerified ? 'DigiLocker Verified ✅' : t.connectDigiLockerBtn}</span>
                </button>
              </div>

              {/* User Details Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left">
                <div>
                  <label className="block text-xs font-extrabold text-slate-700 mb-1">
                    {t.fullNameLabel} <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Elena Rostova"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-300 text-slate-900 text-xs font-bold focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#138808]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-slate-700 mb-1">
                    {t.phoneLabel} <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 98765 43210"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-300 text-slate-900 text-xs font-bold focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#138808]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-slate-700 mb-1">
                    {t.emailLabel}
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="elena.r@example.com"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-300 text-slate-900 text-xs font-bold focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#138808]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-slate-700 mb-1">
                    {t.emergencyContactLabel} <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={emergencyContactName}
                    onChange={(e) => setEmergencyContactName(e.target.value)}
                    placeholder="Carlos Rostova"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-300 text-slate-900 text-xs font-bold focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#138808]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-slate-700 mb-1">
                    {t.emergencyRelationLabel}
                  </label>
                  <select
                    value={emergencyRelation}
                    onChange={(e) => setEmergencyRelation(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-300 text-slate-900 text-xs font-bold focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#138808]"
                  >
                    <option value="Father">Father</option>
                    <option value="Mother">Mother</option>
                    <option value="Spouse">Spouse</option>
                    <option value="Sibling">Sibling</option>
                    <option value="Friend">Friend</option>
                    <option value="Relative">Relative</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-slate-700 mb-1">
                    {t.emergencyPhoneLabel} <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="tel"
                    required
                    value={emergencyContactPhone}
                    onChange={(e) => setEmergencyContactPhone(e.target.value)}
                    placeholder="+91 98765 00000"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-300 text-slate-900 text-xs font-bold focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#138808]"
                  />
                </div>
              </div>

              {/* Submit Button */}
              <div className="pt-4">
                <button
                  type="submit"
                  className="w-full py-3.5 rounded-xl bg-[#0B2447] hover:bg-[#071933] text-white font-black text-sm transition shadow-lg flex items-center justify-center gap-2"
                >
                  <Smartphone className="w-5 h-5 text-[#FF9933]" />
                  <span>Proceed to Mobile OTP Verification</span>
                </button>
              </div>

            </form>
          )}

        </div>
      ) : (
        /* ========================================================= */
        /* CONDITION 2: AUTHENTICATED - MAIN TOURIST DASHBOARD */
        /* ========================================================= */
        <div className="space-y-5 text-left">

          {/* MAIN GRID DASHBOARD CONTAINER MATCHING DIAGRAM */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            
            {/* LEFT COLUMN (Cols 1 - 5) */}
            <div className="lg:col-span-5 space-y-5">
              
              {/* BOX 1 TOP LEFT: TELEMETRY BAR & EMERGENCY SOS BUTTON */}
              <div className="bg-white border-2 border-slate-200 rounded-2xl p-4 shadow-sm space-y-4 text-left">
                
                {/* Emergency SOS Panic Button Center Area */}
                <div className="py-2 flex flex-col items-center justify-center text-center">
                  
                  {/* STEP: ACTIVE EMERGENCY OR SUCCESS STATE */}
                  {(sosStep === 'active' || sosStep === 'success' || sosActive) ? (
                    <div className="w-full bg-red-50 border-2 border-[#D32F2F] rounded-2xl p-4 shadow-xs space-y-3 animate-pulse">
                      <div className="w-12 h-12 rounded-full bg-[#D32F2F] mx-auto flex items-center justify-center text-white shadow-md">
                        <ShieldAlert className="w-7 h-7" />
                      </div>
                      <div className="space-y-1">
                        <h3 className="text-base font-black text-red-900 uppercase tracking-wider">
                          {t.sosActiveNotice}
                        </h3>
                        {incidentRef && (
                          <div className="inline-block px-2.5 py-0.5 rounded-full bg-red-200 text-red-950 font-black text-[10px] tracking-wider">
                            INCIDENT REF #{incidentRef}
                          </div>
                        )}
                      </div>
                      <p className="text-[11px] text-red-800 font-bold">
                        GPS Telemetry ({lat.toFixed(4)}, {lng.toFixed(4)}) broadcasting to Police Command Station.
                      </p>
                      <div className="p-2.5 bg-white/80 rounded-xl border border-red-200 text-left text-[11px] text-slate-700 space-y-1">
                        <div className="font-extrabold text-red-900 flex items-center justify-between">
                          <span>Responder Status:</span>
                          <span className="text-emerald-700 font-black">EN ROUTE (ETA ~4 mins)</span>
                        </div>
                        <div className="text-[10px] text-slate-500">
                          Dispatched Unit: Himachal PCR Unit 2 (Vashisht Patrol)
                        </div>
                      </div>
                      <div className="pt-1 flex justify-center gap-2">
                        <button
                          onClick={() => setSirenPlaying(!sirenPlaying)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                            sirenPlaying ? 'bg-red-600 text-white' : 'bg-slate-200 text-slate-800'
                          }`}
                        >
                          {sirenPlaying ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                          <span>{sirenPlaying ? 'Siren Active' : 'Mute'}</span>
                        </button>
                        <button
                          onClick={handleResetSosFlow}
                          className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-lg shadow-xs"
                        >
                          Reset SOS
                        </button>
                      </div>
                    </div>

                  ) : sosStep === 'confirming' ? (
                    /* STEP: CONFIRMATION MODAL STATE */
                    <div className="w-full bg-amber-50 border-2 border-amber-400 rounded-2xl p-4 text-center space-y-3">
                      <div className="w-10 h-10 rounded-full bg-amber-500 mx-auto flex items-center justify-center text-slate-950 font-black shadow-sm">
                        <AlertTriangle className="w-6 h-6" />
                      </div>
                      <h3 className="text-sm font-black text-amber-950 uppercase tracking-wide">
                        Confirm Emergency SOS Distress Signal?
                      </h3>
                      <p className="text-[11px] text-amber-900 font-medium">
                        This will transmit your live coordinates ({lat.toFixed(4)}, {lng.toFixed(4)}) and identity details directly to the Himachal Police Control Room.
                      </p>
                      <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
                        <button
                          onClick={() => handleExecuteSosSend(false)}
                          className="px-4 py-2 bg-[#D32F2F] hover:bg-red-700 text-white text-xs font-black rounded-xl shadow-md transition flex items-center justify-center gap-1.5"
                        >
                          <ShieldAlert className="w-4 h-4" />
                          <span>Yes, Broadcast SOS</span>
                        </button>
                        <button
                          onClick={() => handleExecuteSosSend(true)}
                          className="px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 text-[10px] font-bold rounded-xl transition"
                          title="Test error fallback state"
                        >
                          Simulate Network Drop Error
                        </button>
                        <button
                          onClick={() => setSosStep('ready')}
                          className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>

                  ) : sosStep === 'sending' ? (
                    /* STEP: SENDING / LOADING STATE */
                    <div className="w-full bg-slate-900 border-2 border-blue-500 text-white rounded-2xl p-5 text-center space-y-4 shadow-lg">
                      <div className="flex justify-center">
                        <Loader2 className="w-10 h-10 text-blue-400 animate-spin" />
                      </div>
                      <div className="space-y-1">
                        <h3 className="text-sm font-black uppercase tracking-wider text-blue-200">
                          Transmitting Encrypted Distress Beacon...
                        </h3>
                        <p className="text-[11px] text-slate-300 font-medium">
                          Connecting to Himachal Pradesh Police Emergency Network
                        </p>
                      </div>

                      {/* Progress Bar */}
                      <div className="w-full bg-slate-800 rounded-full h-2.5 overflow-hidden border border-slate-700">
                        <div
                          className="bg-blue-500 h-2.5 rounded-full transition-all duration-300 ease-out"
                          style={{ width: `${sosSendingProgress}%` }}
                        ></div>
                      </div>

                      <div className="text-[10px] font-mono text-slate-400 flex items-center justify-between">
                        <span>GPS Lock: 32.2432, 77.1892</span>
                        <span>{sosSendingProgress}%</span>
                      </div>
                    </div>

                  ) : sosStep === 'error' ? (
                    /* STEP: ERROR STATE */
                    <div className="w-full bg-red-50 border-2 border-red-500 rounded-2xl p-4 text-center space-y-3">
                      <div className="w-10 h-10 rounded-full bg-red-600 mx-auto flex items-center justify-center text-white shadow-sm">
                        <X className="w-6 h-6" />
                      </div>
                      <h3 className="text-sm font-black text-red-900 uppercase tracking-wide">
                        SOS Transmission Failure
                      </h3>
                      <p className="text-[11px] text-red-800 font-bold">
                        {sosErrorMessage || 'Network signal timeout. Could not establish band relay.'}
                      </p>
                      <div className="flex justify-center gap-2 pt-1">
                        <button
                          onClick={() => handleExecuteSosSend(false)}
                          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-black rounded-xl shadow-md transition flex items-center gap-1.5"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>Retry Broadcast</span>
                        </button>
                        <button
                          onClick={() => setSosStep('ready')}
                          className="px-3 py-2 bg-slate-900 text-white text-xs font-bold rounded-xl"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>

                  ) : countdown !== null ? (
                    <div className="w-full bg-amber-50 border-2 border-[#FF9933] rounded-2xl p-5 text-center space-y-3">
                      <div className="text-5xl font-black text-[#FF9933] animate-bounce">
                        {countdown}
                      </div>
                      <p className="text-xs font-bold text-amber-900">
                        Broadcasting distress beacon in {countdown}s...
                      </p>
                      <button
                        onClick={() => setCountdown(null)}
                        className="px-4 py-2 bg-slate-900 text-white text-xs font-bold rounded-xl shadow-xs"
                      >
                        Cancel SOS
                      </button>
                    </div>

                  ) : (
                    /* STEP: READY DEFAULT STATE */
                    <div className="flex flex-col items-center">
                      <button
                        onClick={handleStartSosConfirmation}
                        className="relative group w-44 h-44 sm:w-48 sm:h-48 rounded-full bg-gradient-to-br from-[#D32F2F] via-red-600 to-red-700 border-4 border-red-300 text-white font-black shadow-2xl shadow-red-500/40 hover:scale-105 active:scale-95 transition-all flex flex-col items-center justify-center gap-1 cursor-pointer"
                      >
                        <div className="absolute inset-0 rounded-full border-4 border-red-500/30 animate-ping pointer-events-none"></div>
                        <ShieldAlert className="w-12 h-12 text-white group-hover:scale-110 transition-transform" />
                        <span className="text-lg sm:text-xl font-black tracking-widest uppercase">EMERGENCY SOS</span>
                        <span className="text-[9px] text-red-100 font-bold uppercase tracking-wider">TAP TO BROADCAST</span>
                      </button>

                      <p className="mt-3 text-[11px] text-slate-500 font-medium max-w-xs text-center">
                        Tap button to initiate guided distress signal & live location dispatch to nearest PCR unit.
                      </p>
                    </div>
                  )}
                </div>

              </div>

              {/* BOX 2 BOTTOM LEFT: GOOGLE MAPS FOR DIRECTIONS, LOCATION & GEO-FENCE */}
              <div className="bg-white border-2 border-slate-200 rounded-2xl p-4 shadow-sm space-y-3 text-left">
                <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                  <div className="flex items-center space-x-2">
                    <Navigation className="w-4 h-4 text-blue-600" />
                    <h3 className="text-xs font-black text-[#0B2447] uppercase tracking-wider">
                      Google Maps Directions & Geo-Fence
                    </h3>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-800 text-[10px] font-black border border-blue-200">
                    LIVE GOOGLE MAP
                  </span>
                </div>

                {/* Geo-Fence Safety Zone Selector & Alert Banner */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[10px] font-bold uppercase text-slate-500">Geo-Fence Safety Zone:</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase border ${
                      activeGeoFenceZone.riskLevel === 'Unsafe' ? 'bg-red-100 text-red-800 border-red-300' :
                      activeGeoFenceZone.riskLevel === 'Caution' ? 'bg-amber-100 text-amber-800 border-amber-300' :
                      'bg-emerald-100 text-emerald-800 border-emerald-300'
                    }`}>
                      {activeGeoFenceZone.riskLevel} STATE
                    </span>
                  </div>

                  {/* Zone Buttons */}
                  <div className="grid grid-cols-3 gap-1.5">
                    {MOCK_GEOFENCE_ZONES.map((zone) => (
                      <button
                        key={zone.id}
                        onClick={() => setActiveGeoFenceZone(zone)}
                        className={`px-2 py-1.5 rounded-lg text-[10px] font-extrabold border transition text-center truncate ${
                          activeGeoFenceZone.id === zone.id
                            ? zone.riskLevel === 'Unsafe' ? 'bg-red-600 text-white border-red-700 shadow-xs' :
                              zone.riskLevel === 'Caution' ? 'bg-amber-500 text-slate-950 border-amber-600 shadow-xs' :
                              'bg-emerald-600 text-white border-emerald-700 shadow-xs'
                            : 'bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200'
                        }`}
                      >
                        {zone.name.split(' ')[0]} ({zone.riskLevel})
                      </button>
                    ))}
                  </div>

                  {/* Active GeoFence Warning Display */}
                  {activeGeoFenceZone.riskLevel === 'Unsafe' ? (
                    <div className="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-900 text-[11px] font-medium flex items-start gap-2">
                      <ShieldAlert className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5 animate-pulse" />
                      <div>
                        <div className="font-extrabold text-red-950 uppercase text-[10px]">
                          ⚠️ GEO-FENCE WARNING: UNSAFE / RESTRICTED ZONE
                        </div>
                        <div>{activeGeoFenceZone.description}</div>
                      </div>
                    </div>
                  ) : activeGeoFenceZone.riskLevel === 'Caution' ? (
                    <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-[11px] font-medium flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <div className="font-extrabold text-amber-950 uppercase text-[10px]">
                          ⚡ GEO-FENCE CAUTION: MODERATE RISK ZONE
                        </div>
                        <div>{activeGeoFenceZone.description}</div>
                      </div>
                    </div>
                  ) : (
                    <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-[11px] font-medium flex items-start gap-2">
                      <ShieldCheck className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <div className="font-extrabold text-emerald-950 uppercase text-[10px]">
                          🛡️ GEO-FENCE SAFE: MONITORED SAFE CORRIDOR
                        </div>
                        <div>{activeGeoFenceZone.description}</div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Route controls */}
                <div className="space-y-3 pt-1">
                  <div className="flex items-center gap-2 text-xs">
                    <input
                      type="text"
                      value={routeOrigin}
                      onChange={(e) => setRouteOrigin(e.target.value)}
                      placeholder="Origin"
                      className="flex-1 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-300 text-xs font-semibold focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-slate-400 font-bold">➔</span>
                    <input
                      type="text"
                      value={routeDest}
                      onChange={(e) => setRouteDest(e.target.value)}
                      placeholder="Destination"
                      className="flex-1 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-300 text-xs font-semibold focus:outline-none focus:bg-white focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {/* Actual Google Map Component with Geofence Zones */}
                  <ActualGoogleMap
                    center={activeGeoFenceZone.center}
                    zoom={12}
                    origin={routeOrigin}
                    destination={routeDest}
                    height="230px"
                    geofenceZones={MOCK_GEOFENCE_ZONES}
                    activeZoneId={activeGeoFenceZone.id}
                    markers={[
                      { id: 'user-loc', lat: activeGeoFenceZone.center.lat, lng: activeGeoFenceZone.center.lng, title: 'My GPS Location', type: 'user' },
                      { id: 'police-pcr', lat: 32.248, lng: 77.185, title: 'Police PCR Unit 2', type: 'police' },
                      { id: 'dest-hotel', lat: 32.316, lng: 77.157, title: routeDest, type: 'hotel' }
                    ]}
                  />

                  <div className="flex items-center justify-between text-[10px] text-slate-500 bg-slate-50 p-2 rounded-xl border border-slate-200 font-semibold">
                    <span>Active Zone: <strong>{activeGeoFenceZone.name}</strong></span>
                    <span className="text-[#138808] font-black">🟢 Himachal Police Patrol</span>
                  </div>
                </div>
              </div>


            </div>

            {/* RIGHT COLUMN (Cols 6 - 12): ITINERARY PLANNER & SAFETY HEATMAP */}
            <div className="lg:col-span-7 space-y-5">
              
              <div className="bg-white border-2 border-slate-200 rounded-2xl p-4 shadow-sm space-y-4 text-left">
                
                {/* RIGHT BOX MODULE SWITCHER TABS */}
                <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 gap-1">
                  <button
                    onClick={() => setActiveTab('itinerary')}
                    className={`flex-1 py-2 px-3 rounded-lg text-xs font-black transition flex items-center justify-center gap-1.5 ${
                      activeTab === 'itinerary'
                        ? 'bg-[#0B2447] text-white shadow-xs'
                        : 'text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    <Calendar className="w-3.5 h-3.5 text-[#138808]" />
                    <span>Itinerary Planner</span>
                  </button>

                  <button
                    onClick={() => setActiveTab('heatmap')}
                    className={`flex-1 py-2 px-3 rounded-lg text-xs font-black transition flex items-center justify-center gap-1.5 ${
                      activeTab === 'heatmap'
                        ? 'bg-[#0B2447] text-white shadow-xs'
                        : 'text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    <Map className="w-3.5 h-3.5 text-red-500" />
                    <span>Safety Heatmap</span>
                  </button>
                </div>

                {/* TAB CONTENT 1: ITINERARY PLANNER */}
                {(activeTab === 'itinerary' || activeTab === 'overview') && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                      <div>
                        <h3 className="text-sm font-black text-[#0B2447] flex items-center gap-1.5">
                          <Calendar className="w-4 h-4 text-[#138808]" />
                          <span>Interactive Itinerary & Hazard Evaluation</span>
                        </h3>
                        <p className="text-[11px] text-slate-500 font-medium">
                          Manage destinations and stays evaluated against real-time hazard alerts.
                        </p>
                      </div>

                      <button
                        onClick={() => setShowAddItineraryModal(true)}
                        className="px-3 py-1.5 bg-[#0B2447] hover:bg-[#071933] text-white text-xs font-extrabold rounded-xl shadow-xs transition flex items-center gap-1"
                      >
                        <Plus className="w-3.5 h-3.5 text-[#FF9933]" />
                        <span>Add</span>
                      </button>
                    </div>

                    <div className="space-y-3 max-h-[460px] overflow-y-auto pr-1">
                      {itinerary.map((item, idx) => (
                        <div
                          key={item.id}
                          className="p-3.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-white hover:border-slate-300 transition shadow-2xs space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2">
                              <span className="w-5 h-5 rounded-full bg-[#0B2447] text-white text-[10px] font-black flex items-center justify-center">
                                {idx + 1}
                              </span>
                              <h4 className="text-xs font-black text-slate-900">{item.destination}</h4>
                            </div>

                            {item.safetyStatus === 'Safe Corridor' && (
                              <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-[#138808] border border-emerald-300 text-[9px] font-black flex items-center gap-1">
                                <ShieldCheck className="w-3 h-3 text-[#138808]" /> Safe Corridor
                              </span>
                            )}
                            {item.safetyStatus === 'Weather Advisory' && (
                              <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-[9px] font-black flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3 text-amber-600" /> Weather Advisory
                              </span>
                            )}
                            {item.safetyStatus === 'High Risk Zone' && (
                              <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-800 border border-red-300 text-[9px] font-black flex items-center gap-1">
                                <ShieldAlert className="w-3 h-3 text-red-600" /> High Risk Pass
                              </span>
                            )}
                          </div>

                          <div className="text-[11px] text-slate-600 font-medium flex flex-wrap gap-x-3 gap-y-1">
                            <span>Date: <strong>{item.date}</strong></span>
                            <span>•</span>
                            <span>Hotel: <strong>{item.hotel}</strong></span>
                          </div>

                          <p className="text-[11px] text-slate-500 italic">
                            Activities: {item.activities}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* TAB CONTENT 2: SAFETY HEATMAP */}
                {activeTab === 'heatmap' && (
                  <CrowdHeatmap onAddItineraryDestination={handleAddItineraryDestination} />
                )}

              </div>

            </div>

            {/* BOTTOM ROW: NEARBY SAFE HAVENS & POLICE POSTS (FULL WIDTH) */}
            <div className="lg:col-span-12 pt-2">
              <div className="w-full bg-white border-2 border-slate-200 rounded-2xl p-4 shadow-sm text-left space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                  <h4 className="text-xs font-black text-[#138808] uppercase tracking-wider flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-[#138808]" />
                    <span>Nearby Safe Havens & Police Posts</span>
                  </h4>
                  <span className="text-[10px] font-bold text-slate-500">24/7 Verified Safe Hubs</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                  {POLICE_STATIONS.map((st) => (
                    <div key={st.id} className="p-3 bg-slate-50 hover:bg-slate-100 transition border border-slate-200 rounded-xl flex items-center justify-between">
                      <div>
                        <div className="font-extrabold text-slate-900">{st.name}</div>
                        <div className="text-[11px] text-slate-600 font-medium">{st.location.address}</div>
                      </div>
                      <div className="text-right flex-shrink-0 ml-2">
                        <span className="px-2 py-0.5 rounded bg-emerald-100 text-[#138808] font-mono text-[10px] font-black border border-emerald-200">450m</span>
                        <div className="text-[10px] text-slate-500 font-mono mt-0.5">Ph: {st.contactPhone}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

          </div>

          {/* ========================================================= */}
          {/* TAB 2: ITINERARY PLANNER */}
          {/* ========================================================= */}
          {activeTab === 'itinerary' && (
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-6 text-left">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-slate-200">
                <div>
                  <h3 className="text-lg font-black text-[#0B2447] flex items-center gap-2">
                    <Calendar className="w-5 h-5 text-[#138808]" />
                    <span>Interactive Itinerary & Safety Checker</span>
                  </h3>
                  <p className="text-xs text-slate-500 font-medium mt-0.5">
                    Manage trip destinations and hotel stays with AI-powered hazard evaluation.
                  </p>
                </div>

                <button
                  onClick={() => setShowAddItineraryModal(true)}
                  className="px-4 py-2.5 bg-[#0B2447] hover:bg-[#071933] text-white text-xs font-extrabold rounded-xl shadow transition flex items-center gap-1.5"
                >
                  <Plus className="w-4 h-4 text-[#FF9933]" />
                  <span>Add New Destination</span>
                </button>
              </div>

              {/* Itinerary Items List */}
              <div className="space-y-4">
                {itinerary.map((item, idx) => (
                  <div
                    key={item.id}
                    className="p-4 rounded-2xl border-2 border-slate-200 bg-slate-50 hover:bg-white hover:border-slate-300 transition shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="w-6 h-6 rounded-full bg-[#0B2447] text-white text-[11px] font-black flex items-center justify-center">
                          {idx + 1}
                        </span>
                        <h4 className="text-sm font-black text-slate-900">{item.destination}</h4>
                        
                        {/* Status Badge */}
                        {item.safetyStatus === 'Safe Corridor' && (
                          <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-[#138808] border border-emerald-300 text-[10px] font-black flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3 text-[#138808]" /> Safe Corridor
                          </span>
                        )}
                        {item.safetyStatus === 'Weather Advisory' && (
                          <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-black flex items-center gap-1">
                            <AlertTriangle className="w-3 h-3 text-amber-600" /> Weather Advisory
                          </span>
                        )}
                        {item.safetyStatus === 'High Risk Zone' && (
                          <span className="px-2.5 py-0.5 rounded-full bg-red-100 text-red-800 border border-red-300 text-[10px] font-black flex items-center gap-1">
                            <ShieldAlert className="w-3 h-3 text-red-600" /> High Risk Pass
                          </span>
                        )}
                      </div>

                      <div className="text-xs text-slate-600 font-medium flex flex-wrap gap-x-4 gap-y-1 pt-1">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5 text-slate-400" /> Date: <strong>{item.date}</strong>
                        </span>
                        <span className="flex items-center gap-1">
                          <Hotel className="w-3.5 h-3.5 text-slate-400" /> Hotel: <strong>{item.hotel}</strong>
                        </span>
                      </div>

                      <p className="text-xs text-slate-500 italic pt-0.5">
                        Activities: {item.activities}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 self-end md:self-center">
                      <button
                        onClick={() => handleDeleteItinerary(item.id)}
                        className="p-2 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 text-xs transition"
                        title="Delete destination"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* TAB 3: SAFETY HEATMAP */}
          {/* ========================================================= */}
          {activeTab === 'heatmap' && (
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-6 text-left">
              <div>
                <h3 className="text-lg font-black text-[#0B2447] flex items-center gap-2">
                  <Map className="w-5 h-5 text-red-500" />
                  <span>Geofenced Regional Safety Heatmap</span>
                </h3>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  Real-time risk evaluation for Kullu, Manali, Lahaul & Spiti tourist corridors.
                </p>
              </div>

              {/* Heatmap Filters */}
              <div className="flex gap-2 overflow-x-auto pb-1 text-xs">
                <button
                  onClick={() => setHeatmapFilter('all')}
                  className={`px-3.5 py-1.5 rounded-xl font-extrabold transition ${
                    heatmapFilter === 'all'
                      ? 'bg-slate-900 text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                  }`}
                >
                  All Zones (5)
                </button>
                <button
                  onClick={() => setHeatmapFilter('high')}
                  className={`px-3.5 py-1.5 rounded-xl font-extrabold transition ${
                    heatmapFilter === 'high'
                      ? 'bg-red-600 text-white'
                      : 'bg-red-50 text-red-800 border border-red-200 hover:bg-red-100'
                  }`}
                >
                  🔴 High-Risk Zones
                </button>
                <button
                  onClick={() => setHeatmapFilter('advisory')}
                  className={`px-3.5 py-1.5 rounded-xl font-extrabold transition ${
                    heatmapFilter === 'advisory'
                      ? 'bg-amber-500 text-white'
                      : 'bg-amber-50 text-amber-900 border border-amber-200 hover:bg-amber-100'
                  }`}
                >
                  🟡 Weather Advisories
                </button>
                <button
                  onClick={() => setHeatmapFilter('safe')}
                  className={`px-3.5 py-1.5 rounded-xl font-extrabold transition ${
                    heatmapFilter === 'safe'
                      ? 'bg-[#138808] text-white'
                      : 'bg-emerald-50 text-emerald-900 border border-emerald-200 hover:bg-emerald-100'
                  }`}
                >
                  🟢 Safe Corridors
                </button>
              </div>

              {/* Visual Simulated Map Grid */}
              <div className="relative h-64 sm:h-80 rounded-2xl bg-slate-900 border-2 border-slate-800 overflow-hidden shadow-inner flex items-center justify-center p-4">
                {/* Simulated Topo Map Lines */}
                <div className="absolute inset-0 bg-[radial-gradient(#334155_1px,transparent_1px)] [background-size:16px_16px] opacity-40"></div>

                {/* Simulated Pins */}
                <div className="relative w-full h-full">
                  
                  {/* Pin 1: Rohtang Pass (High Risk) */}
                  {(heatmapFilter === 'all' || heatmapFilter === 'high') && (
                    <div className="absolute top-[18%] left-[65%] flex items-center gap-1.5 group cursor-pointer">
                      <span className="w-5 h-5 rounded-full bg-red-600 border-2 border-white text-white font-bold text-[9px] flex items-center justify-center animate-ping"></span>
                      <span className="w-5 h-5 rounded-full bg-red-600 border-2 border-white text-white font-bold text-[9px] flex items-center justify-center shadow-lg">!</span>
                      <div className="bg-slate-900/90 text-white text-[10px] font-black px-2 py-1 rounded border border-red-500 shadow">
                        Rohtang Pass (Avalanche Warning)
                      </div>
                    </div>
                  )}

                  {/* Pin 2: Solang Valley (Safe) */}
                  {(heatmapFilter === 'all' || heatmapFilter === 'safe') && (
                    <div className="absolute top-[45%] left-[30%] flex items-center gap-1.5 group cursor-pointer">
                      <span className="w-5 h-5 rounded-full bg-emerald-500 border-2 border-white text-white font-bold text-[9px] flex items-center justify-center shadow-lg">✓</span>
                      <div className="bg-slate-900/90 text-white text-[10px] font-black px-2 py-1 rounded border border-emerald-500 shadow">
                        Solang Valley (Patrol Active)
                      </div>
                    </div>
                  )}

                  {/* Pin 3: Atal Tunnel North (Advisory) */}
                  {(heatmapFilter === 'all' || heatmapFilter === 'advisory') && (
                    <div className="absolute top-[28%] left-[45%] flex items-center gap-1.5 group cursor-pointer">
                      <span className="w-5 h-5 rounded-full bg-amber-500 border-2 border-white text-white font-bold text-[9px] flex items-center justify-center shadow-lg">!</span>
                      <div className="bg-slate-900/90 text-white text-[10px] font-black px-2 py-1 rounded border border-amber-500 shadow">
                        Atal Tunnel (Black Ice Caution)
                      </div>
                    </div>
                  )}

                  {/* Pin 4: Mall Road Manali (Safe) */}
                  {(heatmapFilter === 'all' || heatmapFilter === 'safe') && (
                    <div className="absolute top-[70%] left-[25%] flex items-center gap-1.5 group cursor-pointer">
                      <span className="w-5 h-5 rounded-full bg-emerald-500 border-2 border-white text-white font-bold text-[9px] flex items-center justify-center shadow-lg">✓</span>
                      <div className="bg-slate-900/90 text-white text-[10px] font-black px-2 py-1 rounded border border-emerald-500 shadow">
                        Mall Road Base (Civil HQ)
                      </div>
                    </div>
                  )}
                </div>

                <div className="absolute bottom-3 left-3 bg-slate-900/80 backdrop-blur px-3 py-1.5 rounded-lg border border-slate-700 text-[10px] text-slate-300 font-mono">
                  Coordinates: 32.2432° N, 77.1892° E • Zoom Level: Sector 4
                </div>
              </div>

              {/* Detailed Hazard Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-red-50 border border-red-200 rounded-2xl">
                  <div className="flex items-center gap-2 mb-1">
                    <ShieldAlert className="w-4 h-4 text-red-600" />
                    <span className="text-xs font-black text-red-900 uppercase">Rohtang Pass Sector (3,978m)</span>
                  </div>
                  <p className="text-xs text-red-800 font-medium">
                    High avalanche probability above Marhi. Travel prohibited past 3:00 PM without special mountain permit.
                  </p>
                </div>

                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl">
                  <div className="flex items-center gap-2 mb-1">
                    <ShieldCheck className="w-4 h-4 text-[#138808]" />
                    <span className="text-xs font-black text-emerald-900 uppercase">Solang-Manali Highway Corridor</span>
                  </div>
                  <p className="text-xs text-emerald-800 font-medium">
                    Continuous police patrol every 15 mins. SOS response time: under 6 minutes.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ========================================================= */}
          {/* TAB 4: ROUTE FINDER MAP */}
          {/* ========================================================= */}
          {activeTab === 'route_finder' && (
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-6 text-left">
              <div>
                <h3 className="text-lg font-black text-[#0B2447] flex items-center gap-2">
                  <Navigation className="w-5 h-5 text-blue-600" />
                  <span>Interactive Safe Route Finder & Hazard Avoidance</span>
                </h3>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  Calculate safest mountain transit corridors with real-time landslide & black ice warnings.
                </p>
              </div>

              {/* Route Search Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-200">
                <div>
                  <label className="block text-xs font-extrabold text-slate-700 mb-1">
                    Starting Origin
                  </label>
                  <select
                    value={routeOrigin}
                    onChange={(e) => setRouteOrigin(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-slate-300 text-slate-900 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="Manali Town">Manali Town Center</option>
                    <option value="Solang Valley">Solang Valley Base</option>
                    <option value="Kullu Airport">Kullu Bhuntar Airport</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-slate-700 mb-1">
                    Target Destination
                  </label>
                  <select
                    value={routeDest}
                    onChange={(e) => setRouteDest(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-slate-300 text-slate-900 text-xs font-bold focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="Sissu / Lahaul Valley">Sissu / Lahaul Valley (via Atal Tunnel)</option>
                    <option value="Kasol / Parvati Valley">Kasol / Parvati Valley</option>
                    <option value="Dharamshala / Kangra">Dharamshala / Kangra Valley</option>
                  </select>
                </div>
              </div>

              {/* Route Result Card */}
              <div className="space-y-4">
                <div className="p-5 rounded-2xl bg-blue-50/80 border-2 border-blue-300 space-y-4">
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-blue-200 pb-3">
                    <div>
                      <span className="px-2.5 py-0.5 rounded bg-blue-600 text-white text-[10px] font-black uppercase">
                        RECOMMENDED SAFE CORRIDOR
                      </span>
                      <h4 className="text-base font-black text-slate-900 mt-1">
                        {routeOrigin} ➔ {routeDest}
                      </h4>
                    </div>

                    <div className="text-right">
                      <div className="text-sm font-black text-[#0B2447]">Distance: 28.4 km</div>
                      <div className="text-xs text-blue-800 font-bold">Est. Travel Time: 45 mins</div>
                    </div>
                  </div>

                  {/* Route Safety Milestones */}
                  <div className="space-y-2 text-xs">
                    <div className="font-extrabold text-slate-800 uppercase tracking-wider text-[11px]">
                      Turn-by-Turn Police & Emergency Milestones:
                    </div>

                    <div className="flex items-center space-x-3 p-2.5 bg-white rounded-xl border border-blue-200">
                      <ShieldCheck className="w-4 h-4 text-[#138808] flex-shrink-0" />
                      <div>
                        <div className="font-bold text-slate-900">Km 0.0 — Manali Police Post Checkpoint</div>
                        <div className="text-[11px] text-slate-600">Verification & e-Pass Scanner station</div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-3 p-2.5 bg-white rounded-xl border border-blue-200">
                      <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                      <div>
                        <div className="font-bold text-slate-900">Km 14.2 — Solang Nullah Bypass (Black Ice Warning)</div>
                        <div className="text-[11px] text-amber-800">Drive at max 30 km/h due to morning frost on asphalt</div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-3 p-2.5 bg-white rounded-xl border border-blue-200">
                      <ShieldCheck className="w-4 h-4 text-blue-600 flex-shrink-0" />
                      <div>
                        <div className="font-bold text-slate-900">Km 28.4 — Atal Tunnel South Portal PCR Van Unit 2</div>
                        <div className="text-[11px] text-slate-600">24/7 Patrol Unit stationed with Medical First Aid</div>
                      </div>
                    </div>
                  </div>

                  {/* Avoided Hazard Warning */}
                  <div className="p-3 bg-red-100 rounded-xl border border-red-300 text-xs text-red-900 font-medium">
                    ⚠️ <strong>Hazard Avoided:</strong> Old Rohtang Pass road has been routed around due to active rockfall warning at Marhi curve.
                  </div>
                </div>
              </div>

            </div>
          )}

        </div>
      )}

      {/* ========================================================= */}
      {/* FLOATING EMERGENCY CONTACTS QUICK DRAWER BUTTON */}
      {/* ========================================================= */}
      {authenticatedUser && (
        <div className="fixed bottom-4 left-4 z-40">
          <button
            onClick={() => setShowContactsDrawer(!showContactsDrawer)}
            className="px-4 py-3 rounded-2xl bg-[#0B2447] text-white text-xs font-black shadow-2xl border-2 border-[#FF9933] hover:bg-[#071933] transition flex items-center gap-2"
          >
            <Phone className="w-4 h-4 text-[#FF9933] animate-pulse" />
            <span>Emergency Hotlines</span>
            <ChevronUp className={`w-4 h-4 transition-transform ${showContactsDrawer ? 'rotate-180' : ''}`} />
          </button>
        </div>
      )}

      {/* EMERGENCY CONTACTS SLIDE-UP DRAWER */}
      {showContactsDrawer && (
        <div className="fixed bottom-20 left-4 right-4 sm:left-6 sm:right-auto sm:w-96 z-40 bg-white border-2 border-[#0B2447] rounded-3xl p-5 shadow-2xl space-y-4 text-left animate-fade-in">
          <div className="flex items-center justify-between pb-2 border-b border-slate-200">
            <h4 className="text-sm font-black text-[#0B2447] flex items-center gap-2">
              <PhoneCall className="w-4 h-4 text-red-600" />
              <span>Government Emergency Hotlines</span>
            </h4>
            <button onClick={() => setShowContactsDrawer(false)} className="p-1 rounded hover:bg-slate-100">
              <X className="w-4 h-4 text-slate-500" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs font-bold">
            <a href="tel:112" className="p-2.5 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl flex items-center space-x-2 text-red-900 transition">
              <span className="w-6 h-6 rounded bg-red-600 text-white font-black flex items-center justify-center text-[10px]">112</span>
              <span>National Emergency</span>
            </a>
            <a href="tel:100" className="p-2.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-xl flex items-center space-x-2 text-blue-900 transition">
              <span className="w-6 h-6 rounded bg-blue-600 text-white font-black flex items-center justify-center text-[10px]">100</span>
              <span>Police Control</span>
            </a>
            <a href="tel:108" className="p-2.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl flex items-center space-x-2 text-emerald-900 transition">
              <span className="w-6 h-6 rounded bg-emerald-600 text-white font-black flex items-center justify-center text-[10px]">108</span>
              <span>Ambulance</span>
            </a>
            <a href="tel:1363" className="p-2.5 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl flex items-center space-x-2 text-amber-900 transition">
              <span className="w-6 h-6 rounded bg-[#FF9933] text-white font-black flex items-center justify-center text-[10px]">1363</span>
              <span>Tourist Helpline</span>
            </a>
            <a href="tel:1091" className="p-2.5 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-xl flex items-center space-x-2 text-purple-900 transition">
              <span className="w-6 h-6 rounded bg-purple-600 text-white font-black flex items-center justify-center text-[10px]">1091</span>
              <span>Women Helpline</span>
            </a>
            <a href="tel:1070" className="p-2.5 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-xl flex items-center space-x-2 text-slate-900 transition">
              <span className="w-6 h-6 rounded bg-slate-800 text-white font-black flex items-center justify-center text-[10px]">1070</span>
              <span>Disaster Control</span>
            </a>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* FLOATING AI SAFETY ASSISTANT CHATBOT WIDGET */}
      {/* ========================================================= */}
      {authenticatedUser && (
        <div className="fixed bottom-4 right-4 z-40">
          {!chatOpen ? (
            <button
              onClick={() => setChatOpen(true)}
              className="p-4 rounded-full bg-[#138808] text-white shadow-2xl hover:bg-emerald-800 transition flex items-center gap-2 border-2 border-white cursor-pointer"
            >
              <MessageSquare className="w-6 h-6 text-white" />
              <span className="hidden sm:inline text-xs font-black">AI Safety Assistant</span>
            </button>
          ) : (
            <div className="w-80 sm:w-96 bg-white border-2 border-[#138808] rounded-3xl shadow-2xl overflow-hidden flex flex-col h-96 text-left animate-fade-in">
              
              {/* Chat Header */}
              <div className="bg-[#138808] text-white p-3.5 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white">
                    <ShieldCheck className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h4 className="text-xs font-black">Suraksha AI Assistant</h4>
                    <p className="text-[10px] text-emerald-100">Live Travel Safety Query Engine</p>
                  </div>
                </div>

                <button onClick={() => setChatOpen(false)} className="p-1 rounded hover:bg-white/10 text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Chat Messages Body */}
              <div className="flex-1 p-3 overflow-y-auto space-y-3 bg-slate-50 text-xs">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
                  >
                    <div
                      className={`max-w-[85%] p-3 rounded-2xl shadow-sm leading-relaxed whitespace-pre-line ${
                        msg.sender === 'user'
                          ? 'bg-[#0B2447] text-white rounded-tr-none'
                          : 'bg-white text-slate-800 border border-slate-200 rounded-tl-none'
                      }`}
                    >
                      {msg.text}
                    </div>

                    <span className="text-[9px] text-slate-400 mt-0.5 px-1 font-mono">
                      {msg.timestamp}
                    </span>

                    {/* Quick Action Chips */}
                    {msg.quickActions && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {msg.quickActions.map((qa, i) => (
                          <button
                            key={i}
                            onClick={() => handleSendMessage(qa)}
                            className="text-[10px] bg-emerald-100 text-emerald-900 border border-emerald-300 font-bold px-2 py-1 rounded-lg hover:bg-emerald-200 transition"
                          >
                            {qa}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Chat Input Bar */}
              <div className="p-2 bg-white border-t border-slate-200 flex items-center gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                  placeholder="Ask AI safety tip, weather, or routes..."
                  className="flex-1 px-3 py-2 rounded-xl bg-slate-100 text-slate-900 text-xs font-medium focus:outline-none focus:bg-white focus:ring-1 focus:ring-[#138808]"
                />
                <button
                  onClick={() => handleSendMessage()}
                  className="p-2.5 rounded-xl bg-[#138808] hover:bg-emerald-800 text-white transition"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>

            </div>
          )}
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: REAL-TIME BROADCAST ALERT POPUP LISTENER */}
      {/* ========================================================= */}
      {activeBroadcastModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-red-900/60 backdrop-blur-md animate-fade-in">
          <div className="bg-white border-4 border-red-600 rounded-3xl max-w-md w-full p-6 shadow-2xl relative text-left my-6 animate-bounce-short">
            
            <div className="w-14 h-14 rounded-2xl bg-red-100 border-2 border-red-600 flex items-center justify-center text-red-600 mb-4 mx-auto shadow-lg">
              <AlertCircle className="w-8 h-8 text-red-600" />
            </div>

            <div className="text-center space-y-2">
              <span className="px-3 py-1 rounded-full bg-red-600 text-white text-[10px] font-black uppercase tracking-widest">
                GEOFENCED BROADCAST ALERT
              </span>
              <h3 className="text-lg font-black text-red-900">
                {language === 'hi' ? activeBroadcastModal.titleHi : activeBroadcastModal.titleEn}
              </h3>
              <p className="text-xs text-slate-700 font-medium leading-relaxed bg-red-50 p-3 rounded-xl border border-red-200">
                {language === 'hi' ? activeBroadcastModal.bodyHi : activeBroadcastModal.bodyEn}
              </p>
            </div>

            <div className="mt-4 text-[10px] text-slate-500 font-mono text-center">
              Source: {activeBroadcastModal.senderBadge} • Radius: {activeBroadcastModal.radiusKm} km
            </div>

            <button
              onClick={() => setActiveBroadcastModal(null)}
              className="mt-5 w-full py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-black text-xs transition shadow-lg"
            >
              Acknowledge Alert
            </button>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODAL: ADD ITINERARY ITEM */}
      {/* ========================================================= */}
      {showAddItineraryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white border-2 border-[#0B2447] rounded-3xl max-w-md w-full p-6 shadow-2xl relative text-left">
            <button
              onClick={() => setShowAddItineraryModal(false)}
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-slate-100 text-slate-500"
            >
              <X className="w-5 h-5" />
            </button>

            <h3 className="text-lg font-black text-[#0B2447] mb-4 flex items-center gap-2">
              <Plus className="w-5 h-5 text-[#FF9933]" />
              <span>Add Destination to Itinerary</span>
            </h3>

            <form onSubmit={handleAddItinerary} className="space-y-4">
              <div>
                <label className="block text-xs font-extrabold text-slate-700 mb-1">
                  Destination Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={newDest}
                  onChange={(e) => setNewDest(e.target.value)}
                  placeholder="e.g. Rohtang Glacier Pass or Dharamshala"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-300 text-slate-900 text-xs font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-extrabold text-slate-700 mb-1">
                  Travel Date
                </label>
                <input
                  type="date"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-300 text-slate-900 text-xs font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-extrabold text-slate-700 mb-1">
                  Hotel / Accommodation
                </label>
                <input
                  type="text"
                  value={newHotel}
                  onChange={(e) => setNewHotel(e.target.value)}
                  placeholder="e.g. Grand Himalayan Lodge"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-300 text-slate-900 text-xs font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-extrabold text-slate-700 mb-1">
                  Activities & Travel Notes
                </label>
                <input
                  type="text"
                  value={newActivities}
                  onChange={(e) => setNewActivities(e.target.value)}
                  placeholder="e.g. Hiking, Cable car ride"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-300 text-slate-900 text-xs font-bold"
                />
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  className="w-full py-3 rounded-xl bg-[#0B2447] hover:bg-[#071933] text-white font-black text-xs shadow-md"
                >
                  Save & AI Safety Check
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 1: DIGILOCKER E-KYC CONNECT MODAL */}
      {showDigiLockerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white border-2 border-[#138808] rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl relative text-left">
            <button
              onClick={() => setShowDigiLockerModal(false)}
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-slate-100 text-slate-500"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-3 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-[#138808] flex items-center justify-center text-[#138808] shadow-sm">
                <FileCheck className="w-7 h-7 text-[#138808]" />
              </div>
              <div>
                <h3 className="text-xl font-black text-slate-900">
                  DigiLocker Identity OAuth
                </h3>
                <p className="text-xs text-slate-500 font-medium">
                  Government of India National e-Governance Division (NeGD)
                </p>
              </div>
            </div>

            {digiLockerStep === 'connect' && (
              <div className="space-y-4">
                <p className="text-xs text-slate-600 leading-relaxed font-medium">
                  By clicking below, you grant Suraksha Setu one-time OAuth consent to retrieve your verified e-KYC credentials.
                </p>

                <button
                  onClick={handleConnectDigiLocker}
                  className="w-full py-3.5 rounded-xl bg-[#138808] hover:bg-emerald-800 text-white font-black text-sm transition shadow-lg flex items-center justify-center gap-2"
                >
                  <ExternalLink className="w-4 h-4" />
                  <span>Authenticate & Fetch DigiLocker Records</span>
                </button>
              </div>
            )}

            {digiLockerStep === 'loading' && (
              <div className="py-12 text-center space-y-4">
                <RefreshCw className="w-10 h-10 text-[#138808] animate-spin mx-auto" />
                <p className="text-sm font-bold text-slate-800">
                  Connecting to Government DigiLocker Identity Vault...
                </p>
              </div>
            )}

            {digiLockerStep === 'fetched' && (
              <div className="space-y-5 animate-fade-in">
                <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-300 flex items-center space-x-4">
                  <img
                    src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=300"
                    alt="Verified Photo"
                    className="w-16 h-16 rounded-2xl object-cover border-2 border-[#138808]"
                  />
                  <div>
                    <div className="px-2 py-0.5 rounded bg-[#138808] text-white text-[10px] font-black inline-block mb-1">
                      DIGILOCKER VERIFIED E-KYC
                    </div>
                    <div className="text-sm font-extrabold text-slate-900">{fullName || 'Tourist'}</div>
                    <div className="text-xs text-slate-600 font-mono">Aadhaar No: XXXX-XXXX-4912</div>
                  </div>
                </div>

                <button
                  onClick={handleConfirmDigiLocker}
                  className="w-full py-3.5 rounded-xl bg-[#0B2447] hover:bg-[#071933] text-white font-black text-sm transition shadow-lg"
                >
                  Attach Verified DigiLocker Badge
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL 2: OTP MODAL */}
      {showOtpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white border-2 border-[#0B2447] rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-2xl relative text-left">
            <button
              onClick={() => setShowOtpModal(false)}
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-slate-100 text-slate-500"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-3 mb-6">
              <div className="w-12 h-12 rounded-2xl bg-amber-100 border border-[#FF9933] flex items-center justify-center text-[#0B2447]">
                <Smartphone className="w-7 h-7 text-[#0B2447]" />
              </div>
              <div>
                <h3 className="text-xl font-black text-slate-900">{t.otpModalTitle}</h3>
                <p className="text-xs text-slate-500 font-medium">
                  {t.otpModalSub} <strong className="text-slate-900">{otpPendingAction === 'signup' ? phone : signinPhone}</strong>
                </p>
              </div>
            </div>

            <form onSubmit={handleVerifyOtp} className="space-y-5">
              {otpError && (
                <div className="p-3 bg-red-50 border border-red-300 text-red-800 text-xs rounded-xl font-bold">
                  {otpError}
                </div>
              )}

              <div>
                <label className="block text-xs font-extrabold text-slate-700 mb-1">
                  6-Digit Verification Code
                </label>
                <input
                  type="text"
                  maxLength={6}
                  value={otpValue}
                  onChange={(e) => setOtpValue(e.target.value)}
                  placeholder="654321"
                  className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-300 text-center font-mono text-2xl tracking-[0.4em] font-black focus:outline-none focus:bg-white focus:ring-2 focus:ring-[#138808]"
                />
              </div>

              <button
                type="submit"
                className="w-full py-3.5 rounded-xl bg-[#0B2447] hover:bg-[#071933] text-white font-black text-sm transition shadow-lg flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="w-5 h-5 text-[#FF9933]" />
                <span>{t.verifyOtpBtn}</span>
              </button>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: DIGITAL PASS MODAL */}
      {showDigitalPassModal && authenticatedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
          <div className="bg-white border-2 border-[#138808] rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl relative text-left my-8">
            <button
              onClick={() => setShowDigitalPassModal(false)}
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-slate-100 text-slate-500"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="border-b border-slate-200 pb-4 mb-5 text-center">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-[#138808] text-[11px] font-black uppercase mb-2">
                <ShieldCheck className="w-4 h-4" />
                <span>Suraksha Setu • Government Official Pass</span>
              </div>
              <h3 className="text-xl font-black text-[#0B2447]">
                Digital Tourist Safety Pass
              </h3>
            </div>

            <div className="p-5 bg-gradient-to-br from-slate-900 via-[#0B2447] to-slate-900 text-white rounded-2xl shadow-xl relative overflow-hidden border-2 border-[#FF9933]/50">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center space-x-3">
                  <img
                    src={authenticatedUser.photoUrl}
                    alt={authenticatedUser.name}
                    className="w-16 h-16 rounded-2xl object-cover border-2 border-[#FF9933]"
                  />
                  <div>
                    <div className="text-xs text-[#FF9933] font-bold uppercase tracking-wider">Verified Traveler</div>
                    <div className="text-lg font-black text-white">{authenticatedUser.name}</div>
                    <div className="text-xs text-slate-300 font-mono mt-0.5">{authenticatedUser.phone}</div>
                  </div>
                </div>

                <div className="bg-white p-2 rounded-xl text-slate-900 flex flex-col items-center flex-shrink-0 shadow">
                  <QrCode className="w-12 h-12 text-[#0B2447]" />
                  <span className="text-[8px] font-mono font-bold mt-1 text-slate-600">SCAN FOR POLICE</span>
                </div>
              </div>

              <div className="mt-5 p-3 bg-white/10 backdrop-blur rounded-xl border border-white/20 flex items-center justify-between">
                <div>
                  <div className="text-[10px] text-slate-300 font-bold uppercase">Official Tourist ID</div>
                  <div className="text-xl font-mono font-black text-[#FF9933] tracking-wider">{authenticatedUser.id}</div>
                </div>

                <button
                  type="button"
                  onClick={() => handleCopyTouristId(authenticatedUser.id)}
                  className="px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-white text-xs font-bold transition flex items-center gap-1.5"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{copySuccess ? 'Copied!' : 'Copy ID'}</span>
                </button>
              </div>
            </div>

            <div className="mt-6 space-y-3">
              {downloadSuccess && (
                <div className="p-2.5 bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs font-bold rounded-xl text-center">
                  ✅ Digital Pass PDF downloaded to your device!
                </div>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleDownloadPass}
                  className="flex-1 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-900 font-extrabold text-xs transition border border-slate-300 flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4 text-[#0B2447]" />
                  <span>Download Pass</span>
                </button>

                <button
                  type="button"
                  onClick={handlePassModalProceed}
                  className="flex-1 py-3 rounded-xl bg-[#138808] hover:bg-emerald-800 text-white font-black text-xs transition shadow-md flex items-center justify-center gap-2"
                >
                  <span>Activate Trip & Consent</span>
                  <ArrowLeft className="w-4 h-4 rotate-180 text-[#FF9933]" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: MANDATORY CONSENT MODAL */}
      {showConsentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-md animate-fade-in">
          <div className="bg-white border-4 border-[#138808] rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl relative text-left my-6">
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 border-2 border-[#138808] flex items-center justify-center text-[#138808] mb-5 shadow-md">
              <Navigation className="w-8 h-8 text-[#138808] animate-pulse" />
            </div>

            <div className="space-y-3 mb-6">
              <span className="px-3 py-1 rounded-full bg-emerald-100 text-[#138808] text-[10px] font-black uppercase">
                {t.consentModalSub}
              </span>
              <h3 className="text-xl font-black text-slate-900 leading-tight">
                {t.consentModalTitle}
              </h3>
              <p className="text-xs text-slate-600 font-medium leading-relaxed bg-slate-50 p-4 rounded-2xl border border-slate-200">
                {t.consentModalDesc}
              </p>
            </div>

            <div className="space-y-3">
              <button
                type="button"
                onClick={handleGrantConsent}
                className="w-full py-4 rounded-2xl bg-[#138808] hover:bg-emerald-800 text-white font-black text-sm transition shadow-xl flex items-center justify-center gap-2"
              >
                <CheckCircle2 className="w-5 h-5 text-[#FF9933]" />
                <span>{t.consentEnableBtn}</span>
              </button>

              <button
                type="button"
                onClick={handleDeclineConsent}
                className="w-full py-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition border border-slate-300"
              >
                {t.consentDeclineBtn}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 5: TOURIST PROFILE MODAL */}
      {showProfileModal && authenticatedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
          <div className="bg-white border-2 border-[#0B2447] rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl relative text-left my-8 space-y-5">
            <button
              onClick={() => setShowProfileModal(false)}
              className="absolute top-4 right-4 p-2 rounded-full hover:bg-slate-100 text-slate-500 font-bold transition"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-3 pb-4 border-b border-slate-200">
              <img
                src={authenticatedUser.photoUrl}
                alt={authenticatedUser.name}
                className="w-14 h-14 rounded-2xl object-cover border-2 border-[#138808] shadow-md flex-shrink-0"
              />
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-xl font-black text-slate-900">
                    {authenticatedUser.name}
                  </h3>
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-[#138808] border border-emerald-300 font-mono text-[10px] font-black">
                    {authenticatedUser.id}
                  </span>
                </div>
                <div className="text-xs text-slate-500 font-medium mt-0.5">{authenticatedUser.phone}</div>
                {authenticatedUser.digiLockerVerified && (
                  <span className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-100 text-blue-800 text-[10px] font-bold border border-blue-200">
                    <ShieldCheck className="w-3 h-3 text-blue-600" /> DigiLocker e-KYC Verified
                  </span>
                )}
              </div>
            </div>

            {/* Details Grid */}
            <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 p-4 rounded-2xl border border-slate-200">
              <div>
                <span className="text-[10px] font-extrabold text-slate-500 uppercase">Digital Band ID</span>
                <div className="font-mono font-black text-slate-900 text-sm mt-0.5">{authenticatedUser.digitalBandId}</div>
              </div>
              <div>
                <span className="text-[10px] font-extrabold text-slate-500 uppercase">Nationality / Origin</span>
                <div className="font-bold text-slate-900 text-xs mt-0.5">{authenticatedUser.nationality}</div>
              </div>
              <div>
                <span className="text-[10px] font-extrabold text-slate-500 uppercase">Emergency Contact</span>
                <div className="font-bold text-slate-900 text-xs mt-0.5">{authenticatedUser.emergencyContact}</div>
              </div>
              <div>
                <span className="text-[10px] font-extrabold text-slate-500 uppercase">Trip Status</span>
                <div className="font-bold text-slate-900 text-xs mt-0.5">Active Verified Tour</div>
              </div>
            </div>

            {/* GPS Telemetry Consent Status */}
            <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
              <div className="text-[10px] font-extrabold text-slate-500 uppercase">Location & Safety Telemetry</div>
              <div className="flex items-center justify-between">
                {locationConsent === 'granted' ? (
                  <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-[#138808] border border-emerald-300 text-xs font-extrabold flex items-center gap-1.5">
                    <Radio className="w-3.5 h-3.5 text-[#138808] animate-pulse" />
                    <span>GPS Telemetry ACTIVE</span>
                  </span>
                ) : (
                  <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-900 border border-amber-300 text-xs font-extrabold flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                    <span>Location Access DECLINED</span>
                  </span>
                )}
                <button
                  onClick={() => {
                    setShowProfileModal(false);
                    setShowConsentModal(true);
                  }}
                  className="text-xs font-black text-blue-700 hover:underline"
                >
                  Configure
                </button>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="space-y-2.5 pt-2">
              <button
                onClick={() => {
                  setShowProfileModal(false);
                  setShowDigitalPassModal(true);
                }}
                className="w-full py-3 px-4 bg-[#0B2447] hover:bg-[#071933] text-white font-extrabold text-xs rounded-xl shadow transition flex items-center justify-center gap-2"
              >
                <QrCode className="w-4 h-4 text-[#FF9933]" />
                <span>View Digital Safety Pass & QR Code</span>
              </button>

              <button
                onClick={handleTriggerSimulatedAlert}
                className="w-full py-2.5 px-4 bg-amber-50 hover:bg-amber-100 text-amber-900 font-extrabold text-xs rounded-xl border border-amber-300 transition flex items-center justify-center gap-2"
              >
                <Bell className="w-4 h-4 text-[#FF9933] animate-bounce" />
                <span>Test Broadcast Alert Simulation</span>
              </button>

              <button
                onClick={() => {
                  setShowProfileModal(false);
                  handleSignOut();
                }}
                className="w-full py-2.5 px-4 bg-red-50 hover:bg-red-100 text-red-800 font-bold text-xs rounded-xl border border-red-200 transition flex items-center gap-2 justify-center"
              >
                <LogOut className="w-4 h-4 text-red-600" />
                <span>Sign Out Account</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
```

### `frontend/src/data/i18n.ts`

```typescript
import { Language } from '../types';

export const i18n = {
  en: {
    // Top Bar & Branding
    nationalPortalName: 'SURAKSHA SETU',
    nationalPortalSub: 'Tourist Safety & AI Predictive Emergency Portal',
    stateGovt: 'Suraksha Setu • Ministry of Home & Tourism',
    officerTitle: 'Chief Safety Controller',
    officerName: 'Rajesh Kumar, IPS',
    languageLabel: 'Language / भाषा',
    liveTicker: '⚡ LIVE STATUS: 3 Active SOS Beacons • 14 Patrolling Responders Online • AI Anomaly Engine: NORMAL (22% Risk)',
    searchPlaceholder: 'Global Search Tourist ID / Incident / Patrol Unit...',
    
    // Gateway & Roles
    gatewayTitle: 'SURAKSHA SETU Safety Command Gateway',
    gatewaySub: 'Integrated emergency response, AI threat prediction, and tourist safety monitoring ecosystem.',
    selectRoleTitle: 'Select Access Portal',
    forTouristsTitle: 'For Tourists & Travelers',
    forTouristsDesc: 'Public mobile safety web app with instant emergency SOS panic trigger, live safety beacon, and regional helplines.',
    enterTouristPortal: 'Launch Tourist Safety Web App',
    
    forAuthoritiesTitle: 'For Authorized Personnel',
    forAuthoritiesDesc: 'Command Center access for IPS officers, state police, and disaster response teams. Requires MFA verification.',
    enterAuthorityPortal: 'Authenticate as Authority',
    
    mfaModalTitle: 'Authority MFA Security Verification',
    mfaBadgeIdLabel: 'Officer Badge ID / IPS No.',
    mfaOtpLabel: '2FA Auth Code / OTP',
    mfaVerifyBtn: 'Verify Identity & Enter Command Dashboard',
    mfaDemoNote: 'Enter your officer Badge ID and the OTP sent to your registered device.',
    
    // Navigation Modules
    modAiHub: 'AI Anomaly & Prediction Hub',
    modTouristTracking: 'Tourist Detail Tracking',
    modSosMap: 'SOS Alert & Command Map',
    modBroadcast: 'Broadcast & Geofenced Alerts',
    modAnalyticsAudit: 'Audit Logs & Analytics',
    
    // Module 1: AI Anomaly
    highRiskHeatmap: 'High-Risk Zones & Heatmap Intelligence',
    incidentClusters: 'AI Incident Anomaly Clusters',
    contextualAnalysis: 'AI Contextual Stream & Threat Metrics',
    predictiveTracking: 'Continuous Predictive Anomaly Feed',
    riskScore: 'AI Threat Index',
    touristDensity: 'Active Density',
    confidenceLevel: 'Model Confidence',
    anomalyType: 'Anomaly Type',
    investigateBtn: 'Investigate Zone & Tourists',
    viewInMap: 'View on GIS Command Map',
    
    // Module 2: Tourist Tracking
    touristSearchTitle: 'Tourist ID Verification & Live Lookup',
    touristSearchSub: 'Enter official Tourist ID (e.g., TR-88219) or digital safety band number.',
    searchBtn: 'Execute Lookup',
    interceptionTitle: 'Mandatory Interception & Privacy Mandate',
    interceptionDesc: 'Under statutory safety protocols, accessing personal telemetry and live location of citizens or visitors requires a logged legal justification.',
    selectReasonLabel: 'Select Mandatory Search Reason',
    reasonActiveSos: 'Active SOS Response',
    reasonMissing: 'Filed Missing Person Report',
    reasonRoutine: 'Designated Check-in Routine',
    reasonWarrant: 'Judicial / Legal Warrant',
    officerNotesLabel: 'Officer Case Notes / Dispatch Ref (Optional)',
    confirmAccessBtn: 'Confirm & View Telemetry Profile',
    cancelBtn: 'Cancel Request',
    
    // Tourist Profile Card
    profileTitle: 'Tourist Safety Profile',
    passportNo: 'Passport / ID Hash',
    nationality: 'Nationality / Origin',
    phoneNo: 'Registered Mobile',
    emergencyContact: 'Emergency Contact',
    hotelStay: 'Hotel / Stay Location',
    batteryStatus: 'Safety Band Battery',
    safetyStatus: 'Current Safety Status',
    liveLocation: 'Real-Time Location Coordinate',
    sosHistory: 'Past SOS & Incident Records',
    dispatchToTourist: 'Dispatch Patrol Unit to Location',
    sendDirectMsg: 'Send Priority SMS Alert',
    markSafeBtn: 'Mark Tourist as Safe',
    
    // Module 3: SOS Command Map
    gisMapTitle: 'Real-Time GIS Command Map',
    layersLabel: 'Toggle Map Layers:',
    layerSosBeacons: 'Active SOS Beacons',
    layerResponders: 'Patrolling Units',
    layerStations: 'Police Stations & Safe Havens',
    layerHospitals: 'Hospitals & Medical Care',
    layerHeatmap: 'AI Threat Heatmap',
    
    kanbanTitle: 'Incident Lifecycle Ticketing System',
    kanbanNew: 'New SOS Alerts',
    kanbanDispatched: 'Units Dispatched',
    kanbanResolved: 'Resolved & Safe',
    dispatchUnitBtn: 'Dispatch PCR Unit',
    markResolvedBtn: 'Resolve Incident',
    addMockSosBtn: '+ Simulate Incoming SOS Emergency',
    
    // Module 4: Broadcast & Geofence
    broadcastTitle: 'Geofenced Emergency Broadcast Centre',
    broadcastSub: 'Draft and push targeted emergency SMS and app alerts to all travelers in specific high-risk radiuses.',
    selectRegion: 'Target Zone / Administrative Division',
    radiusKm: 'Geofence Radius (km)',
    severityLabel: 'Alert Severity Level',
    titleEnLabel: 'Alert Title (English)',
    titleHiLabel: 'Alert Title (Hindi / हिंदी)',
    bodyEnLabel: 'Alert Message Body (English)',
    bodyHiLabel: 'Alert Message Body (Hindi / हिंदी)',
    estimatedRecipients: 'Estimated Target Audience in Selected Geofence',
    quickTemplates: 'Load Emergency Template:',
    templateWeather: 'Extreme Weather / Flash Flood',
    templateHeatwave: 'Severe Heatwave Alert',
    templateUnsafe: 'Unsafe Mountain Pass / Landslide',
    sendBroadcastBtn: '🚀 Push Geofenced Alert Now',
    broadcastHistoryTitle: 'Recent Broadcast Log & Delivery Telemetry',
    
    // Audit & Analytics
    auditLogsTitle: 'Authority Access & Audit Trail',
    auditLogsDesc: 'Immutable system log tracking officer search justifications, SOS dispatches, and emergency broadcasts.',
    exportCsvBtn: 'Export Audit Logs (CSV)',
    colTimestamp: 'Timestamp',
    colOfficer: 'Officer / Badge ID',
    colAction: 'Action Taken',
    colTarget: 'Target ID',
    colReason: 'Mandatory Reason',
    colIp: 'IP / Terminal',
    
    performanceTitle: 'Response Performance & Zone Analytics',
    avgResponseTime: 'Avg Emergency Response Time',
    resolutionRate: 'Incident Resolution Rate',
    frequentZones: 'Frequent Incident Zones Breakdown',
    inflowVsRisk: 'Tourist Inflow vs Risk Trend',
    
    // Tourist Public Portal
    touristPortalTitle: 'National Tourist Safety Portal',
    touristPortalSub: 'Official emergency beacon & safety companion for travelers in India.',
    sosPanicBtnText: 'EMERGENCY SOS',
    sosHoldInstruction: 'Tap to trigger immediate SOS beacon to nearest Police Command Center.',
    sosCancelTimer: 'SOS Activating in',
    sosActiveNotice: '🚨 SOS BEACON ACTIVE! Patrol Unit PCR-04 dispatched to your GPS coordinates.',
    hotlinesTitle: 'National Emergency Hotlines',
    safeHavensNearby: 'Nearby Safe Havens & Police Posts',
    currentAddress: 'Your GPS Location',
    locationAccuracy: 'GPS Accuracy',
    switchGatewayBtn: 'Return to Entry Gateway',
    logoutBtn: 'Logout Officer',

    // Tourist Auth & Onboarding Flow
    authSignUpTab: 'Sign Up (New Tourist)',
    authSignInTab: 'Sign In & Trip Activation',
    signUpTitle: 'Tourist Safety Registration',
    signUpSub: 'Create your official Suraksha Setu Digital Tourist Pass with instant DigiLocker e-KYC verification.',
    signInTitle: 'Activate Trip / Sign In',
    signInSub: 'Enter your unique Tourist ID (e.g. TR-2026-8942) and registered phone number to activate safety session.',
    fullNameLabel: 'Full Name (as per Govt ID)',
    phoneLabel: 'Mobile Phone Number',
    emailLabel: 'Email Address',
    emergencyContactLabel: 'Emergency Contact Full Name',
    emergencyRelationLabel: 'Relationship to Contact',
    emergencyPhoneLabel: 'Emergency Contact Mobile',
    connectDigiLockerBtn: 'Connect with DigiLocker (e-KYC)',
    digiLockerVerifiedBadge: 'DigiLocker e-KYC Verified',
    sendOtpBtn: 'Send Mobile OTP',
    otpModalTitle: 'Mobile Number OTP Verification',
    otpModalSub: 'Enter 6-digit verification code sent to',
    verifyOtpBtn: 'Verify OTP & Generate Tourist ID',
    digitalPassTitle: 'Suraksha Setu Digital Tourist Safety Pass',
    touristIdLabel: 'Unique Tourist ID',
    copyIdBtn: 'Copy Tourist ID',
    downloadPassBtn: 'Download Digital Pass',
    proceedToConsentBtn: 'Proceed to Activate Trip & Location Consent',
    consentModalTitle: 'Mandatory Safety Permission: Grant Live Location Access',
    consentModalSub: 'Suraksha Setu Civil Protection & Emergency Response Protocol',
    consentModalDesc: 'To enable 1-tap SOS panic triggers, AI geofenced hazard alerts, and real-time police dispatch during emergencies in remote or high-altitude zones, Suraksha Setu requests continuous encrypted live location tracking for your trip duration.',
    consentEnableBtn: 'Enable Live Location Access & Start Trip',
    consentDeclineBtn: 'Decline (Standard Manual SOS Only)',

    // Dashboard Tabs & Modules
    tabOverview: 'Safety Status',
    tabItinerary: 'Itinerary Planner',
    tabHeatmap: 'Safety Heatmap',
    tabRouteFinder: 'Route Finder Map',
    chatbotTitle: 'Suraksha AI Safety Assistant',
    quickContactsBtn: 'Emergency Hotlines Drawer',
    broadcastAlertTitle: 'Geofenced Safety Advisory Broadcast',
    simulateBroadcastBtn: 'Simulate Live Area Broadcast Test'
  },
  
  hi: {
    // Top Bar & Branding
    nationalPortalName: 'सुरक्षा सेतु',
    nationalPortalSub: 'पर्यटक सुरक्षा एवं एआई पूर्वानुमानित आपातकालीन पोर्टल',
    stateGovt: 'सुरक्षा सेतु • गृह एवं पर्यटन मंत्रालय',
    officerTitle: 'मुख्य सुरक्षा नियंत्रक',
    officerName: 'राजेश कुमार, आईपीएस',
    languageLabel: 'भाषा / Language',
    liveTicker: '⚡ लाइव स्थिति: 3 सक्रिय एसओएस बीकन • 14 गश्ती दल ऑनलाइन • एआई विसंगति इंजन: सामान्य (22% जोखिम)',
    searchPlaceholder: 'ग्लोबल खोज: पर्यटक आईडी / घटना / गश्ती इकाई...',
    
    // Gateway & Roles
    gatewayTitle: 'सुरक्षा सेतु सुरक्षा कमान प्रवेश द्वार',
    gatewaySub: 'एकीकृत आपातकालीन प्रतिक्रिया, एआई खतरा पूर्वानुमान और पर्यटक सुरक्षा निगरानी पारिस्थितिकी तंत्र।',
    selectRoleTitle: 'प्रवेश पोर्टल चुनें',
    forTouristsTitle: 'पर्यटकों और यात्रियों के लिए',
    forTouristsDesc: 'तत्काल आपातकालीन एसओएस पैनिक बटन, लाइव सुरक्षा बीकन और क्षेत्रीय हेल्पलाइन के साथ सार्वजनिक मोबाइल सुरक्षा ऐप।',
    enterTouristPortal: 'पर्यटक सुरक्षा ऐप खोलें',
    
    forAuthoritiesTitle: 'प्राधिकृत अधिकारियों के लिए',
    forAuthoritiesDesc: 'आईपीएस अधिकारियों, राज्य पुलिस और आपदा प्रतिक्रिया टीमों के लिए कमान केंद्र। एमएफए सत्यापन आवश्यक है।',
    enterAuthorityPortal: 'अधिकारी के रूप में सत्यापित करें',
    
    mfaModalTitle: 'प्राधिकरण एमएफए सुरक्षा सत्यापन',
    mfaBadgeIdLabel: 'अधिकारी बैज आईडी / आईपीएस संख्या',
    mfaOtpLabel: '2FA प्रमाणन कोड / ओटीपी',
    mfaVerifyBtn: 'पहचान सत्यापित करें और कमान केंद्र में प्रवेश करें',
    mfaDemoNote: 'अपनी अधिकारी बैज आईडी और अपने पंजीकृत डिवाइस पर भेजा गया ओटीपी दर्ज करें।',
    
    // Navigation Modules
    modAiHub: 'एआई विसंगति एवं पूर्वानुमान केंद्र',
    modTouristTracking: 'पर्यटक विवरण और ट्रैकिंग',
    modSosMap: 'एसओएस चेतावनी एवं कमान नक्शा',
    modBroadcast: 'प्रसारण और जियोफेन्स्ड अलर्ट',
    modAnalyticsAudit: 'ऑडिट लॉग और विश्लेषिकी',
    
    // Module 1: AI Anomaly
    highRiskHeatmap: 'उच्च जोखिम वाले क्षेत्र और हीटमैप इंटेलिजेंस',
    incidentClusters: 'एआई घटना विसंगति क्लस्टर',
    contextualAnalysis: 'एआई संदर्भ धारा और खतरा मेट्रिक्स',
    predictiveTracking: 'सतत पूर्वानुमानित विसंगति फीड',
    riskScore: 'एआई खतरा सूचकांक',
    touristDensity: 'सक्रिय घनत्व',
    confidenceLevel: 'मॉडल विश्वसनीयता',
    anomalyType: 'विसंगति प्रकार',
    investigateBtn: 'क्षेत्र और पर्यटकों की जांच करें',
    viewInMap: 'जीआईएस नक्शे पर देखें',
    
    // Module 2: Tourist Tracking
    touristSearchTitle: 'पर्यटक आईडी सत्यापन और लाइव खोज',
    touristSearchSub: 'आधिकारिक पर्यटक आईडी (उदा. TR-88219) या डिजिटल सुरक्षा बैंड संख्या दर्ज करें।',
    searchBtn: 'खोज निष्पादित करें',
    interceptionTitle: 'अनिवार्य इंटरसेप्शन और गोपनीयता जनादेश',
    interceptionDesc: 'वैधानिक सुरक्षा प्रोटोकॉल के तहत, नागरिकों या आगंतुकों के व्यक्तिगत टेलीमेट्री और लाइव स्थान तक पहुंचने के लिए कानूनी औचित्य दर्ज करना अनिवार्य है।',
    selectReasonLabel: 'अनिवार्य खोज कारण चुनें',
    reasonActiveSos: 'सक्रिय एसओएस प्रतिक्रिया (Active SOS Response)',
    reasonMissing: 'गुमशुदा व्यक्ति रिपोर्ट (Filed Missing Person Report)',
    reasonRoutine: 'निर्दिष्ट चेक-इन दिनचर्या (Designated Check-in Routine)',
    reasonWarrant: 'न्यायिक / कानूनी वारंट (Judicial / Legal Warrant)',
    officerNotesLabel: 'अधिकारी केस नोट / प्रेषण संदर्भ (वैकल्पिक)',
    confirmAccessBtn: 'पुष्टि करें और टेलीमेट्री प्रोफ़ाइल देखें',
    cancelBtn: 'अनुरोध रद्द करें',
    
    // Tourist Profile Card
    profileTitle: 'पर्यटक सुरक्षा प्रोफ़ाइल',
    passportNo: 'पासपोर्ट / आईडी हैश',
    nationality: 'राष्ट्रीयता / मूल देश',
    phoneNo: 'पंजीकृत मोबाइल',
    emergencyContact: 'आपातकालीन संपर्क',
    hotelStay: 'होटल / रहने का स्थान',
    batteryStatus: 'सुरक्षा बैंड बैटरी',
    safetyStatus: 'वर्तमान सुरक्षा स्थिति',
    liveLocation: 'वास्तविक समय स्थान निर्देशांक',
    sosHistory: 'अतीत के एसओएस और घटना रिकॉर्ड',
    dispatchToTourist: 'स्थान पर गश्ती इकाई भेजें',
    sendDirectMsg: 'प्राथमिकता एसएमएस अलर्ट भेजें',
    markSafeBtn: 'पर्यटक को सुरक्षित चिह्नित करें',
    
    // Module 3: SOS Command Map
    gisMapTitle: 'वास्तविक समय जीआईएस कमान नक्शा',
    layersLabel: 'मानचित्र परतें टगल करें:',
    layerSosBeacons: 'सक्रिय एसओएस बीकन',
    layerResponders: 'गश्ती प्रतिक्रिया दल',
    layerStations: 'पुलिस स्टेशन और सुरक्षित केंद्र',
    layerHospitals: 'अस्पताल और आपातकालीन चिकित्सा',
    layerHeatmap: 'एआई खतरा हीटमैप',
    
    kanbanTitle: 'घटना जीवनचक्र टिकटिंग प्रणाली',
    kanbanNew: 'नया एसओएस अलर्ट',
    kanbanDispatched: 'दल रवाना किया गया',
    kanbanResolved: 'हल किया गया और सुरक्षित',
    dispatchUnitBtn: 'पीसीआर इकाई भेजें',
    markResolvedBtn: 'घटना का समाधान करें',
    addMockSosBtn: '+ आने वाले एसओएस आपातकाल अनुकरण करें',
    
    // Module 4: Broadcast & Geofence
    broadcastTitle: 'जियोफेन्स्ड आपातकालीन प्रसारण केंद्र',
    broadcastSub: 'विशिष्ट उच्च जोखिम वाले क्षेत्रों में सभी यात्रियों को लक्षित आपातकालीन एसएमएस और ऐप अलर्ट का मसौदा तैयार करें और भेजें।',
    selectRegion: 'लक्षित क्षेत्र / प्रशासनिक प्रभाग',
    radiusKm: 'जियोफेंस त्रिज्या (किमी)',
    severityLabel: 'अलर्ट गंभीरता स्तर',
    titleEnLabel: 'अलर्ट शीर्षक (अंग्रेजी)',
    titleHiLabel: 'अलर्ट शीर्षक (हिंदी)',
    bodyEnLabel: 'अलर्ट संदेश (अंग्रेजी)',
    bodyHiLabel: 'अलर्ट संदेश (हिंदी)',
    estimatedRecipients: 'चयनित जियोफेंस में अनुमानित लक्षित दर्शक',
    quickTemplates: 'आपातकालीन टेम्प्लेट लोड करें:',
    templateWeather: 'खराब मौसम / अचानक बाढ़',
    templateHeatwave: 'अत्यधिक गर्मी का अलर्ट',
    templateUnsafe: 'असुरक्षित पहाड़ी दर्रा / भूस्खलन',
    sendBroadcastBtn: '🚀 जियोफेन्स्ड अलर्ट अभी भेजें',
    broadcastHistoryTitle: 'हाल का प्रसारण लॉग और डिलीवरी टेलीमेट्री',
    
    // Audit & Analytics
    auditLogsTitle: 'प्राधिकरण पहुंच और ऑडिट ट्रेल',
    auditLogsDesc: 'अधिकारी खोज औचित्य, एसओएस प्रेषण और आपातकालीन प्रसारण को ट्रैक करने वाला अपरिवर्तनीय सिस्टम लॉग।',
    exportCsvBtn: 'ऑडिट लॉग निर्यात करें (CSV)',
    colTimestamp: 'समय',
    colOfficer: 'अधिकारी / बैज आईडी',
    colAction: 'की गई कार्रवाई',
    colTarget: 'लक्ष्य आईडी',
    colReason: 'अनिवार्य कारण',
    colIp: 'आईपी / टर्मिनल',
    
    performanceTitle: 'प्रतिक्रिया प्रदर्शन और क्षेत्र विश्लेषिकी',
    avgResponseTime: 'औसत आपातकालीन प्रतिक्रिया समय',
    resolutionRate: 'घटना समाधान दर',
    frequentZones: 'बार-बार होने वाली घटना क्षेत्रों का विवरण',
    inflowVsRisk: 'पर्यटक आगमन बनाम जोखिम प्रवृत्ति',
    
    // Tourist Public Portal
    touristPortalTitle: 'राष्ट्रीय पर्यटक सुरक्षा पोर्टल',
    touristPortalSub: 'भारत में यात्रियों के लिए आधिकारिक आपातकालीन बीकन और सुरक्षा साथी।',
    sosPanicBtnText: 'आपातकालीन एसओएस',
    sosHoldInstruction: 'निकटतम पुलिस कमान केंद्र को तत्काल एसओएस बीकन भेजने के लिए दबाएं।',
    sosCancelTimer: 'एसओएस सक्रिय हो रहा है',
    sosActiveNotice: '🚨 एसओएस बीकन सक्रिय! गश्ती इकाई PCR-04 आपके जीपीएस निर्देशांकों पर भेजी गई है।',
    hotlinesTitle: 'राष्ट्रीय आपातकालीन हेल्पलाइन',
    safeHavensNearby: 'आसपास के सुरक्षित स्थान और पुलिस चौकियां',
    currentAddress: 'आपका जीपीएस स्थान',
    locationAccuracy: 'जीपीएस सटीकता',
    switchGatewayBtn: 'प्रवेश द्वार पर लौटें',
    logoutBtn: 'अधिकारी लॉगआउट',

    // Tourist Auth & Onboarding Flow
    authSignUpTab: 'नया पंजीकरण (साइन अप)',
    authSignInTab: 'साइन इन एवं यात्रा सक्रियण',
    signUpTitle: 'पर्यटक सुरक्षा पंजीकरण',
    signUpSub: 'डिजीलॉकर ई-केवाईसी सत्यापन के साथ अपना आधिकारिक सुरक्षा सेतु डिजिटल पर्यटक पास बनाएं।',
    signInTitle: 'यात्रा सक्रियण / साइन इन',
    signInSub: 'अपनी सुरक्षा सत्र को पुनः आरंभ करने के लिए अपनी अद्वितीय पर्यटक आईडी (उदा. TR-2026-8942) और मोबाइल नंबर दर्ज करें।',
    fullNameLabel: 'पूरा नाम (सरकारी पहचान पत्र के अनुसार)',
    phoneLabel: 'मोबाइल फोन नंबर',
    emailLabel: 'ईमेल पता',
    emergencyContactLabel: 'आपातकालीन संपर्क का नाम',
    emergencyRelationLabel: 'संपर्क से संबंध',
    emergencyPhoneLabel: 'आपातकालीन संपर्क का मोबाइल नंबर',
    connectDigiLockerBtn: 'डिजीलॉकर (e-KYC) से जोड़ें',
    digiLockerVerifiedBadge: 'डिजीलॉकर ई-केवाईसी सत्यापित',
    sendOtpBtn: 'मोबाइल ओटीपी भेजें',
    otpModalTitle: 'मोबाइल नंबर ओटीपी सत्यापन',
    otpModalSub: 'भेजा गया 6-अंकों का सत्यापन कोड दर्ज करें',
    verifyOtpBtn: 'ओटीपी सत्यापित करें और पर्यटक आईडी बनाएं',
    digitalPassTitle: 'सुरक्षा सेतु डिजिटल पर्यटक सुरक्षा पास',
    touristIdLabel: 'अद्वितीय पर्यटक आईडी',
    copyIdBtn: 'पर्यटक आईडी कॉपी करें',
    downloadPassBtn: 'डिजिटल पास डाउनलोड करें',
    proceedToConsentBtn: 'यात्रा सक्रियण एवं स्थान अनुमति हेतु आगे बढ़ें',
    consentModalTitle: 'अनिवार्य सुरक्षा अनुमति: लाइव स्थान पहुंच प्रदान करें',
    consentModalSub: 'सुरक्षा सेतु नागरिक सुरक्षा एवं आपातकालीन प्रतिक्रिया प्रोटोकॉल',
    consentModalDesc: 'दुर्गम या ऊंचाई वाले क्षेत्रों में आपात स्थिति के दौरान 1-टैप एसओएस पैनिक ट्रिगर, एआई जियोफेंस जोखिम अलर्ट और वास्तविक समय पुलिस प्रतिक्रिया सक्षम करने के लिए, सुरक्षा सेतु आपकी यात्रा अवधि के लिए निरंतर एन्क्रिप्टेड लाइव स्थान ट्रैकिंग का अनुरोध करता है।',
    consentEnableBtn: 'लाइव स्थान पहुंच सक्षम करें और यात्रा शुरू करें',
    consentDeclineBtn: 'अस्वीकार करें (केवल मानक मैनुअल एसओएस)',

    // Dashboard Tabs & Modules
    tabOverview: 'सुरक्षा स्थिति',
    tabItinerary: 'यात्रा योजनाकार',
    tabHeatmap: 'सुरक्षा हीटमैप',
    tabRouteFinder: 'सुरक्षित मार्ग खोजक',
    chatbotTitle: 'सुरक्षा एआई सहायक',
    quickContactsBtn: 'आपातकालीन हॉटलाइन',
    broadcastAlertTitle: 'जियोफेंस सुरक्षा चेतावनी प्रसारण',
    simulateBroadcastBtn: 'लाइव प्रसारण परीक्षण ट्रिगर करें'
  }
};
```

### `frontend/src/data/mockData.ts`

```typescript
import {
  TouristProfile,
  SOSIncident,
  PatrollingUnit,
  PoliceStation,
  Hospital,
  AnomalyCluster,
  BroadcastAlert,
  AuditLog,
  AILog,
  GeoFenceZone
} from '../types';


export const INITIAL_TOURISTS: TouristProfile[] = [
  {
    id: 'TR-88219',
    name: 'Elena Rostova',
    nationality: 'Spain',
    passportHash: 'ESP-9874****',
    photoUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=300',
    phone: '+34 612 884 902',
    emergencyContact: '+34 612 001 223',
    emergencyRelation: 'Father',
    hotel: 'The Grand Himalayan Resort, Old Manali',
    currentLocation: {
      lat: 32.2432,
      lng: 77.1892,
      address: 'Solang Valley North Trail, Kullu, HP'
    },
    batteryLevel: 84,
    safetyStatus: 'SOS Active',
    lastSeenTime: '10 mins ago',
    digitalBandId: 'BAND-3301',
    pastSOSHistory: [
      {
        id: 'SOS-8012',
        date: '2026-08-01',
        location: 'Hadimba Temple Trek',
        reason: 'Network Drop & Altitude Confusion',
        status: 'Resolved'
      }
    ],
    tourist_id: '8f7a9d1b-3c4e-4f52-a1b2-c3d4e5f67890',
    digital_id: 'TR-88219',
    full_name: 'Elena Rostova',
    kyc_document_type: 'Passport',
    kyc_verified: true,
    email: 'elena.rostova@example.com',
    emergency_contact: '+34 612 001 223',
    preferred_language: 'Spanish',
    created_at: '2026-07-15T08:30:00Z'
  },
  {
    id: 'TR-44021',
    name: 'Marcus Vance',
    nationality: 'Australia',
    passportHash: 'AUS-4412****',
    photoUrl: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=300',
    phone: '+61 412 990 123',
    emergencyContact: '+61 412 000 888',
    emergencyRelation: 'Sister',
    hotel: 'Ganga View Heritage Guest House, Varanasi',
    currentLocation: {
      lat: 25.3176,
      lng: 83.0062,
      address: 'Dashashwamedh Ghat Alley #4, Varanasi, UP'
    },
    batteryLevel: 62,
    safetyStatus: 'Watch',
    lastSeenTime: '2 mins ago',
    digitalBandId: 'BAND-1192',
    pastSOSHistory: [],
    tourist_id: '3b2a1c0d-9e8f-4765-b4a3-102938475610',
    digital_id: 'TR-44021',
    full_name: 'Marcus Vance',
    kyc_document_type: 'Passport',
    kyc_verified: true,
    email: 'marcus.vance@example.au',
    emergency_contact: '+61 412 000 888',
    preferred_language: 'English',
    created_at: '2026-07-20T11:15:00Z'
  },
  {
    id: 'TR-90423',
    name: 'Amina Al-Mansoor',
    nationality: 'UAE',
    passportHash: 'ARE-7712****',
    photoUrl: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&q=80&w=300',
    phone: '+971 50 123 4567',
    emergencyContact: '+971 50 999 8877',
    emergencyRelation: 'Spouse',
    hotel: 'Taj Palace, New Delhi',
    currentLocation: {
      lat: 28.6315,
      lng: 77.2167,
      address: 'Connaught Place Inner Circle, New Delhi'
    },
    batteryLevel: 91,
    safetyStatus: 'Safe',
    lastSeenTime: 'Just now',
    digitalBandId: 'BAND-9081',
    pastSOSHistory: [],
    tourist_id: '6c5b4a3f-2e1d-4890-a5b6-7c8d9e0f1a2b',
    digital_id: 'TR-90423',
    full_name: 'Amina Al-Mansoor',
    kyc_document_type: 'National ID',
    kyc_verified: true,
    email: 'amina.almansoor@example.ae',
    emergency_contact: '+971 50 999 8877',
    preferred_language: 'Arabic',
    created_at: '2026-08-01T14:45:00Z'
  },
  {
    id: 'TR-12890',
    name: 'Kenji Takahashi',
    nationality: 'Japan',
    passportHash: 'JPN-3301****',
    photoUrl: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=300',
    phone: '+81 90 4432 1100',
    emergencyContact: '+81 90 0011 2233',
    emergencyRelation: 'Mother',
    hotel: 'Palolem Beach Shack Inn, Goa',
    currentLocation: {
      lat: 15.0102,
      lng: 74.0231,
      address: 'South Palolem Cliff Point, Canacona, Goa'
    },
    batteryLevel: 45,
    safetyStatus: 'SOS Active',
    lastSeenTime: '5 mins ago',
    digitalBandId: 'BAND-5512',
    pastSOSHistory: [
      {
        id: 'SOS-7110',
        date: '2026-07-28',
        location: 'Agonda Beach Cliff',
        reason: 'Water Tide Isolation Warning',
        status: 'Resolved'
      }
    ],
    tourist_id: '9d8c7b6a-5f4e-3d2c-1b0a-fe9d8c7b6a5f',
    digital_id: 'TR-12890',
    full_name: 'Kenji Takahashi',
    kyc_document_type: 'Passport',
    kyc_verified: true,
    email: 'kenji.takahashi@example.jp',
    emergency_contact: '+81 90 0011 2233',
    preferred_language: 'Japanese',
    created_at: '2026-07-25T09:20:00Z'
  },
  {
    id: 'TR-55310',
    name: 'Priya Sharma',
    nationality: 'India (Domestic Traveler)',
    passportHash: 'IND-8821****',
    photoUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=300',
    phone: '+91 98765 43210',
    emergencyContact: '+91 98123 45678',
    emergencyRelation: 'Brother',
    hotel: 'Zostel Rishikesh, Tapovan',
    currentLocation: {
      lat: 30.1231,
      lng: 78.3211,
      address: 'Laxman Jhula North Bank, Rishikesh, Uttarakhand'
    },
    batteryLevel: 78,
    safetyStatus: 'Safe',
    lastSeenTime: '15 mins ago',
    digitalBandId: 'BAND-8840',
    pastSOSHistory: [],
    tourist_id: '1a2b3c4d-5e6f-7a8b-9c0d-1e2f3a4b5c6d',
    digital_id: 'TR-55310',
    full_name: 'Priya Sharma',
    kyc_document_type: 'Aadhaar Card',
    kyc_verified: true,
    email: 'priya.sharma@example.in',
    emergency_contact: '+91 98123 45678',
    preferred_language: 'Hindi',
    created_at: '2026-08-05T16:10:00Z'
  }
];

export const INITIAL_INCIDENTS: SOSIncident[] = [
  {
    id: 'SOS-9021',
    touristId: 'TR-88219',
    touristName: 'Elena Rostova',
    touristPhone: '+34 612 884 902',
    location: {
      lat: 32.2432,
      lng: 77.1892,
      address: 'Solang Valley North Trail (Off-route 2.4 km)'
    },
    timestamp: '2026-08-12 08:10:12',
    status: 'New',
    severity: 'Critical',
    hazardType: 'Panic Beacon / Off-Route Isolation',
    notes: 'Panic button pressed continuously for 5s. Rapid heart-rate spike recorded by digital band.',
  },
  {
    id: 'SOS-9022',
    touristId: 'TR-12890',
    touristName: 'Kenji Takahashi',
    touristPhone: '+81 90 4432 1100',
    location: {
      lat: 15.0102,
      lng: 74.0231,
      address: 'South Palolem Cliff Point, Goa'
    },
    timestamp: '2026-08-12 07:55:00',
    status: 'Units Dispatched',
    severity: 'Critical',
    unitAssigned: 'PCR-GOA-08',
    hazardType: 'High Tide Cliff Isolation',
    notes: 'Coastal Patrol boat dispatched with life jackets.'
  },
  {
    id: 'SOS-9018',
    touristId: 'TR-44021',
    touristName: 'Marcus Vance',
    touristPhone: '+61 412 990 123',
    location: {
      lat: 25.3176,
      lng: 83.0062,
      address: 'Manikarnika Ghat Lane, Varanasi'
    },
    timestamp: '2026-08-12 06:30:15',
    status: 'Resolved',
    severity: 'Warning',
    unitAssigned: 'PCR-VAR-02',
    hazardType: 'Crowd Disorientation',
    notes: 'Tourist safely escorted back to hotel by Ghat Tourist Squad.'
  }
];

export const INITIAL_PATROL_UNITS: PatrollingUnit[] = [
  {
    id: 'PCR-KULLU-04',
    unitName: 'PCR Van - Himachal High Sector 04',
    type: 'PCR Van',
    unitLeader: 'SI Inspector Vikram Singh',
    location: {
      lat: 32.2390,
      lng: 77.1820,
      address: 'Solang Valley Checkpost'
    },
    status: 'Patrolling',
    contactPhone: '+91 94180 12345'
  },
  {
    id: 'PCR-GOA-08',
    unitName: 'Coastal Rescue Speedboat - Unit 8',
    type: 'Quick Response Motorcycle',
    unitLeader: 'Coast Guard Sub-Officer Rahul Naik',
    location: {
      lat: 15.0080,
      lng: 74.0210,
      address: 'Palolem Beach Patrol Bay'
    },
    status: 'Dispatched',
    contactPhone: '+91 98221 88990',
    assignedIncidentId: 'SOS-9022'
  },
  {
    id: 'WSS-DELHI-01',
    unitName: 'Pink Panther Women Safety Squad - CP',
    type: 'Women Safety Squad',
    unitLeader: 'Inspector Sunita Rani',
    location: {
      lat: 28.6320,
      lng: 77.2180,
      address: 'Connaught Place Outer Ring'
    },
    status: 'Patrolling',
    contactPhone: '+91 98100 55443'
  },
  {
    id: 'PCR-VAR-02',
    unitName: 'Ghat Quick Response Bike Team 2',
    type: 'Quick Response Motorcycle',
    unitLeader: 'Head Constable Ramesh Yadav',
    location: {
      lat: 25.3120,
      lng: 83.0080,
      address: 'Godowlia Crossing, Varanasi'
    },
    status: 'Standby',
    contactPhone: '+91 94500 11223'
  }
];

export const POLICE_STATIONS: PoliceStation[] = [
  {
    id: 'PS-MANALI-01',
    name: 'Manali Central Tourist Police Station',
    jurisdiction: 'Kullu Valley & Solang Pass',
    location: {
      lat: 32.2400,
      lng: 77.1850,
      address: 'Mall Road, Manali, Himachal Pradesh'
    },
    contactPhone: '01902-252326',
    activeOfficers: 34,
    availableVehicles: 8
  },
  {
    id: 'PS-VARANASI-01',
    name: 'Kotwali Tourist Helpdesk & Station',
    jurisdiction: 'Varanasi Ghats & Heritage Corridor',
    location: {
      lat: 25.3150,
      lng: 83.0040,
      address: 'Dashashwamedh Main Road, Varanasi'
    },
    contactPhone: '0542-2502220',
    activeOfficers: 42,
    availableVehicles: 12
  },
  {
    id: 'PS-DELHI-01',
    name: 'Connaught Place Police Station',
    jurisdiction: 'Central Delhi & Janpath Tourist Hub',
    location: {
      lat: 28.6300,
      lng: 77.2150,
      address: 'Parliament Street, Connaught Place, New Delhi'
    },
    contactPhone: '011-23361234',
    activeOfficers: 65,
    availableVehicles: 18
  },
  {
    id: 'PS-GOA-01',
    name: 'Canacona Coastal Police Station',
    jurisdiction: 'South Goa Beaches & Cliff Circuits',
    location: {
      lat: 15.0150,
      lng: 74.0200,
      address: 'Chaudi, Canacona, South Goa'
    },
    contactPhone: '0832-2643323',
    activeOfficers: 28,
    availableVehicles: 6
  }
];

export const HOSPITALS: Hospital[] = [
  {
    id: 'HOSP-MANALI-01',
    name: 'Manali Civil District Hospital & Trauma Center',
    jurisdiction: 'Mall Road Emergency Ward',
    location: {
      lat: 32.2380,
      lng: 77.1890,
      address: 'Mall Road, Manali, Himachal Pradesh'
    },
    contactPhone: '+91 1902 252222',
    icuBedsAvailable: 14,
    ambulancesReady: 4
  },
  {
    id: 'HOSP-KULLU-02',
    name: 'Kullu Regional Emergency Care Center',
    jurisdiction: 'Kullu Valley Medical Command',
    location: {
      lat: 31.9580,
      lng: 77.1090,
      address: 'Regional Hospital Campus, Kullu'
    },
    contactPhone: '+91 1902 222340',
    icuBedsAvailable: 22,
    ambulancesReady: 6
  },
  {
    id: 'HOSP-VARANASI-03',
    name: 'Heritage Super Specialty Hospital',
    jurisdiction: 'Varanasi Central Trauma Response',
    location: {
      lat: 25.3120,
      lng: 83.0080,
      address: 'Lanka Crossing, Varanasi'
    },
    contactPhone: '+91 542 2369999',
    icuBedsAvailable: 18,
    ambulancesReady: 5
  }
];

export const ANOMALY_CLUSTERS: AnomalyCluster[] = [
  {
    id: 'AC-101',
    regionName: 'Solang Valley North Trail (Kullu Sector)',
    riskScore: 88,
    touristDensity: 142,
    anomalyType: 'Off-Route Signal Loss',
    confidenceScore: 94,
    descriptionEn: 'AI detected 3 active tourist digital bands deviating >2km from marked trekking trail after dusk.',
    descriptionHi: 'एआई ने सूर्यास्त के बाद चिह्नित ट्रैकिंग ट्रेल से >2 किमी दूर भटक रहे 3 सक्रिय पर्यटक डिजिटल बैंड का पता लगाया।',
    recommendedActionEn: 'Deploy High Altitude PCR-04 van and send automated SMS advisory to registered trekking groups.',
    recommendedActionHi: 'हाई एल्टीट्यूड पीसीआर-04 वैन भेजें और पंजीकृत ट्रैकिंग समूहों को स्वचालित एसएमएस सलाह भेजें।',
    coordinates: { lat: 32.2432, lng: 77.1892 },
    timestamp: '2026-08-12 08:12:00'
  },
  {
    id: 'AC-102',
    regionName: 'Varanasi Ghat Narrow Alleyway Grid',
    riskScore: 72,
    touristDensity: 890,
    anomalyType: 'Unusual Grouping',
    confidenceScore: 89,
    descriptionEn: 'High density congestion detected near unlit alley #4. Slow movement and sudden drop in GPS precision.',
    descriptionHi: 'अप्रकाशित गली #4 के पास उच्च घनत्व वाली भीड़ का पता चला। धीमी गति और जीपीएस सटीकता में अचानक गिरावट।',
    recommendedActionEn: 'Dispatch Ghat Bike Team for crowd flow management and illuminate emergency LED arrays.',
    recommendedActionHi: 'भीड़ प्रवाह प्रबंधन के लिए घाट बाइक टीम भेजें और आपातकालीन एलईडी समूह चालू करें।',
    coordinates: { lat: 25.3176, lng: 83.0062 },
    timestamp: '2026-08-12 08:05:00'
  },
  {
    id: 'AC-103',
    regionName: 'Anjuna - Palolem Coastal Cliff Edge',
    riskScore: 81,
    touristDensity: 210,
    anomalyType: 'Hazard Zone Entry',
    confidenceScore: 91,
    descriptionEn: 'High tide alert active. 5 tourists located past danger warning barrier near tidal cliff.',
    descriptionHi: 'उच्च ज्वार की चेतावनी सक्रिय। ज्वारीय चट्टान के पास खतरे की चेतावनी बाधा के पार 5 पर्यटक स्थित हैं।',
    recommendedActionEn: 'Trigger geofenced audio warning beacon and broadcast SMS to coastal cell towers.',
    recommendedActionHi: 'जियोफेंस किए गए ऑडियो चेतावनी बीकन को ट्रिगर करें और तटीय सेल टावरों पर एसएमएस प्रसारित करें।',
    coordinates: { lat: 15.0102, lng: 74.0231 },
    timestamp: '2026-08-12 07:50:00'
  }
];

export const INITIAL_BROADCASTS: BroadcastAlert[] = [
  {
    id: 'BC-501',
    senderBadge: 'IPS-7742 (Rajesh Kumar)',
    region: 'Himachal Pradesh (Solang Valley & Rohtang Pass)',
    radiusKm: 15,
    titleEn: '⚠️ Flash Flood & Sudden Weather Warning',
    titleHi: '⚠️ अचानक बाढ़ और खराब मौसम की चेतावनी',
    bodyEn: 'Heavy rainfall and cloudburst alert in Solang Valley. Avoid unmapped riverbanks and return to main highway immediately.',
    bodyHi: 'सोलंग घाटी में भारी बारिश और बादल फटने का अलर्ट। बिना नक्शे वाले नदी तटों से दूर रहें और तुरंत मुख्य राजमार्ग पर लौटें।',
    severity: 'Critical',
    timestamp: '2026-08-12 07:30:00',
    recipientCount: 3420,
    deliveredCount: 3389,
    status: 'Completed'
  },
  {
    id: 'BC-502',
    senderBadge: 'IPS-7742 (Rajesh Kumar)',
    region: 'Varanasi Ghats Heritage Area',
    radiusKm: 3,
    titleEn: 'ℹ️ Ganga Aarti Crowd Diversion Advisory',
    titleHi: 'ℹ️ गंगा आरती भीड़ डायवर्जन सलाह',
    bodyEn: 'Dashashwamedh Ghat experiencing maximum capacity. Please use Rajghat or Assi Ghat for comfortable view.',
    bodyHi: 'दशाश्वमेध घाट अधिकतम क्षमता पर है। आरामदायक दर्शन के लिए कृपया राजघाट या अस्सी घाट का उपयोग करें।',
    severity: 'Advisory',
    timestamp: '2026-08-11 18:00:00',
    recipientCount: 12500,
    deliveredCount: 12410,
    status: 'Completed'
  }
];

export const INITIAL_AUDIT_LOGS: AuditLog[] = [
  {
    id: 'AUD-9901',
    timestamp: '2026-08-12 08:14:02',
    officerName: 'Rajesh Kumar, IPS',
    officerBadge: 'IPS-7742',
    actionType: 'TOURIST_LOOKUP',
    targetId: 'TR-88219 (Elena Rostova)',
    reason: 'Active SOS Response',
    details: 'Accessed live GPS telemetry and emergency contact records during active panic beacon event SOS-9021.',
    ipAddress: '10.142.0.88 (NIC Secure Gateway)'
  },
  {
    id: 'AUD-9902',
    timestamp: '2026-08-12 07:56:10',
    officerName: 'Rajesh Kumar, IPS',
    officerBadge: 'IPS-7742',
    actionType: 'DISPATCH_UNIT',
    targetId: 'PCR-GOA-08',
    reason: 'Active SOS Response',
    details: 'Dispatched Coastal Rescue Speedboat to South Palolem Cliff Point for incident SOS-9022.',
    ipAddress: '10.142.0.88 (NIC Secure Gateway)'
  },
  {
    id: 'AUD-9903',
    timestamp: '2026-08-12 07:30:15',
    officerName: 'Rajesh Kumar, IPS',
    officerBadge: 'IPS-7742',
    actionType: 'BROADCAST_SENT',
    targetId: 'Geofence Solang (15km)',
    reason: 'Disaster Prevention Protocol',
    details: 'Pushed Critical Flash Flood warning SMS to 3,420 active tourist devices.',
    ipAddress: '10.142.0.88 (NIC Secure Gateway)'
  }
];

export const INITIAL_AI_LOGS: AILog[] = [
  {
    id: 'LOG-1',
    timestamp: '08:19:12',
    severity: 'critical',
    messageEn: 'AI Model Threat-Predictor v4.2 flagged rapid signal loss for TR-88219 near Solang Ravine. Anomaly confidence: 94%.',
    messageHi: 'एआई मॉडल खतरा-पूर्वानुमानकर्ता v4.2 ने सोलंग खड्ड के पास TR-88219 के लिए तेज सिग्नल हानि को चिह्नित किया। विसंगति विश्वसनीयता: 94%।',
    modelConfidence: 94,
    region: 'Solang Valley, HP'
  },
  {
    id: 'LOG-2',
    timestamp: '08:15:30',
    severity: 'warning',
    messageEn: 'Density threshold surpassed in Varanasi Sector 4 (+38% over average baseline). Recommended squad re-allocation.',
    messageHi: 'वाराणसी सेक्टर 4 में घनत्व सीमा पार हो गई (औसत आधार रेखा से +38% अधिक)। अनुशंसित दस्ता पुनरावंटन।',
    modelConfidence: 89,
    region: 'Varanasi, UP'
  },
  {
    id: 'LOG-3',
    timestamp: '08:02:44',
    severity: 'info',
    messageEn: 'Geofence heartbeats synced with 18,940 active tourist digital wristbands across major national circuits.',
    messageHi: 'प्रमुख राष्ट्रीय सर्किटों में 18,940 सक्रिय पर्यटक डिजिटल कलाई बैंड के साथ जियोफेंस धड़कनें सिंक की गईं।',
    modelConfidence: 99,
    region: 'National Network'
  }
];

export const MOCK_GEOFENCE_ZONES: GeoFenceZone[] = [
  {
    id: 'zone-1',
    name: 'Solang Riverbank & Avalanche Slope',
    riskLevel: 'Unsafe',
    description: 'High flash flood & avalanche hazard zone. Night movement prohibited after 17:00 IST.',
    center: { lat: 32.2432, lng: 77.1892 },
    radiusKm: 1.5
  },
  {
    id: 'zone-2',
    name: 'Hadimba Pine Forest Trek',
    riskLevel: 'Caution',
    description: 'Dense forest cover area. Stick to designated trails and maintain band connectivity.',
    center: { lat: 32.2480, lng: 77.1850 },
    radiusKm: 2.0
  },
  {
    id: 'zone-3',
    name: 'Manali Mall Road Safe Zone',
    riskLevel: 'Safe',
    description: 'Monitored safe tourist corridor with 24/7 Police Helpdesk & active PCR coverage.',
    center: { lat: 32.2396, lng: 77.1887 },
    radiusKm: 3.0
  }
];
```

### `frontend/src/index.css`

```css
@import "tailwindcss";
```

### `frontend/src/lib/api.ts`

```typescript
import { SOSRecord, getQueuedSOSRecords, updateSOSRecordStatus } from "./db";

let isSyncing = false;

// ---------------------------------------------------------------------------
// Base URL & session storage
//
// Resolution order matches existing behavior (localStorage override first),
// and additionally honors Vite's standard VITE_* env convention so a
// deployment-specific URL can be set via frontend/.env without code changes.
// ---------------------------------------------------------------------------

export function getApiBaseUrl(): string {
  const envUrl = (import.meta as any).env?.VITE_API_BASE_URL as string | undefined;
  return localStorage.getItem("sos_api_base_url") || envUrl || "http://localhost:8000/api/v1";
}

export function getAuthToken(): string {
  return localStorage.getItem("sos_auth_token") || "";
}

export function getTouristId(): string {
  return localStorage.getItem("sos_tourist_id") || "";
}

export function getUserType(): string {
  return localStorage.getItem("sos_user_type") || "";
}

export function getAuthorityId(): string {
  return localStorage.getItem("sos_authority_id") || "";
}

export function getUsername(): string {
  return localStorage.getItem("sos_username") || "";
}

interface SessionInfo {
  access_token?: string;
  user_type?: string;
  tourist_id?: string | null;
  authority_id?: string | null;
  username?: string;
}

/** Persists an authenticated session (token + identity) to localStorage. */
export function storeSession(session: SessionInfo): void {
  if (session.access_token) localStorage.setItem("sos_auth_token", session.access_token);
  if (session.user_type) localStorage.setItem("sos_user_type", session.user_type);
  if (session.tourist_id) localStorage.setItem("sos_tourist_id", session.tourist_id);
  if (session.authority_id) localStorage.setItem("sos_authority_id", session.authority_id);
  if (session.username) localStorage.setItem("sos_username", session.username);
}

/** Clears any stored session/auth data (used on logout). */
export function clearSession(): void {
  localStorage.removeItem("sos_auth_token");
  localStorage.removeItem("sos_user_type");
  localStorage.removeItem("sos_tourist_id");
  localStorage.removeItem("sos_authority_id");
  localStorage.removeItem("sos_username");
}

// ---------------------------------------------------------------------------
// Generic authenticated request helper
// ---------------------------------------------------------------------------

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function apiRequest<T = any>(
  path: string,
  options: { method?: string; body?: any; auth?: boolean } = {}
): Promise<T> {
  const { method = "GET", body, auth = true } = options;
  const baseUrl = getApiBaseUrl();
  const token = getAuthToken();

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth && token) headers["Authorization"] = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (networkErr: any) {
    throw new ApiError(0, `Network error contacting backend: ${networkErr.message || networkErr}`);
  }

  if (!response.ok) {
    let detail = "";
    try {
      const errJson = await response.json();
      detail = errJson.detail ? JSON.stringify(errJson.detail) : JSON.stringify(errJson);
    } catch {
      detail = await response.text().catch(() => "");
    }
    throw new ApiError(response.status, detail || `Request failed with status ${response.status}`);
  }

  if (response.status === 204) return undefined as unknown as T;
  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Authentication (backend/routers/auth.py)
// ---------------------------------------------------------------------------

export async function registerUser(
  username: string,
  password: string,
  userType: "tourist" | "authority"
): Promise<any> {
  return apiRequest("/auth/register", {
    method: "POST",
    auth: false,
    body: { username, password, user_type: userType },
  });
}

export async function loginUser(username: string, password: string): Promise<any> {
  return apiRequest("/auth/login", {
    method: "POST",
    auth: false,
    body: { username, password },
  });
}

export async function logoutUser(): Promise<void> {
  try {
    await apiRequest("/auth/logout", { method: "POST" });
  } catch (err) {
    console.warn("Logout request failed (clearing local session anyway):", err);
  }
}

export async function getSession(): Promise<any> {
  return apiRequest("/auth/session");
}

/**
 * The existing Tourist Portal sign-up/sign-in UI never collects a password
 * (only name/phone/email/OTP). The backend's register/login endpoints require
 * username + password. To connect the two without adding a new field to the
 * existing form, we derive stable, non-secret credentials from the tourist's
 * phone number. This is a pragmatic integration bridge for this app, not a
 * production-grade auth scheme.
 */
export function deriveTouristCredentials(phone: string): { username: string; password: string } {
  const normalized = (phone || "").replace(/[^0-9]/g, "");
  return {
    username: `tourist-${normalized || "guest"}`,
    password: `SurakshaSetu-${normalized || "guest"}-2026`,
  };
}

// ---------------------------------------------------------------------------
// Tourist profile (backend/routers/tourists.py)
// ---------------------------------------------------------------------------

export async function createTouristProfile(payload: {
  full_name: string;
  phone?: string;
  email?: string;
  emergency_contact?: string;
  preferred_language?: string;
}): Promise<any> {
  return apiRequest("/tourists", { method: "POST", body: payload });
}

export async function getTouristProfile(touristId: string): Promise<any> {
  return apiRequest(`/tourists/${touristId}`);
}

export async function updateTouristProfile(touristId: string, payload: Record<string, any>): Promise<any> {
  return apiRequest(`/tourists/${touristId}`, { method: "PATCH", body: payload });
}

export async function getDigitalId(touristId: string): Promise<any> {
  return apiRequest(`/tourists/${touristId}/digital-id`);
}

// ---------------------------------------------------------------------------
// Incidents (backend/routers/incidents.py)
// ---------------------------------------------------------------------------

export async function listIncidents(statusFilter?: string): Promise<any[]> {
  const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : "";
  return apiRequest(`/incidents${qs}`);
}

export async function getIncident(incidentId: string): Promise<any> {
  return apiRequest(`/incidents/${incidentId}`);
}

export async function updateIncidentStatus(
  incidentId: string,
  payload: { status?: string; severity?: string; description?: string; authority_id?: string }
): Promise<any> {
  return apiRequest(`/incidents/${incidentId}`, { method: "PATCH", body: payload });
}

export async function createIncidentResponse(
  incidentId: string,
  payload: { responder_unit?: string; action_taken?: string; resolved_at?: string; authority_id?: string }
): Promise<any> {
  return apiRequest(`/incidents/${incidentId}/responses`, { method: "POST", body: payload });
}

export async function listIncidentResponses(incidentId: string): Promise<any[]> {
  return apiRequest(`/incidents/${incidentId}/responses`);
}

export async function createItineraryEntry(payload: {
  location_id?: string;
  destination_name?: string;
  latitude?: number;
  longitude?: number;
  planned_arrival?: string;
  planned_departure?: string;
}): Promise<any> {
  return apiRequest(`/itinerary`, { method: "POST", body: payload });
}

export async function listItineraryEntries(): Promise<any[]> {
  return apiRequest(`/itinerary`);
}

export async function deleteItineraryEntry(itineraryId: string): Promise<void> {
  await apiRequest(`/itinerary/${itineraryId}`, { method: "DELETE" });
}

export async function createAuditLog(payload: {
  action_type: string;
  target_id: string;
  reason?: string;
  details?: string;
}): Promise<any> {
  return apiRequest(`/audit-logs`, { method: "POST", body: payload });
}

export async function listAuditLogs(): Promise<any[]> {
  return apiRequest(`/audit-logs`);
}

// ---------------------------------------------------------------------------
// Locations (backend/routers/locations.py)
// ---------------------------------------------------------------------------

export async function listLocations(): Promise<any[]> {
  return apiRequest("/locations");
}

export async function getLocation(locationId: string): Promise<any> {
  return apiRequest(`/locations/${locationId}`);
}

// ---------------------------------------------------------------------------
// Alerts (backend/routers/alerts.py)
// ---------------------------------------------------------------------------

export async function createAlert(payload: {
  incident_id: string;
  channel: "SMS" | "EMAIL" | "PUSH" | "APP";
  recipient: string;
}): Promise<any> {
  return apiRequest("/alerts", { method: "POST", body: payload });
}

export async function listAlerts(incidentId?: string): Promise<any[]> {
  const qs = incidentId ? `?incident_id=${encodeURIComponent(incidentId)}` : "";
  return apiRequest(`/alerts${qs}`);
}

// ---------------------------------------------------------------------------
// Authority (backend/routers/authority.py)
// ---------------------------------------------------------------------------

export async function authorityLoginRequest(username: string, password: string): Promise<any> {
  return apiRequest("/authority/login", { method: "POST", auth: false, body: { username, password } });
}

export async function getAuthorityAlerts(): Promise<any[]> {
  return apiRequest("/authority/alerts");
}

export async function getAuthorityIncidents(): Promise<any[]> {
  return apiRequest("/authority/incidents");
}

export async function getAuthorityTourist(touristId: string): Promise<any> {
  return apiRequest(`/authority/tourists/${touristId}`);
}

export async function getAuthorityIncidentLocation(incidentId: string): Promise<any> {
  return apiRequest(`/authority/incidents/${incidentId}/location`);
}

/**
 * Connects the Gateway's existing MFA form (Badge ID + Auth Code) to the real
 * backend. The Auth Code field is already a masked "password" input in the
 * UI, so Badge ID -> username and Auth Code -> password is a direct mapping,
 * not an invented one.
 *
 * If the badge is not registered, or the credentials are otherwise invalid,
 * login simply fails — there is no auto-registration fallback. Authority
 * accounts must be provisioned separately.
 */
export async function authenticateAuthority(
  badgeId: string,
  otp: string
): Promise<{ authority_id: string; username: string } | null> {
  try {
    const loginResp = await authorityLoginRequest(badgeId, otp);
    storeSession({
      access_token: loginResp.access_token,
      user_type: loginResp.user_type,
      authority_id: loginResp.authority_id,
      username: loginResp.username,
    });
    return { authority_id: loginResp.authority_id, username: loginResp.username };
  } catch (err: any) {
    console.error("Authority login failed:", err);
    return null;
  }
}

/**
 * Connects the Tourist Portal's existing sign-up form to the real backend:
 * registers an auth account (derived credentials, see deriveTouristCredentials),
 * logs in to obtain a session token, creates the tourist profile with the
 * actual form data, and returns the resulting profile + token so the caller
 * can populate the existing UI without changing its shape.
 */
export async function registerAndLoginTourist(details: {
  fullName: string;
  phone: string;
  email: string;
  emergencyContact: string;
}): Promise<{ token: string; tourist: any } | null> {
  const { username, password } = deriveTouristCredentials(details.phone);
  try {
    await registerUser(username, password, "tourist");
  } catch (err: any) {
    // If the derived account already exists (e.g. re-registering the same
    // phone), fall through to login instead of failing the whole flow.
    if (!(err instanceof ApiError && err.status === 409)) {
      console.error("Tourist registration failed:", err);
      return null;
    }
  }

  try {
    const loginResp = await loginUser(username, password);
    storeSession({
      access_token: loginResp.access_token,
      user_type: loginResp.user_type,
      tourist_id: loginResp.tourist_id,
      username: loginResp.username,
    });

    if (!loginResp.tourist_id) return null;

    const updated = await updateTouristProfile(loginResp.tourist_id, {
      full_name: details.fullName,
      phone: details.phone,
      email: details.email,
      emergency_contact: details.emergencyContact,
    });

    return { token: loginResp.access_token, tourist: updated };
  } catch (err) {
    console.error("Tourist login/profile-update failed:", err);
    return null;
  }
}

/**
 * Connects the Tourist Portal's existing sign-in form (Tourist ID + Phone) to
 * the real backend by attempting a re-login with the same derived credentials
 * used at sign-up time. There is no backend endpoint to look a tourist up by
 * phone number alone, so this only succeeds for a phone that previously
 * registered through this app in the current backend session; otherwise it
 * returns null and the caller falls back to its existing local demo lookup.
 */
export async function loginTouristByPhone(phone: string): Promise<{ token: string; tourist: any } | null> {
  const { username, password } = deriveTouristCredentials(phone);
  try {
    const loginResp = await loginUser(username, password);
    storeSession({
      access_token: loginResp.access_token,
      user_type: loginResp.user_type,
      tourist_id: loginResp.tourist_id,
      username: loginResp.username,
    });
    if (!loginResp.tourist_id) return null;
    const tourist = await getTouristProfile(loginResp.tourist_id);
    return { token: loginResp.access_token, tourist };
  } catch (err) {
    console.warn("Backend sign-in by phone did not match a registered account; using local demo lookup.", err);
    return null;
  }
}

export async function submitSOSOnline(sosRecord: SOSRecord): Promise<any> {
  const baseUrl = getApiBaseUrl();
  const token = getAuthToken();

  const touristId = sosRecord.tourist_id || getTouristId();

  const payload = {
    tourist_id: touristId,
    latitude: sosRecord.latitude !== undefined ? sosRecord.latitude : null,
    longitude: sosRecord.longitude !== undefined ? sosRecord.longitude : null,
    description: sosRecord.description || `SOS Emergency Alert (${sosRecord.location_source || "live"})`,
    severity: sosRecord.severity || "HIGH",
    trigger_source: "APP",
  };

  const response = await fetch(`${baseUrl}/sos`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new ApiError(response.status, errText || `Server returned status ${response.status}`);
  }

  return await response.json();
}

export async function syncQueuedSOS(
  onProgressCallback?: (status: string, record: SOSRecord, serverRes?: any) => void
): Promise<{ count: number; synced: number; error?: string }> {
  if (isSyncing) {
    console.log("Sync process already in progress. Skipping duplicate invocation.");
    return { count: 0, synced: 0 };
  }

  if (!navigator.onLine) {
    console.log("Device is offline. Cannot perform synchronization.");
    return { count: 0, synced: 0, error: "Offline" };
  }

  isSyncing = true;
  let syncedCount = 0;
  let queuedRecords: SOSRecord[] = [];

  try {
    queuedRecords = await getQueuedSOSRecords();
    console.log(`Found ${queuedRecords.length} queued offline SOS records to synchronize.`);

    for (const record of queuedRecords) {
      if (record.status === "SYNCED") continue;

      try {
        if (record.local_sos_id) {
          await updateSOSRecordStatus(record.local_sos_id, "SYNCING");
        }

        if (onProgressCallback) onProgressCallback("SYNCING", record);

        const serverResponse = await submitSOSOnline(record);
        console.log("Successfully synchronized SOS record:", serverResponse);

        if (record.local_sos_id) {
          await updateSOSRecordStatus(record.local_sos_id, "SYNCED", {
            server_sos_id: serverResponse.sos_id || `MOCK-${Date.now()}`,
            server_incident_id: serverResponse.incident_id || `MOCK-INC-${Date.now()}`,
          });
        }

        syncedCount++;
        if (onProgressCallback) onProgressCallback("SYNCED", record, serverResponse);
      } catch (err: any) {
        console.error(`Failed to synchronize SOS record ${record.local_sos_id}:`, err);
        if (record.local_sos_id) {
          await updateSOSRecordStatus(record.local_sos_id, "QUEUED_OFFLINE");
        }
        if (onProgressCallback) onProgressCallback("FAILED", record, err);
      }
    }
  } catch (e) {
    console.error("Error during synchronization process:", e);
  } finally {
    isSyncing = false;
  }

  return { count: queuedRecords.length, synced: syncedCount };
}
```

### `frontend/src/lib/db.ts`

```typescript
export interface LocationData {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  timestamp: string;
  location_source?: string;
}

export interface SOSRecord {
  local_sos_id?: string;
  tourist_id?: string | null;
  triggered_at?: string;
  latitude?: number | null;
  longitude?: number | null;
  accuracy?: number | null;
  location_source?: string;
  description?: string;
  severity?: string;
  status?: string;
  server_sos_id?: string | null;
  server_incident_id?: string | null;
  synced_at?: string | null;
}

const DB_NAME = "smart_tourist_safety_sos";
const DB_VERSION = 1;
const STORE_LOCATION = "last_location";
const STORE_QUEUE = "sos_queue";

let dbInstance: IDBDatabase | null = null;

export async function initDB(): Promise<IDBDatabase> {
  if (dbInstance) return dbInstance;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_LOCATION)) {
        db.createObjectStore(STORE_LOCATION, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        const queueStore = db.createObjectStore(STORE_QUEUE, { keyPath: "local_sos_id" });
        queueStore.createIndex("status", "status", { unique: false });
        queueStore.createIndex("triggered_at", "triggered_at", { unique: false });
      }
    };

    request.onsuccess = (event: Event) => {
      dbInstance = (event.target as IDBOpenDBRequest).result;
      resolve(dbInstance);
    };

    request.onerror = (event: Event) => {
      console.error("IndexedDB error:", (event.target as IDBOpenDBRequest).error);
      reject((event.target as IDBOpenDBRequest).error);
    };
  });
}

export async function saveLastKnownLocation(locationData: LocationData): Promise<any> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_LOCATION, "readwrite");
    const store = tx.objectStore(STORE_LOCATION);
    const record = {
      id: "latest",
      latitude: locationData.latitude,
      longitude: locationData.longitude,
      accuracy: locationData.accuracy || null,
      timestamp: locationData.timestamp || new Date().toISOString(),
    };
    const request = store.put(record);
    request.onsuccess = () => resolve(record);
    request.onerror = (e) => reject((e.target as IDBRequest).error);
  });
}

export async function getLastKnownLocation(): Promise<LocationData | null> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_LOCATION, "readonly");
    const store = tx.objectStore(STORE_LOCATION);
    const request = store.get("latest");
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = (e) => reject((e.target as IDBRequest).error);
  });
}

export async function queueSOSRecord(sosRecord: SOSRecord): Promise<SOSRecord> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, "readwrite");
    const store = tx.objectStore(STORE_QUEUE);
    const record: SOSRecord = {
      local_sos_id: sosRecord.local_sos_id || crypto.randomUUID(),
      tourist_id: sosRecord.tourist_id || null,
      triggered_at: sosRecord.triggered_at || new Date().toISOString(),
      latitude: sosRecord.latitude !== undefined ? sosRecord.latitude : null,
      longitude: sosRecord.longitude !== undefined ? sosRecord.longitude : null,
      accuracy: sosRecord.accuracy || null,
      location_source: sosRecord.location_source || "unavailable",
      description: sosRecord.description || "Offline Emergency SOS Alert",
      severity: sosRecord.severity || "HIGH",
      status: sosRecord.status || "QUEUED_OFFLINE",
      server_sos_id: sosRecord.server_sos_id || null,
      server_incident_id: sosRecord.server_incident_id || null,
      synced_at: sosRecord.synced_at || null,
    };
    const request = store.put(record);
    request.onsuccess = () => resolve(record as SOSRecord);
    request.onerror = (e) => reject((e.target as IDBRequest).error);
  });
}

export async function getQueuedSOSRecords(): Promise<SOSRecord[]> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, "readonly");
    const store = tx.objectStore(STORE_QUEUE);
    const request = store.getAll();
    request.onsuccess = () => {
      const all: SOSRecord[] = request.result || [];
      const queued = all.filter((r) => r.status === "QUEUED_OFFLINE");
      resolve(queued);
    };
    request.onerror = (e) => reject((e.target as IDBRequest).error);
  });
}

export async function updateSOSRecordStatus(
  local_sos_id: string,
  newStatus: string,
  serverData: Partial<SOSRecord> = {}
): Promise<SOSRecord> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_QUEUE, "readwrite");
    const store = tx.objectStore(STORE_QUEUE);
    const getReq = store.get(local_sos_id);
    getReq.onsuccess = () => {
      const record = getReq.result as SOSRecord;
      if (!record) return reject(new Error("Record not found"));

      record.status = newStatus;
      if (serverData.server_sos_id) record.server_sos_id = serverData.server_sos_id;
      if (serverData.server_incident_id) record.server_incident_id = serverData.server_incident_id;
      if (newStatus === "SYNCED") record.synced_at = new Date().toISOString();

      const putReq = store.put(record);
      putReq.onsuccess = () => resolve(record);
      putReq.onerror = (e) => reject((e.target as IDBRequest).error);
    };
    getReq.onerror = (e) => reject((e.target as IDBRequest).error);
  });
}
```

### `frontend/src/lib/location.ts`

```typescript
import { saveLastKnownLocation, getLastKnownLocation, LocationData } from "./db";

export async function getLiveLocation(
  options = { timeout: 6000, maxAge: 0, enableHighAccuracy: true }
): Promise<LocationData> {
  if (!navigator.geolocation) {
    throw new Error("Geolocation API not supported by browser");
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const locData: LocationData = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: new Date(position.timestamp).toISOString(),
          location_source: "live",
        };

        try {
          await saveLastKnownLocation(locData);
        } catch (err) {
          console.warn("Could not save last known location to IndexedDB:", err);
        }

        resolve(locData);
      },
      (error) => {
        reject(error);
      },
      options
    );
  });
}

export async function getSOSLocation(): Promise<LocationData> {
  try {
    console.log("Attempting live GPS location acquisition...");
    const liveLoc = await getLiveLocation();
    console.log("Live GPS acquired:", liveLoc);
    return liveLoc;
  } catch (gpsError: any) {
    console.warn("Live GPS unavailable or timed out:", gpsError.message || gpsError);

    try {
      const lastKnown = await getLastKnownLocation();
      if (lastKnown && lastKnown.latitude && lastKnown.longitude) {
        console.log("Using last-known location from IndexedDB:", lastKnown);
        return {
          latitude: lastKnown.latitude,
          longitude: lastKnown.longitude,
          accuracy: lastKnown.accuracy || null,
          timestamp: lastKnown.timestamp,
          location_source: "last_known",
        };
      }
    } catch (dbError) {
      console.warn("Could not read last-known location from IndexedDB:", dbError);
    }

    console.log("No GPS or last-known location available. Proceeding with 'unavailable'.");
    return {
      latitude: null,
      longitude: null,
      accuracy: null,
      timestamp: new Date().toISOString(),
      location_source: "unavailable",
    };
  }
}
```

### `frontend/src/main.tsx`

```tsx
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

### `frontend/src/types.ts`

```typescript
export type Language = 'en' | 'hi';

export type UserRole = 'gateway' | 'tourist' | 'authority';

export type ActiveModule = 'ai_hub' | 'tourist_tracking' | 'sos_map' | 'broadcast' | 'analytics_audit';

export type InterceptionReason =
  | 'Active SOS Response'
  | 'Filed Missing Person Report'
  | 'Designated Check-in Routine'
  | 'Judicial / Legal Warrant';

export type SOSStatus = 'New' | 'Units Dispatched' | 'Resolved';

export type AlertSeverity = 'Critical' | 'Warning' | 'Advisory';

export type AnomalyType =
  | 'Unusual Grouping'
  | 'Off-Route Signal Loss'
  | 'Rapid Density Spike'
  | 'Late-Night Isolated Signal'
  | 'Hazard Zone Entry';

export interface LocationPoint {
  lat: number;
  lng: number;
  address: string;
}

export interface PastSOSRecord {
  id: string;
  date: string;
  location: string;
  reason: string;
  status: 'Resolved' | 'False Alarm';
}

export interface TouristProfile {
  id: string; // e.g. TR-88219 or TR-2026-8942
  name: string;
  nationality: string;
  passportHash: string;
  photoUrl: string;
  phone: string;
  emergencyContact: string;
  emergencyRelation: string;
  hotel: string;
  currentLocation: LocationPoint;
  batteryLevel: number;
  safetyStatus: 'Safe' | 'Watch' | 'SOS Active';
  lastSeenTime: string;
  digitalBandId: string;
  pastSOSHistory: PastSOSRecord[];
  email?: string;
  digiLockerVerified?: boolean;
  aadhaarHash?: string;
  locationConsent?: 'granted' | 'declined';

  // Schema fields as per DB spec
  tourist_id?: string;
  digital_id?: string;
  full_name?: string;
  kyc_document_type?: string;
  kyc_verified?: boolean;
  emergency_contact?: string;
  preferred_language?: string;
  created_at?: string;
}

export interface SOSIncident {
  id: string; // e.g. SOS-9021
  touristId: string;
  touristName: string;
  touristPhone: string;
  location: LocationPoint;
  timestamp: string;
  status: SOSStatus;
  severity: AlertSeverity;
  unitAssigned?: string;
  hazardType: string;
  notes: string;
  audioRecordingUrl?: string;

  // Backend linkage (real API), used to PATCH the actual incident record.
  // Undefined for locally-generated demo/mock incidents that have no backend counterpart.
  backendIncidentId?: string;
}

export interface PatrollingUnit {
  id: string;
  unitName: string;
  type: 'PCR Van' | 'Quick Response Motorcycle' | 'Women Safety Squad' | 'Highway Patrol';
  unitLeader: string;
  location: LocationPoint;
  status: 'Patrolling' | 'Dispatched' | 'On Scene' | 'Standby';
  contactPhone: string;
  assignedIncidentId?: string;
}

export interface PoliceStation {
  id: string;
  name: string;
  jurisdiction: string;
  location: LocationPoint;
  contactPhone: string;
  activeOfficers: number;
  availableVehicles: number;
}

export interface Hospital {
  id: string;
  name: string;
  jurisdiction: string;
  location: LocationPoint;
  contactPhone: string;
  icuBedsAvailable: number;
  ambulancesReady: number;
}

export interface AnomalyCluster {
  id: string;
  regionName: string;
  riskScore: number; // 0 - 100
  touristDensity: number;
  anomalyType: AnomalyType;
  confidenceScore: number; // %
  descriptionEn: string;
  descriptionHi: string;
  recommendedActionEn: string;
  recommendedActionHi: string;
  coordinates: { lat: number; lng: number };
  timestamp: string;
}

export interface BroadcastAlert {
  id: string;
  senderBadge: string;
  region: string;
  radiusKm: number;
  titleEn: string;
  titleHi: string;
  bodyEn: string;
  bodyHi: string;
  severity: AlertSeverity;
  timestamp: string;
  recipientCount: number;
  deliveredCount: number;
  status: 'Active' | 'Completed' | 'Draft';
}

export interface AuditLog {
  id: string;
  timestamp: string;
  officerName: string;
  officerBadge: string;
  actionType: 'TOURIST_LOOKUP' | 'DISPATCH_UNIT' | 'BROADCAST_SENT' | 'TICKET_STATUS_CHANGE' | 'AUTHORITY_LOGIN';
  targetId: string;
  reason?: InterceptionReason | string;
  details: string;
  ipAddress: string;
  backendAuditId?: string;
}

export interface AILog {
  id: string;
  timestamp: string;
  severity: 'info' | 'warning' | 'critical';
  messageEn: string;
  messageHi: string;
  modelConfidence: number;
  region: string;
}

export interface ItineraryItem {
  id: string;
  destination: string;
  date: string;
  hotel: string;
  activities: string;
  safetyStatus: 'Safe Corridor' | 'Weather Advisory' | 'High Risk Zone';
  coordinates?: { lat: number; lng: number };
  backendItineraryId?: string;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'bot';
  text: string;
  timestamp: string;
  quickActions?: string[];
}

export type GeoFenceRiskLevel = 'Safe' | 'Caution' | 'Unsafe';

export interface GeoFenceZone {
  id: string;
  name: string;
  riskLevel: GeoFenceRiskLevel;
  description: string;
  center: { lat: number; lng: number };
  radiusKm: number;
}

export type SosStepState = 'ready' | 'confirming' | 'sending' | 'success' | 'error' | 'active';
```
