from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class IncidentCreate(BaseModel):
    tourist_id: UUID
    location_id: UUID | None = None
    incident_type: str | None = "OTHER"
    severity: str | None = "MEDIUM"
    status: str = "OPEN"
    description: str | None = None
    authority_id: UUID | None = None


class IncidentUpdate(BaseModel):
    status: str | None = None
    severity: str | None = None
    description: str | None = None


class IncidentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    incident_id: UUID
    tourist_id: UUID
    location_id: UUID | None = None
    incident_type: str | None = None
    severity: str | None = None
    status: str
    description: str | None = None
    created_at: datetime
    authority_id: UUID | None = None
