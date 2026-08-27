import json
import logging
from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from db import is_db_active, get_db_cursor, get_authenticated_cursor
from realtime import broadcast_sync, manager
from routers.auth import get_current_user
from schemas.auth import SessionResponse
from schemas.incident import IncidentResponse
from schemas.sos import SOSCreate, SOSResponse

logger = logging.getLogger("sos")

router = APIRouter(prefix="/sos", tags=["sos"])


class BLERelayPayload(BaseModel):
    """
    Received from Android MainActivity.java and iOS AppDelegate.swift when a
    nearby device running the app picks up a Bluetooth LE SOS beacon and
    successfully has internet connectivity to forward it. The originating
    tourist's device may be completely offline — no auth token is available.
    payload: JSON string encoded by the originating device, containing at
             minimum tourist_id, latitude, longitude.
    """
    payload: str

# Temporary in-memory storage for local API development only (fallback).
_in_memory_sos_store: dict[UUID, SOSResponse] = {}

# A tourist mashing the SOS button, a flaky-network retry, or the offline-
# sync bug that resubmitted an already-sent SOS all used to create a
# brand-new incident every time, flooding the authority dashboard with
# dozens of rows for a single real emergency. create_sos now checks whether
# this tourist already has an SOS whose linked incident is still unresolved
# (status OPEN or INVESTIGATING) and, if so, returns that existing SOS
# (is_duplicate=True) instead of inserting a new incident/sos_requests row —
# tied to resolution state rather than a rolling time window, so: (a) it
# can never be duplicated while still open, however many times the button
# is pressed or retried, and (b) the moment an authority resolves it, the
# next genuine SOS from that tourist creates a fresh incident right away
# instead of waiting out a fixed window.
_UNRESOLVED_INCIDENT_STATUSES = ("OPEN", "INVESTIGATING")


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

        existing = sorted(
            (s for s in _in_memory_sos_store.values() if s.tourist_id == payload.tourist_id),
            key=lambda s: s.triggered_at, reverse=True,
        )
        for s in existing:
            linked_incident = _in_memory_incident_store.get(s.incident_id)
            if linked_incident is not None and linked_incident.status in _UNRESOLVED_INCIDENT_STATUSES:
                return s.model_copy(update={"is_duplicate": True})

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

            # Duplicate guard: if this tourist already has an SOS whose
            # linked incident is still unresolved (OPEN/INVESTIGATING), hand
            # back that existing record instead of creating another incident
            # — this is what stops a single account from filling the
            # authority dashboard with dozens of rows, and it stays blocked
            # for as long as the incident stays open, however many times the
            # button is pressed. The moment an authority resolves it, this
            # query no longer matches and the next SOS creates a fresh one.
            cur.execute("""
                SELECT sr.sos_id, sr.tourist_id, sr.incident_id, sr.latitude, sr.longitude,
                       sr.battery_status, sr.authority_id, sr.trigger_source, sr.sos_status, sr.triggered_at
                FROM public.sos_requests sr
                JOIN public.incidents i ON i.id = sr.incident_id
                WHERE sr.tourist_id = %s AND i.status = ANY(%s)
                ORDER BY sr.triggered_at DESC
                LIMIT 1;
            """, (payload.tourist_id, list(_UNRESOLVED_INCIDENT_STATUSES)))
            recent_row = cur.fetchone()
            if recent_row:
                return SOSResponse(
                    sos_id=recent_row[0], tourist_id=recent_row[1], incident_id=recent_row[2],
                    latitude=float(recent_row[3]), longitude=float(recent_row[4]),
                    battery_status=recent_row[5], authority_id=recent_row[6],
                    trigger_source=recent_row[7], sos_status=recent_row[8], triggered_at=recent_row[9],
                    is_duplicate=True,
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


# ---------------------------------------------------------------------------
# BLE Mesh Relay — no auth required (originating tourist is offline)
# Called by: Android MainActivity.java and iOS AppDelegate.swift when a
# nearby device with internet picks up a Bluetooth LE SOS beacon hop.
# ---------------------------------------------------------------------------

@router.post("/relay", status_code=status.HTTP_200_OK)
def relay_sos(body: BLERelayPayload):
    """
    Accept a Bluetooth-hopped SOS payload and record it as a new SOS incident.
    The relaying device sends the original tourist's SOS packet (JSON string)
    as 'payload'. We parse it and create the incident + sos_request rows using
    a service-level DB cursor so no JWT from the (offline) tourist is needed.
    Duplicate packets (same tourist_id with an already-unresolved SOS
    incident) are silently deduplicated.
    """
    try:
        data = json.loads(body.payload)
    except (json.JSONDecodeError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="payload must be a valid JSON string",
        )

    try:
        tourist_id = UUID(str(data.get("tourist_id", "")))
    except (ValueError, AttributeError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="payload must contain a valid tourist_id UUID",
        )

    latitude = data.get("latitude") or data.get("lat")
    longitude = data.get("longitude") or data.get("lng") or data.get("lon")
    if latitude is None or longitude is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="payload must contain latitude and longitude",
        )

    battery_status = data.get("battery_status") or data.get("battery")
    now = datetime.now(timezone.utc)

    # Fallback mode — no DB
    if not is_db_active():
        from routers.incidents import _in_memory_incident_store
        incident_id = uuid4()
        sos_id = uuid4()
        incident = IncidentResponse(
            id=incident_id, incident_type="SOS", tourist_id=tourist_id,
            latitude=float(latitude), longitude=float(longitude),
            ai_risk_score=70, priority="CRITICAL", status="OPEN",
            description="SOS Alarm Triggered (BLE Mesh Relay)", created_at=now,
        )
        _in_memory_incident_store[incident_id] = incident
        sos = SOSResponse(
            sos_id=sos_id, tourist_id=tourist_id, incident_id=incident_id,
            latitude=float(latitude), longitude=float(longitude),
            battery_status=battery_status, triggered_at=now,
            trigger_source="BLE_RELAY", sos_status="PENDING",
        )
        broadcast_sync(manager.broadcast_to_authorities, "sos.created", sos.model_dump(mode="json"))
        return {"status": "relayed", "sos_id": str(sos_id)}

    # Database mode — use service cursor (no RLS, tourist has no token)
    try:
        with get_db_cursor(commit=True) as cur:
            # Verify tourist exists
            cur.execute("SELECT id FROM public.tourist_profiles WHERE id = %s;", (tourist_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND,
                                    detail="Tourist profile not found")

            # Deduplicate: skip if this tourist already has an SOS whose
            # linked incident is still unresolved — tied to resolution
            # state (see _UNRESOLVED_INCIDENT_STATUSES above) rather than a
            # fixed window, matching the direct-submit path above, so a
            # tourist can't flood the dashboard via BLE relay either.
            cur.execute("""
                SELECT sr.sos_id
                FROM public.sos_requests sr
                JOIN public.incidents i ON i.id = sr.incident_id
                WHERE sr.tourist_id = %s AND i.status = ANY(%s)
                LIMIT 1;
            """, (tourist_id, list(_UNRESOLVED_INCIDENT_STATUSES)))
            if cur.fetchone():
                logger.info(f"[BLE Relay] Duplicate SOS from {tourist_id} — skipping")
                return {"status": "duplicate_skipped"}

            incident_id = uuid4()
            sos_id = uuid4()

            cur.execute("""
                INSERT INTO public.incidents (
                    id, incident_type, tourist_id, latitude, longitude,
                    ai_risk_score, priority, status, description, created_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id;
            """, (incident_id, "SOS", tourist_id, float(latitude), float(longitude),
                  70, "CRITICAL", "OPEN", "SOS Alarm Triggered (BLE Mesh Relay)", now))

            cur.execute("""
                INSERT INTO public.sos_requests (
                    sos_id, tourist_id, incident_id, latitude, longitude,
                    battery_status, trigger_source, sos_status, triggered_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING sos_id, tourist_id, incident_id, latitude, longitude,
                          battery_status, authority_id, trigger_source, sos_status, triggered_at;
            """, (sos_id, tourist_id, incident_id, float(latitude), float(longitude),
                  battery_status, "BLE_RELAY", "PENDING", now))

            row = cur.fetchone()
            sos_response = SOSResponse(
                sos_id=row[0], tourist_id=row[1], incident_id=row[2],
                latitude=float(row[3]), longitude=float(row[4]),
                battery_status=row[5], authority_id=row[6],
                trigger_source=row[7], sos_status=row[8], triggered_at=row[9],
            )

        broadcast_sync(manager.broadcast_to_authorities, "sos.created", sos_response.model_dump(mode="json"))
        logger.info(f"[BLE Relay] SOS relayed for tourist {tourist_id}, incident {incident_id}")
        return {"status": "relayed", "sos_id": str(sos_id)}

    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"[BLE Relay] Failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to record relayed SOS: {str(e)}",
        )
