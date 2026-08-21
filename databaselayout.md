# Suraksha Setu — Database Layout & Schema Management

This document defines the canonical database architecture, expected schemas, relationships, constraints, indexes, and automatic database schema update logic for the **Suraksha Setu (Smart Tourist Safety)** project.

---

## 1. Database Architecture Overview

Suraksha Setu utilizes **Supabase** (PostgreSQL) as its central relational database, configured with **Row Level Security (RLS)**.
The database serves as the source of truth for tourist registrations, safety logs, GPS tracking coordinates, trips, incident responses, geofences, and immutable compliance audits.

* **Client/Tourist App Portal:** Operates under RLS rules matching their Supabase Auth User ID (`auth.uid()`).
* **Authority Command Center:** Operates under dedicated authority credentials with RLS policies granting visibility to assigned incidents and full access to audit trails.
* **FastAPI Backend connection:** Performs claim-injection (JWT claims mapping via `set_config('request.jwt.claims', ...)` and `SET LOCAL ROLE authenticated`) to simulate Supabase Auth policies when working in live postgres connection pools.

---

## 2. PostgreSQL Extensions

* **`pgcrypto`**: Crucial for UUID generation (`gen_random_uuid()`).
* **`uuid-ossp`**: Standard UUID generation functions (e.g. `uuid_generate_v4()`).
* **`postgis`**: (Optional / Future-proofing) For advanced spatial querying, radius geofencing, and risk zone tracking.

---

## 3. Current Database Structure Expected by Backend

Below is the list of expected tables, columns, constraints, and relationships.

### 3.1 Table: `tourists`
Profiles of travelers.
* **Columns:**
  * `tourist_id` (`UUID`): Primary Key, default `gen_random_uuid()`.
  * `auth_user_id` (`UUID`): Unique, Foreign Key -> `auth.users(id)` ON DELETE CASCADE.
  * `digital_id` (`VARCHAR(255)`): Unique, official tourist digital pass ID.
  * `full_name` (`VARCHAR(255)`): Not Null.
  * `kyc_document_type` (`VARCHAR(100)`): Nullable. Allowed: `PASSPORT`, `AADHAAR`, `DRIVING_LICENSE`, `VOTER_ID`, `OTHER`.
  * `kyc_verified` (`BOOLEAN`): Not Null, default `FALSE`.
  * `phone` (`VARCHAR(30)`): Nullable.
  * `email` (`VARCHAR(255)`): Nullable.
  * `emergency_contact` (`VARCHAR(255)`): Nullable.
  * `preferred_language` (`VARCHAR(100)`): Nullable.
  * `created_at` (`TIMESTAMPTZ`): Not Null, default `NOW()`.
* **Constraints:**
  * `CHECK (kyc_verified = FALSE OR kyc_document_type IS NOT NULL)`: KYC verified tourists must have a document type specified.

### 3.2 Table: `authorities`
Safety agencies (Police, Medical, Fire).
* **Columns:**
  * `authority_id` (`UUID`): Primary Key, default `gen_random_uuid()`.
  * `auth_user_id` (`UUID`): Unique, Foreign Key -> `auth.users(id)` ON DELETE CASCADE.
  * `agency_name` (`VARCHAR(255)`): Not Null.
  * `jurisdiction` (`VARCHAR(255)`): Nullable.
  * `contact_phone` (`VARCHAR(30)`): Nullable.
  * `contact_email` (`VARCHAR(255)`): Nullable.

### 3.3 Table: `authentication`
Application-level authentication profiles linking to Supabase Auth accounts.
* **Columns:**
  * `auth_id` (`UUID`): Primary Key, default `gen_random_uuid()`.
  * `auth_user_id` (`UUID`): Unique, Not Null, Foreign Key -> `auth.users(id)` ON DELETE CASCADE.
  * `tourist_id` (`UUID`): Nullable, Foreign Key -> `tourists(tourist_id)` ON DELETE CASCADE.
  * `authority_id` (`UUID`): Nullable, Foreign Key -> `authorities(authority_id)` ON DELETE CASCADE.
  * `username` (`VARCHAR(255)`): Unique, Not Null.
  * `mfa_enabled` (`BOOLEAN`): Not Null, default `FALSE`.
  * `last_login_at` (`TIMESTAMPTZ`): Nullable.
  * `created_at` (`TIMESTAMPTZ`): Not Null, default `NOW()`.
