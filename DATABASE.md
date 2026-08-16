# Tourist Safety & Incident Management System — Database Contract

## 1. Purpose

This document is the implementation contract for the Supabase/PostgreSQL database used by the Tourist Safety & Incident Management System.

It is intended for backend, frontend, authorization, AI, and integration developers.

**Important:** Treat the existing Supabase schema as the source of truth. Do not recreate or rename tables/columns without coordinating with the database owner.

---

# 2. Technology Stack

- Database: PostgreSQL
- Platform: Supabase
- Authentication: Supabase Auth
- Identity source: `auth.users`
- Application schema: `public`
- Row Level Security: Enabled on all application tables
- Primary identifiers: UUID
- Timestamps: `TIMESTAMPTZ`
- UUID generation: `gen_random_uuid()` via `pgcrypto`

---

# 3. High-Level Architecture

```text
                         SUPABASE
                            |
             +--------------+--------------+
             |                             |
             v                             v
       Supabase Auth                 PostgreSQL
        auth.users                  public schema
             |                             |
             |                    +--------+--------+
             |                    |        |        |
             v                    v        v        v
        User Identity          tourists authorities locations
             |                    |        |        |
             |                    |        |        |
             +--------------------+--------+        |
                                  |                 |
                                  v                 |
                           authentication          |
                                  |                 |
                    +-------------+-------------+   |
                    |             |             |   |
                    v             v             v   |
               itinerary      incidents      SOS requests
                                |   |              |
                                |   +----+---------+
                                |        |
                                v        v
                              alerts  responses
```

---

# 4. Authentication Architecture

Supabase Auth owns credentials.

Do **not** store passwords in application tables.

The canonical identity is:

```text
auth.users.id
```

Application profiles are linked using:

```text
tourists.auth_user_id       -> auth.users.id
authorities.auth_user_id    -> auth.users.id
authentication.auth_user_id -> auth.users.id
```

All three foreign keys use:

```text
ON DELETE CASCADE
```

Therefore, deleting an Auth user deletes its linked application record.

## Auth flow

```text
User signs up / is created
        |
        v
Supabase Auth
auth.users
        |
        | auth.users.id
        v
Application profile
        |
        +--> tourists
        |
        +--> authorities
```

The frontend/backend should use Supabase Auth for:

- Signup
- Login
- Password management
- Sessions
- JWTs
- MFA where enabled

Do not implement a second password store.

---

# 5. Tables

## 5.1 tourists

Stores tourist profiles.

| Column | Type | Constraints |
|---|---|---|
| `tourist_id` | UUID | PK, default UUID |
| `auth_user_id` | UUID | UNIQUE, FK -> `auth.users.id`, CASCADE |
| `digital_id` | VARCHAR(255) | UNIQUE |
| `full_name` | VARCHAR(255) | NOT NULL |
| `kyc_document_type` | VARCHAR(100) | Optional |
| `kyc_verified` | BOOLEAN | NOT NULL, default FALSE |
| `phone` | VARCHAR(30) | Optional |
| `email` | VARCHAR(255) | Optional |
| `emergency_contact` | VARCHAR(255) | Optional |
| `preferred_language` | VARCHAR(100) | Optional |
| `created_at` | TIMESTAMPTZ | NOT NULL, default NOW |

### KYC values

Allowed document types:

```text
PASSPORT
AADHAAR
DRIVING_LICENSE
VOTER_ID
OTHER
```

If `kyc_verified = TRUE`, `kyc_document_type` must not be NULL.

---

## 5.2 authorities

Stores emergency/service authority organizations.

| Column | Type | Constraints |
|---|---|---|
| `authority_id` | UUID | PK, default UUID |
| `auth_user_id` | UUID | UNIQUE, FK -> `auth.users.id`, CASCADE |
| `agency_name` | VARCHAR(255) | NOT NULL |
| `jurisdiction` | VARCHAR(255) | Optional |
| `contact_phone` | VARCHAR(30) | Optional |
| `contact_email` | VARCHAR(255) | Optional |

Examples of authority records:

