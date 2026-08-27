import json
import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status

from db import is_db_active, get_authenticated_cursor
from geofence_engine import GeofenceZone, evaluate_point, row_to_zone, BREACH_ZONE_TYPES
from realtime import broadcast_sync, manager
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

# Column order matches geofence_engine.row_to_zone()'s expectations exactly —
# keep these in sync if either changes.
_GEOFENCE_COLUMNS = (
    "id, name, zone_type, coordinates, is_active, created_at, "
    "geometry_type, center_lat, center_lng, radius_m, severity, warning_message, is_crowd_zone"
)


def _ring_to_wkt(coordinates: list[list[float]]) -> str:
    points = ", ".join(f"{lng} {lat}" for lng, lat in coordinates)
    return f"POLYGON(({points}))"


def _row_to_geofence(row) -> GeofenceResponse:
    coords = row[3]
    if isinstance(coords, str) and coords:
        coords = json.loads(coords)
    return GeofenceResponse(
        id=row[0], name=row[1], zone_type=row[2], coordinates=coords,
        is_active=row[4], created_at=row[5],
        geometry_type=row[6] or "POLYGON",
        center_lat=float(row[7]) if row[7] is not None else None,
        center_lng=float(row[8]) if row[8] is not None else None,
        radius_m=float(row[9]) if row[9] is not None else None,
        severity=row[10] or "MEDIUM",
        warning_message=row[11],
        is_crowd_zone=bool(row[12]) if row[12] is not None else False,
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
            geometry_type=payload.geometry_type, coordinates=payload.coordinates,
            center_lat=payload.center_lat, center_lng=payload.center_lng, radius_m=payload.radius_m,
            severity=payload.severity, warning_message=payload.warning_message,
            is_crowd_zone=payload.is_crowd_zone, is_active=payload.is_active, created_at=now,
        )
        _in_memory_geofence_store[geofence_id] = gf
        return gf

    try:
        with get_authenticated_cursor(current_user.auth_user_id, commit=True) as cur:
            if payload.geometry_type == "POLYGON":
                wkt = _ring_to_wkt(payload.coordinates)
                geom_expr = "ST_SetSRID(ST_GeomFromText(%s), 4326)"
                geom_param = (wkt,)
                coords_param = json.dumps(payload.coordinates)
            else:
                # CIRCLE zones don't populate `geom` (a polygon column) —
                # the shapely engine derives the circle's geometry at query
                # time from center_lat/center_lng/radius_m instead.
                geom_expr = "NULL"
                geom_param = ()
                coords_param = json.dumps([[payload.center_lng or 0.0, payload.center_lat or 0.0]])

            cur.execute(f"""
                INSERT INTO public.geofences (
                    id, name, zone_type, coordinates, geom, is_active, created_at,
                    geometry_type, center_lat, center_lng, radius_m, severity, warning_message, is_crowd_zone
                )
                VALUES (%s, %s, %s, %s, {geom_expr}, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING {_GEOFENCE_COLUMNS};
            """, (
                geofence_id, payload.name, payload.zone_type, coords_param, *geom_param,
                payload.is_active, now, payload.geometry_type,
                payload.center_lat, payload.center_lng, payload.radius_m,
                payload.severity, payload.warning_message, payload.is_crowd_zone,
            ))
            created_gf = _row_to_geofence(cur.fetchone())
        broadcast_sync(manager.broadcast_to_authorities, "geofence.created", created_gf.model_dump(mode="json"))
        return created_gf
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
            params.append(json.dumps(v) if v is not None else None)
            if v:
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
            updated_gf = _row_to_geofence(row)
        broadcast_sync(manager.broadcast_to_authorities, "geofence.updated", updated_gf.model_dump(mode="json"))
        return updated_gf
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
            # public.geofence_breaches.geofence_id references this row. A
            # zone that has been triggering repeated breaches (the exact
            # "sending 90-100 SOS automatically" scenario) accumulates many
            # breach rows, and deleting the geofence directly would either
            # be rejected outright by the FK constraint (if it isn't
            # ON DELETE CASCADE on the live DB) or silently leave orphaned
            # breach rows behind (if it is) — either way this is the delete
            # that was previously failing with the zone staying visible on
            # both dashboards and continuing to fire new incidents on every
            # GPS ping. Clearing breach history first makes the delete
            # unconditional regardless of what the live constraint is.
            cur.execute("DELETE FROM public.geofence_breaches WHERE geofence_id = %s;", (geofence_id,))
            cur.execute("DELETE FROM public.geofences WHERE id = %s RETURNING id;", (geofence_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Geofence not found")
        broadcast_sync(manager.broadcast_to_authorities, "geofence.deleted", {"id": str(geofence_id)})
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
                SELECT id, tourist_id, geofence_id, latitude, longitude, breach_time, sms_sent,
                       event_type, severity, message
                FROM public.geofence_breaches
                ORDER BY breach_time DESC
                LIMIT 200;
            """)
            return [
                GeofenceBreachResponse(
                    id=row[0], tourist_id=row[1], geofence_id=row[2],
                    latitude=float(row[3]), longitude=float(row[4]),
                    breach_time=row[5], sms_sent=row[6],
                    event_type=row[7] or "ENTERED", severity=row[8] or "MEDIUM", message=row[9],
                )
                for row in cur.fetchall()
            ]
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to retrieve breaches: {str(e)}")


# ---------------------------------------------------------------------------
# Breach detection — called from routers/locations.py on every GPS ping.
#
# Rewired (migration 003 merge) to use geofence_engine's shapely-based
# matcher instead of a single ST_Contains query, so CIRCLE zones now work
# correctly alongside POLYGON zones, and the hazard set now covers
# RESTRICTED (original), plus UNSAFE and WARNING (merged from Tanvi's
# module) — see geofence_engine.BREACH_ZONE_TYPES. SAFE/BUFFER zones remain
# informational, not breach triggers, unchanged from the original scope.
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
    Checks a single GPS ping against all active hazard geofences (RESTRICTED
    / UNSAFE / WARNING, CIRCLE or POLYGON) using geofence_engine's matcher,
    and records a breach (+ a linked incident) for any match, debounced per
    tourist+geofence so a tourist standing still doesn't spam new incidents
    every ping.

    NOTE (documented scope limit, unchanged from the original): this only
    detects ENTERING a hazard zone. Detecting "exited a SAFE zone" needs
    stateful per-tourist zone-membership tracking across consecutive pings —
    a bigger, separate piece of work.
    """
    cur.execute(f"SELECT {_GEOFENCE_COLUMNS} FROM public.geofences WHERE is_active = TRUE;")
    zones = [row_to_zone(row) for row in cur.fetchall()]

    matches = evaluate_point(latitude, longitude, zones, zone_types=BREACH_ZONE_TYPES)

    created = []
    now = datetime.now(timezone.utc)
    for match in matches:
        cur.execute("""
            SELECT 1 FROM public.geofence_breaches
            WHERE tourist_id = %s AND geofence_id = %s AND breach_time > %s
            LIMIT 1;
        """, (tourist_id, match.zone_id, now - _BREACH_DEBOUNCE))
        if cur.fetchone():
            continue  # already alerted recently for this tourist+zone

        breach_id = uuid4()
        sms_sent = _dispatch_sms_webhook(tourist_id, match.zone_name, match.zone_type)
        cur.execute("""
            INSERT INTO public.geofence_breaches (
                id, tourist_id, geofence_id, latitude, longitude, breach_time, sms_sent,
                event_type, severity, message
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, 'ENTERED', %s, %s);
        """, (breach_id, tourist_id, match.zone_id, latitude, longitude, now, sms_sent,
              match.severity, match.warning_message))

        incident_priority = "CRITICAL" if match.severity == "CRITICAL" else ("HIGH" if match.severity in ("HIGH", "MEDIUM") else "MEDIUM")
        incident_id = uuid4()
        cur.execute("""
            INSERT INTO public.incidents (
                id, incident_type, tourist_id, latitude, longitude,
                ai_risk_score, priority, status, description, created_at
            )
            VALUES (%s, 'GEOFENCE_BREACH', %s, %s, %s, %s, %s, 'OPEN', %s, %s);
        """, (
            incident_id, tourist_id, latitude, longitude, 55, incident_priority,
            f"Entered {match.zone_type.lower()} zone '{match.zone_name}'", now
        ))
        created.append({
            "geofence_id": match.zone_id, "geofence_name": match.zone_name,
            "incident_id": incident_id, "severity": match.severity,
            "warning_message": match.warning_message,
        })

    return created
