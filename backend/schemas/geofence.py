from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator


class GeofenceCreate(BaseModel):
    name: str
    zone_type: str  # SAFE | BUFFER | RESTRICTED
    coordinates: list[list[float]]  # [[lng, lat], [lng, lat], ...] closed ring
    is_active: bool = True

    @field_validator("zone_type")
    @classmethod
    def _validate_zone_type(cls, v: str) -> str:
        v = v.upper()
        if v not in ("SAFE", "BUFFER", "RESTRICTED"):
            raise ValueError("zone_type must be SAFE, BUFFER, or RESTRICTED")
        return v

    @field_validator("coordinates")
    @classmethod
    def _validate_ring(cls, v: list[list[float]]) -> list[list[float]]:
        if len(v) < 4:
            raise ValueError("coordinates must form a closed ring with at least 4 points (first == last)")
        if v[0] != v[-1]:
            v = v + [v[0]]
        return v


class GeofenceUpdate(BaseModel):
    name: str | None = None
    zone_type: str | None = None
    coordinates: list[list[float]] | None = None
    is_active: bool | None = None


class GeofenceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    zone_type: str
    coordinates: list[list[float]]
    is_active: bool
    created_at: datetime


class GeofenceBreachResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tourist_id: UUID
    geofence_id: UUID
    latitude: float
    longitude: float
    breach_time: datetime
    sms_sent: bool
