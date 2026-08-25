-- =================================================================
-- Suraksha Setu — Complete Supabase SQL Migration (Directive Phase 4)
-- Generated from backend/database/schema_definition.py and
-- backend/database/rls_policies.py — the same source of truth the
-- running FastAPI backend uses to build/verify this schema at boot
-- (database/schema_manager.py). Regenerate with:
--   python3 generate_sql_migration.py > database/migrations/002_directive_schema.sql
-- Safe to run against a fresh database or an existing one — every
-- statement is idempotent (IF NOT EXISTS / CREATE OR REPLACE), except
-- constraint and policy additions, which fail loudly on a second run
-- instead of silently duplicating (Postgres has no native
-- 'ADD CONSTRAINT IF NOT EXISTS'); re-running this file against an
-- already-migrated database is safe to ignore those specific errors.
--
-- NOTE: this file assumes a fresh schema. If migrating an existing
-- pre-directive database with real data in the old table names,
-- use backend/database/migration_v2.py instead (or first) — it
-- renames tables/columns in place so existing rows survive, which
-- this file's CREATE TABLE statements do not attempt.
-- =================================================================

-- ============================================================
-- Extensions
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- ============================================================
-- Tables
-- ============================================================
-- tourist_profiles
CREATE TABLE IF NOT EXISTS public.tourist_profiles (
    id UUID DEFAULT gen_random_uuid() NOT NULL,
    user_id UUID,
    username VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    tourist_id VARCHAR(30),
    phone_number VARCHAR(30),
    email VARCHAR(255),
    emergency_contacts JSONB DEFAULT '[]'::jsonb NOT NULL,
    govt_id_type VARCHAR(100),
    govt_id_number VARCHAR(255),
    id_photo_url TEXT,
    kyc_status VARCHAR(50) DEFAULT 'PENDING' NOT NULL,
    preferred_language VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    PRIMARY KEY (id)
);
-- authorities
CREATE TABLE IF NOT EXISTS public.authorities (
    authority_id UUID DEFAULT gen_random_uuid() NOT NULL,
    auth_user_id UUID,
    agency_name VARCHAR(255) NOT NULL,
    jurisdiction VARCHAR(255),
    contact_phone VARCHAR(30),
    contact_email VARCHAR(255),
    PRIMARY KEY (authority_id)
);
-- authentication
CREATE TABLE IF NOT EXISTS public.authentication (
    auth_id UUID DEFAULT gen_random_uuid() NOT NULL,
    auth_user_id UUID NOT NULL,
    tourist_profile_id UUID,
    authority_id UUID,
    username VARCHAR(255) NOT NULL,
    mfa_enabled BOOLEAN DEFAULT FALSE NOT NULL,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    PRIMARY KEY (auth_id)
);
-- points_of_interest
CREATE TABLE IF NOT EXISTS public.points_of_interest (
    poi_id UUID DEFAULT gen_random_uuid() NOT NULL,
    name VARCHAR(255) NOT NULL,
    latitude DECIMAL(10,7) NOT NULL,
    longitude DECIMAL(10,7) NOT NULL,
    risk_level VARCHAR(50) NOT NULL,
    recorded_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    PRIMARY KEY (poi_id)
);
-- locations
CREATE TABLE IF NOT EXISTS public.locations (
    id UUID DEFAULT gen_random_uuid() NOT NULL,
    tourist_id UUID NOT NULL,
    latitude DECIMAL(10,7) NOT NULL,
    longitude DECIMAL(10,7) NOT NULL,
    speed DECIMAL(6,2),
    heading DECIMAL(6,2),
    geom GEOMETRY(Point,4326),
    recorded_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    PRIMARY KEY (id)
);
-- geofences
CREATE TABLE IF NOT EXISTS public.geofences (
    id UUID DEFAULT gen_random_uuid() NOT NULL,
    name VARCHAR(255) NOT NULL,
    zone_type VARCHAR(50) NOT NULL,
    coordinates JSONB NOT NULL,
    geom GEOMETRY(Polygon,4326),
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    PRIMARY KEY (id)
);
-- geofence_breaches
CREATE TABLE IF NOT EXISTS public.geofence_breaches (
    id UUID DEFAULT gen_random_uuid() NOT NULL,
    tourist_id UUID NOT NULL,
    geofence_id UUID NOT NULL,
    latitude DECIMAL(10,7) NOT NULL,
    longitude DECIMAL(10,7) NOT NULL,
    breach_time TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    sms_sent BOOLEAN DEFAULT FALSE NOT NULL,
    PRIMARY KEY (id)
);
-- itineraries
CREATE TABLE IF NOT EXISTS public.itineraries (
    id UUID DEFAULT gen_random_uuid() NOT NULL,
    tourist_id UUID NOT NULL,
    title VARCHAR(255) NOT NULL,
    destinations JSONB DEFAULT '[]'::jsonb NOT NULL,
    start_date DATE,
    end_date DATE,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    PRIMARY KEY (id)
);
-- incidents
CREATE TABLE IF NOT EXISTS public.incidents (
    id UUID DEFAULT gen_random_uuid() NOT NULL,
    incident_type VARCHAR(50) NOT NULL,
    tourist_id UUID NOT NULL,
    latitude DECIMAL(10,7) NOT NULL,
    longitude DECIMAL(10,7) NOT NULL,
    ai_risk_score SMALLINT,
    priority VARCHAR(20) DEFAULT 'LOW' NOT NULL,
    status VARCHAR(50) DEFAULT 'OPEN' NOT NULL,
    description TEXT,
    assigned_officer_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    PRIMARY KEY (id)
);
-- alerts
CREATE TABLE IF NOT EXISTS public.alerts (
    alert_id UUID DEFAULT gen_random_uuid() NOT NULL,
    incident_id UUID NOT NULL,
    authority_id UUID,
    channel VARCHAR(50) NOT NULL,
    recipient VARCHAR(255) NOT NULL,
    sent_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    PRIMARY KEY (alert_id)
);
-- responses
CREATE TABLE IF NOT EXISTS public.responses (
    response_id UUID DEFAULT gen_random_uuid() NOT NULL,
    incident_id UUID NOT NULL,
    responder_unit VARCHAR(255),
    action_taken TEXT,
    resolved_at TIMESTAMPTZ,
    authority_id UUID NOT NULL,
    PRIMARY KEY (response_id)
);
-- sos_requests
CREATE TABLE IF NOT EXISTS public.sos_requests (
    sos_id UUID DEFAULT gen_random_uuid() NOT NULL,
    tourist_id UUID NOT NULL,
    incident_id UUID,
    latitude DECIMAL(10,7) NOT NULL,
    longitude DECIMAL(10,7) NOT NULL,
    battery_status SMALLINT,
    authority_id UUID,
    triggered_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    trigger_source VARCHAR(100) NOT NULL,
    sos_status VARCHAR(50) DEFAULT 'PENDING' NOT NULL,
    PRIMARY KEY (sos_id)
);
-- audit_logs
CREATE TABLE IF NOT EXISTS public.audit_logs (
    audit_id UUID DEFAULT gen_random_uuid() NOT NULL,
    authority_id UUID NOT NULL,
    action_type VARCHAR(50) NOT NULL,
    target_id VARCHAR(255) NOT NULL,
    reason TEXT,
    details TEXT,
    ip_address VARCHAR(64),
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    PRIMARY KEY (audit_id)
);

