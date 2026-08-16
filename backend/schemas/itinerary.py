from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class ItineraryEntryCreate(BaseModel):
    location_id: UUID | None = None
    # Optional convenience fields — when location_id is not supplied, a
    # location record is resolved/created from a plain destination name
    # (and optional coordinates), mirroring how incidents/sos resolve
    # locations elsewhere in the backend.
    destination_name: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    planned_arrival: datetime | None = None
    planned_departure: datetime | None = None


class ItineraryEntryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    itinerary_id: UUID
    tourist_id: UUID
    location_id: UUID
    location_name: str | None = None
    planned_arrival: datetime | None = None
    planned_departure: datetime | None = None
