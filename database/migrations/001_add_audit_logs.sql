-- Migration: Add public.audit_logs table
--
-- Why: Task 7.3 of the production-readiness correction requires persisting
-- authority search/interception compliance logs to the database instead of
-- an in-memory array in the frontend (App.tsx). This table is new — it is
-- not part of the original 9-table schema documented in DATABASE.md — so
-- per DATABASE.md section 26 (Schema Change Policy) this migration and the
-- corresponding DATABASE.md addendum accompany the code change.
--
-- Run this against the Supabase project before deploying the audit-logs
-- backend router.

CREATE TABLE IF NOT EXISTS public.audit_logs (
    audit_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    authority_id UUID NOT NULL REFERENCES public.authorities(authority_id) ON DELETE CASCADE,
    action_type  VARCHAR(50) NOT NULL,
    target_id    VARCHAR(255) NOT NULL,
    reason       TEXT,
    details      TEXT,
    ip_address   VARCHAR(64),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_authority_id ON public.audit_logs(authority_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Authorities may insert their own audit log entries.
CREATE POLICY audit_logs_insert_own ON public.audit_logs
    FOR INSERT
    WITH CHECK (
        authority_id IN (
            SELECT authority_id FROM public.authorities WHERE auth_user_id = auth.uid()
        )
    );

-- Any authenticated authority may read the compliance log (read-only
-- oversight/audit trail is intentionally visible across the authority pool,
-- matching a shared compliance-review use case).
CREATE POLICY audit_logs_select_authority ON public.audit_logs
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.authorities WHERE auth_user_id = auth.uid()
        )
    );

-- Table-level privileges must permit the operations for RLS policies to evaluate.
GRANT SELECT, INSERT ON public.audit_logs TO authenticated;
