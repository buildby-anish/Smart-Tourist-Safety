from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status

from db import is_db_active, get_db_cursor, get_authenticated_cursor
from routers.auth import get_current_user, require_authority
from schemas.auth import SessionResponse
from schemas.incident import IncidentCreate, IncidentResponse, IncidentUpdate
from schemas.location import LocationResponse
from schemas.response import ResponseCreate, ResponseRecord

router = APIRouter(prefix="/incidents", tags=["incidents"])

# Temporary in-memory storage for local API development only (fallback).
_in_memory_incident_store: dict[UUID, IncidentResponse] = {}
_in_memory_response_store: dict[UUID, ResponseRecord] = {}


def _get_incident_or_404(incident_id: UUID, current_user: SessionResponse | None = None) -> IncidentResponse:
    # 1. Fallback Mode
    if not is_db_active():
        incident = _in_memory_incident_store.get(incident_id)
        if incident is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Incident not found",
            )
        return incident

    # 2. Database Mode
    try:
        if current_user:
            cursor_ctx = get_authenticated_cursor(current_user.auth_user_id)
        else:
            cursor_ctx = get_db_cursor()
            
        with cursor_ctx as cur:
            cur.execute("""
                SELECT incident_id, tourist_id, location_id, incident_type, severity, status, description, created_at, authority_id
                FROM public.incidents
                WHERE incident_id = %s;
            """, (incident_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Incident not found",
                )
            return IncidentResponse(
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
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Database query failed: {str(e)}"
        )


@router.post("", response_model=IncidentResponse, status_code=status.HTTP_201_CREATED)
def create_incident(
    payload: IncidentCreate,
    current_user: SessionResponse = Depends(get_current_user)
) -> IncidentResponse:
    # 1. Fallback Mode
    if not is_db_active():
        from routers.tourists import _get_tourist_or_404
        from routers.locations import _in_memory_location_store
        
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

    # 2. Database Mode
    # SECURITY: force a tourist caller's incidents to their own tourist_id
    # (payload.tourist_id was previously trusted verbatim, letting a tourist
    # file an incident "as" another tourist_id). Authority callers may still
    # file an incident on behalf of a tourist (e.g. intake at a police desk).
    if current_user.user_type == "tourist":
        if current_user.tourist_id is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No tourist profile is associated with this account.",
            )
        payload.tourist_id = current_user.tourist_id

    now = datetime.now(timezone.utc)
    incident_id = uuid4()
    
    try:
        with get_authenticated_cursor(current_user.auth_user_id, commit=True) as cur:
            # Verify tourist profile exists
            cur.execute("SELECT tourist_id FROM public.tourists WHERE tourist_id = %s;", (payload.tourist_id,))
            if not cur.fetchone():
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Tourist profile not found",
                )
                
            # Verify location exists, or resolve/create one — incidents.location_id is NOT NULL
            loc_id = payload.location_id
            if loc_id:
                cur.execute("SELECT location_id FROM public.locations WHERE location_id = %s;", (loc_id,))
                if not cur.fetchone():
                    # Generate automatic location entry
                    cur.execute("""
                        INSERT INTO public.locations (location_id, name, latitude, longitude, risk_level, recorded_at)
                        VALUES (%s, %s, %s, %s, %s, %s);
                    """, (loc_id, "Geocoded Tourist Incident Location", 0.0, 0.0, "LOW", now))
            else:
                # No location_id provided — create one from supplied coordinates (or a default placeholder)
                loc_id = uuid4()
                cur.execute("""
                    INSERT INTO public.locations (location_id, name, latitude, longitude, risk_level, recorded_at)
                    VALUES (%s, %s, %s, %s, %s, %s);
                """, (
                    loc_id, "Geocoded Tourist Incident Location",
                    payload.latitude if payload.latitude is not None else 0.0,
                    payload.longitude if payload.longitude is not None else 0.0,
                    "LOW", now
                ))
            
            cur.execute("""
                INSERT INTO public.incidents (incident_id, tourist_id, location_id, incident_type, severity, status, description, created_at, authority_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING incident_id, tourist_id, location_id, incident_type, severity, status, description, created_at, authority_id;
            """, (
                incident_id, payload.tourist_id, loc_id, payload.incident_type or "OTHER",
                payload.severity or "MEDIUM", payload.status or "OPEN", payload.description, now, payload.authority_id
            ))
            row = cur.fetchone()
            return IncidentResponse(
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
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create incident: {str(e)}"
        )


