from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class Destination(BaseModel):
    name: str
    latitude: float | None = None
    longitude: float | None = None
    activity_tags: list[str] = []
    planned_arrival: datetime | None = None
    planned_departure: datetime | None = None


class ItineraryCreate(BaseModel):
    title: str
    destinations: list[Destination] = []
    start_date: date | None = None
    end_date: date | None = None


class ItineraryUpdate(BaseModel):
    title: str | None = None
    destinations: list[Destination] | None = None
    start_date: date | None = None
    end_date: date | None = None


class ItineraryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    tourist_id: UUID
    title: str
    destinations: list[Destination] = []
    start_date: date | None = None
    end_date: date | None = None
    created_at: datetime