-- ============================================================
-- Unique & check constraints
-- ============================================================
ALTER TABLE public.tourist_profiles ADD CONSTRAINT uq_tourist_profiles_user_id UNIQUE (user_id);
ALTER TABLE public.tourist_profiles ADD CONSTRAINT uq_tourist_profiles_username UNIQUE (username);
ALTER TABLE public.tourist_profiles ADD CONSTRAINT uq_tourist_profiles_tourist_id UNIQUE (tourist_id);
ALTER TABLE public.tourist_profiles ADD CONSTRAINT chk_tourist_profiles_kyc CHECK (kyc_status IN ('PENDING','VERIFIED','REJECTED'));
ALTER TABLE public.authorities ADD CONSTRAINT uq_authorities_auth_user_id UNIQUE (auth_user_id);
ALTER TABLE public.authentication ADD CONSTRAINT uq_authentication_auth_user_id UNIQUE (auth_user_id);
ALTER TABLE public.authentication ADD CONSTRAINT uq_authentication_username UNIQUE (username);
ALTER TABLE public.authentication ADD CONSTRAINT chk_authentication_type CHECK ((tourist_profile_id IS NOT NULL AND authority_id IS NULL) OR (tourist_profile_id IS NULL AND authority_id IS NOT NULL));
ALTER TABLE public.points_of_interest ADD CONSTRAINT chk_points_of_interest_coords CHECK (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180);
ALTER TABLE public.locations ADD CONSTRAINT chk_locations_coords CHECK (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180);
ALTER TABLE public.geofences ADD CONSTRAINT chk_geofences_zone_type CHECK (zone_type IN ('SAFE','BUFFER','RESTRICTED'));
ALTER TABLE public.itineraries ADD CONSTRAINT chk_itineraries_dates CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date);
ALTER TABLE public.incidents ADD CONSTRAINT chk_incidents_type CHECK (incident_type IN ('SOS','GEOFENCE_BREACH','MANUAL'));
ALTER TABLE public.incidents ADD CONSTRAINT chk_incidents_priority CHECK (priority IN ('LOW','MEDIUM','HIGH','CRITICAL'));
ALTER TABLE public.incidents ADD CONSTRAINT chk_incidents_status CHECK (status IN ('OPEN','INVESTIGATING','RESOLVED'));
ALTER TABLE public.incidents ADD CONSTRAINT chk_incidents_risk_score CHECK (ai_risk_score IS NULL OR ai_risk_score BETWEEN 1 AND 100);
ALTER TABLE public.sos_requests ADD CONSTRAINT chk_sos_requests_status CHECK (sos_status IN ('PENDING','ACKNOWLEDGED','DISPATCHED','RESOLVED'));

