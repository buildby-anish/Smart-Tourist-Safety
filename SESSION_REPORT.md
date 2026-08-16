# Smart Tourist Safety / Suraksha Setu — Production-Readiness Correction Report

Scope: 7-task correction pass covering demo-credential removal, database attribute
mapping, security bypass removal, RLS/incident-assignment fixes, a CORS startup
crash, a nullable-schema mismatch, and connecting three local-only features to
the backend.

---

## Root Cause

The codebase was built demo-first: forms were pre-filled with a single fictional
tourist ("Elena Rostova") and a single fictional officer ("IPS-7742") so the app
was clickable without a live backend. As real backend endpoints were added
incrementally, several of these demo shortcuts were left in place as *silent
fallbacks* rather than being removed — sign-up/sign-in caught backend errors and
substituted a local mock profile instead of failing, authority login
auto-registered unknown badges instead of rejecting them, and SOS submission
errors were treated as "offline" regardless of whether the backend actually
rejected the request. Separately, three features (itinerary, dispatch-response
logging, compliance audit trail) had frontend UI and local React state but no
backend endpoints at all. Finally, two independent schema/config mismatches
(a non-nullable `incident_id` on `SOSResponse`, and a `CORS_ALLOWED_ORIGINS`
default that collides with `allow_credentials=True`) would surface as runtime
crashes rather than design issues per se.

## Changes Made

**Task 1 — Demo credentials removed**
- `Gateway.tsx`: `badgeId`/`otp` state now initializes empty.
- `i18n.ts`: `mfaDemoNote` rewritten (both `en`/`hi`) to generic instructions.
- `TouristPortal.tsx`: all sign-up/sign-in field defaults cleared; every
  `'Elena Rostova'` fallback replaced with `authenticatedUser?.name || 'Tourist'`
  (or `fullName || 'Tourist'` pre-auth); the stale "Demo Quick Sign-In:
  Pre-filled..." helper text (which became factually wrong once the field
  defaults were cleared) rewritten to accurate guidance.

**Task 2 — Database attribute mapping aligned**
- `handleVerifyOtp()` in `TouristPortal.tsx` now builds the `TouristProfile`
  entirely from the backend response (`tourist_id`, `digital_id`, `full_name`,
  `kyc_verified`, `emergency_contact`, `preferred_language`, `created_at`)
  instead of fallback strings.
- `onTriggerSos` signature extended to carry the real `touristId`/`touristPhone`
  from `authenticatedUser`; `App.tsx`'s `handleTouristTriggerSos` now uses
  these instead of the hardcoded `'TR-88219'` / `'+34 612 884 902'` overrides.
- `getTouristId()` in `api.ts`: hardcoded UUID fallback removed, returns `""`.

**Task 3 — Security/auth bypasses removed**
- `handleVerifyOtp()` (both signup and signin branches): on backend failure,
  aborts, sets `otpError`, and keeps the OTP modal open — no more silent
  fallback to a mock local profile.
- `authenticateAuthority()` in `api.ts`: removed the catch-block that
  auto-registered an unknown badge on 401/404. Login now simply fails.
- `submitSOSOnline()` now throws a typed `ApiError` (carrying the real HTTP
  status) instead of a plain `Error`. `handleExecuteSosSend()` in
  `TouristPortal.tsx` checks for `ApiError` with status 400/401/404 and
  reports it as an active failure (`sosStep = 'error'`) instead of silently
  queuing it as an offline record; only genuine network failures still queue
  offline.

**Task 4 — RLS/assignment fixes**
- `authority.py` (`get_authority_incidents`) and `incidents.py`
  (`list_incidents`) now explicitly widen their query to
  `authority_id IS NULL OR authority_id = <current authority>` for authority
  users, so newly created (unassigned) SOS incidents are visible. Tourist
  users are left on the original RLS-only query.