```text
Police
Medical / Ambulance
Fire & Rescue
Tourist Emergency Cell
Local Disaster Response
```

---

## 5.3 authentication

Application-level authentication/profile metadata.

**Passwords are NOT stored here. Supabase Auth handles passwords.**

| Column | Type | Constraints |
|---|---|---|
| `auth_id` | UUID | PK |
| `auth_user_id` | UUID | UNIQUE, FK -> `auth.users.id`, CASCADE, NOT NULL |
| `tourist_id` | UUID | FK -> `tourists.tourist_id`, optional |
| `authority_id` | UUID | FK -> `authorities.authority_id`, optional |
| `username` | VARCHAR(255) | UNIQUE, NOT NULL |
| `mfa_enabled` | BOOLEAN | NOT NULL, default FALSE |
| `last_login_at` | TIMESTAMPTZ | Optional |
| `created_at` | TIMESTAMPTZ | NOT NULL, default NOW |

Exactly one of these should identify the application owner:

```text
tourist_id
authority_id
```

The existing database contains a CHECK constraint enforcing this.

---

## 5.4 locations

Stores geographical locations and risk information.

| Column | Type | Constraints |
|---|---|---|
| `location_id` | UUID | PK |
| `name` | VARCHAR(255) | NOT NULL |
| `latitude` | DECIMAL(10,7) | NOT NULL, -90 to 90 |
| `longitude` | DECIMAL(10,7) | NOT NULL, -180 to 180 |
| `risk_level` | VARCHAR(50) | NOT NULL |
| `recorded_at` | TIMESTAMPTZ | NOT NULL, default NOW |

Allowed `risk_level` values:

```text
LOW
MEDIUM
HIGH
CRITICAL
```

---

## 5.5 itinerary_entries

Stores a tourist's planned destinations.

| Column | Type | Constraints |
|---|---|---|
| `itinerary_id` | UUID | PK |
| `tourist_id` | UUID | NOT NULL, FK -> tourists |
| `location_id` | UUID | NOT NULL, FK -> locations |
| `planned_arrival` | TIMESTAMPTZ | Optional |
| `planned_departure` | TIMESTAMPTZ | Optional |

If both times exist:

```text
planned_departure >= planned_arrival
```

---

## 5.6 incidents

Core incident-management table.

| Column | Type | Constraints |
|---|---|---|
| `incident_id` | UUID | PK |
| `tourist_id` | UUID | NOT NULL, FK -> tourists |
| `location_id` | UUID | NOT NULL, FK -> locations |
| `incident_type` | VARCHAR(100) | NOT NULL |
| `severity` | VARCHAR(50) | NOT NULL |
| `status` | VARCHAR(50) | NOT NULL |
| `description` | TEXT | Optional |
| `created_at` | TIMESTAMPTZ | NOT NULL, default NOW |
| `authority_id` | UUID | FK -> authorities, optional |

### Incident types

```text
ACCIDENT
MEDICAL
THEFT
MISSING_PERSON
HARASSMENT
ASSAULT
NATURAL_DISASTER
OTHER
```

### Severity

```text
LOW
MEDIUM
HIGH
CRITICAL
```

### Status lifecycle

```text
OPEN
  |
  v
ACKNOWLEDGED
  |
  v
INVESTIGATING
  |
  v
RESPONDING
  |
  v
RESOLVED
  |
  v
CLOSED
```

---

## 5.7 alerts

Stores notifications generated for incidents.

| Column | Type | Constraints |
|---|---|---|
| `alert_id` | UUID | PK |
| `incident_id` | UUID | NOT NULL, FK -> incidents |
| `authority_id` | UUID | FK -> authorities, optional |
| `channel` | VARCHAR(50) | NOT NULL |
| `recipient` | VARCHAR(255) | NOT NULL |
| `sent_at` | TIMESTAMPTZ | NOT NULL, default NOW |

Allowed channels:

```text
SMS
EMAIL
PUSH
APP
```

---

## 5.8 responses

Stores actions taken by authorities.

