from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, status

from routers.locations import _in_memory_location_store
from routers.incidents import _in_memory_incident_store
from routers.tourists import _get_tourist_or_404
from schemas.incident import IncidentResponse
from schemas.location import LocationResponse
from schemas.sos import SOSCreate, SOSResponse

router = APIRouter(prefix="/sos", tags=["sos"])

# Temporary in-memory storage for local API development only.
# Replace with PostgreSQL queries when database connection details are provided.
_in_memory_sos_store: dict[UUID, SOSResponse] = {}


@router.post("", response_model=SOSResponse, status_code=status.HTTP_201_CREATED)
def trigger_sos(payload: SOSCreate) -> SOSResponse:
    tourist = _get_tourist_or_404(payload.tourist_id)

    now = datetime.now(timezone.utc)
    incident_id = uuid4()
    sos_id = uuid4()

    location_id = payload.location_id
    if location_id is None and (payload.latitude is not None or payload.longitude is not None):
        location_id = uuid4()

    if location_id is not None:
        if location_id not in _in_memory_location_store:
            _in_memory_location_store[location_id] = LocationResponse(
                location_id=location_id,
                latitude=payload.latitude,
                longitude=payload.longitude,
                recorded_at=now,
            )

    incident = IncidentResponse(
        incident_id=incident_id,
        tourist_id=tourist.tourist_id,
        location_id=location_id,
        incident_type="SOS",
        severity=payload.severity or "HIGH",
        status="OPEN",
        description=payload.description or "SOS Emergency Request",
        created_at=now,
    )
    _in_memory_incident_store[incident_id] = incident


    sos_response = SOSResponse(
        sos_id=sos_id,
        tourist_id=tourist.tourist_id,
        incident_id=incident_id,
        location_id=payload.location_id,
        incident_type="SOS",
        severity=incident.severity,
        status=incident.status,
        description=incident.description,
        triggered_at=now,
        created_at=now,
        trigger_source=payload.trigger_source or "APP",
        sos_status="ACTIVE",
    )
    _in_memory_sos_store[sos_id] = sos_response
    return sos_response
