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