| Column | Type | Constraints |
|---|---|---|
| `response_id` | UUID | PK |
| `incident_id` | UUID | NOT NULL, FK -> incidents |
| `responder_unit` | VARCHAR(255) | Optional |
| `action_taken` | TEXT | Optional |
| `resolved_at` | TIMESTAMPTZ | Optional |
| `authority_id` | UUID | NOT NULL, FK -> authorities |

Example:

```text
Incident:
Medical emergency

Authority:
Mumbai Emergency Medical Unit

Response:
Ambulance dispatched to location.

Status:
Resolved
```

---

## 5.9 sos_requests

Stores emergency SOS activations.

| Column | Type | Constraints |
|---|---|---|
| `sos_id` | UUID | PK |
| `tourist_id` | UUID | NOT NULL, FK -> tourists |
| `incident_id` | UUID | Optional, FK -> incidents |
| `location_id` | UUID | NOT NULL, FK -> locations |
| `authority_id` | UUID | Optional, FK -> authorities |
| `triggered_at` | TIMESTAMPTZ | NOT NULL, default NOW |
| `trigger_source` | VARCHAR(100) | NOT NULL |
| `sos_status` | VARCHAR(50) | NOT NULL |

### Trigger sources

```text
APP
WEARABLE
MANUAL
AI
SYSTEM
```

### SOS lifecycle

```text
ACTIVE
  |
  v
ACKNOWLEDGED
  |
  v
RESPONDING
  |
  v
RESOLVED
```

Alternative:

```text
ACTIVE -> CANCELLED
```

An SOS can initially exist without an incident:

```text
sos_requests.incident_id = NULL
```

This supports immediate SOS creation before an incident record is generated.

---

# 6. Complete Relationship Map

```text
auth.users
    |
    +---- tourists.auth_user_id
    |
    +---- authorities.auth_user_id
    |
    +---- authentication.auth_user_id


tourists
    |
    +---- itinerary_entries.tourist_id
    |
    +---- incidents.tourist_id
    |
    +---- sos_requests.tourist_id
    |
    +---- authentication.tourist_id


authorities
    |
    +---- incidents.authority_id
    |
    +---- alerts.authority_id
    |
    +---- responses.authority_id
    |
    +---- sos_requests.authority_id
    |
    +---- authentication.authority_id


locations
    |
    +---- itinerary_entries.location_id
    |
    +---- incidents.location_id
    |
    +---- sos_requests.location_id


incidents
    |
    +---- alerts.incident_id
    |
    +---- responses.incident_id
    |
    +---- sos_requests.incident_id
```

---

# 7. Cardinality

```text
tourist 1 ---- N itinerary_entries
location 1 --- N itinerary_entries

tourist 1 ---- N incidents
location 1 --- N incidents
authority 1 -- N incidents

incident 1 --- N alerts
authority 1 -- N alerts

incident 1 --- N responses
authority 1 -- N responses

tourist 1 ---- N sos_requests
incident 1 --- N sos_requests
location 1 --- N sos_requests
authority 1 -- N sos_requests
```

---

# 8. RLS Architecture

RLS is enabled on all application tables.

The system uses:

```sql
auth.uid()
```

to identify the authenticated Supabase user.

## Tourist access

A tourist is identified by:

```sql
tourists.auth_user_id = auth.uid()
```

Tourists can:

- Read their own tourist profile
- Update their own tourist profile
- Create their own tourist profile
- Read their own itinerary
- Create their own itinerary
- Update their own itinerary
- Delete their own itinerary
- Read their own incidents
- Create incidents for themselves
- Update their own incidents
- Create SOS requests for themselves
- Read their own SOS requests
- Update their own SOS requests
- Read alerts related to their own incidents
- Read locations

## Authority access

An authority is identified by:

```sql
authorities.auth_user_id = auth.uid()
```

Authorities can:

- Read their own authority profile
- Update their own authority profile
- Read incidents assigned to them
- Update assigned incidents
- Read SOS requests assigned to them
- Update assigned SOS requests
- Create responses for assigned incidents
- Read their responses
- Update their responses
- Read alerts assigned to them

