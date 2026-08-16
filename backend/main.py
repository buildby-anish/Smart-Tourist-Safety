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
