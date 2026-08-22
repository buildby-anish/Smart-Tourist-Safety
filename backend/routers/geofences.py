import json
import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status

from db import is_db_active, get_authenticated_cursor
from routers.auth import get_current_user, require_authority
from schemas.auth import SessionResponse
from schemas.geofence import (
    GeofenceBreachResponse,
    GeofenceCreate,
    GeofenceResponse,
    GeofenceUpdate,
)

logger = logging.getLogger("geofences")

router = APIRouter(prefix="/geofences", tags=["geofences"])

_in_memory_geofence_store: dict[UUID, GeofenceResponse] = {}
_in_memory_breach_log: list[GeofenceBreachResponse] = []

_BREACH_DEBOUNCE = timedelta(minutes=5)  # avoid re-alerting every single ping while a tourist lingers in a zone

_GEOFENCE_COLUMNS = "id, name, zone_type, coordinates, is_active, created_at"


def _ring_to_wkt(coordinates: list[list[float]]) -> str:
    points = ", ".join(f"{lng} {lat}" for lng, lat in coordinates)
    return f"POLYGON(({points}))"


def _row_to_geofence(row) -> GeofenceResponse:
    coords = row[3]
    if isinstance(coords, str):
        coords = json.loads(coords)
    return GeofenceResponse(
        id=row[0], name=row[1], zone_type=row[2], coordinates=coords,
        is_active=row[4], created_at=row[5],
    )


@router.post("", response_model=GeofenceResponse, status_code=status.HTTP_201_CREATED)
def create_geofence(
    payload: GeofenceCreate,
    current_user: SessionResponse = Depends(require_authority),
) -> GeofenceResponse:
    now = datetime.now(timezone.utc)
    geofence_id = uuid4()

    if not is_db_active():
        gf = GeofenceResponse(
            id=geofence_id, name=payload.name, zone_type=payload.zone_type,
            coordinates=payload.coordinates, is_active=payload.is_active, created_at=now,
        )
        _in_memory_geofence_store[geofence_id] = gf
        return gf

    try:
        with get_authenticated_cursor(current_user.auth_user_id, commit=True) as cur:
            wkt = _ring_to_wkt(payload.coordinates)
            cur.execute(f"""
                INSERT INTO public.geofences (id, name, zone_type, coordinates, geom, is_active, created_at)
                VALUES (%s, %s, %s, %s, ST_SetSRID(ST_GeomFromText(%s), 4326), %s, %s)
                RETURNING {_GEOFENCE_COLUMNS};
            """, (geofence_id, payload.name, payload.zone_type, json.dumps(payload.coordinates),
                  wkt, payload.is_active, now))
            return _row_to_geofence(cur.fetchone())
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to create geofence: {str(e)}")


@router.get("", response_model=list[GeofenceResponse])
def list_geofences(
    active_only: bool = True,
    current_user: SessionResponse = Depends(get_current_user),
) -> list[GeofenceResponse]:
    if not is_db_active():
        zones = list(_in_memory_geofence_store.values())
        return [z for z in zones if z.is_active] if active_only else zones

    try:
        with get_authenticated_cursor(current_user.auth_user_id) as cur:
            if active_only:
                cur.execute(f"SELECT {_GEOFENCE_COLUMNS} FROM public.geofences WHERE is_active = TRUE;")
            else:
                cur.execute(f"SELECT {_GEOFENCE_COLUMNS} FROM public.geofences;")
            return [_row_to_geofence(row) for row in cur.fetchall()]
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to retrieve geofences: {str(e)}")


@router.patch("/{geofence_id}", response_model=GeofenceResponse)
def update_geofence(
    geofence_id: UUID,
    payload: GeofenceUpdate,
    current_user: SessionResponse = Depends(require_authority),
) -> GeofenceResponse:
    update_data = payload.model_dump(exclude_unset=True)

    if not is_db_active():
        gf = _in_memory_geofence_store.get(geofence_id)
        if not gf:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Geofence not found")
        updated = gf.model_copy(update=update_data)
        _in_memory_geofence_store[geofence_id] = updated
        return updated

    if not update_data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields to update")

    set_clauses = []
    params = []
    for k, v in update_data.items():
        if k == "coordinates":
            set_clauses.append("coordinates = %s")
            params.append(json.dumps(v))
            set_clauses.append("geom = ST_SetSRID(ST_GeomFromText(%s), 4326)")
            params.append(_ring_to_wkt(v if v[0] == v[-1] else v + [v[0]]))
        else:
            set_clauses.append(f"{k} = %s")
            params.append(v)
    params.append(geofence_id)

    query = f"UPDATE public.geofences SET {', '.join(set_clauses)} WHERE id = %s RETURNING {_GEOFENCE_COLUMNS};"
    try:
        with get_authenticated_cursor(current_user.auth_user_id, commit=True) as cur:
            cur.execute(query, tuple(params))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Geofence not found")
            return _row_to_geofence(row)
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to update geofence: {str(e)}")


