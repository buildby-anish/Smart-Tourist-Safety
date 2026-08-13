from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class SOSCreate(BaseModel):
    tourist_id: UUID
    location_id: UUID | None = None
    latitude: float | None = None
    longitude: float | None = None
    description: str | None = None
    severity: str | None = "HIGH"
    trigger_source: str | None = "APP"


class SOSResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    sos_id: UUID
    tourist_id: UUID
    incident_id: UUID
    location_id: UUID | None = None
    incident_type: str = "SOS"
    severity: str | None = None
    status: str = "OPEN"
    description: str | None = None
    triggered_at: datetime
    created_at: datetime
    trigger_source: str | None = "APP"
    sos_status: str = "ACTIVE"
