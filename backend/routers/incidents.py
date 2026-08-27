from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status

from db import is_db_active, get_db_cursor, get_authenticated_cursor
from realtime import broadcast_sync, manager
from routers.auth import get_current_user, require_authority
from schemas.auth import SessionResponse
from schemas.incident import (
    IncidentBulkDeleteRequest,
    IncidentBulkDeleteResponse,
    IncidentCreate,
    IncidentResponse,
    IncidentUpdate,
)
from schemas.response import ResponseCreate, ResponseRecord

router = APIRouter(prefix="/incidents", tags=["incidents"])

# Temporary in-memory storage for local API development only (fallback).
_in_memory_incident_store: dict[UUID, IncidentResponse] = {}
_in_memory_response_store: dict[UUID, ResponseRecord] = {}

_INCIDENT_COLUMNS = (
    "id, incident_type, tourist_id, latitude, longitude, ai_risk_score, "
    "priority, status, description, assigned_officer_id, created_at"
)


def _compute_initial_risk_score(incident_type: str | None, priority: str | None) -> int:
    """
    v1 heuristic risk score (1-100), used to seed ai_risk_score at creation
    time so the dashboard has something to sort by immediately.

    This is intentionally simple — the directive's full AI Risk
    Prioritization Engine (zone danger level, time-of-day, tourist
    vulnerability profile, SOS trigger history) needs geofence-breach data
    and per-tourist SOS history that this endpoint doesn't have in scope;
    that's Phase 3 (Authority Dashboard) work per the directive's own
    roadmap. This heuristic can be replaced there without changing the
    column or API shape.
    """
    base = {"SOS": 70, "GEOFENCE_BREACH": 50, "MANUAL": 30}.get((incident_type or "MANUAL").upper(), 30)
    priority_bonus = {"CRITICAL": 25, "HIGH": 15, "MEDIUM": 5, "LOW": 0}.get((priority or "LOW").upper(), 0)
    hour = datetime.now(timezone.utc).hour
    night_bonus = 10 if (hour >= 22 or hour < 5) else 0
    return min(100, base + priority_bonus + night_bonus)


