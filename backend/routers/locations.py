from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status

from db import is_db_active, get_authenticated_cursor
from realtime import broadcast_sync, manager
from routers.auth import get_current_user, require_tourist
from routers.geofences import evaluate_geofence_breaches
from schemas.auth import SessionResponse
from schemas.location import LocationPingCreate, LocationPingResponse

# Directive §A.3 / §B.2: live tourist GPS pings feeding the geofencing
# engine and the authority dashboard's live tracker. This is distinct from
# points_of_interest.py, which serves the (unrelated) itinerary POI
# catalogue that used to live at this same "/locations" path — see the
# note in database/schema_definition.py for why they were split.
router = APIRouter(prefix="/locations", tags=["locations"])

_in_memory_location_store: dict[UUID, list[LocationPingResponse]] = {}


def _row_to_ping(row) -> LocationPingResponse:
    return LocationPingResponse(
        id=row[0],
        tourist_id=row[1],
        latitude=float(row[2]),
        longitude=float(row[3]),
        speed=float(row[4]) if row[4] is not None else None,
        heading=float(row[5]) if row[5] is not None else None,
        recorded_at=row[6],
    )


@router.post("", response_model=LocationPingResponse, status_code=status.HTTP_201_CREATED)
def report_location(
    payload: LocationPingCreate,
    current_user: SessionResponse = Depends(require_tourist),
) -> LocationPingResponse:
    now = payload.recorded_at or datetime.now(timezone.utc)

    # 1. Fallback Mode
    if not is_db_active():
        ping = LocationPingResponse(
            id=uuid4(),
            tourist_id=current_user.tourist_profile_id,
            latitude=payload.latitude,
            longitude=payload.longitude,
            speed=payload.speed,
            heading=payload.heading,
            recorded_at=now,
        )
        _in_memory_location_store.setdefault(current_user.tourist_profile_id, []).append(ping)
        return ping

    # 2. Database Mode
    ping_id = uuid4()
    try:
        with get_authenticated_cursor(current_user.auth_user_id, commit=True) as cur:
            cur.execute("""
                INSERT INTO public.locations (id, tourist_id, latitude, longitude, speed, heading, geom, recorded_at)
                VALUES (%s, %s, %s, %s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326), %s)
                RETURNING id, tourist_id, latitude, longitude, speed, heading, recorded_at;
            """, (
                ping_id, current_user.tourist_profile_id, payload.latitude, payload.longitude,
                payload.speed, payload.heading, payload.longitude, payload.latitude, now
            ))
            row = cur.fetchone()
            ping = _row_to_ping(row)

            # Directive §A.3: geofencing check runs on every ping, in the
            # same transaction as the ping insert so a breach is never
            # recorded against a ping that ultimately fails to save.
            breaches = evaluate_geofence_breaches(cur, current_user.tourist_profile_id, payload.latitude, payload.longitude)

        broadcast_sync(manager.broadcast_to_authorities, "location.ping", ping.model_dump(mode="json"))
        for b in breaches:
            breach_payload = {"tourist_id": str(current_user.tourist_profile_id), **{k: str(v) for k, v in b.items()}}
            broadcast_sync(manager.broadcast_to_authorities, "geofence.breach", breach_payload)
            # Merged (migration 003): use the zone's own severity-aware
            # warning_message when the engine supplied one, instead of
            # always hardcoding "restricted zone" — b['warning_message']
            # may be absent for older in-memory-mode breaches, hence the
            # fallback keeps the original wording.
            alert_message = b.get("warning_message") or f"You have entered a restricted zone: {b['geofence_name']}"
            broadcast_sync(
                manager.send_to_tourist, current_user.tourist_profile_id, "geofence.alert",
                {"geofence_name": b["geofence_name"], "message": alert_message, "severity": b.get("severity", "MEDIUM")}
            )
        return ping
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to record location ping: {str(e)}"
        )


@router.get("/tourist/{tourist_id}", response_model=list[LocationPingResponse])
def get_tourist_location_history(
    tourist_id: UUID,
    limit: int = 100,
    current_user: SessionResponse = Depends(get_current_user),
) -> list[LocationPingResponse]:
    # A tourist may only ever read their own trail; authorities read any
    # tourist's trail via the authenticated cursor, which applies RLS.
    if current_user.user_type == "tourist" and current_user.tourist_profile_id != tourist_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tourists may only access their own location history.",
        )

    # 1. Fallback Mode
    if not is_db_active():
        return _in_memory_location_store.get(tourist_id, [])[-limit:]

    # 2. Database Mode
    try:
        with get_authenticated_cursor(current_user.auth_user_id) as cur:
            cur.execute("""
                SELECT id, tourist_id, latitude, longitude, speed, heading, recorded_at
                FROM public.locations
                WHERE tourist_id = %s
                ORDER BY recorded_at DESC
                LIMIT %s;
            """, (tourist_id, limit))
            rows = cur.fetchall()
            return [_row_to_ping(row) for row in rows]
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve location history: {str(e)}"
        )