-- ============================================================
-- Foreign keys
-- ============================================================
ALTER TABLE public.tourist_profiles ADD CONSTRAINT fk_tourist_profiles_user_id FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.authorities ADD CONSTRAINT fk_authorities_auth_user_id FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.authentication ADD CONSTRAINT fk_authentication_auth_user_id FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.authentication ADD CONSTRAINT fk_authentication_tourist_profile_id FOREIGN KEY (tourist_profile_id) REFERENCES public.tourist_profiles(id) ON DELETE CASCADE;
ALTER TABLE public.authentication ADD CONSTRAINT fk_authentication_authority_id FOREIGN KEY (authority_id) REFERENCES public.authorities(authority_id) ON DELETE CASCADE;
ALTER TABLE public.locations ADD CONSTRAINT fk_locations_tourist_id FOREIGN KEY (tourist_id) REFERENCES public.tourist_profiles(id) ON DELETE CASCADE;
ALTER TABLE public.geofence_breaches ADD CONSTRAINT fk_geofence_breaches_tourist_id FOREIGN KEY (tourist_id) REFERENCES public.tourist_profiles(id) ON DELETE CASCADE;
ALTER TABLE public.geofence_breaches ADD CONSTRAINT fk_geofence_breaches_geofence_id FOREIGN KEY (geofence_id) REFERENCES public.geofences(id) ON DELETE CASCADE;
ALTER TABLE public.itineraries ADD CONSTRAINT fk_itineraries_tourist_id FOREIGN KEY (tourist_id) REFERENCES public.tourist_profiles(id) ON DELETE CASCADE;
ALTER TABLE public.incidents ADD CONSTRAINT fk_incidents_tourist_id FOREIGN KEY (tourist_id) REFERENCES public.tourist_profiles(id) ON DELETE CASCADE;
ALTER TABLE public.incidents ADD CONSTRAINT fk_incidents_assigned_officer_id FOREIGN KEY (assigned_officer_id) REFERENCES public.authorities(authority_id) ON DELETE SET NULL;
ALTER TABLE public.alerts ADD CONSTRAINT fk_alerts_incident_id FOREIGN KEY (incident_id) REFERENCES public.incidents(id) ON DELETE CASCADE;
ALTER TABLE public.alerts ADD CONSTRAINT fk_alerts_authority_id FOREIGN KEY (authority_id) REFERENCES public.authorities(authority_id) ON DELETE SET NULL;
ALTER TABLE public.responses ADD CONSTRAINT fk_responses_incident_id FOREIGN KEY (incident_id) REFERENCES public.incidents(id) ON DELETE CASCADE;
ALTER TABLE public.responses ADD CONSTRAINT fk_responses_authority_id FOREIGN KEY (authority_id) REFERENCES public.authorities(authority_id) ON DELETE CASCADE;
ALTER TABLE public.sos_requests ADD CONSTRAINT fk_sos_requests_tourist_id FOREIGN KEY (tourist_id) REFERENCES public.tourist_profiles(id) ON DELETE CASCADE;
ALTER TABLE public.sos_requests ADD CONSTRAINT fk_sos_requests_incident_id FOREIGN KEY (incident_id) REFERENCES public.incidents(id) ON DELETE CASCADE;
ALTER TABLE public.sos_requests ADD CONSTRAINT fk_sos_requests_authority_id FOREIGN KEY (authority_id) REFERENCES public.authorities(authority_id) ON DELETE SET NULL;
ALTER TABLE public.audit_logs ADD CONSTRAINT fk_audit_logs_authority_id FOREIGN KEY (authority_id) REFERENCES public.authorities(authority_id) ON DELETE CASCADE;

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_tourist_profiles_user_id ON public.tourist_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_tourist_profiles_tourist_id ON public.tourist_profiles(tourist_id);
CREATE INDEX IF NOT EXISTS idx_authorities_auth_user_id ON public.authorities(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_authentication_username ON public.authentication(username);
CREATE INDEX IF NOT EXISTS idx_authentication_tourist_profile_id ON public.authentication(tourist_profile_id);
CREATE INDEX IF NOT EXISTS idx_authentication_authority_id ON public.authentication(authority_id);
CREATE INDEX IF NOT EXISTS idx_points_of_interest_coords ON public.points_of_interest(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_locations_tourist_id ON public.locations(tourist_id);
CREATE INDEX IF NOT EXISTS idx_locations_recorded_at ON public.locations(recorded_at);
CREATE INDEX IF NOT EXISTS idx_locations_geom ON public.locations(geom USING GIST);
CREATE INDEX IF NOT EXISTS idx_locations_tourist_recorded ON public.locations(tourist_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_geofences_zone_type ON public.geofences(zone_type);
CREATE INDEX IF NOT EXISTS idx_geofences_geom ON public.geofences(geom USING GIST);
CREATE INDEX IF NOT EXISTS idx_geofence_breaches_tourist_id ON public.geofence_breaches(tourist_id);
CREATE INDEX IF NOT EXISTS idx_geofence_breaches_geofence_id ON public.geofence_breaches(geofence_id);
CREATE INDEX IF NOT EXISTS idx_geofence_breaches_breach_time ON public.geofence_breaches(breach_time);
CREATE INDEX IF NOT EXISTS idx_itineraries_tourist_id ON public.itineraries(tourist_id);
CREATE INDEX IF NOT EXISTS idx_incidents_status ON public.incidents(status);
CREATE INDEX IF NOT EXISTS idx_incidents_priority ON public.incidents(priority);
CREATE INDEX IF NOT EXISTS idx_incidents_created_at ON public.incidents(created_at);
CREATE INDEX IF NOT EXISTS idx_incidents_tourist_id ON public.incidents(tourist_id);
CREATE INDEX IF NOT EXISTS idx_sos_requests_tourist_id ON public.sos_requests(tourist_id);
CREATE INDEX IF NOT EXISTS idx_sos_requests_status ON public.sos_requests(sos_status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_authority_id ON public.audit_logs(authority_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at);

-- ============================================================
-- Row Level Security
-- ============================================================
ALTER TABLE public.tourist_profiles ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tourist_profiles TO authenticated;
ALTER TABLE public.authorities ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.authorities TO authenticated;
ALTER TABLE public.authentication ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.authentication TO authenticated;
ALTER TABLE public.points_of_interest ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.points_of_interest TO authenticated;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.locations TO authenticated;
ALTER TABLE public.geofences ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.geofences TO authenticated;
ALTER TABLE public.geofence_breaches ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.geofence_breaches TO authenticated;
ALTER TABLE public.itineraries ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.itineraries TO authenticated;
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.incidents TO authenticated;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.alerts TO authenticated;
ALTER TABLE public.responses ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.responses TO authenticated;
ALTER TABLE public.sos_requests ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sos_requests TO authenticated;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_logs TO authenticated;

-- SECURITY DEFINER helper for every "is the current user an
-- authority?" RLS check. MUST be created before the policies below,
-- several of which call it by name. A raw
-- 'EXISTS (SELECT 1 FROM public.authorities ...)' subquery inlined
-- directly into authorities' own SELECT policy (and into every other
-- table's "OR is an authority" checks) re-triggers RLS on
-- authorities every time it runs, causing "infinite recursion
-- detected in policy for relation \"authorities\"". A SECURITY
-- DEFINER function evaluates with the function owner's privileges
-- instead of the calling role's, so it doesn't re-invoke that policy.
CREATE OR REPLACE FUNCTION public.is_authority(uid uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
    SELECT EXISTS (SELECT 1 FROM public.authorities a WHERE a.auth_user_id = uid);
$$;

DROP POLICY IF EXISTS select_own_or_authority ON public.tourist_profiles;
CREATE POLICY select_own_or_authority ON public.tourist_profiles FOR SELECT TO authenticated
    USING (user_id = auth.uid() OR public.is_authority(auth.uid()));
DROP POLICY IF EXISTS insert_own ON public.tourist_profiles;
CREATE POLICY insert_own ON public.tourist_profiles FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS update_own ON public.tourist_profiles;
CREATE POLICY update_own ON public.tourist_profiles FOR UPDATE TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS select_any_authority ON public.authorities;
CREATE POLICY select_any_authority ON public.authorities FOR SELECT TO authenticated
    USING (public.is_authority(auth.uid()));
DROP POLICY IF EXISTS insert_own ON public.authorities;
CREATE POLICY insert_own ON public.authorities FOR INSERT TO authenticated
    WITH CHECK (auth_user_id = auth.uid());
DROP POLICY IF EXISTS update_own ON public.authorities;
CREATE POLICY update_own ON public.authorities FOR UPDATE TO authenticated
    USING (auth_user_id = auth.uid())
    WITH CHECK (auth_user_id = auth.uid());
DROP POLICY IF EXISTS select_own ON public.authentication;
CREATE POLICY select_own ON public.authentication FOR SELECT TO authenticated
    USING (auth_user_id = auth.uid());
DROP POLICY IF EXISTS select_all_authenticated ON public.points_of_interest;
CREATE POLICY select_all_authenticated ON public.points_of_interest FOR SELECT TO authenticated
    USING (true);
DROP POLICY IF EXISTS select_own_or_authority ON public.locations;
CREATE POLICY select_own_or_authority ON public.locations FOR SELECT TO authenticated
    USING (tourist_id = (SELECT tp.id FROM public.tourist_profiles tp WHERE tp.user_id = auth.uid()) OR public.is_authority(auth.uid()));
DROP POLICY IF EXISTS insert_own ON public.locations;
CREATE POLICY insert_own ON public.locations FOR INSERT TO authenticated
    WITH CHECK (tourist_id = (SELECT tp.id FROM public.tourist_profiles tp WHERE tp.user_id = auth.uid()));
DROP POLICY IF EXISTS select_all_authenticated ON public.geofences;
CREATE POLICY select_all_authenticated ON public.geofences FOR SELECT TO authenticated
    USING (true);
DROP POLICY IF EXISTS authority_insert ON public.geofences;
CREATE POLICY authority_insert ON public.geofences FOR INSERT TO authenticated
    WITH CHECK (public.is_authority(auth.uid()));
DROP POLICY IF EXISTS authority_update ON public.geofences;
CREATE POLICY authority_update ON public.geofences FOR UPDATE TO authenticated
    USING (public.is_authority(auth.uid()))
    WITH CHECK (public.is_authority(auth.uid()));
DROP POLICY IF EXISTS authority_delete ON public.geofences;
CREATE POLICY authority_delete ON public.geofences FOR DELETE TO authenticated
    USING (public.is_authority(auth.uid()));
DROP POLICY IF EXISTS select_own_or_authority ON public.geofence_breaches;
CREATE POLICY select_own_or_authority ON public.geofence_breaches FOR SELECT TO authenticated
    USING (tourist_id = (SELECT tp.id FROM public.tourist_profiles tp WHERE tp.user_id = auth.uid()) OR public.is_authority(auth.uid()));
DROP POLICY IF EXISTS insert_own ON public.geofence_breaches;
CREATE POLICY insert_own ON public.geofence_breaches FOR INSERT TO authenticated
    WITH CHECK (tourist_id = (SELECT tp.id FROM public.tourist_profiles tp WHERE tp.user_id = auth.uid()));
DROP POLICY IF EXISTS full_access_own ON public.itineraries;
CREATE POLICY full_access_own ON public.itineraries FOR ALL TO authenticated
    USING (tourist_id = (SELECT tp.id FROM public.tourist_profiles tp WHERE tp.user_id = auth.uid()))
    WITH CHECK (tourist_id = (SELECT tp.id FROM public.tourist_profiles tp WHERE tp.user_id = auth.uid()));
DROP POLICY IF EXISTS select_own_or_authority ON public.incidents;
CREATE POLICY select_own_or_authority ON public.incidents FOR SELECT TO authenticated
    USING (tourist_id = (SELECT tp.id FROM public.tourist_profiles tp WHERE tp.user_id = auth.uid()) OR public.is_authority(auth.uid()));
DROP POLICY IF EXISTS insert_own_or_authority ON public.incidents;
CREATE POLICY insert_own_or_authority ON public.incidents FOR INSERT TO authenticated
    WITH CHECK (tourist_id = (SELECT tp.id FROM public.tourist_profiles tp WHERE tp.user_id = auth.uid()) OR public.is_authority(auth.uid()));
DROP POLICY IF EXISTS authority_update ON public.incidents;
CREATE POLICY authority_update ON public.incidents FOR UPDATE TO authenticated
    USING (public.is_authority(auth.uid()))
    WITH CHECK (public.is_authority(auth.uid()));
DROP POLICY IF EXISTS authority_only ON public.alerts;
CREATE POLICY authority_only ON public.alerts FOR ALL TO authenticated
    USING (public.is_authority(auth.uid()))
    WITH CHECK (public.is_authority(auth.uid()));
DROP POLICY IF EXISTS authority_only ON public.responses;
CREATE POLICY authority_only ON public.responses FOR ALL TO authenticated
    USING (public.is_authority(auth.uid()))
    WITH CHECK (public.is_authority(auth.uid()));
DROP POLICY IF EXISTS select_own_or_authority ON public.sos_requests;
CREATE POLICY select_own_or_authority ON public.sos_requests FOR SELECT TO authenticated
    USING (tourist_id = (SELECT tp.id FROM public.tourist_profiles tp WHERE tp.user_id = auth.uid()) OR public.is_authority(auth.uid()));
DROP POLICY IF EXISTS insert_own ON public.sos_requests;
CREATE POLICY insert_own ON public.sos_requests FOR INSERT TO authenticated
    WITH CHECK (tourist_id = (SELECT tp.id FROM public.tourist_profiles tp WHERE tp.user_id = auth.uid()));
DROP POLICY IF EXISTS authority_only ON public.audit_logs;
CREATE POLICY authority_only ON public.audit_logs FOR ALL TO authenticated
    USING (public.is_authority(auth.uid()))
    WITH CHECK (public.is_authority(auth.uid()));

-- ============================================================
-- Triggers
-- ============================================================
-- Keeps public.locations.geom in sync with latitude/longitude on
-- every insert or update, regardless of which code path wrote the
-- row (the FastAPI backend already sets geom explicitly, but any
-- other write path — a direct Supabase client call, a manual SQL
-- fix — would otherwise leave geom NULL and silently break the
-- geofence ST_Contains breach check in routers/geofences.py).
CREATE OR REPLACE FUNCTION public.sync_locations_geom() RETURNS trigger AS $$
BEGIN
    NEW.geom := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_locations_sync_geom ON public.locations;
CREATE TRIGGER trg_locations_sync_geom
    BEFORE INSERT OR UPDATE OF latitude, longitude ON public.locations
    FOR EACH ROW EXECUTE FUNCTION public.sync_locations_geom();