- `IncidentUpdate` schema gained an optional `authority_id` field;
  `update_incident()` auto-assigns the dispatching authority's `authority_id`
  when a PATCH transitions status to `RESPONDING` and no explicit
  `authority_id` was supplied.
- `handleDispatchUnit()` in `App.tsx` now reads `getAuthorityId()` and passes
  it through `updateIncidentStatus(...)`.

**Task 5 — CORS startup crash**
- `main.py`: if `CORS_ALLOWED_ORIGINS` is empty or contains `"*"`, falls back
  to explicit `http://localhost:3000` / `http://localhost:5173` instead of
  passing an incompatible wildcard+credentials combination to
  `CORSMiddleware`.

**Task 6 — Schema mismatch**
- `schemas/sos.py`: `SOSResponse.incident_id` changed from `UUID` to
  `UUID | None = None`, matching `sos_requests.incident_id` being optional
  per `DATABASE.md`.

**Task 7 — Local-only features connected to backend**
- **Itinerary**: new `backend/routers/itinerary.py` (`POST/GET/DELETE
  /api/v1/itinerary`) + `backend/schemas/itinerary.py`, resolving/creating a
  `locations` row when no `location_id` is supplied. `TouristPortal.tsx`'s
  `handleAddItinerary`/`handleDeleteItinerary` now call
  `createItineraryEntry`/`deleteItineraryEntry` (best-effort — the item stays
  visible locally either way, consistent with the app's existing
  offline-friendly UX).
- **Dispatch response logging**: `POST/GET /api/v1/incidents/{id}/responses`
  added to `incidents.py` + `backend/schemas/response.py`, mapping
  `public.responses`. `handleDispatchUnit()` in `App.tsx` now calls
  `createIncidentResponse()` alongside the existing status PATCH.
- **Compliance audit trail**: new `public.audit_logs` table (not part of the
  original 9-table schema — see "Schema change" below), `backend/schemas
  /audit_log.py`, `backend/routers/audit_logs.py` (`POST/GET
  /api/v1/audit-logs`). `handleLogAudit()` in `App.tsx` now persists to the
  backend (optimistic local update + fire-and-forget POST, patched with the
  real `audit_id` on success) and uses the actual signed-in officer's
  username (`getUsername()`) instead of the hardcoded `'Rajesh Kumar, IPS'` /
  `'IPS-7742'`. A new `refreshAuditLogsFromBackend()` merges persisted logs
  in after authority login, mirroring the existing `refreshIncidentsFromBackend()`
  pattern.

**Schema change (flagged for your review):** `public.audit_logs` is a new
table, not present in the original `DATABASE.md`. Added via
`database/migrations/001_add_audit_logs.sql` (with RLS: authorities insert
their own rows, any authenticated authority can read the full log) and
documented as an addendum in `DATABASE.md` §31, per that document's own
schema-change policy. This is the one place this pass extended the DB
contract beyond what was given — please review the migration before running
it against the live Supabase project.

## Features Connected
- Tourist itinerary entries (`itinerary_entries` table) — create/list/delete.
- Authority dispatch-response logs (`responses` table) — create/list per incident.
- Authority compliance audit trail (`audit_logs`, new table) — create/list.
- SOS trigger flow now carries the real tourist identity end-to-end instead of
  overriding it with hardcoded values at the App.tsx layer.

## Demo Code Removed
- Pre-filled badge/OTP/tourist form defaults (Gateway.tsx, TouristPortal.tsx).
- `mfaDemoNote` demo-credential strings (i18n.ts, en/hi).
- Every `'Elena Rostova'` / `'Carlos Rostova'` fallback in live code paths
  (form defaults, SOS trigger name, DigiLocker preview name). Note:
  `mockData.ts`'s `INITIAL_TOURISTS`/seed dashboard data was intentionally
  left untouched — see below.
- Authority auto-registration-on-login-failure loophole.
- Silent mock-profile fallback on sign-up/sign-in API failure.
- Hardcoded `'TR-88219'` / `'+34 612 884 902'` overrides in the SOS-trigger
  handler in `App.tsx`.
