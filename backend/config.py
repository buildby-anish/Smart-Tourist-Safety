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

    # SMTP config for sending real email OTPs (see routers/auth.py
    # send_email_otp). Any standard SMTP relay works (SendGrid, Mailgun,
    # AWS SES, Gmail app-password, etc.) — just set these on Railway. If
    # SMTP_HOST is unset, email OTP falls back to debug-log-only mode
    # (same pattern as phone OTP without an SMS gateway configured), so
    # signup still works end-to-end locally without real credentials.
    SMTP_HOST = os.getenv("SMTP_HOST", "")
    SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USER = os.getenv("SMTP_USER", "")
    SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
    SMTP_FROM = os.getenv("SMTP_FROM", "") or SMTP_USER

    @classmethod
    def is_smtp_configured(cls) -> bool:
        return bool(cls.SMTP_HOST and cls.SMTP_USER and cls.SMTP_PASSWORD)

    # Groq (OpenAI-compatible) API key for the travel-assistant chat
    # endpoint (see routers/ai_assistant.py). Free tier, no card required:
    # https://console.groq.com. If unset, /ai/chat returns 503 and the
    # frontend falls back to its local rule-based assistant instead of
    # breaking the Ask AI feature entirely.
    GROQ_API_KEY = os.getenv("GROQ_API_KEY", os.getenv("GROQ_API", os.getenv("GROQ_KEY", ""))).strip().strip('"').strip("'")
    GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-20b").strip().strip('"').strip("'")

    @classmethod
    def is_groq_configured(cls) -> bool:
        return bool(cls.GROQ_API_KEY)

    @classmethod
    def is_supabase_configured(cls) -> bool:
        return bool(cls.SUPABASE_URL and cls.SUPABASE_ANON_KEY)

    @classmethod
    def has_service_role(cls) -> bool:
        return bool(cls.SUPABASE_URL and cls.SUPABASE_SERVICE_ROLE_KEY)

    # Ethereum Sepolia testnet config for KYC anchoring (see
    # backend/blockchain/). If any of these three are unset,
    # blockchain/service.py falls back to the offline mock ledger
    # (public.chain_blocks) instead of failing KYC verification outright —
    # same "degrade, don't break" posture as GROQ_API_KEY/SMTP above.
    SEPOLIA_RPC_URL = os.getenv("SEPOLIA_RPC_URL", "").strip()
    SEPOLIA_PRIVATE_KEY = os.getenv("SEPOLIA_PRIVATE_KEY", "").strip()
    SEPOLIA_CONTRACT_ADDRESS = os.getenv("SEPOLIA_CONTRACT_ADDRESS", "").strip()

    @classmethod
    def is_sepolia_configured(cls) -> bool:
        return bool(cls.SEPOLIA_RPC_URL and cls.SEPOLIA_PRIVATE_KEY and cls.SEPOLIA_CONTRACT_ADDRESS)

    # DigiLocker / API Setu OAuth2 config (see backend/digilocker/). Unset
    # by default -> MockDigiLockerAdapter is used, so local/demo KYC never
    # depends on real DigiLocker sandbox credentials being provisioned.
    DIGILOCKER_CLIENT_ID = os.getenv("DIGILOCKER_CLIENT_ID", "").strip()
    DIGILOCKER_CLIENT_SECRET = os.getenv("DIGILOCKER_CLIENT_SECRET", "").strip()
    DIGILOCKER_REDIRECT_URI = os.getenv("DIGILOCKER_REDIRECT_URI", "").strip()

    @classmethod
    def is_digilocker_configured(cls) -> bool:
        return bool(cls.DIGILOCKER_CLIENT_ID and cls.DIGILOCKER_CLIENT_SECRET and cls.DIGILOCKER_REDIRECT_URI)