## Security principle

Never use:

```sql
USING (true)
```

for sensitive application tables unless the data is intentionally public.

RLS is a security boundary, not just a convenience filter.

---

# 9. PostgreSQL Permissions

RLS policies alone are not enough. PostgreSQL role privileges must also permit the operation.

For example:

```sql
GRANT SELECT ON public.tourists TO authenticated;
```

The backend must ensure the required privileges exist for any operation it exposes.

Do not blindly grant:

```sql
GRANT ALL
```

to broad roles.

---

# 10. API Key Architecture

Use the Supabase project URL:

```env
SUPABASE_URL=https://<project-ref>.supabase.co
```

Normal application access uses the **publishable key**:

```env
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Do NOT put secret keys in:

- Frontend code
- GitHub
- `.env` committed to Git
- Discord/Slack public channels
- Documentation
- Client applications

Secret keys are for trusted server-side operations only.

---

# 11. Recommended Backend Environment

Example `.env`:

```env
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

If a trusted backend later requires privileged Supabase operations, use a separate server-only secret environment variable.

Never expose it to the frontend.

---

# 12. Backend Request Architecture

Recommended:

```text
Frontend
   |
   | Supabase Auth login
   v
Supabase Auth
   |
   | JWT
   v
Backend API
   |
   | authenticated request
   v
Supabase PostgreSQL
   |
   | RLS evaluates auth.uid()
   v
Allowed rows only
```

For direct frontend Supabase access:

```text
Frontend
   |
   v
Supabase client
   |
   v
Supabase Data API
   |
   v
PostgreSQL + RLS
```

---

# 13. Authorization Model

Use two primary application roles:

```text
TOURIST
AUTHORITY
```

Future role:

```text
ADMIN
```

Do not implement an admin role by simply disabling RLS.

Admin access should be implemented explicitly with a controlled role/claim and carefully scoped policies.

---

# 14. Typical Tourist Flow

## Registration

```text
User
 |
 v
Supabase Auth signup
 |
 v
auth.users
 |
 v
Create tourists row
 |
 v
tourists.auth_user_id = auth.users.id
```

## View profile

```text
JWT
 |
 v
auth.uid()
 |
 v
tourists.auth_user_id
 |
 v
Own tourist row
```

## Create incident

```text
Tourist
 |
 v
POST /incidents
 |
 +-- tourist_id = current user's tourist_id
 |
 +-- location_id
 |
 +-- incident_type
 |
 +-- severity
 |
 +-- description
 |
 v
incidents
 |
 v
Assign authority
 |
 v
Create alert
```

---

# 15. Typical SOS Flow

```text
Tourist presses SOS
        |
        v
Create sos_requests
        |
        +-- tourist_id
        +-- location_id
        +-- trigger_source
        +-- sos_status = ACTIVE
        |
        v
Determine appropriate authority
        |
        v
Assign authority_id
        |
        v
Create / link incident
        |
        v
Create alert
        |
        v
Authority receives alert
        |
        v
Authority acknowledges
        |
        v
Authority creates response
        |
        v
SOS becomes RESPONDING
        |
        v
Response completed
        |
        v
RESOLVED
```

---

# 16. Typical Incident Flow

```text
OPEN
 |
 v
Authority assigned
 |
 v
ACKNOWLEDGED
 |
 v
INVESTIGATING
 |
 v
RESPONDING
 |
 v
RESOLVED
 |
 v
CLOSED
```

---

# 17. AI Integration Points

The database can support AI-generated information, but AI output should not automatically be treated as verified fact.

Potential AI inputs:

```text
GPS/location data
Incident descriptions
Risk levels
Historical incidents
Tourist itinerary
SOS patterns
```

Potential AI outputs:

```text
Risk classification
Incident classification
Severity recommendation
Location risk prediction
Anomaly detection
Authority recommendation
Incident summarization
```

AI-generated values should preferably be stored separately or marked as AI-generated in future schema extensions.

Do not overwrite authoritative human decisions without an explicit product requirement.

---

# 18. Location/Risk Architecture