@router.delete("/{geofence_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_geofence(
    geofence_id: UUID,
    current_user: SessionResponse = Depends(require_authority),
) -> None:
    if not is_db_active():
        if geofence_id not in _in_memory_geofence_store:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Geofence not found")
        del _in_memory_geofence_store[geofence_id]
        return None

    try:
        with get_authenticated_cursor(current_user.auth_user_id, commit=True) as cur:
            cur.execute("DELETE FROM public.geofences WHERE id = %s RETURNING id;", (geofence_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Geofence not found")
            return None
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to delete geofence: {str(e)}")


@router.get("/breaches", response_model=list[GeofenceBreachResponse])
def list_breaches(
    current_user: SessionResponse = Depends(require_authority),
) -> list[GeofenceBreachResponse]:
    if not is_db_active():
        return _in_memory_breach_log

    try:
        with get_authenticated_cursor(current_user.auth_user_id) as cur:
            cur.execute("""
                SELECT id, tourist_id, geofence_id, latitude, longitude, breach_time, sms_sent
                FROM public.geofence_breaches
                ORDER BY breach_time DESC
                LIMIT 200;
            """)
            return [
                GeofenceBreachResponse(
                    id=row[0], tourist_id=row[1], geofence_id=row[2],
                    latitude=float(row[3]), longitude=float(row[4]),
                    breach_time=row[5], sms_sent=row[6],
                )
                for row in cur.fetchall()
            ]
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to retrieve breaches: {str(e)}")


# ---------------------------------------------------------------------------
# Breach detection — called from routers/locations.py on every GPS ping.
# ---------------------------------------------------------------------------

def _dispatch_sms_webhook(tourist_id: UUID, geofence_name: str, zone_type: str) -> bool:
    """
    Directive §A.3: geofence breaches must "dispatch an SMS webhook payload
    via backend." No SMS provider (Twilio/MSG91/etc.) is configured in this
    codebase yet, so this logs the payload that would be sent instead of
    silently no-op'ing or pretending to send a real SMS. Wire a real
    provider call in here when credentials are available; the call site
    (evaluate_geofence_breaches below) and the sms_sent column are already
    in place.
    """
    logger.warning(
        f"[SMS WEBHOOK STUB] Would notify tourist {tourist_id}: "
        f"entered {zone_type} zone '{geofence_name}'. No SMS provider configured — "
        "this is a logged stub, not a sent message."
    )
    return False


def evaluate_geofence_breaches(cur, tourist_id: UUID, latitude: float, longitude: float) -> list[dict]:
    """
    Checks a single GPS ping against all active RESTRICTED geofences and
    records a breach (+ a linked incident) for any match, debounced per
    tourist+geofence so a tourist standing still doesn't spam new incidents
    every ping.

    NOTE (documented scope limit): this only detects entering a RESTRICTED
    zone. Detecting "exited a SAFE zone" (the directive's other trigger)
    needs the tourist's previous zone membership, which means either
    tracking last-known-zone per tourist or a stateful comparison across
    consecutive pings — a bigger, separate piece of work better done
    alongside the dashboard's live tracker in Phase 3 rather than bolted
    onto this ping handler.
    """
    cur.execute("""
        SELECT id, name, zone_type
        FROM public.geofences
        WHERE is_active = TRUE AND zone_type = 'RESTRICTED'
          AND ST_Contains(geom, ST_SetSRID(ST_MakePoint(%s, %s), 4326));
    """, (longitude, latitude))
    matches = cur.fetchall()

    created = []
    now = datetime.now(timezone.utc)
    for geofence_id, geofence_name, zone_type in matches:
        cur.execute("""
            SELECT 1 FROM public.geofence_breaches
            WHERE tourist_id = %s AND geofence_id = %s AND breach_time > %s
            LIMIT 1;
        """, (tourist_id, geofence_id, now - _BREACH_DEBOUNCE))
        if cur.fetchone():
            continue  # already alerted recently for this tourist+zone

        breach_id = uuid4()
        sms_sent = _dispatch_sms_webhook(tourist_id, geofence_name, zone_type)
        cur.execute("""
            INSERT INTO public.geofence_breaches (id, tourist_id, geofence_id, latitude, longitude, breach_time, sms_sent)
            VALUES (%s, %s, %s, %s, %s, %s, %s);
        """, (breach_id, tourist_id, geofence_id, latitude, longitude, now, sms_sent))

        incident_id = uuid4()
        cur.execute("""
            INSERT INTO public.incidents (
                id, incident_type, tourist_id, latitude, longitude,
                ai_risk_score, priority, status, description, created_at
            )
            VALUES (%s, 'GEOFENCE_BREACH', %s, %s, %s, %s, %s, 'OPEN', %s, %s);
        """, (
            incident_id, tourist_id, latitude, longitude, 55, "HIGH",
            f"Entered restricted zone '{geofence_name}'", now
        ))
        created.append({"geofence_id": geofence_id, "geofence_name": geofence_name, "incident_id": incident_id})

    return created
