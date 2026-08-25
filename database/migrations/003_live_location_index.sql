-- Migration: Add composite index for GET /authority/locations/live
--
-- Why: the authority dashboard's live tracker hydrates all tourists'
-- current positions in one call via a
--   SELECT DISTINCT ON (tourist_id) ... FROM public.locations
--   ORDER BY tourist_id, recorded_at DESC
-- query (see routers/authority.py get_live_tourist_locations). The two
-- pre-existing single-column indexes on public.locations
-- (idx_locations_tourist_id, idx_locations_recorded_at) don't let
-- Postgres satisfy "the latest row per tourist_id" efficiently on their
-- own — it would still need to sort/scan every row per tourist. This
-- composite index lets it walk straight to each tourist's single latest
-- row instead.
--
-- No new table/column — additive index only. Safe to run against an
-- already-live database; also applied automatically by
-- database/schema_manager.py on backend boot (see the "indexes" entry
-- for the "locations" table in database/schema_definition.py), so running
-- this by hand is only needed if you want it applied immediately without
-- waiting for/triggering a backend redeploy.

CREATE INDEX IF NOT EXISTS idx_locations_tourist_recorded
    ON public.locations (tourist_id, recorded_at DESC);
