from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, HTTPException, status

from routers.locations import _in_memory_location_store
from routers.tourists import _get_tourist_or_404
from schemas.incident import IncidentCreate, IncidentResponse, IncidentUpdate
from schemas.location import LocationResponse

router = APIRouter(prefix="/incidents", tags=["incidents"])

# Temporary in-memory storage for local API development only.
# Replace with PostgreSQL queries when database connection details are provided.
_in_memory_incident_store: dict[UUID, IncidentResponse] = {}


def _get_incident_or_404(incident_id: UUID) -> IncidentResponse:
    incident = _in_memory_incident_store.get(incident_id)
    if incident is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Incident not found",
        )
    return incident


@router.post("", response_model=IncidentResponse, status_code=status.HTTP_201_CREATED)
def create_incident(payload: IncidentCreate) -> IncidentResponse:
    _get_tourist_or_404(payload.tourist_id)

    now = datetime.now(timezone.utc)
    if payload.location_id is not None and payload.location_id not in _in_memory_location_store:
        _in_memory_location_store[payload.location_id] = LocationResponse(
            location_id=payload.location_id,
            recorded_at=now,
        )

    incident = IncidentResponse(
        incident_id=uuid4(),
        tourist_id=payload.tourist_id,
        location_id=payload.location_id,
        incident_type=payload.incident_type or "OTHER",
        severity=payload.severity or "MEDIUM",
        status=payload.status or "OPEN",
        description=payload.description,
        created_at=now,
        authority_id=payload.authority_id,
    )
    _in_memory_incident_store[incident.incident_id] = incident
    return incident



@router.get("", response_model=list[IncidentResponse])
def list_incidents(status: str | None = None) -> list[IncidentResponse]:
    incidents = list(_in_memory_incident_store.values())
    if status is not None:
        incidents = [i for i in incidents if i.status.lower() == status.lower()]
    return incidents


@router.get("/{incident_id}", response_model=IncidentResponse)
def get_incident(incident_id: UUID) -> IncidentResponse:
    return _get_incident_or_404(incident_id)


@router.patch("/{incident_id}", response_model=IncidentResponse)
def update_incident(incident_id: UUID, payload: IncidentUpdate) -> IncidentResponse:
    incident = _get_incident_or_404(incident_id)
    update_data = payload.model_dump(exclude_unset=True)

    updated = incident.model_copy(update=update_data)
    _in_memory_incident_store[incident_id] = updated
    return updated
