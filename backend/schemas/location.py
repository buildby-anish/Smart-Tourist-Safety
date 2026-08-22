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
