from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import Config
from database.schema_manager import run_database_schema_check
from routers import alerts, audit_logs, auth, authority, chat, geofences, incidents, itinerary, locations, points_of_interest, sos, tourists, ws
from document_verification import router as document_verification_router

# Execute automatic database schema check and updates
run_database_schema_check()

app = FastAPI(title="Smart Tourist Safety API")

# Starlette's CORSMiddleware raises a ValueError at startup if
# allow_credentials=True is combined with a wildcard ("*") origin, and an
# empty allow_origins list is equally unusable for a credentialed API.
#
# allow_origin_regex is a standing safety net, not just an empty-config
# fallback: it must apply *whenever an origin doesn't exactly match
# allow_origins*, regardless of whether CORS_ALLOWED_ORIGINS is also set,
# because Vercel issues a new preview-deployment origin on every branch/PR
# and the production domain can change independently of this env var.
# Previously the regex was only set in the empty/"*" branch, so as soon as
# CORS_ALLOWED_ORIGINS held even one real value, any origin that didn't
# exactly match that fixed list got Starlette's 400 "Disallowed CORS
# origin" on preflight — surfacing to the browser as an opaque "Failed to
# fetch" network error.
_configured_origins = [o for o in Config.CORS_ALLOWED_ORIGINS if o != "*"]
_cors_origins = list(dict.fromkeys(_configured_origins + ["http://localhost:3000", "http://localhost:5173"]))
_cors_origin_regex = r"https://.*|http://localhost(:\d+)?|http://127\.0\.0\.1(:\d+)?"

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_origin_regex=_cors_origin_regex,
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
app.include_router(points_of_interest.router, prefix="/api/v1")
app.include_router(geofences.router, prefix="/api/v1")
app.include_router(ws.router, prefix="/api/v1")
app.include_router(itinerary.router, prefix="/api/v1")
app.include_router(audit_logs.router, prefix="/api/v1")
app.include_router(chat.router, prefix="/api/v1")
# Standalone in-memory OCR/identity verification module (see
# backend/document_verification/README notes): sessions live only in this
# process's memory and are lost on restart/redeploy — there's no
# persistent verification audit trail. What IS persisted is whatever the
# frontend PATCHes onto tourist_profiles (kyc_status, govt_id_type) once a
# verification completes, via the existing /tourists/{id} endpoint.
app.include_router(document_verification_router, prefix="/api/v1/verifications")
