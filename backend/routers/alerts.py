from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, status

from routers.incidents import _get_incident_or_404
from schemas.alert import AlertCreate, AlertResponse

router = APIRouter(prefix="/alerts", tags=["alerts"])

# Temporary in-memory storage for local API development only.
# Replace with PostgreSQL queries when database connection details are provided.
_in_memory_alert_store: dict[UUID, AlertResponse] = {}


@router.post("", response_model=AlertResponse, status_code=status.HTTP_201_CREATED)
def create_alert(payload: AlertCreate) -> AlertResponse:
    _get_incident_or_404(payload.incident_id)

    alert = AlertResponse(
        alert_id=uuid4(),
        incident_id=payload.incident_id,
        channel=payload.channel,
        recipient=payload.recipient,
        sent_at=payload.sent_at or datetime.now(timezone.utc),
    )
    _in_memory_alert_store[alert.alert_id] = alert
    return alert


@router.get("", response_model=list[AlertResponse])
def list_alerts(incident_id: UUID | None = None) -> list[AlertResponse]:
    alerts = list(_in_memory_alert_store.values())
    if incident_id is not None:
        alerts = [a for a in alerts if a.incident_id == incident_id]
    return alerts
