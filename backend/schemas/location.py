from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class PointOfInterestCreate(BaseModel):
    name: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    risk_level: str | None = None
    recorded_at: datetime | None = None


class PointOfInterestResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    poi_id: UUID
    name: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    risk_level: str | None = None
    recorded_at: datetime | None = None


class LocationPingCreate(BaseModel):
    """A live GPS ping from a tourist's device."""
    latitude: float
    longitude: float
    speed: float | None = None
    heading: float | None = None
    recorded_at: datetime | None = None


class LocationPingResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tourist_id: UUID
    latitude: float
    longitude: float
    speed: float | None = None
    heading: float | None = None
    recorded_at: datetime


class CoordinatesResponse(BaseModel):
    latitude: float | None = None
    longitude: float | None = None


class LiveTouristLocation(BaseModel):
    """
    One tourist's current/last-known position, for the authority
    dashboard's initial map hydration (GET /authority/locations/live).
    Deliberately mirrors LocationPingResponse's field names/types rather
    than duplicating a divergent shape, plus full_name (for the map
    marker label) and safety_status (derived from open incidents, not
    stored — see routers/authority.py).
    """
    tourist_id: UUID
    full_name: str | None = None
    latitude: float
    longitude: float
    speed: float | None = None
    heading: float | None = None
    recorded_at: datetime
    safety_status: str  # "Safe" | "SOS Active" — mirrors frontend TouristProfile['safetyStatus']