def _row_to_incident(row) -> IncidentResponse:
    return IncidentResponse(
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
            cur.execute(f"""
                SELECT {_INCIDENT_COLUMNS}
                FROM public.incidents
                WHERE id = %s;
            """, (incident_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Incident not found",
                )
            return _row_to_incident(row)
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
    # SECURITY: force a tourist caller's incidents to their own tourist_id
    # (payload.tourist_id was previously trusted verbatim, letting a tourist
    # file an incident "as" another tourist_id). Must run before the
    # in-memory fallback return so local/test mode cannot skip the bind.
    # Authority callers may still file an incident on behalf of a tourist
    # (e.g. intake at a police desk).
    if current_user.user_type == "tourist":
        if current_user.tourist_profile_id is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No tourist profile is associated with this account.",
            )
        payload.tourist_id = current_user.tourist_profile_id

    incident_type = (payload.incident_type or "MANUAL").upper()
    if incident_type not in ("SOS", "GEOFENCE_BREACH", "MANUAL"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="incident_type must be one of SOS, GEOFENCE_BREACH, MANUAL",
        )
    priority = (payload.priority or "LOW").upper()
    risk_score = _compute_initial_risk_score(incident_type, priority)

    # 1. Fallback Mode
    if not is_db_active():
        from routers.tourists import _get_tourist_or_404

        _get_tourist_or_404(payload.tourist_id)

        now = datetime.now(timezone.utc)
        incident = IncidentResponse(
            id=uuid4(),
            incident_type=incident_type,
            tourist_id=payload.tourist_id,
            latitude=payload.latitude,
            longitude=payload.longitude,
            ai_risk_score=risk_score,
            priority=priority,
            status=payload.status or "OPEN",
            description=payload.description,
            assigned_officer_id=payload.assigned_officer_id,
            created_at=now,
        )
        _in_memory_incident_store[incident.id] = incident
        return incident

    # 2. Database Mode
    now = datetime.now(timezone.utc)
    incident_id = uuid4()

    try:
        with get_authenticated_cursor(current_user.auth_user_id, commit=True) as cur:
            # Verify tourist profile exists
            cur.execute("SELECT id FROM public.tourist_profiles WHERE id = %s;", (payload.tourist_id,))
            if not cur.fetchone():
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Tourist profile not found",
                )

            cur.execute(f"""
                INSERT INTO public.incidents (
                    id, incident_type, tourist_id, latitude, longitude,
                    ai_risk_score, priority, status, description, assigned_officer_id, created_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING {_INCIDENT_COLUMNS};
            """, (
                incident_id, incident_type, payload.tourist_id, payload.latitude, payload.longitude,
                risk_score, priority, payload.status or "OPEN", payload.description,
                payload.assigned_officer_id, now
            ))
            row = cur.fetchone()
            return _row_to_incident(row)
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
            # New SOS-triggered incidents are created with assigned_officer_id
            # = NULL (unassigned/unclaimed). RLS only allows an authority to
            # read incidents assigned to them, which would hide every
            # unassigned incident from every authority dashboard. For
            # authority users, explicitly widen the query to also include
            # unassigned incidents. Tourist users are left on the original
            # RLS-only query, which already scopes correctly to their own
            # incidents.
            is_authority = current_user.user_type == "authority"

            if status_filter and is_authority:
                cur.execute(f"""
                    SELECT {_INCIDENT_COLUMNS}
                    FROM public.incidents
                    WHERE status = %s AND (assigned_officer_id IS NULL OR assigned_officer_id = %s)
                    ORDER BY ai_risk_score DESC NULLS LAST, created_at DESC;
                """, (status_filter, current_user.authority_id))
            elif status_filter:
                cur.execute(f"""
                    SELECT {_INCIDENT_COLUMNS}
                    FROM public.incidents
                    WHERE status = %s
                    ORDER BY created_at DESC;
                """, (status_filter,))
            elif is_authority:
                cur.execute(f"""
                    SELECT {_INCIDENT_COLUMNS}
                    FROM public.incidents
                    WHERE assigned_officer_id IS NULL OR assigned_officer_id = %s
                    ORDER BY ai_risk_score DESC NULLS LAST, created_at DESC;
                """, (current_user.authority_id,))
            else:
                cur.execute(f"""
                    SELECT {_INCIDENT_COLUMNS}
                    FROM public.incidents
                    ORDER BY created_at DESC;
                """)

            rows = cur.fetchall()
            return [_row_to_incident(row) for row in rows]
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
        # Mirror the DB-mode auto-assign-on-dispatch behavior below so
        # fallback/mock mode (used by tests and DATABASE_URL-less local
        # dev) doesn't silently diverge from production behavior.
        if (
            update_data.get("status") == "INVESTIGATING"
            and current_user.user_type == "authority"
            and "assigned_officer_id" not in update_data
        ):
            update_data["assigned_officer_id"] = current_user.authority_id
        updated = incident.model_copy(update=update_data)
        _in_memory_incident_store[incident_id] = updated
        broadcast_sync(manager.broadcast_to_authorities, "incident.updated", updated.model_dump(mode="json"))
        return updated

    # 2. Database Mode
    _get_incident_or_404(incident_id, current_user)  # Verify existence/RLS permissions first

    update_data = payload.model_dump(exclude_unset=True)
    if not update_data:
        return _get_incident_or_404(incident_id, current_user)

    # When an authority dispatches to an incident (status -> INVESTIGATING),
    # link that authority to the incident record if it isn't already
    # assigned. This resolves incidents created with assigned_officer_id =
    # NULL into claimed, assigned incidents at the moment of dispatch.
    if (
        update_data.get("status") == "INVESTIGATING"
        and current_user.user_type == "authority"
        and "assigned_officer_id" not in update_data
    ):
        update_data["assigned_officer_id"] = current_user.authority_id

    set_clauses = []
    params = []
    for k, v in update_data.items():
        set_clauses.append(f"{k} = %s")
        params.append(v)

    params.append(incident_id)
    query = f"UPDATE public.incidents SET {', '.join(set_clauses)} WHERE id = %s RETURNING {_INCIDENT_COLUMNS};"

    try:
        with get_authenticated_cursor(current_user.auth_user_id, commit=True) as cur:
            cur.execute(query, tuple(params))
            row = cur.fetchone()
            if not row:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Incident not found or unauthorized to update",
                )
            incident_response = _row_to_incident(row)
        broadcast_sync(manager.broadcast_to_authorities, "incident.updated", incident_response.model_dump(mode="json"))
        return incident_response
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update incident: {str(e)}"
        )