- Hardcoded officer identity (`'Rajesh Kumar, IPS'` / `'IPS-7742'`) in the
  audit-log helper — now uses the real session username.
- Hardcoded tourist-ID fallback UUID in `getTouristId()`.

## Features Intentionally Not Changed
- `mockData.ts` (`INITIAL_TOURISTS`, `INITIAL_AUDIT_LOGS`, `INITIAL_BROADCASTS`,
  `POLICE_STATIONS`, etc.) — this is the app's seed/demo dataset used to give
  the authority dashboard baseline content before any real data exists. It
  was out of scope for all 7 tasks and removing it would blank out the
  dashboard on first load; left as-is per the minimal-change principle.
- `ModuleTouristTracking.tsx`'s `'TR-88219'` default search value and
  `App.tsx`'s `setPrefilledTouristId('TR-88219')` quick-search shortcut — these
  are authority-side search conveniences, not credentials or auth bypasses,
  and weren't named in any of the 7 tasks.
- UI placeholder text showing `TR-88219`/`IPS-7742` as *example* input format
  (e.g. `placeholder="TR-88219 or TR-2026-8942"`) — these are input hints, not
  pre-filled values, and remain useful as format examples.
- No UI/styling changes were made anywhere, per the original instruction.
- No new backend endpoints beyond what Task 7 explicitly required.

## Remaining Problems / Follow-ups
1. **`audit_logs` migration not yet run** against any live database — this
   pass only added the migration file and backend code; someone with
   Supabase access needs to apply
   `database/migrations/001_add_audit_logs.sql` before the audit-log
   endpoints will work in DB mode (they already work correctly in the
   in-memory fallback mode, which is what the test suite exercises).
2. **Task 4's RLS fix is untestable in this environment** — no live
   Supabase/Postgres connection was available (`DATABASE_URL` unset), so the
   full test suite runs in the backend's in-memory fallback mode, which
   doesn't exercise real RLS. The SQL logic (`authority_id IS NULL OR
   authority_id = %s`) was reasoned through against `DATABASE.md`'s RLS
   description but should be verified against the actual Supabase RLS
   policies before deploying.
3. **Itinerary/audit-log backend writes are best-effort (fire-and-forget)**
   on the frontend, matching the existing SOS-queue pattern's philosophy —
   if you'd prefer these to block and show an error like the Task 3 auth
   flows now do, that's a follow-up change, not something this pass assumed.
4. **`getAuthorityId()` may be empty** immediately after the auto-registration
   loophole removal in edge cases where `authenticateAuthority()` succeeds but
   `authority_id` wasn't returned by the backend — current code guards with
   `authorityId ? {...} : {}` so it degrades gracefully (falls back to the
   incident's already-established `authority_id` rather than sending
   `undefined`), but this wasn't specifically tested.

## Verification Performed
- `npx tsc --noEmit` — **clean, zero errors** (run twice, after the last edit too).
- `pytest tests/` — **10/10 passing** (7 original tests unchanged + 3 new
  tests added for itinerary CRUD, incident-response logging, and audit logs,
  including the authority-only 403 checks for the latter two).
- Verified all 9 backend routers actually register their routes via
  `TestClient` + `/openapi.json` (caught and fixed a real bug in this pass:
  the new `itinerary`/`audit_logs` routers were imported in `main.py` but I'd
  initially forgotten the corresponding `app.include_router()` calls).
- Full-codebase grep sweep for remaining hardcoded credential strings after
  all edits, to confirm nothing was missed outside the explicitly-named files.
- `codebase.md` regenerated in full from the current 41 source files, with
  secret-redaction patterns applied (no actual secrets were found — all
  credentials are loaded via `os.getenv`/`Config` on the backend and
  `import.meta.env`/session-token `localStorage` on the frontend).