@router.get("", response_model=list[IncidentResponse])
def list_incidents(
    status_filter: str | None = Query(default=None, alias="status"),
    current_user: SessionResponse = Depends(get_current_user)
) -> list[IncidentResponse]:
    # 1. Fallback Mode
    if not is_db_active():
        incidents = list(_in_memory_incident_store.values())
        if status_filter is not None:
            incidents = [i for i in incidents if i.status.lower() == status_filter.lower()]
        return incidents

    # 2. Database Mode
    try:
        # Run using user authenticated cursor so RLS policies automatically filter incidents
        with get_authenticated_cursor(current_user.auth_user_id) as cur:
            # New SOS-triggered incidents are created with authority_id = NULL
            # (unassigned/unclaimed). RLS only allows an authority to read
            # incidents assigned to them, which would hide every unassigned
            # incident from every authority dashboard. For authority users,
            # explicitly widen the query to also include unassigned
            # incidents. Tourist users are left on the original RLS-only
            # query, which already scopes correctly to their own incidents.
            is_authority = current_user.user_type == "authority"

            if status_filter and is_authority:
                cur.execute("""
                    SELECT incident_id, tourist_id, location_id, incident_type, severity, status, description, created_at, authority_id
                    FROM public.incidents
                    WHERE status = %s AND (authority_id IS NULL OR authority_id = %s);
                """, (status_filter, current_user.authority_id))
            elif status_filter:
                cur.execute("""
                    SELECT incident_id, tourist_id, location_id, incident_type, severity, status, description, created_at, authority_id
                    FROM public.incidents
                    WHERE status = %s;
                """, (status_filter,))
            elif is_authority:
                cur.execute("""
                    SELECT incident_id, tourist_id, location_id, incident_type, severity, status, description, created_at, authority_id
                    FROM public.incidents
                    WHERE authority_id IS NULL OR authority_id = %s;
                """, (current_user.authority_id,))
            else:
                cur.execute("""
                    SELECT incident_id, tourist_id, location_id, incident_type, severity, status, description, created_at, authority_id
                    FROM public.incidents;
                """)
                
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
            detail=f"Failed to retrieve incidents: {str(e)}"
        )


@router.get("/{incident_id}", response_model=IncidentResponse)
def get_incident(
    incident_id: UUID,
    current_user: SessionResponse = Depends(get_current_user)
) -> IncidentResponse:
    return _get_incident_or_404(incident_id, current_user)


