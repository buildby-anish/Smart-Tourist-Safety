import logging

from fastapi import HTTPException

logger = logging.getLogger("seed")

# Fixed, well-known credentials so this is reproducible across
# environments/deploys — not meant as a real production authority account.
# Change or remove this before shipping to real users; it exists purely so
# the "Official Sign In" page (badge ID + password) has something to log
# into during development/testing.
DEMO_AUTHORITY_USERNAME = "authority-demo"
DEMO_AUTHORITY_PASSWORD = "Demo@12345"


def ensure_demo_authority_account() -> None:
    """
    Creates one demo authority account at backend startup, if none exists
    yet — mirrors the self-healing pattern already used for schema/policy
    setup (see database/schema_manager.py). Safe to call on every boot:
    register() already converts "already registered" into a 409, which is
    treated here as "already seeded, nothing to do" rather than an error.

    This reuses routers.auth.register() directly (not an HTTP call to
    itself) — it's a plain function with no FastAPI request-scoped
    dependencies, so calling it in-process at startup is safe and runs
    through the exact same validation/DB-write path as a real signup,
    rather than duplicating that logic here.
    """
    from db import is_db_active
    from routers.auth import register
    from schemas.auth import RegisterRequest

    try:
        register(RegisterRequest(
            username=DEMO_AUTHORITY_USERNAME,
            password=DEMO_AUTHORITY_PASSWORD,
            user_type="authority",
            mfa_enabled=False,
        ))
        mode = "database" if is_db_active() else "offline/mock mode (resets on restart)"
        logger.info(
            f"[SEED] Demo authority account ready ({mode}). "
            f"Sign in at the Official Sign In page with "
            f"Badge ID: {DEMO_AUTHORITY_USERNAME} / Auth Code: {DEMO_AUTHORITY_PASSWORD}"
        )
    except HTTPException as e:
        if e.status_code == 409:
            logger.info(f"[SEED] Demo authority account already exists ({DEMO_AUTHORITY_USERNAME}) — skipping.")
        else:
            logger.warning(f"[SEED] Could not create demo authority account: {e.detail}")
    except Exception as e:
        # Never let seeding failures block the app from starting.
        logger.warning(f"[SEED] Could not create demo authority account: {e}")
