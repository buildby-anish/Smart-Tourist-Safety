from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class AlertCreate(BaseModel):
    incident_id: UUID
    channel: str
    recipient: str
    sent_at: datetime | None = None


class AlertResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    alert_id: UUID
    incident_id: UUID
    channel: str
    recipient: str
    sent_at: datetime