@router.patch("/{incident_id}", response_model=IncidentResponse)
def update_incident(
    incident_id: UUID,
    payload: IncidentUpdate,
    current_user: SessionResponse = Depends(get_current_user)
) -> IncidentResponse:
    # 1. Fallback Mode
    if not is_db_active():
        incident = _get_incident_or_404(incident_id)
        update_data = payload.model_dump(exclude_unset=True)
        updated = incident.model_copy(update=update_data)
        _in_memory_incident_store[incident_id] = updated
        return updated

    # 2. Database Mode
    _get_incident_or_404(incident_id, current_user) # Verify existence/RLS permissions first
    
    update_data = payload.model_dump(exclude_unset=True)
    if not update_data:
        return _get_incident_or_404(incident_id, current_user)

    # When an authority dispatches to an incident (status -> RESPONDING),
    # link that authority to the incident record if it isn't already
    # assigned. This resolves incidents created with authority_id = NULL
    # into claimed, assigned incidents at the moment of dispatch.
    if (
        update_data.get("status") == "RESPONDING"
        and current_user.user_type == "authority"
        and "authority_id" not in update_data
    ):
        update_data["authority_id"] = current_user.authority_id

    set_clauses = []
    params = []
    for k, v in update_data.items():
        set_clauses.append(f"{k} = %s")
        params.append(v)
        
    params.append(incident_id)
    query = f"UPDATE public.incidents SET {', '.join(set_clauses)} WHERE incident_id = %s RETURNING incident_id, tourist_id, location_id, incident_type, severity, status, description, created_at, authority_id;"
    
    try:
        with get_authenticated_cursor(current_user.auth_user_id, commit=True) as cur:
            cur.execute(query, tuple(params))
            row = cur.fetchone()
            if not row:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Incident not found or unauthorized to update",
                )
            return IncidentResponse(
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
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update incident: {str(e)}"
        )


# ---------------------------------------------------------------------------
# Responses (public.responses) — dispatch action logging
# ---------------------------------------------------------------------------

@router.post("/{incident_id}/responses", response_model=ResponseRecord, status_code=status.HTTP_201_CREATED)
def create_incident_response(
    incident_id: UUID,
    payload: ResponseCreate,
    current_user: SessionResponse = Depends(require_authority)
) -> ResponseRecord:
    authority_id = payload.authority_id or current_user.authority_id

    # 1. Fallback Mode
    if not is_db_active():
        incident = _in_memory_incident_store.get(incident_id)
        if incident is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Incident not found",
            )
        record = ResponseRecord(
            response_id=uuid4(),
            incident_id=incident_id,
            responder_unit=payload.responder_unit,
            action_taken=payload.action_taken,
            resolved_at=payload.resolved_at,
            authority_id=authority_id,
        )
        _in_memory_response_store[record.response_id] = record
        return record

    # 2. Database Mode
    response_id = uuid4()
    try:
        with get_authenticated_cursor(current_user.auth_user_id, commit=True) as cur:
            cur.execute("SELECT incident_id FROM public.incidents WHERE incident_id = %s;", (incident_id,))
            if not cur.fetchone():
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Incident not found",
                )

            cur.execute("""
                INSERT INTO public.responses (response_id, incident_id, responder_unit, action_taken, resolved_at, authority_id)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING response_id, incident_id, responder_unit, action_taken, resolved_at, authority_id;
            """, (response_id, incident_id, payload.responder_unit, payload.action_taken, payload.resolved_at, authority_id))

            row = cur.fetchone()
            return ResponseRecord(
                response_id=row[0],
                incident_id=row[1],
                responder_unit=row[2],
                action_taken=row[3],
                resolved_at=row[4],
                authority_id=row[5],
            )
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create response log: {str(e)}"
        )


@router.get("/{incident_id}/responses", response_model=list[ResponseRecord])
def list_incident_responses(
    incident_id: UUID,
    current_user: SessionResponse = Depends(get_current_user)
) -> list[ResponseRecord]:
    # 1. Fallback Mode
    if not is_db_active():
        return [r for r in _in_memory_response_store.values() if r.incident_id == incident_id]

    # 2. Database Mode
    try:
        with get_authenticated_cursor(current_user.auth_user_id) as cur:
            cur.execute("""
                SELECT response_id, incident_id, responder_unit, action_taken, resolved_at, authority_id
                FROM public.responses
                WHERE incident_id = %s;
            """, (incident_id,))
            rows = cur.fetchall()
            return [
                ResponseRecord(
                    response_id=row[0],
                    incident_id=row[1],
                    responder_unit=row[2],
                    action_taken=row[3],
                    resolved_at=row[4],
                    authority_id=row[5],
                )
                for row in rows
            ]
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve response logs: {str(e)}"
        )