Current location record:

```text
locations
├── name
├── latitude
├── longitude
├── risk_level
└── recorded_at
```

Future AI/risk expansion could add:

```text
risk_score
risk_reason
risk_model_version
risk_updated_at
incident_count
```

Do not add these fields unless the application requires them.

---

# 19. Indexes

Indexes already exist for frequently queried foreign keys and statuses.

Important indexes include:

```text
itinerary_entries.tourist_id
itinerary_entries.location_id

incidents.tourist_id
incidents.location_id
incidents.authority_id
incidents.status

alerts.incident_id
alerts.authority_id

responses.incident_id
responses.authority_id

authentication.tourist_id
authentication.authority_id

sos_requests.tourist_id
sos_requests.incident_id
sos_requests.location_id
sos_requests.authority_id
sos_requests.sos_status
```

Do not add indexes blindly. Add them when query patterns justify them.

---

# 20. Delete Behavior

Important existing behaviors:

```text
tourist deleted
    |
    +--> itinerary entries CASCADE
    +--> incidents CASCADE
    +--> SOS requests CASCADE


incident deleted
    |
    +--> alerts CASCADE
    +--> responses CASCADE
    +--> SOS incident reference SET NULL


authority deleted
    |
    +--> incident authority SET NULL
    +--> alert authority SET NULL
    +--> SOS authority SET NULL
```

Auth user deletion cascades to linked application identity/profile records.

---

# 21. Developer Rules

## DO

- Use UUIDs from the database.
- Use Supabase Auth for credentials.
- Use `auth.uid()` for identity-aware RLS.
- Use foreign keys rather than manually trusting IDs.
- Validate enum-like values.
- Use parameterized queries / Supabase client methods.
- Keep secrets in environment variables.
- Test RLS with real authenticated sessions.
- Keep backend and frontend configuration separate.
- Use migrations for schema changes.

## DO NOT

- Store plaintext passwords.
- Store password hashes in the application database.
- Expose secret/service-role keys to the frontend.
- Commit `.env` files.
- Disable RLS to make an API call work.
- Use `USING (true)` for private data.
- Let a tourist submit another tourist's `tourist_id`.
- Let an authority update incidents belonging to another authority.
- Trust client-provided authorization/role values.
- Recreate the schema in the backend.

---

# 22. Backend API Contract Suggestions

The following routes are recommended.

## Auth

Supabase Auth handles:

```text
/signup
/login
/logout
/refresh
```

The backend should verify the Supabase session/JWT where backend authorization is required.

## Tourists

```text
GET    /tourists/me
PATCH  /tourists/me
```

## Itinerary

```text
GET    /itinerary
POST   /itinerary
PATCH  /itinerary/{itinerary_id}
DELETE /itinerary/{itinerary_id}
```

## Locations

```text
GET /locations
GET /locations/{location_id}
```

## Incidents

```text
GET  /incidents
POST /incidents
GET  /incidents/{incident_id}
PATCH /incidents/{incident_id}
```

## SOS

```text
POST  /sos
GET   /sos
GET   /sos/{sos_id}
PATCH /sos/{sos_id}
```

## Authorities

```text
GET   /authorities/me
PATCH /authorities/me
GET   /authorities/incidents
GET   /authorities/sos
```

## Responses

```text
GET  /incidents/{incident_id}/responses
POST /incidents/{incident_id}/responses
PATCH /responses/{response_id}
```

---

# 23. Realtime

Supabase Realtime can be used for emergency workflows.

Potential realtime subscriptions:

```text
incidents
alerts
sos_requests
responses
```

Example conceptual flow:

```text
Tourist
  |
  | SOS
  v
sos_requests
  |
  | database change
  v
Supabase Realtime
  |
  +--> Authority dashboard
  |
  +--> Notification service
  |
  +--> Monitoring dashboard
```

For a hackathon MVP, prioritize realtime for:

```text
SOS status
Incident status
Authority response
```

---

# 24. Current Test User

There is currently a test Supabase Auth user connected to a tourist profile.

The relationship has been verified:

```text
auth.users.id
    =
tourists.auth_user_id
```

Do not hard-code this user's UUID into application logic.

Application code must obtain the authenticated user's identity from the current Supabase session/JWT.

---

# 25. Current Database Readiness

The current database has:

```text
9 application tables             READY
Primary keys                     READY
Foreign keys                     READY
Auth foreign keys                READY
Indexes                          READY
RLS enabled                      READY
RLS policies                     READY
Supabase Auth integration        READY
Validation constraints           READY
Tourist Auth test                VERIFIED
```

---

# 26. Schema Change Policy

If a developer needs to change the database:

1. Explain why the change is needed.
2. Check existing foreign keys and RLS.
3. Create a migration.
4. Test the migration.
5. Update this document.
6. Inform all team members.
7. Do not manually change production schema without recording the change.

---

# 27. Recommended Repository Structure

```text
project/
|
├── frontend/
|
├── backend/
|   ├── app/
|   |   ├── main.py
|   |   ├── routes/
|   |   ├── services/
|   |   ├── models/
|   |   └── core/
|   |
|   ├── .env
|   └── requirements.txt
|
├── database/
|   ├── migrations/
|   └── seed/
|
├── docs/
|   └── DATABASE.md
|
└── .gitignore
```

---

# 28. Team Integration

All team members should use the same Supabase project.

```text
                    GitHub Repository
                           |
          +----------------+----------------+
          |                |                |
       Frontend          Backend        Database
          |                |                |
          +----------------+----------------+
                           |
                           v
                    Same Supabase
                           |
             +-------------+-------------+
             |                           |
        Supabase Auth              PostgreSQL
                                   + RLS
```

Do not create separate production databases for each developer.

For local testing, developers may use test users and test records in the shared development environment, or a separate Supabase project if the team later needs isolated environments.

---

# 29. Final Source of Truth

For implementation, use:

1. Supabase database schema
2. This document
3. Supabase Auth configuration
4. RLS policies

If application code conflicts with the database constraints or RLS policies, fix the application code rather than bypassing the database security model.

---

# 30. Quick Reference

```text
AUTH IDENTITY
auth.users.id

TOURIST ID
tourists.tourist_id

AUTHORITY ID
authorities.authority_id

LOCATION ID
locations.location_id

INCIDENT ID
incidents.incident_id

SOS ID
sos_requests.sos_id

RLS IDENTITY
auth.uid()

DATABASE
Supabase PostgreSQL

AUTH
Supabase Auth

SECURITY
PostgreSQL RLS

NORMAL API KEY
sb_publishable_...

SECRET
sb_secret_...   # SERVER ONLY
```

---

# 31. Addendum: audit_logs (Post-MVP Schema Change)

Added by: production-readiness correction, Task 7.3 (compliance audit trail persistence).

Migration: `database/migrations/001_add_audit_logs.sql`

## 31.1 audit_logs

Stores authority search/interception compliance log entries (previously an in-memory-only array in the frontend).

| Column | Type | Constraints |
|---|---|---|
| `audit_id` | UUID | PK, default UUID |
| `authority_id` | UUID | NOT NULL, FK -> authorities, CASCADE |
| `action_type` | VARCHAR(50) | NOT NULL |
| `target_id` | VARCHAR(255) | NOT NULL |
| `reason` | TEXT | Optional |
| `details` | TEXT | Optional |
| `ip_address` | VARCHAR(64) | Optional |
| `created_at` | TIMESTAMPTZ | NOT NULL, default NOW |

Action types mirror the frontend's existing `AuditLog.actionType` union:

```text
TOURIST_LOOKUP
DISPATCH_UNIT
BROADCAST_SENT
TICKET_STATUS_CHANGE
AUTHORITY_LOGIN
```

RLS: authorities may insert their own entries; any authenticated authority may read the full log (shared compliance-review visibility). See the migration file for exact policies.

Backend router: `backend/routers/audit_logs.py` — `POST /api/v1/audit-logs`, `GET /api/v1/audit-logs`.

---

## End of Database Contract
