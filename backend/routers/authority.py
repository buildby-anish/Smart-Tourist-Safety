from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status

from db import is_db_active, get_authenticated_cursor
from routers.auth import login as auth_login, require_authority
from schemas.auth import LoginRequest, LoginResponse, SessionResponse
from schemas.alert import AlertResponse
from schemas.incident import IncidentResponse
from schemas.location import CoordinatesResponse
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
                SELECT id, incident_type, tourist_id, latitude, longitude, ai_risk_score,
                       priority, status, description, assigned_officer_id, created_at
                FROM public.incidents
                WHERE assigned_officer_id IS NULL OR assigned_officer_id = %s
                ORDER BY ai_risk_score DESC NULLS LAST, created_at DESC;
            """, (current_user.authority_id,))
            rows = cur.fetchall()
            return [
                IncidentResponse(
                    id=row[0],
                    incident_type=row[1],
                    tourist_id=row[2],
                    latitude=float(row[3]) if row[3] is not None else None,
                    longitude=float(row[4]) if row[4] is not None else None,
                    ai_risk_score=row[5],
                    priority=row[6],
                    status=row[7],
                    description=row[8],
                    assigned_officer_id=row[9],
                    created_at=row[10],
                )
                for row in rows
            ]
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve authority incidents: {str(e)}"
        )


@router.get("/tourists/{profile_id}", response_model=TouristResponse)
def get_authority_tourist_details(
    profile_id: UUID,
    current_user: SessionResponse = Depends(require_authority)
) -> TouristResponse:
    # 1. Fallback Mode
    if not is_db_active():
        from routers.tourists import _get_tourist_or_404
        return _get_tourist_or_404(profile_id)

    # 2. Database Mode
    try:
        with get_authenticated_cursor(current_user.auth_user_id) as cur:
            from routers.tourists import _PROFILE_COLUMNS, _row_to_response
            cur.execute(f"""
                SELECT {_PROFILE_COLUMNS}
                FROM public.tourist_profiles
                WHERE id = %s;
            """, (profile_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Tourist profile not found",
                )
            return _row_to_response(row)
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve tourist profile: {str(e)}"
        )


@router.get("/incidents/{incident_id}/location", response_model=CoordinatesResponse)
def get_authority_incident_location(
    incident_id: UUID,
    current_user: SessionResponse = Depends(require_authority)
) -> CoordinatesResponse:
    # Incidents carry their own latitude/longitude directly (directive
    # §4: incidents.latitude / incidents.longitude) rather than pointing
    # at a point-of-interest row, so this is now a direct field read
    # instead of a join through points_of_interest.

    # 1. Fallback Mode
    if not is_db_active():
        from routers.incidents import _get_incident_or_404
        incident = _get_incident_or_404(incident_id)
        return CoordinatesResponse(latitude=incident.latitude, longitude=incident.longitude)

    # 2. Database Mode
    try:
        with get_authenticated_cursor(current_user.auth_user_id) as cur:
            cur.execute("SELECT latitude, longitude FROM public.incidents WHERE id = %s;", (incident_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Incident not found",
                )
            return CoordinatesResponse(
                latitude=float(row[0]) if row[0] is not None else None,
                longitude=float(row[1]) if row[1] is not None else None,
            )
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve incident location: {str(e)}"
        )