# ---------------------------------------------------------------------------
# Delete (authority only) — powers the "select all SOS + delete" bulk action
# on the authority dashboard. Deletes dependent rows (public.sos,
# public.responses, public.alerts all reference incident_id) before the
# incident row itself, in the same transaction, so this can't be blocked by
# a foreign-key constraint or leave orphaned child rows behind.
#
# Both routes broadcast "incident.deleted" over the authority realtime feed
# so every connected authority session drops the incident immediately —
# this is the other half of "dual side sync": a delete triggered on one
# authority screen now removes the incident everywhere, instead of it only
# disappearing after that one browser reloads / re-polls.
# ---------------------------------------------------------------------------

def _delete_incident_and_dependents(cur, incident_id: UUID) -> bool:
    cur.execute("DELETE FROM public.responses WHERE incident_id = %s;", (incident_id,))
    cur.execute("DELETE FROM public.alerts WHERE incident_id = %s;", (incident_id,))
    cur.execute("DELETE FROM public.sos_requests WHERE incident_id = %s;", (incident_id,))
    cur.execute("DELETE FROM public.incidents WHERE id = %s RETURNING id;", (incident_id,))
    return cur.fetchone() is not None


@router.delete("/{incident_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_incident(
    incident_id: UUID,
    current_user: SessionResponse = Depends(require_authority),
) -> None:
    if not is_db_active():
        if incident_id not in _in_memory_incident_store:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Incident not found")
        del _in_memory_incident_store[incident_id]
        broadcast_sync(manager.broadcast_to_authorities, "incident.deleted", {"id": str(incident_id)})
        return None

    try:
        with get_authenticated_cursor(current_user.auth_user_id, commit=True) as cur:
            found = _delete_incident_and_dependents(cur, incident_id)
            if not found:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Incident not found")
        broadcast_sync(manager.broadcast_to_authorities, "incident.deleted", {"id": str(incident_id)})
        return None
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to delete incident: {str(e)}")


@router.delete("", response_model=IncidentBulkDeleteResponse)
def bulk_delete_incidents(
    payload: IncidentBulkDeleteRequest,
    current_user: SessionResponse = Depends(require_authority),
) -> IncidentBulkDeleteResponse:
    """Deletes every incident id in the request (used by the authority
    dashboard's "select all + delete" action). Ids that don't exist / were
    already deleted are reported back in not_found_ids rather than failing
    the whole batch, so one stale id in a large selection doesn't block
    deleting the rest."""
    if not payload.incident_ids:
        return IncidentBulkDeleteResponse(deleted_ids=[], not_found_ids=[])

    if not is_db_active():
        deleted, not_found = [], []
        for iid in payload.incident_ids:
            if iid in _in_memory_incident_store:
                del _in_memory_incident_store[iid]
                deleted.append(iid)
            else:
                not_found.append(iid)
        broadcast_sync(manager.broadcast_to_authorities, "incident.deleted", {"ids": [str(i) for i in deleted]})
        return IncidentBulkDeleteResponse(deleted_ids=deleted, not_found_ids=not_found)

    deleted, not_found = [], []
    try:
        with get_authenticated_cursor(current_user.auth_user_id, commit=True) as cur:
            for iid in payload.incident_ids:
                if _delete_incident_and_dependents(cur, iid):
                    deleted.append(iid)
                else:
                    not_found.append(iid)
        broadcast_sync(manager.broadcast_to_authorities, "incident.deleted", {"ids": [str(i) for i in deleted]})
        return IncidentBulkDeleteResponse(deleted_ids=deleted, not_found_ids=not_found)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to bulk delete incidents: {str(e)}")


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
            cur.execute("SELECT id FROM public.incidents WHERE id = %s;", (incident_id,))
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
