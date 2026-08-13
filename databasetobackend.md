# Database to Backend Integration Documentation

This document describes how the Supabase/PostgreSQL database schema and security rules specified in `DATABASE.md` were integrated into the backend FastAPI codebase of the **Smart Tourist Safety** application.

---

## 1. Architecture Overview

To achieve a secure, high-performance, and robust database connection, the backend connects directly to Supabase's PostgreSQL database using a connection pool. It fully respects and mimics the Row Level Security (RLS) system established on Supabase.

```text
       Client Request (JWT)
               │
               ▼
         FastAPI Route
               │
               ▼
     Extract user ID from JWT
               │
               ▼
     Get DB connection from Pool
               │
               ▼
  Set request.jwt.claims (sub = user ID)
  Set role to 'authenticated'
               │
               ▼
   Execute Query (RLS Applied)
               │
               ▼
        Return Response
```

---

## 2. Key Components Created

### 2.1 Configuration Layer (`backend/config.py`)
Centralizes environment variables using `python-dotenv`.
* **`DATABASE_URL`**: PostgreSQL connection string (defaults to a local fallback for offline development).
* **`SUPABASE_URL`**: Supabase project endpoint (for Auth API).
* **`SUPABASE_ANON_KEY`**: Publishable key (for Auth API).
* **`JWT_SECRET`**: Decryption key to locally verify JWT signatures.

### 2.2 Database Connection Pool & RLS Manager (`backend/db.py`)
Manages database sessions and simulates Row Level Security (RLS) inside transactions:
* **`ThreadedConnectionPool`**: Psycopg2 thread-safe connection pool ensuring multiple API requests reuse open connections.
* **`get_db_cursor(commit)`**: Regular context manager for system/auth queries.
* **`get_authenticated_cursor(auth_user_id, commit)`**:
  Performs two essential SQL operations inside a transaction before yielding the cursor:
  1. Sets session JWT claim:
     ```sql
     SELECT set_config('request.jwt.claims', '{"sub": "<auth_user_id>", "role": "authenticated"}', true);
     ```
     This allows Supabase's `auth.uid()` function in RLS policies to evaluate to the current user's ID.
  2. Sets role:
     ```sql
     SET LOCAL ROLE authenticated;
     ```
     Ensures Row Level Security is active and the transaction has the same access rights as a client communicating via Supabase API.

---

## 3. Core Flows Implemented

### 3.1 Authentication Integration (`backend/routers/auth.py`)
Supabase Auth owns credentials. The backend handles register/login by wrapping Supabase's API endpoints, falling back gracefully to mock mechanisms for offline testing:
* **Register**:
  1. Requests signup from Supabase Auth (`/auth/v1/signup`).
  2. Inserts profile records into `public.tourists` or `public.authorities` based on the assigned `auth_user_id`.
  3. Maps profiles in the `public.authentication` table.
* **Login**:
  1. Authenticates against Supabase Auth (`/auth/v1/token?grant_type=password`) and obtains the session JWT.
  2. Updates `last_login_at` in the `public.authentication` table.
  3. Returns the JWT access token and user metadata.
* **Session Validation & Verification**:
  1. Decodes JWT base64 payloads to extract the `sub` claim.
  2. Validates HS256 signatures if `JWT_SECRET` is configured in the environment.
  3. Validates the `sub` ID against the `public.authentication` table to resolve tourist or authority profiles.

### 3.2 Tourists (`backend/routers/tourists.py`)
* Queries are run using `get_authenticated_cursor(auth_user_id)`.
* Profiles are queried/updated with RLS protection ensuring tourists can only interact with their own profile.

### 3.3 Incidents & SOS (`backend/routers/incidents.py` & `backend/routers/sos.py`)
* **Location Resolution**: Dynamically checks if coordinates (latitude, longitude) or `location_id` are in the database. If coordinates do not exist, a new record is generated automatically in `public.locations`.
* **SOS Request Creation**: Creates an `incidents` row with type `'SOS'` and immediately inserts the trigger event details into `public.sos_requests`, linking them both to the resolved location.

### 3.4 Alerts (`backend/routers/alerts.py`)
* Alerts are recorded in `public.alerts` and queried using the authenticated cursor, ensuring only the assigned authority (or creator tourist) can read them.

### 3.5 Locations (`backend/routers/locations.py`)
* Created endpoints `GET /locations` and `GET /locations/{location_id}` to fetch geocoded tourist safety coordinates.

### 3.6 Authority (`backend/routers/authority.py`)
* Integrates `require_authority` dependency.
* Restricts access to alerts, incidents, and tourist metadata. Since queries run with the authority user's `auth_user_id`, RLS ensures only records assigned to that specific agency are returned.

---

## 4. Run/Test Environment Variables

Add the following to a `backend/.env` file in the root of the project to connect to Supabase:

```env
DATABASE_URL=postgresql://postgres:<your-password>@db.<your-project-ref>.supabase.co:5432/postgres
SUPABASE_URL=https://<your-project-ref>.supabase.co
SUPABASE_PUBLISHABLE_KEY=<your-anon-key>
JWT_SECRET=<your-jwt-secret>
```
