from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import Config
from routers import alerts, auth, authority, incidents, locations, sos, tourists

app = FastAPI(title="Smart Tourist Safety API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=Config.CORS_ALLOWED_ORIGINS,
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