* **Constraints:**
  * `CHECK ((tourist_id IS NOT NULL AND authority_id IS NULL) OR (tourist_id IS NULL AND authority_id IS NOT NULL))`: Enforces mutual exclusivity of profile types.

### 3.4 Table: `locations`
Coordinates and geographic zones.
* **Columns:**
  * `location_id` (`UUID`): Primary Key, default `gen_random_uuid()`.
  * `name` (`VARCHAR(255)`): Not Null.
  * `latitude` (`DECIMAL(10,7)`): Not Null.
  * `longitude` (`DECIMAL(10,7)`): Not Null.
  * `risk_level` (`VARCHAR(50)`): Not Null. Allowed: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`.
  * `recorded_at` (`TIMESTAMPTZ`): Not Null, default `NOW()`.
* **Constraints:**
  * `CHECK (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)`: Validates geographic coordinates range.

### 3.5 Table: `itinerary_entries`
Planned destinations for travelers.
* **Columns:**
  * `itinerary_id` (`UUID`): Primary Key, default `gen_random_uuid()`.
  * `tourist_id` (`UUID`): Not Null, Foreign Key -> `tourists(tourist_id)` ON DELETE CASCADE.
  * `location_id` (`UUID`): Not Null, Foreign Key -> `locations(location_id)` ON DELETE CASCADE.
  * `planned_arrival` (`TIMESTAMPTZ`): Nullable.
  * `planned_departure` (`TIMESTAMPTZ`): Nullable.
* **Constraints:**
  * `CHECK (planned_arrival IS NULL OR planned_departure IS NULL OR planned_departure >= planned_arrival)`: Enforces chronological correctness of itineraries.

### 3.6 Table: `incidents`
Active incidents and panic alerts.
* **Columns:**
  * `incident_id` (`UUID`): Primary Key, default `gen_random_uuid()`.
  * `tourist_id` (`UUID`): Not Null, Foreign Key -> `tourists(tourist_id)` ON DELETE CASCADE.
  * `location_id` (`UUID`): Not Null, Foreign Key -> `locations(location_id)` ON DELETE CASCADE.
  * `incident_type` (`VARCHAR(100)`): Not Null. (e.g. `ACCIDENT`, `MEDICAL`, `THEFT`, `MISSING_PERSON`, `HARASSMENT`, `ASSAULT`, `NATURAL_DISASTER`, `OTHER`, `SOS`).
  * `severity` (`VARCHAR(50)`): Not Null. Allowed: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`.
  * `status` (`VARCHAR(50)`): Not Null. Lifecycle stages: `OPEN`, `ACKNOWLEDGED`, `INVESTIGATING`, `RESPONDING`, `RESOLVED`, `CLOSED`.
  * `description` (`TEXT`): Nullable.
  * `created_at` (`TIMESTAMPTZ`): Not Null, default `NOW()`.
  * `authority_id` (`UUID`): Nullable, Foreign Key -> `authorities(authority_id)` ON DELETE SET NULL.

### 3.7 Table: `alerts`
Broadcast warnings and geofenced warnings.
* **Columns:**
  * `alert_id` (`UUID`): Primary Key, default `gen_random_uuid()`.
  * `incident_id` (`UUID`): Not Null, Foreign Key -> `incidents(incident_id)` ON DELETE CASCADE.
  * `authority_id` (`UUID`): Nullable, Foreign Key -> `authorities(authority_id)` ON DELETE SET NULL.
  * `channel` (`VARCHAR(50)`): Not Null. Allowed: `SMS`, `EMAIL`, `PUSH`, `APP`.
  * `recipient` (`VARCHAR(255)`): Not Null.
  * `sent_at` (`TIMESTAMPTZ`): Not Null, default `NOW()`.

