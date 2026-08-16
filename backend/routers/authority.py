from uuid import UUID
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status

from db import is_db_active, get_db_cursor, get_authenticated_cursor
from routers.auth import login as auth_login, require_authority
from schemas.auth import LoginRequest, LoginResponse, SessionResponse
from schemas.alert import AlertResponse
from schemas.incident import IncidentResponse
from schemas.location import LocationResponse
from schemas.tourist import TouristResponse

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
def get_authority_alerts(
    current_user: SessionResponse = Depends(require_authority)
) -> list[AlertResponse]:
    # 1. Fallback Mode
    if not is_db_active():
        from routers.alerts import _in_memory_alert_store
        return list(_in_memory_alert_store.values())

    # 2. Database Mode
    try:
        with get_authenticated_cursor(current_user.auth_user_id) as cur:
            cur.execute("""
                SELECT alert_id, incident_id, channel, recipient, sent_at
                FROM public.alerts;
            """)
            rows = cur.fetchall()
            return [
                AlertResponse(
                    alert_id=row[0],
                    incident_id=row[1],
                    channel=row[2],
                    recipient=row[3],
                    sent_at=row[4]
                )
                for row in rows
            ]
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve authority alerts: {str(e)}"
        )


@router.get("/incidents", response_model=list[IncidentResponse])
def get_authority_incidents(
    current_user: SessionResponse = Depends(require_authority)
) -> list[IncidentResponse]:
    # 1. Fallback Mode
    if not is_db_active():
        from routers.incidents import _in_memory_incident_store
        return list(_in_memory_incident_store.values())

    # 2. Database Mode
    try:
        with get_authenticated_cursor(current_user.auth_user_id) as cur:
            # New SOS-triggered incidents are created with authority_id = NULL
            # (unassigned/unclaimed). RLS on this table only allows an
            # authority to read incidents assigned to them, which would hide
            # every unassigned incident from every authority dashboard.
            # Explicitly widen the query to also include unassigned
            # incidents so dispatchers can see and claim new incidents.
            cur.execute("""
                SELECT incident_id, tourist_id, location_id, incident_type, severity, status, description, created_at, authority_id
                FROM public.incidents
                WHERE authority_id IS NULL OR authority_id = %s;
            """, (current_user.authority_id,))
            rows = cur.fetchall()
            return [
                IncidentResponse(
                    incident_id=row[0],
                    tourist_id=row[1],
                    location_id=row[2],
                    incident_type=row[3],
                    severity=row[4],
                    status=row[5],
                    description=row[6],
                    created_at=row[7],
                    authority_id=row[8]
                )
                for row in rows
            ]
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve authority incidents: {str(e)}"
        )


@router.get("/tourists/{tourist_id}", response_model=TouristResponse)
def get_authority_tourist_details(
    tourist_id: UUID,
    current_user: SessionResponse = Depends(require_authority)
) -> TouristResponse:
    # 1. Fallback Mode
    if not is_db_active():
        from routers.tourists import _get_tourist_or_404
        return _get_tourist_or_404(tourist_id)

    # 2. Database Mode
    try:
        with get_authenticated_cursor(current_user.auth_user_id) as cur:
            cur.execute("""
                SELECT tourist_id, digital_id, full_name, kyc_document_type, kyc_verified, phone, email, emergency_contact, preferred_language, created_at
                FROM public.tourists
                WHERE tourist_id = %s;
            """, (tourist_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Tourist profile not found",
                )
            return TouristResponse(
                tourist_id=row[0],
                digital_id=row[1],
                full_name=row[2],
                kyc_document_type=row[3],
                kyc_verified=row[4],
                phone=row[5],
                email=row[6],
                emergency_contact=row[7],
                preferred_language=row[8],
                created_at=row[9]
            )
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve tourist profile: {str(e)}"
        )


@router.get("/incidents/{incident_id}/location", response_model=LocationResponse)
def get_authority_incident_location(
    incident_id: UUID,
    current_user: SessionResponse = Depends(require_authority)
) -> LocationResponse:
    # 1. Fallback Mode
    if not is_db_active():
        from routers.incidents import _get_incident_or_404
        from routers.locations import _in_memory_location_store
        
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

    # 2. Database Mode
    try:
        with get_authenticated_cursor(current_user.auth_user_id) as cur:
            cur.execute("SELECT location_id FROM public.incidents WHERE incident_id = %s;", (incident_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Incident not found",
                )
            loc_id = row[0]
            if not loc_id:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Incident has no location assigned",
                )
                
            cur.execute("""
                SELECT location_id, name, latitude, longitude, risk_level, recorded_at
                FROM public.locations
                WHERE location_id = %s;
            """, (loc_id,))
            loc_row = cur.fetchone()
            if not loc_row:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Location not found",
                )
            return LocationResponse(
                location_id=loc_row[0],
                name=loc_row[1],
                latitude=float(loc_row[2]) if loc_row[2] is not None else None,
                longitude=float(loc_row[3]) if loc_row[3] is not None else None,
                risk_level=loc_row[4],
                recorded_at=loc_row[5]
            )
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve incident location: {str(e)}"
        )
