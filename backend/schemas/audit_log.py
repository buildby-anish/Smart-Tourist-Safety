from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class AuditLogCreate(BaseModel):
    action_type: str
    target_id: str
    reason: str | None = None
    details: str | None = None
    ip_address: str | None = None


class AuditLogRecord(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    audit_id: UUID
    authority_id: UUID
    action_type: str
    target_id: str
    reason: str | None = None
    details: str | None = None
    ip_address: str | None = None
    created_at: datetime
