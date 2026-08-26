from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status

from db import is_db_active, get_db_cursor, get_authenticated_cursor
from realtime import broadcast_sync, manager
from routers.auth import get_current_user
from schemas.auth import SessionResponse
from schemas.incident import IncidentResponse
from schemas.sos import SOSCreate, SOSResponse

router = APIRouter(prefix="/sos", tags=["sos"])

# Temporary in-memory storage for local API development only (fallback).
_in_memory_sos_store: dict[UUID, SOSResponse] = {}


@router.post("", response_model=SOSResponse, status_code=status.HTTP_201_CREATED)
def create_sos(
    payload: SOSCreate,
    current_user: SessionResponse = Depends(get_current_user)
) -> SOSResponse:
    # SECURITY: a tourist caller must only ever raise an SOS for themselves.
    # payload.tourist_id is client-supplied and was previously trusted as-is,
    # which would let one tourist's session trigger an SOS "for" another
    # tourist. Force it to the caller's own tourist_profile_id when the
    # caller is a tourist. This must run before the in-memory fallback
    # return — that path used to skip the bind, so tests and
    # DATABASE_URL-less local mode still accepted a spoofed tourist_id.
    # Non-tourist callers (e.g. AI/system triggered SOS submitted by an
    # authority/system account) keep the explicit payload value.
    if current_user.user_type == "tourist":
        if current_user.tourist_profile_id is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="No tourist profile is associated with this account.",
            )
        payload.tourist_id = current_user.tourist_profile_id

    # 1. Fallback Mode
    if not is_db_active():
        from routers.tourists import _get_tourist_or_404
        from routers.incidents import _in_memory_incident_store

        _get_tourist_or_404(payload.tourist_id)

        now = datetime.now(timezone.utc)

        incident_id = uuid4()
        incident = IncidentResponse(
            id=incident_id,
            incident_type="SOS",
            tourist_id=payload.tourist_id,
            latitude=payload.latitude,
            longitude=payload.longitude,
            ai_risk_score=70,
            priority="CRITICAL",
            status="OPEN",
            description="SOS Alarm Triggered",
            assigned_officer_id=None,
            created_at=now,
        )
        _in_memory_incident_store[incident_id] = incident

        sos = SOSResponse(
            sos_id=uuid4(),
            tourist_id=payload.tourist_id,
            incident_id=incident_id,
            latitude=payload.latitude,
            longitude=payload.longitude,
            battery_status=payload.battery_status,
            authority_id=None,
            triggered_at=now,
            trigger_source=payload.trigger_source or "APP",
            sos_status="PENDING",
        )
        _in_memory_sos_store[sos.sos_id] = sos
        broadcast_sync(manager.broadcast_to_authorities, "sos.created", sos.model_dump(mode="json"))
        return sos

    # 2. Database Mode
    now = datetime.now(timezone.utc)
    incident_id = uuid4()
    sos_id = uuid4()

    try:
        with get_authenticated_cursor(current_user.auth_user_id, commit=True) as cur:
            # Verify tourist profile exists
            cur.execute("SELECT id, kyc_status FROM public.tourist_profiles WHERE id = %s;", (payload.tourist_id,))
            tourist_row = cur.fetchone()
            if not tourist_row:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Tourist profile not found",
                )

            # Deliberately NOT a hard KYC gate here (unlike itinerary
            # creation) — refusing to raise an SOS because a tourist hasn't
            # finished a verification flow would withhold emergency response
            # from someone who may be in genuine danger. Instead, flag it in
            # the incident description so authorities see "unverified
            # identity" and can weigh that when responding, without ever
            # blocking the alert itself.
            kyc_status = tourist_row[1]
            sos_description = "SOS Alarm Triggered"
            if kyc_status != "VERIFIED":
                sos_description += " (UNVERIFIED IDENTITY — tourist has not completed KYC)"

            # Create an incident record — SOS coordinates are stored
            # directly on the incident (directive §4: incidents.latitude /
            # incidents.longitude), no separate location row needed.
            cur.execute("""
                INSERT INTO public.incidents (
                    id, incident_type, tourist_id, latitude, longitude,
                    ai_risk_score, priority, status, description, created_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id;
            """, (incident_id, "SOS", payload.tourist_id, payload.latitude, payload.longitude,
                  70, "CRITICAL", "OPEN", sos_description, now))

            # Create the SOS request record
            cur.execute("""
                INSERT INTO public.sos_requests (
                    sos_id, tourist_id, incident_id, latitude, longitude,
                    battery_status, trigger_source, sos_status, triggered_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING sos_id, tourist_id, incident_id, latitude, longitude,
                          battery_status, authority_id, trigger_source, sos_status, triggered_at;
            """, (sos_id, payload.tourist_id, incident_id, payload.latitude, payload.longitude,
                  payload.battery_status, payload.trigger_source or "APP", "PENDING", now))

            row = cur.fetchone()
            sos_response = SOSResponse(
                sos_id=row[0],
                tourist_id=row[1],
                incident_id=row[2],
                latitude=float(row[3]),
                longitude=float(row[4]),
                battery_status=row[5],
                authority_id=row[6],
                trigger_source=row[7],
                sos_status=row[8],
                triggered_at=row[9],
            )
        # Broadcast after the transaction commits (outside the `with` block,
        # cursor already closed) so a slow/failed dashboard push can never
        # roll back a successfully recorded SOS.
        broadcast_sync(manager.broadcast_to_authorities, "sos.created", sos_response.model_dump(mode="json"))
        return sos_response
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to activate SOS alarm: {str(e)}"
        )
