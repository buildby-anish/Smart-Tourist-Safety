from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class SOSCreate(BaseModel):
    tourist_id: UUID
    latitude: float
    longitude: float
    battery_status: int | None = None
    trigger_source: str | None = "APP"


class SOSResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    sos_id: UUID
    tourist_id: UUID
    incident_id: UUID | None = None
    latitude: float
    longitude: float
    battery_status: int | None = None
    authority_id: UUID | None = None
    triggered_at: datetime
    trigger_source: str | None = "APP"
    sos_status: str = "PENDING"  # PENDING | ACKNOWLEDGED | DISPATCHED | RESOLVED
