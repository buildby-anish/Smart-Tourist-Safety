import os
from dotenv import load_dotenv

# Load env variables from backend/.env if it exists
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

class Config:
    DATABASE_URL = os.getenv("DATABASE_URL", "")
    SUPABASE_URL = os.getenv("SUPABASE_URL", "")
    SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", os.getenv("SUPABASE_PUBLISHABLE_KEY", ""))
    # Server-only secret (never sent to the frontend). Used exclusively to
    # create already-confirmed tourist/authority accounts via Supabase's
    # Admin API, since app users are verified out-of-band via phone OTP
    # against a synthetic, unreachable email address (see routers/auth.py
    # register()). Falls back to "" (unset) so existing deployments keep
    # working via the public signup endpoint until this is configured.
    SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    JWT_SECRET = os.getenv("JWT_SECRET", "").strip().strip('"').strip("'").replace("\\n", "\n")
    CORS_ALLOWED_ORIGINS = [
        o.strip() for o in os.getenv("CORS_ALLOWED_ORIGINS", "").split(",") if o.strip()
    ]
    # Controls whether generated OTPs are written to the application logs
    # (visible in Railway deployment logs) for local/staging debugging.
    # Must be explicitly disabled in production. Defaults to "true" to match
    # current dev/testing workflow; set OTP_DEBUG_LOG=false in Railway once
    # real SMS delivery is wired up.
    OTP_DEBUG_LOG = os.getenv("OTP_DEBUG_LOG", "true").strip().lower() == "true"

    @classmethod
    def is_supabase_configured(cls) -> bool:
        return bool(cls.SUPABASE_URL and cls.SUPABASE_ANON_KEY)

    @classmethod
    def has_service_role(cls) -> bool:
        return bool(cls.SUPABASE_URL and cls.SUPABASE_SERVICE_ROLE_KEY)
