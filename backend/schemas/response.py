from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class ResponseCreate(BaseModel):
    responder_unit: str | None = None
    action_taken: str | None = None
    resolved_at: datetime | None = None
    # Optional explicit override — defaults to the authenticated authority's
    # own authority_id when omitted.
    authority_id: UUID | None = None


class ResponseRecord(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    response_id: UUID
    incident_id: UUID
    responder_unit: str | None = None
    action_taken: str | None = None
    resolved_at: datetime | None = None
    authority_id: UUID
