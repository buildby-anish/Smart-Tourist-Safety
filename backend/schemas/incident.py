from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class IncidentCreate(BaseModel):
    tourist_id: UUID
    latitude: float | None = None
    longitude: float | None = None
    incident_type: str | None = "MANUAL"  # SOS | GEOFENCE_BREACH | MANUAL
    priority: str | None = "LOW"  # LOW | MEDIUM | HIGH | CRITICAL
    status: str = "OPEN"
    description: str | None = None
    assigned_officer_id: UUID | None = None


class IncidentUpdate(BaseModel):
    status: str | None = None
    priority: str | None = None
    ai_risk_score: int | None = None
    description: str | None = None
    assigned_officer_id: UUID | None = None


class IncidentBulkDeleteRequest(BaseModel):
    incident_ids: list[UUID]


class IncidentBulkDeleteResponse(BaseModel):
    deleted_ids: list[UUID]
    not_found_ids: list[UUID]


class IncidentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    incident_type: str | None = None
    tourist_id: UUID
    latitude: float | None = None
    longitude: float | None = None
    ai_risk_score: int | None = None
    priority: str | None = None
    status: str
    description: str | None = None
    assigned_officer_id: UUID | None = None
    created_at: datetime
