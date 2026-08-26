-- Migration 003: Merge location-geofencing-backend-main's geofencing engine
--
-- Why: the standalone teammate module (Tanvi's location-geofencing-backend)
-- supports circular zones, per-zone severity, custom warning messages, and
-- crowd-zone flags, plus two extra zone types (UNSAFE, WARNING) that the
-- original 3-type set (SAFE/BUFFER/RESTRICTED) didn't have. This migration
-- is purely additive: every existing polygon geofence row keeps working
-- unchanged (geometry_type defaults to 'POLYGON'), and the zone_type CHECK
-- constraint is widened (dropped + re-added with the union of both value
-- sets), never narrowed. Mirrors database/schema_definition.py's
-- "geofences"/"geofence_breaches" table entries — keep both in sync.
--
-- Safe to run against an existing, already-migrated database. Re-running is
-- safe: every ADD COLUMN uses IF NOT EXISTS, and the constraint drop/add is
-- also idempotent (DROP ... IF EXISTS before the ADD).

-- ============================================================
-- public.geofences — new columns for circle geometry, severity, messaging
-- ============================================================
ALTER TABLE IF EXISTS public.geofences
    ADD COLUMN IF NOT EXISTS geometry_type VARCHAR(16) NOT NULL DEFAULT 'POLYGON',
    ADD COLUMN IF NOT EXISTS center_lat DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS center_lng DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS radius_m DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS severity VARCHAR(16) NOT NULL DEFAULT 'MEDIUM',
    ADD COLUMN IF NOT EXISTS warning_message TEXT,
    ADD COLUMN IF NOT EXISTS is_crowd_zone BOOLEAN NOT NULL DEFAULT FALSE;

-- Widen zone_type to also allow Tanvi's UNSAFE/WARNING values, keeping the
-- original SAFE/BUFFER/RESTRICTED values valid for every existing row.
ALTER TABLE IF EXISTS public.geofences DROP CONSTRAINT IF EXISTS chk_geofences_zone_type;
ALTER TABLE IF EXISTS public.geofences
    ADD CONSTRAINT chk_geofences_zone_type
    CHECK (zone_type IN ('SAFE','BUFFER','RESTRICTED','UNSAFE','WARNING'));

ALTER TABLE IF EXISTS public.geofences DROP CONSTRAINT IF EXISTS chk_geofences_geometry_type;
ALTER TABLE IF EXISTS public.geofences
    ADD CONSTRAINT chk_geofences_geometry_type CHECK (geometry_type IN ('CIRCLE','POLYGON'));

ALTER TABLE IF EXISTS public.geofences DROP CONSTRAINT IF EXISTS chk_geofences_severity;
ALTER TABLE IF EXISTS public.geofences
    ADD CONSTRAINT chk_geofences_severity CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL'));

-- CIRCLE zones have no `geom` polygon to index against; geometry_type lets
-- the engine and any future query branch cheaply without parsing coordinates.
CREATE INDEX IF NOT EXISTS idx_geofences_geometry_type ON public.geofences(geometry_type);

-- ============================================================
-- public.geofence_breaches — enrich with event_type/severity/message
-- instead of creating a duplicate geofence_events table (Tanvi's module
-- had a separate GeofenceEvent model; this codebase's geofence_breaches
-- already served the same purpose for RESTRICTED-only breaches, so it is
-- extended rather than duplicated).
-- ============================================================
ALTER TABLE IF EXISTS public.geofence_breaches
    ADD COLUMN IF NOT EXISTS event_type VARCHAR(32) NOT NULL DEFAULT 'ENTERED',
    ADD COLUMN IF NOT EXISTS severity VARCHAR(16) NOT NULL DEFAULT 'MEDIUM',
    ADD COLUMN IF NOT EXISTS message TEXT;