### 3.8 Table: `responses`
Emergency response dispatches and actions logged by officers.
* **Columns:**
  * `response_id` (`UUID`): Primary Key, default `gen_random_uuid()`.
  * `incident_id` (`UUID`): Not Null, Foreign Key -> `incidents(incident_id)` ON DELETE CASCADE.
  * `responder_unit` (`VARCHAR(255)`): Nullable.
  * `action_taken` (`TEXT`): Nullable.
  * `resolved_at` (`TIMESTAMPTZ`): Nullable.
  * `authority_id` (`UUID`): Not Null, Foreign Key -> `authorities(authority_id)` ON DELETE CASCADE.

### 3.9 Table: `sos_requests`
Telemetry logs for emergency SOS triggers.
* **Columns:**
  * `sos_id` (`UUID`): Primary Key, default `gen_random_uuid()`.
  * `tourist_id` (`UUID`): Not Null, Foreign Key -> `tourists(tourist_id)` ON DELETE CASCADE.
  * `incident_id` (`UUID`): Nullable, Foreign Key -> `incidents(incident_id)` ON DELETE CASCADE.
  * `location_id` (`UUID`): Not Null, Foreign Key -> `locations(location_id)` ON DELETE CASCADE.
  * `authority_id` (`UUID`): Nullable, Foreign Key -> `authorities(authority_id)` ON DELETE SET NULL.
  * `triggered_at` (`TIMESTAMPTZ`): Not Null, default `NOW()`.
  * `trigger_source` (`VARCHAR(100)`): Not Null. Allowed: `APP`, `WEARABLE`, `MANUAL`, `AI`, `SYSTEM`.
  * `sos_status` (`VARCHAR(50)`): Not Null. Allowed: `ACTIVE`, `ACKNOWLEDGED`, `RESPONDING`, `RESOLVED`, `CANCELLED`.

### 3.10 Table: `audit_logs`
Compliance trails for citizen surveillance tracking and interceptions.
* **Columns:**
  * `audit_id` (`UUID`): Primary Key, default `gen_random_uuid()`.
  * `authority_id` (`UUID`): Not Null, Foreign Key -> `authorities(authority_id)` ON DELETE CASCADE.
  * `action_type` (`VARCHAR(50)`): Not Null.
  * `target_id` (`VARCHAR(255)`): Not Null.
  * `reason` (`TEXT`): Nullable.
  * `details` (`TEXT`): Nullable.
  * `ip_address` (`VARCHAR(64)`): Nullable.
  * `created_at` (`TIMESTAMPTZ`): Not Null, default `NOW()`.

---

## 4. Required Indexes

To maintain performance, the database layout mandates indexes on fields frequently queried or used in sorting/joining:

* `idx_tourists_auth_user_id` ON `tourists(auth_user_id)`
* `idx_tourists_digital_id` ON `tourists(digital_id)`
* `idx_authorities_auth_user_id` ON `authorities(auth_user_id)`
* `idx_authentication_username` ON `authentication(username)`
* `idx_authentication_tourist_id` ON `authentication(tourist_id)`
* `idx_authentication_authority_id` ON `authentication(authority_id)`
* `idx_locations_coords` ON `locations(latitude, longitude)`
* `idx_itinerary_entries_tourist_id` ON `itinerary_entries(tourist_id)`
* `idx_incidents_status` ON `incidents(status)`
* `idx_incidents_created_at` ON `incidents(created_at)`
* `idx_audit_logs_authority_id` ON `audit_logs(authority_id)`
* `idx_audit_logs_created_at` ON `audit_logs(created_at)`

---

## 5. Future Tables / Blockchain Compatibility

The design leaves hooks for registering decentralized identity checks and cryptographic blockchain signatures (e.g. audit hash outputs and digital credentials metadata columns). No destructive updates should be executed.

---

## 6. Database Update Logic

When the FastAPI backend starts up:

```text
       Expected schema definitions (Python code model)
                            ↓
       Inspects existing database columns & tables
                            ↓
   Identifies missing tables, columns, PK, FK, and indexes
                            ↓
              Execute safety updates:
      - Create missing tables
      - Add missing columns (ALTER TABLE ADD COLUMN IF NOT EXISTS)
      - Add missing constraints & indexes
```

### Safety Policy:
* **NO DELETIONS:** Never drop tables or columns.
* **NO DESTRUCTIVE ALTERS:** Never change column types or nullability if it would cause database write failures.
* **DATA INTEGRITY:** Existing records and columns remain fully intact.
