"""
Geofence zone-matching engine.

Ported from location-geofencing-backend-main/app/geofence/engine.py (a
teammate's standalone SQLAlchemy-based module) into this codebase's raw-SQL
style. The detection ALGORITHM is unchanged (shapely point-in-polygon /
circle-as-buffer matching); only the data access layer changed — this module
takes plain rows/dicts pulled via psycopg2 (get_authenticated_cursor), not
SQLAlchemy ORM objects, so no second ORM is introduced alongside the
existing raw-SQL codebase.

Supports both zone_type vocabularies now present on public.geofences after
migration 003_geofence_engine_merge.sql:
  - the original set: SAFE, BUFFER, RESTRICTED
  - Tanvi's set, merged in: UNSAFE, WARNING
plus CIRCLE geometry (center_lat/center_lng/radius_m) in addition to the
existing POLYGON geometry (coordinates/geom).
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass

from shapely.geometry import Point, shape
from shapely.geometry.base import BaseGeometry

EARTH_RADIUS_METERS = 6_371_000.0

# Zone types that represent a genuine hazard a tourist should be alerted
# about entering. SAFE and BUFFER zones are informational, not breach
# triggers — mirrors the original evaluate_geofence_breaches() scope, now
# widened to also cover Tanvi's UNSAFE/WARNING vocabulary.
BREACH_ZONE_TYPES = ("RESTRICTED", "UNSAFE", "WARNING")

# Default per-zone-type severity when a geofence row predates the severity
# column (additive migration default is 'MEDIUM' for all pre-existing rows,
# but this mapping gives new callers something more specific to fall back
# on if a row's severity is ever missing/blank).
_DEFAULT_SEVERITY_BY_ZONE_TYPE = {
    "RESTRICTED": "HIGH",
    "UNSAFE": "CRITICAL",
    "WARNING": "MEDIUM",
    "BUFFER": "LOW",
    "SAFE": "LOW",
}


@dataclass(frozen=True)
class GeofenceZone:
    """Plain data holder for one public.geofences row — no ORM."""
    id: str
    name: str
    zone_type: str
    geometry_type: str  # 'CIRCLE' | 'POLYGON'
    is_active: bool
    severity: str | None = None
    warning_message: str | None = None
    is_crowd_zone: bool = False
    center_lat: float | None = None
    center_lng: float | None = None
    radius_m: float | None = None
    coordinates: list | None = None  # [[lng, lat], ...] closed ring, POLYGON only


@dataclass(frozen=True)
class ZoneMatch:
    zone_id: str
    zone_name: str
    zone_type: str
    severity: str
    warning_message: str


def _circle_to_polygon(lat: float, lng: float, radius_m: float) -> BaseGeometry:
    """Approximate a geodesic circle as a local planar buffer (adequate for
    the small radii used by these zones — same approach as the original)."""
    lat_rad = lat * math.pi / 180.0
    buffer_x = radius_m / (EARTH_RADIUS_METERS * max(abs(math.cos(lat_rad)), 1e-6)) * (180.0 / math.pi)
    buffer_y = radius_m / EARTH_RADIUS_METERS * (180.0 / math.pi)
    point = Point(lng, lat)
    return point.buffer(max(buffer_x, buffer_y))


def zone_to_geometry(zone: GeofenceZone) -> BaseGeometry:
    if zone.geometry_type == "CIRCLE":
        if zone.center_lat is None or zone.center_lng is None or zone.radius_m is None:
            raise ValueError(f"Circle zone {zone.id} missing center or radius")
        return _circle_to_polygon(zone.center_lat, zone.center_lng, zone.radius_m)

    if not zone.coordinates:
        raise ValueError(f"Polygon zone {zone.id} missing coordinates")

    coords = zone.coordinates
    if isinstance(coords, str):
        coords = json.loads(coords)
    geojson = {"type": "Polygon", "coordinates": [coords]}
    return shape(geojson)


def point_in_zone(lat: float, lng: float, zone: GeofenceZone) -> bool:
    try:
        geometry = zone_to_geometry(zone)
    except ValueError:
        return False
    return geometry.contains(Point(lng, lat))


def evaluate_point(lat: float, lng: float, zones: list[GeofenceZone], zone_types: tuple[str, ...] | None = None) -> list[ZoneMatch]:
    """Return every active zone (optionally restricted to zone_types) that
    contains (lat, lng)."""
    matches: list[ZoneMatch] = []
    for zone in zones:
        if not zone.is_active:
            continue
        if zone_types is not None and zone.zone_type not in zone_types:
            continue
        if point_in_zone(lat, lng, zone):
            severity = zone.severity or _DEFAULT_SEVERITY_BY_ZONE_TYPE.get(zone.zone_type, "MEDIUM")
            message = zone.warning_message or f"You have entered a {zone.zone_type.lower()} zone: {zone.name}"
            matches.append(ZoneMatch(
                zone_id=zone.id, zone_name=zone.name, zone_type=zone.zone_type,
                severity=severity, warning_message=message,
            ))
    return matches


def split_transitions(previous_zone_ids: set[str], current_matches: list[ZoneMatch]) -> tuple[list[ZoneMatch], set[str]]:
    """Return (newly entered matches, zone ids that were exited) versus a
    previous known zone-membership set. Callers that don't track
    previous-zone state per tourist can pass an empty set to just get
    "currently inside" as "entered"."""
    entered = [m for m in current_matches if m.zone_id not in previous_zone_ids]
    current_ids = {m.zone_id for m in current_matches}
    exited_ids = previous_zone_ids - current_ids
    return entered, exited_ids


def row_to_zone(row) -> GeofenceZone:
    """Expects the column order from geofences.py's _GEOFENCE_COLUMNS_V2
    (see routers/geofences.py): id, name, zone_type, coordinates, is_active,
    created_at, geometry_type, center_lat, center_lng, radius_m, severity,
    warning_message, is_crowd_zone."""
    coords = row[3]
    if isinstance(coords, str) and coords:
        coords = json.loads(coords)
    return GeofenceZone(
        id=str(row[0]), name=row[1], zone_type=row[2], coordinates=coords,
        is_active=row[4],
        geometry_type=row[6] or "POLYGON",
        center_lat=float(row[7]) if row[7] is not None else None,
        center_lng=float(row[8]) if row[8] is not None else None,
        radius_m=float(row[9]) if row[9] is not None else None,
        severity=row[10],
        warning_message=row[11],
        is_crowd_zone=bool(row[12]) if row[12] is not None else False,
    )
