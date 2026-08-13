from uuid import UUID

from fastapi import APIRouter, HTTPException, status

from routers.alerts import _in_memory_alert_store
from routers.incidents import _get_incident_or_404, _in_memory_incident_store
from routers.locations import _in_memory_location_store
from routers.tourists import _get_tourist_or_404
from schemas.alert import AlertResponse
from schemas.incident import IncidentResponse
from schemas.location import LocationResponse
from schemas.tourist import TouristResponse

from schemas.auth import LoginRequest, LoginResponse
from routers.auth import login as auth_login

router = APIRouter(prefix="/authority", tags=["authority"])


@router.post("/login", response_model=LoginResponse)
def authority_login(payload: LoginRequest) -> LoginResponse:
    login_resp = auth_login(payload)
    if login_resp.user_type != "authority":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account is not an authority account",
        )
    return login_resp




@router.get("/alerts", response_model=list[AlertResponse])
def get_authority_alerts() -> list[AlertResponse]:
    return list(_in_memory_alert_store.values())


@router.get("/incidents", response_model=list[IncidentResponse])
def get_authority_incidents() -> list[IncidentResponse]:
    return list(_in_memory_incident_store.values())


@router.get("/tourists/{tourist_id}", response_model=TouristResponse)
def get_authority_tourist_details(tourist_id: UUID) -> TouristResponse:
    return _get_tourist_or_404(tourist_id)


@router.get("/incidents/{incident_id}/location", response_model=LocationResponse)
def get_authority_incident_location(incident_id: UUID) -> LocationResponse:
    incident = _get_incident_or_404(incident_id)

    if incident.location_id is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Incident has no location assigned",
        )

    location = _in_memory_location_store.get(incident.location_id)
    if location is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Location not found",
        )

    return location
