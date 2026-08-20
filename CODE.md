# Suraksha Setu (Smart Tourist Safety) — Technical Codebase Reference

This document serves as a complete technical reference for the **Suraksha Setu (Smart Tourist Safety)** project. It details the system architecture, file-by-file definitions, database contracts, Row Level Security (RLS) constraints, API endpoints, and code connectivity mappings to enable future AI developers to modify the project with minimal context.

---

## 1. PROJECT OVERVIEW

* **Project Name:** Suraksha Setu (Smart Tourist Safety Application)
* **Description:** An emergency response, location tracking, and geofenced hazard warning system designed to protect tourists. It features a client PWA for tourists and a restricted MFA command console for emergency response authorities.
* **Technology Stack:**
  * **Frontend:** React 19 (TypeScript), Vite (version ~6.2.3), Tailwind CSS v4, Lucide React, `@vis.gl/react-google-maps`.
  * **Backend:** FastAPI (Python 3.10+), Uvicorn, `psycopg2-binary` (Threaded Connection Pool), `pyjwt`, `requests`, `cryptography`.
  * **Database:** PostgreSQL on Supabase (managed schema with Row Level Security enabled).
  * **Authentication:** Supabase Auth with synthetic email-from-phone mapping and phone OTP verification.
  * **Offline-First Capabilities:** IndexedDB local storage (`smart_tourist_safety_sos` database) to buffer location telemetry and queue offline SOS panic signals until network connectivity is restored. Service worker (`sw.js`) support.
* **Architecture:**
  ```text
  Tourist Portal (PWA) / Authority Command Center (Web Console)
                                   ↓
                       Vite + React (Frontend App)
                                   ↓  HTTP REST API (v1 /api/v1)
                         FastAPI (Python Backend)
                                   ↓  psycopg2 (Claims Injection + Local Role)
                        PostgreSQL (Supabase Database)
  ```

---

## 2. COMPLETE DIRECTORY STRUCTURE

```text
Smart-Tourist-Safety/
├── .gitignore
├── DATABASE.md                       # Canonical database contract
├── codebase.md                       # Full code dump file (generated)
├── databasetobackend.md              # RLS connection pool integration details
├── frontendconnectbackend.md         # Full frontend-backend route integration matrix
├── README.md
├── database/
│   └── migrations/
│       └── 001_add_audit_logs.sql   # SQL migration adding the audit compliance table
├── docs/
│   └── .gitkeep
├── backend/
│   ├── config.py                     # App settings & dotenv loading
│   ├── db.py                         # Threaded pool & authenticated RLS contexts
│   ├── main.py                       # FastAPI entry point, CORS, router registration
│   ├── requirements.txt              # Backend runtime packages
│   ├── routers/                      # Route controllers
│   │   ├── alerts.py                 # Incident alert logs
│   │   ├── audit_logs.py             # Compliance lookup logging
│   │   ├── auth.py                   # User registration, login, session, OTP verification
│   │   ├── authority.py              # Authority-facing queries & validation
│   │   ├── incidents.py              # Standard incidents CRUD & responder responses
│   │   ├── itinerary.py              # Tourist trip itinerary planner
│   │   ├── locations.py              # Geocoded locations list
│   │   ├── sos.py                    # Urgent SOS triggers
│   │   └── tourists.py               # Tourist profile management
│   ├── schemas/                      # Pydantic schemas
│   │   ├── alert.py
│   │   ├── audit_log.py
│   │   ├── auth.py
│   │   ├── incident.py
│   │   ├── itinerary.py
│   │   ├── location.py
│   │   ├── response.py
│   │   ├── sos.py
│   │   └── tourist.py
│   └── tests/
│       └── test_api.py               # End-to-end API test suites
└── frontend/
    ├── index.html
    ├── package.json                  # Frontend dependencies and run scripts
    ├── sw.js                         # Service worker for offline asset caching
    └── src/
        ├── App.tsx                   # Main router and console state
        ├── main.tsx                  # React entry point
        ├── types.ts                  # Shared TypeScript declarations
        ├── index.css
        ├── components/               # Command center authority panels
        │   ├── ActualGoogleMap.tsx   # Google Map wrapper with iframe fallback
        │   ├── Gateway.tsx           # Role selector and MFA Badge Login
        │   ├── Header.tsx            # Authority Dashboard Header
        │   ├── InterceptionModal.tsx # Statutory lookup audit confirmation
        │   ├── ModuleAIHub.tsx       # AI crowd anomaly monitoring
        │   ├── ModuleAnalyticsAudit.tsx # Compliance audit viewer
        │   ├── ModuleBroadcast.tsx   # Geofenced SMS broadcaster
        │   ├── ModuleSOSMap.tsx      # GIS dispatcher Kanban & PCR assigner
        │   ├── ModuleTouristTracking.tsx # Search and tracking console
        │   └── Sidebar.tsx
        ├── data/
        │   ├── i18n.ts               # Bilingual (English/Hindi) localizations
        │   └── mockData.ts           # Demo seed data
        └── lib/
            ├── api.ts                # Fetch Client & wrapper endpoints
            ├── db.ts                 # IndexedDB offline storage
            └── location.ts           # HTML5 Geolocation fetchers
```

### Directory Purposes:
* **`backend/`**: Implements REST API backend with mock fallback modes for offline local testing and live PostgreSQL modes.
* **`database/`**: Contains schema changes and database setups.
* **`frontend/src/`**: Houses PWA pages, component modules, styling layouts, and utility directories.
* **`frontend/src/components/tourist/`**: Exclusively houses components running within the Tourist App Portal (`TouristApp.tsx`, `TripsPanel.tsx`, `ProfilePanel.tsx`, `AlertsPanel.tsx`, `LoginModal.tsx`, `MapCanvas.tsx`).

---

## 3. FRONTEND ARCHITECTURE

* **Framework:** React 19 with Vite.
* **Routing:** Role-based conditional state routing (`Gateway` vs `TouristApp` vs `Authority Command Modules`).
* **State Management:** Lifting state up to `App.tsx` for shared command variables (incidents, patrols, audit logs) and React hooks for layout tab routing.
* **Theme System:** Dark Mode supported by syncing the `.dark` class to the HTML document element for Tailwind CSS.
* **Bilingual Translation:** Bilingual system (English `en` and Hindi `hi`) configured in `i18n.ts` and selected in the top Header.
* **Offline Mechanics:**
  * Auto-registering service worker (`sw.js`).
  * IndexedDB databases caching positions and queuing offline SOS alerts when connection drops.
  * Auto-syncing queue whenever the network state goes `online` (`syncQueuedSOS`).

### Component Relationship Map:
```text
App (Main State Coordinator)
 ├── Header (Console Nav, Dark mode toggles, language selections)
 ├── Gateway (Log In Gateway)
 │    └── MFA Login Form Modal (Badge Verification)
 ├── TouristApp (Tourist Safe Passage Portal)
 │    ├── SearchBar (Auto-complete)
 │    ├── QuickActions (Map category filters: Police, Hospitals, Alerts, Hotels)
 │    ├── SafetyBanner (Emergency weather notice)
 │    ├── MapCanvas (ActualGoogleMap mapping engine)
 │    │    └── PlaceCard (Selected point description card)
 │    ├── SOSButton (Panics trigger, GPS trackers, audio siren sirens)
 │    ├── BottomNav (Tab navigations: Map, Explore, Trips, Alerts, Profile)
 │    ├── ExplorePanel (Local destinations lists)
 │    ├── TripsPanel (Planned itinerary entries)
 │    │    └── LoginModal
 │    ├── AlertsPanel (System hazard warnings)
 │    ├── ProfilePanel (KYC verifying and emergency contacts edit)
 │    │    └── LoginModal
 │    └── LoginModal (Phone input -> OTP code verification -> Profile registration)
 └── Authority Command Modules (Only loaded after verification success)
      ├── ModuleAIHub (Visualizes unusual crowd spikes and confidence statistics)
      ├── ModuleTouristTracking (Lookup tourist name/ID, interception reason modal, mark safe)
      │    └── InterceptionModal (Statutory logs reason)
      ├── ModuleSOSMap (Live GIS tracking, PCR Van assigner board, resolve ticket)
      ├── ModuleBroadcast (Radius-based emergency geofenced notifications editor)
      └── ModuleAnalyticsAudit (Oversight and compliance table)
```

---

## 4. FRONTEND FILE-BY-FILE REFERENCE

### File: `frontend/src/lib/api.ts`
* **Purpose:** Handles all fetch requests, API base path configurations, and authentication session storage.
* **State:** Local session caching in `localStorage`.
* **Important Helpers:**
  * `deriveTouristCredentials(phone)`: Standardized username/password generation from phone numbers.
  * `registerAndLoginTourist(details)`: Chains user signup, login, and profile creation together.
  * `syncQueuedSOS()`: Transmits IndexedDB queued offline SOS records online.
* **Key Code Snippet:**
```typescript
export function getApiBaseUrl(): string {
  const envUrl = (import.meta as any).env?.VITE_API_BASE_URL as string | undefined;
  return localStorage.getItem("sos_api_base_url") || envUrl || "http://localhost:8000/api/v1";
}

export function deriveTouristCredentials(phone: string): { username: string; password: string } {
  const normalized = (phone || "").replace(/[^0-9]/g, "");
  return {
    username: `tourist-${normalized || "guest"}`,
    password: `SurakshaSetu-${normalized || "guest"}-2026`,
  };
}
```

### File: `frontend/src/lib/db.ts`
* **Purpose:** Sets up IndexedDB storage for offline safety capabilities.
* **Stores:**
  * `last_location`: Stores key `"latest"` containing current GPS coordinates.
  * `sos_queue`: Table of queued panic requests containing `local_sos_id` (UUID keyPath).
* **Key Code Snippet:**
```typescript
const DB_NAME = "smart_tourist_safety_sos";
const DB_VERSION = 1;
const STORE_LOCATION = "last_location";
const STORE_QUEUE = "sos_queue";

export async function initDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_LOCATION)) {
        db.createObjectStore(STORE_LOCATION, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        const queueStore = db.createObjectStore(STORE_QUEUE, { keyPath: "local_sos_id" });
        queueStore.createIndex("status", "status", { unique: false });
      }
    };
    request.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    request.onerror = (e) => reject((e.target as IDBOpenDBRequest).error);
  });
}
```

### File: `frontend/src/lib/location.ts`
* **Purpose:** Handles location telemetry fetch with a backup fallback to last known location cached in IndexedDB.
* **Key Code Snippet:**
```typescript
import { saveLastKnownLocation, getLastKnownLocation, LocationData } from "./db";

export async function getLiveLocation(
  options = { timeout: 6000, maxAge: 0, enableHighAccuracy: true }
): Promise<LocationData> {
  if (!navigator.geolocation) throw new Error("Geolocation API not supported");
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const locData: LocationData = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: new Date(position.timestamp).toISOString(),
          location_source: "live",
        };
        await saveLastKnownLocation(locData).catch(() => {});
        resolve(locData);
      },
      (error) => reject(error),
      options
    );
  });
}
```

### File: `frontend/src/components/tourist/LoginModal.tsx`
* **Purpose:** Steps users through OTP code requests and profile registrations.
* **Step Transitions:** `credentials` (phone input) → `otp` (SMS code verification) → `name` (new tourists profile signups) → `verifying` → `success` / `error`.
* **Important Logic:** Connects OTP and profile registration calls to backend routers.
* **Key Code Snippet:**
```typescript
const handleContinue = async () => {
  if (!validatePhone()) return;
  setLoading(true);
  try {
    await sendOtp(phone.trim());
    setLoading(false);
    setStep('otp');
  } catch (err: any) {
    setLoading(false);
    setGenErr(err instanceof ApiError ? err.message : 'Network error.');
  }
};
```

---

## 5. BACKEND ARCHITECTURE

* **Backend Framework:** FastAPI.
* **CORS Settings:** Wires explicit local origins (`localhost:3000`, `localhost:5173`) if `CORS_ALLOWED_ORIGINS` environment variables are empty or contain wildcard overrides to prevent runtime Starlette crashes when combined with credential passes.
* **Database Pooling & Authenticated Claims Mapping (`backend/db.py`):**
  The backend connects using a psycopg2 connection pool. Before executing queries within an active user context, the backend sets the PostgreSQL transaction session configs to simulate Supabase Row Level Security (RLS) dynamically.
* **API Flow Diagram:**
  ```text
  Client Token Request → Router Auth Middleware → jwt.decode() Verification
                                                         ↓
                                         get_authenticated_cursor(auth_user_id)
                                                         ↓
                                         Executes: set_config('request.jwt.claims', ...)
                                         Executes: SET LOCAL ROLE authenticated;
                                                         ↓
                                         Runs SQL Statement against PostgreSQL tables
                                                         ↓
                                         Database RLS evaluates auth.uid() against claims
  ```

---

## 6. BACKEND API REFERENCE

| Method | Endpoint | Purpose | Auth | Request Body | Response Format | Calling Frontend Files |
| :--- | :--- | :--- | :---: | :--- | :--- | :--- |
| `POST` | `/api/v1/auth/send-otp` | Generate and dispatch verification codes | No | `{ "phone" }` | `{ "message": "OTP sent" }` | `LoginModal.tsx` |
| `POST` | `/api/v1/auth/verify-otp` | Verify user inputs with generated OTPs | No | `{ "phone", "otp" }` | `{ "verified": true }` | `LoginModal.tsx` |
| `POST` | `/api/v1/auth/register` | Register new tourist/authority account | No | `{ "username", "password", "user_type" }` | `AuthResponse` | `LoginModal.tsx` |
| `POST` | `/api/v1/auth/login` | Login user, updates timestamps, returns JWT | No | `{ "username", "password" }` | `LoginResponse` | `LoginModal.tsx` / `Gateway.tsx` |
| `POST` | `/api/v1/auth/logout` | Terminate session stateless tokens | Yes | None | `{ "message": "logged out" }` | `TouristApp.tsx` / `App.tsx` |
| `GET` | `/api/v1/auth/session` | Fetch active session configurations | Yes | None | `SessionResponse` | App init startup |
| `POST` | `/api/v1/tourists` | Create new tourist profile records | Yes | `TouristCreate` | `TouristResponse` | `LoginModal.tsx` |
| `GET` | `/api/v1/tourists/{id}` | Read tourist details (own profile only) | Yes | None | `TouristResponse` | `TouristApp.tsx` |
| `PATCH` | `/api/v1/tourists/{id}` | Update tourist profile fields | Yes | `TouristUpdate` | `TouristResponse` | `ProfilePanel.tsx` |
| `GET` | `/api/v1/tourists/{id}/digital-id`| Returns tourist's digital pass details | Yes | None | `DigitalIdResponse` | `ProfilePanel.tsx` |
| `POST` | `/api/v1/sos` | Create an active incident & SOS request | Yes | `SOSCreate` | `SOSResponse` | `TouristApp.tsx` / `api.ts` |
| `POST` | `/api/v1/incidents` | Post a standard non-SOS incident report | Yes | `IncidentCreate` | `IncidentResponse` | Incident panels |
| `GET` | `/api/v1/incidents` | List assigned or created incident logs | Yes | Query: `status` | `list[IncidentResponse]` | Authority dashboard |
| `PATCH` | `/api/v1/incidents/{id}` | Update incident (assign units, resolve cases)| Yes | `IncidentUpdate` | `IncidentResponse` | `App.tsx` |
| `POST` | `/api/v1/incidents/{id}/responses` | Log emergency PCR dispatch units data | Yes | `ResponseCreate` | `ResponseRecord` | `App.tsx` |
| `GET` | `/api/v1/incidents/{id}/responses` | List logged dispatch operations details | Yes | None | `list[ResponseRecord]` | Dispatch tracking charts |
| `POST` | `/api/v1/alerts` | Create notification links for incidents | Yes | `AlertCreate` | `AlertResponse` | `App.tsx` (broadcast) |
| `GET` | `/api/v1/alerts` | Get recorded notifications | Yes | Query: `incident_id`| `list[AlertResponse]` | `TouristApp.tsx` |
| `GET` | `/api/v1/locations` | Retrieve recorded coordinates | Yes | None | `list[LocationResponse]` | Live map layers |
| `POST` | `/api/v1/itinerary` | Create destinations itinerary items | Yes | `ItineraryEntryCreate`| `ItineraryEntryResponse` | `TripsPanel.tsx` |
| `GET` | `/api/v1/itinerary` | List tourist destinations itinerary items | Yes | None | `list[ItineraryEntryResponse]`| `TripsPanel.tsx` |
| `DELETE`| `/api/v1/itinerary/{id}`| Remove destinations itinerary items | Yes | None | Status 204 | `TripsPanel.tsx` |
| `POST` | `/api/v1/audit-logs` | Persist lookup event metrics for audit trails| Yes | `AuditLogCreate` | `AuditLogRecord` | `App.tsx` |
| `GET` | `/api/v1/audit-logs` | Retrieve the oversight audit compliance trail| Yes | None | `list[AuditLogRecord]` | `App.tsx` (audit panel) |
| `POST` | `/api/v1/authority/login` | Restricts logins to authority role profiles| No | `{ "username", "password" }` | `LoginResponse` | `Gateway.tsx` |
| `GET` | `/api/v1/authority/alerts` | Fetch all alerts dispatcher has oversight of | Yes | None | `list[AlertResponse]` | Command console |
| `GET` | `/api/v1/authority/incidents` | Fetch all unassigned and assigned incidents | Yes | None | `list[IncidentResponse]` | `App.tsx` (refresh) |
| `GET` | `/api/v1/authority/tourists/{id}` | Read tourist details under audit guard | Yes | None | `TouristResponse` | `App.tsx` (tracking) |
| `GET` | `/api/v1/authority/incidents/{id}/location`| Resolve geocoded details of incidents | Yes | None | `LocationResponse` | `App.tsx` (map zoom) |

---

## 7. BACKEND FILE-BY-FILE REFERENCE

### File: `backend/db.py`
* **Purpose:** Configures the `ThreadedConnectionPool` and injects session variables for RLS simulation.
* **Key Code Snippet:**
```python
@contextmanager
def get_authenticated_cursor(auth_user_id, commit: bool = False):
    if not DB_ACTIVE or pool is None:
        raise RuntimeError("Database connection is not active.")
    conn = pool.getconn()
    cur = conn.cursor()
    try:
        # Inject JWT claims to simulate Supabase Auth
        claims_str = json.dumps({"sub": str(auth_user_id), "role": "authenticated"})
        cur.execute("SELECT set_config('request.jwt.claims', %s, true);", (claims_str,))
        cur.execute("SET LOCAL ROLE authenticated;")
        yield cur
        if commit:
            conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cur.close()
        pool.putconn(conn)
```

### File: `backend/routers/auth.py`
* **Purpose:** Manages registration (delegating to Supabase Admin API / signup endpoint) and JWT local decoding.
* **Key Code Snippet:**
```python
def get_current_user(
    authorization: str | None = Header(None),
    x_session_token: str | None = Header(None, alias="X-Session-Token"),
) -> SessionResponse:
    token = None
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ", 1)[1].strip()
    elif x_session_token:
        token = x_session_token.strip()

    if not token:
        raise HTTPException(status_code=401, detail="Authentication token required")

    if not is_db_active():
        session_data = _in_memory_session_store.get(token)
        if not session_data:
            raise HTTPException(status_code=401, detail="Invalid session token")
        return SessionResponse(**session_data)

    try:
        claims = jwt.decode(token, Config.JWT_SECRET, algorithms=["HS256"], options={"verify_aud": False})
        auth_user_id = claims.get("sub")
        with get_db_cursor() as cur:
            cur.execute("""
                SELECT auth_id, auth_user_id, tourist_id, authority_id, username, mfa_enabled, last_login_at
                FROM public.authentication WHERE auth_user_id = %s;
            """, (auth_user_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=401, detail="User profile not found")
            return SessionResponse(
                auth_id=row[0], auth_user_id=row[1], username=row[4],
                user_type="tourist" if row[2] is not None else "authority",
                tourist_id=row[2], authority_id=row[3], mfa_enabled=row[5], last_login_at=row[6]
            )
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
```

### File: `backend/routers/sos.py`
* **Purpose:** Handles SOS panic operations, geocoding incident spots, and linking request metrics.
* **Key Code Snippet:**
```python
@router.post("", response_model=SOSResponse, status_code=201)
def create_sos(payload: SOSCreate, current_user: SessionResponse = Depends(get_current_user)) -> SOSResponse:
    if current_user.user_type == "tourist":
        if current_user.tourist_id is None:
            raise HTTPException(status_code=403, detail="No tourist profile associated.")
        payload.tourist_id = current_user.tourist_id # Prevent ID spoofing

    now = datetime.now(timezone.utc)
    location_id, incident_id, sos_id = uuid4(), uuid4(), uuid4()

    try:
        with get_authenticated_cursor(current_user.auth_user_id, commit=True) as cur:
            # Create a location record
            cur.execute("""
                INSERT INTO public.locations (location_id, name, latitude, longitude, risk_level, recorded_at)
                VALUES (%s, %s, %s, %s, %s, %s);
            """, (location_id, f"SOS Alarm - {payload.tourist_id}", payload.latitude, payload.longitude, "HIGH", now))
            
            # Create incident
            cur.execute("""
                INSERT INTO public.incidents (incident_id, tourist_id, location_id, incident_type, severity, status, description, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s);
            """, (incident_id, payload.tourist_id, location_id, "SOS", "HIGH", "OPEN", "SOS Alarm Triggered", now))
            
            # Create SOS request record
            cur.execute("""
                INSERT INTO public.sos_requests (sos_id, tourist_id, incident_id, location_id, trigger_source, sos_status, triggered_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING sos_id, tourist_id, incident_id, location_id, trigger_source, sos_status, triggered_at;
            """, (sos_id, payload.tourist_id, incident_id, location_id, payload.trigger_source or "APP", "ACTIVE", now))
            row = cur.fetchone()
            
            return SOSResponse(
                sos_id=row[0], tourist_id=row[1], incident_id=row[2], location_id=row[3],
                incident_type="SOS", severity="HIGH", status="OPEN", description="SOS Alarm Triggered",
                triggered_at=row[6], created_at=row[6], trigger_source=row[4], sos_status=row[5]
            )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SOS creation failed: {e}")
```

---

## 8. DATABASE ARCHITECTURE

* **Database Type:** Supabase / PostgreSQL.
* **Row Level Security (RLS):** Enabled on all tables. Queries utilize the authenticated user ID (`auth.uid()`) to restrict data access.

### Database Tables:
1. **`tourists`**: Profiles of travelers.
   * `tourist_id` (UUID, PK)
   * `auth_user_id` (UUID, Unique, FK -> `auth.users.id` ON DELETE CASCADE)
   * `digital_id` (VARCHAR(255), Unique)
   * `full_name` (VARCHAR(255), NOT NULL)
   * `kyc_document_type` (VARCHAR(100), e.g., PASSPORT, AADHAAR)
   * `kyc_verified` (BOOLEAN, default FALSE)
   * `phone` (VARCHAR(30))
   * `email` (VARCHAR(255))
   * `emergency_contact` (VARCHAR(255))
   * `preferred_language` (VARCHAR(100))
   * `created_at` (TIMESTAMPTZ, default NOW)
2. **`authorities`**: Safety organizations (Police, Medical, Fire).
   * `authority_id` (UUID, PK)
   * `auth_user_id` (UUID, Unique, FK -> `auth.users.id` ON DELETE CASCADE)
   * `agency_name` (VARCHAR(255), NOT NULL)
   * `jurisdiction` (VARCHAR(255))
   * `contact_phone` (VARCHAR(30))
   * `contact_email` (VARCHAR(255))
3. **`authentication`**: Core login and user profile link records.
   * `auth_id` (UUID, PK)
   * `auth_user_id` (UUID, Unique, FK -> `auth.users.id` ON DELETE CASCADE)
   * `tourist_id` (UUID, FK -> `tourists.tourist_id` ON DELETE CASCADE, nullable)
   * `authority_id` (UUID, FK -> `authorities.authority_id` ON DELETE CASCADE, nullable)
   * `username` (VARCHAR(255), Unique, NOT NULL)
   * `mfa_enabled` (BOOLEAN, default FALSE)
   * `last_login_at` (TIMESTAMPTZ)
   * `created_at` (TIMESTAMPTZ, default NOW)
4. **`locations`**: Geocoded points and regional safety metrics.
   * `location_id` (UUID, PK)
   * `name` (VARCHAR(255))
   * `latitude` (DECIMAL(10,7), NOT NULL)
   * `longitude` (DECIMAL(10,7), NOT NULL)
   * `risk_level` (VARCHAR(50), e.g., LOW, MEDIUM, HIGH, CRITICAL)
   * `recorded_at` (TIMESTAMPTZ, default NOW)
5. **`itinerary_entries`**: Registered travel destinations.
   * `itinerary_id` (UUID, PK)
   * `tourist_id` (UUID, FK -> `tourists.tourist_id` ON DELETE CASCADE)
   * `location_id` (UUID, FK -> `locations.location_id` ON DELETE CASCADE)
   * `planned_arrival` (TIMESTAMPTZ)
   * `planned_departure` (TIMESTAMPTZ)
6. **`incidents`**: Incident records (medical emergencies, theft, harassment, SOS triggers).
   * `incident_id` (UUID, PK)
   * `tourist_id` (UUID, FK -> `tourists.tourist_id` ON DELETE CASCADE)
   * `location_id` (UUID, FK -> `locations.location_id` ON DELETE CASCADE)
   * `incident_type` (VARCHAR(100))
   * `severity` (VARCHAR(50))
   * `status` (VARCHAR(50), OPEN → ACKNOWLEDGED → INVESTIGATING → RESPONDING → RESOLVED → CLOSED)
   * `description` (TEXT)
   * `created_at` (TIMESTAMPTZ, default NOW)
   * `authority_id` (UUID, FK -> `authorities.authority_id`)
7. **`alerts`**: Pushed notifications for active incidents.
   * `alert_id` (UUID, PK)
   * `incident_id` (UUID, FK -> `incidents.incident_id` ON DELETE CASCADE)
   * `authority_id` (UUID, FK -> `authorities.authority_id`)
   * `channel` (VARCHAR(50), e.g., SMS, EMAIL, PUSH, APP)
   * `recipient` (VARCHAR(255))
   * `sent_at` (TIMESTAMPTZ, default NOW)
8. **`responses`**: Dispatch operational actions.
   * `response_id` (UUID, PK)
   * `incident_id` (UUID, FK -> `incidents.incident_id` ON DELETE CASCADE)
   * `responder_unit` (VARCHAR(255))
   * `action_taken` (TEXT)
   * `resolved_at` (TIMESTAMPTZ)
   * `authority_id` (UUID, FK -> `authorities.authority_id` ON DELETE CASCADE)
9. **`sos_requests`**: Emergency SOS requests.
   * `sos_id` (UUID, PK)
   * `tourist_id` (UUID, FK -> `tourists.tourist_id` ON DELETE CASCADE)
   * `incident_id` (UUID, FK -> `incidents.incident_id` ON DELETE CASCADE)
   * `location_id` (UUID, FK -> `locations.location_id` ON DELETE CASCADE)
   * `triggered_at` (TIMESTAMPTZ, default NOW)
   * `trigger_source` (VARCHAR(100), e.g., APP, WEARABLE, MANUAL, AI, SYSTEM)
   * `sos_status` (VARCHAR(50), e.g., ACTIVE, ACKNOWLEDGED, RESPONDING, RESOLVED, CANCELLED)
10. **`audit_logs`**: compliance check oversight records.
   * `audit_id` (UUID, PK)
   * `authority_id` (UUID, FK -> `authorities.authority_id` ON DELETE CASCADE)
   * `action_type` (VARCHAR(50))
   * `target_id` (VARCHAR(255))
   * `reason` (TEXT)
   * `details` (TEXT)
   * `ip_address` (VARCHAR(64))
   * `created_at` (TIMESTAMPTZ, default NOW)

### Database Relationship Diagram:
```text
  ┌─────────────────────────┐
  │       auth.users        │
  └────────────┬────────────┘
               │ (1:1 ON DELETE CASCADE)
     ┌─────────┼─────────┐
     ▼         ▼         ▼
 tourists authorities authentication
     │         │         │
     ├─────────┼─────────┤
     │ (1:N)   │ (1:N)   │
     ▼         ▼         ▼
 itinerary_entries, incidents, sos_requests, responses, alerts, audit_logs
```

---

## 9. DATABASE ↔ BACKEND ↔ FRONTEND CONNECTION MAP

### Tourist Profile Verification
* **Frontend:** `ProfilePanel.tsx` (DigiLocker verification modal / emergency contact input)
  * Calls: `PATCH /api/v1/tourists/{id}` via `updateTouristProfile()`
* **Backend Router:** `backend/routers/tourists.py`
  * Action: Checks token claims and updates `public.tourists` RLS table.
* **Database Table:** `public.tourists`

### SOS Panic Action
* **Frontend:** `TouristApp.tsx` → `SOSButton.tsx` (countdown panic trigger)
  * Capture: HTML5 GPS coordinates, fallback to IndexedDB.
  * Calls: `POST /api/v1/sos` via `submitSOSOnline()` (online mode) or caches in IndexedDB queue (offline mode).
* **Backend Router:** `backend/routers/sos.py`
  * Action: Resolves coordinates location, inserts `public.locations` row, creates `"SOS"` incident in `public.incidents`, and inserts activation row in `public.sos_requests`.
* **Database Tables:** `public.locations` → `public.incidents` → `public.sos_requests`

### PCR Responder Dispatching
* **Frontend:** `ModuleSOSMap.tsx` (Kanban ticket PCR selection dropdown)
  * Action: Dispatches van to incident, calls `PATCH /api/v1/incidents/{id}` via `updateIncidentStatus()` (sets status to `"RESPONDING"`), and logs dispatcher operations via `POST /api/v1/incidents/{id}/responses` via `createIncidentResponse()`.
* **Backend Router:** `backend/routers/incidents.py`
  * Action: Updates incident status in `public.incidents` and inserts dispatch action details into `public.responses`.
* **Database Tables:** `public.incidents` & `public.responses`

---

## 10. AUTHENTICATION FLOW

```text
Tourist Signup (OTP Verification)
  1. User enters phone number → LoginModal.tsx triggers sendOtp()
  2. Backend: /auth/send-otp creates short-lived in-memory code and logs debug signature
  3. User enters code → verifyOtp() validates with backend
  4. Phone verified: UI collects full name and triggers registerAndLoginTourist()
  5. Backend: /auth/register creates Supabase Auth record with synthetic email (tourist-<phone>@...)
  6. Backend: inserts profile row into public.tourists and maps link in public.authentication
  7. Backend: /auth/login returns JWT session token
  8. Frontend: stores token and tourist ID in localStorage
```

```text
Authority MFA Login
  1. Officer enters Badge ID & MFA OTP code → Gateway.tsx submits form
  2. Frontend: authenticateAuthority() maps Badge ID → username and OTP → password
  3. Backend: /authority/login verifies credentials against Supabase Auth (via email badge-id@...)
  4. Backend: updates last_login_at timestamp in public.authentication and returns session JWT
  5. Frontend: stores token in localStorage and loads authority command modules
```

---

## 11. ENVIRONMENT VARIABLES

* **`DATABASE_URL`** = `[REDACTED]` — PostgreSQL connection string. Used by `ThreadedConnectionPool` in `backend/db.py`.
* **`SUPABASE_URL`** = `[REDACTED]` — Supabase project endpoint. Used by backend `routers/auth.py` for API requests.
* **`SUPABASE_ANON_KEY`** = `[REDACTED]` — Publishable anonymous API key. Used by backend `routers/auth.py` for public user registration/login.
* **`SUPABASE_SERVICE_ROLE_KEY`** = `[REDACTED]` — Supabase service role key. Used to sign up tourists as pre-confirmed users to bypass Supabase's default email verification constraint.
* **`JWT_SECRET`** = `[REDACTED]` — Decryption secret for local verification of JWT token signatures in `routers/auth.py`.
* **`CORS_ALLOWED_ORIGINS`** = `[REDACTED]` — Comma-separated CORS whitelist origins. Configured in `backend/main.py`.
* **`OTP_DEBUG_LOG`** = `[REDACTED]` — Boolean flag (`true`/`false`). Controls whether generated OTPs are printed to logs for local testing.
* **`GOOGLE_MAPS_PLATFORM_KEY`** / **`VITE_GOOGLE_MAPS_PLATFORM_KEY`** = `[REDACTED]` — Google Maps JS API key. Configured in `ActualGoogleMap.tsx` with fallback iframe rendering when missing.
* **`VITE_API_BASE_URL`** = `[REDACTED]` — Custom API URL override for the frontend fetch client.

---

## 12. EXTERNAL SERVICES

1. **Supabase Auth API:**
   * **Purpose:** Handles user registration, login, token issuance, and session revocation.
   * **Integration:** Backend forwards requests to `${SUPABASE_URL}/auth/v1/*`.
2. **Google Maps Platform API:**
   * **Purpose:** Renders GIS maps and pins active coordinates.
   * **Integration:** Loaded via `@vis.gl/react-google-maps` or dynamic iframe embeds (`maps.google.com/maps`).

---

## 13. IMPORTANT DATA FLOWS

* **Offline-First SOS Queuing:**
  When a tourist triggers an SOS offline: Geolocation captures coords → saves to IndexedDB table `sos_queue` with status `QUEUED_OFFLINE`. Once network connectivity is restored, the `online` window event listener triggers `syncQueuedSOS()`, posting the queued SOS payload to `/api/v1/sos` and updating local IndexedDB records to `SYNCED`.
* **PCR Dispatching & Assignment:**
  Dispatcher assigns PCR Van in command board → calls `PATCH /incidents/{id}` (links authority agency, updates status to `"RESPONDING"`) and creates response records (`POST /incidents/{id}/responses`) to map dispatch operations.
* **DigiLocker KYC Verification:**
  Tourist clicks "Verify DigiLocker" → triggers OAuth consent verification → returns mock payload → updates profile KYC status via `PATCH /tourists/{id}` (sets `kyc_verified = true` and `kyc_document_type = "AADHAAR"`).

---

## 14. CURRENT KNOWN ISSUES

| Issue | File | Severity | Description |
| :--- | :--- | :---: | :--- |
| Mock Chatbot | `TouristPortal.tsx` / `TouristApp.tsx` | Low | AI chatbot panel uses mock responses; no backend integration router exists. |
| Audit CSV Export | `ModuleAnalyticsAudit.tsx` | Low | CSV export function triggers download of client-side logs; does not pull full backend audit trails. |
| Geofenced Geolocation Map | `CrowdHeatmap.tsx` / `ActualGoogleMap.tsx` | Medium | Heatmap overlays use mock density zones; no backend API returns real-time regional crowd counts. |
| Interception Logs | `ModuleTouristTracking.tsx` | Low | Statutory search reason is logged to local array; does not call `POST /api/v1/audit-logs`. |

---

## 15. BUILD AND RUN INSTRUCTIONS

### Frontend Setup:
```bash
cd frontend
bun install # or npm install
bun dev     # Starts Vite local server on port 3000
bun build   # Compiles production bundle to frontend/dist
```

### Backend Setup:
```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000 # Starts API server
pytest      # Runs test suite under backend/tests
```

---

## 16. DEPLOYMENT ARCHITECTURE

* **Backend Deployment:** Deployed to Railway. Continuous integration builds and starts the FastAPI app via `uvicorn main:app --host 0.0.0.0 --port $PORT`.
* **Frontend Hosting:** Static bundle generated via `vite build` and served from `dist` folder.
* **Database Hosting:** Hosted on Supabase (PostgreSQL + Auth integration).

---

## 17. IMPORTANT CONFIGURATION FILES

### Snippet from `frontend/package.json`:
```json
  "scripts": {
    "dev": "vite --port=3000 --host=0.0.0.0",
    "build": "vite build",
    "preview": "vite preview",
    "clean": "rm -rf dist server.js",
    "lint": "tsc --noEmit"
  }
```

### Snippet from `backend/requirements.txt`:
```text
fastapi
uvicorn[standard]
psycopg2-binary
python-dotenv
pyjwt
requests
cryptography
pytest
httpx
```

### Snippet from `database/migrations/001_add_audit_logs.sql`:
```sql
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
```

---

## 18. DEPENDENCY MAP

* **Frontend Key Dependencies:**
  * `react` / `react-dom` (v19.0.1) — UI core framework.
  * `vite` (v6.2.3) — Asset compilation and bundling.
  * `@vis.gl/react-google-maps` (v1.9.0) — GIS map interface.
  * `lucide-react` (v0.546.0) — Icon graphics.
* **Backend Key Dependencies:**
  * `fastapi` / `uvicorn` — REST API framework and runtime.
  * `psycopg2-binary` — PostgreSQL connector.
  * `pyjwt` — Decodes and verifies HS256 JWT auth tokens.
  * `pytest` — API test runner.

---

## 19. INSTRUCTIONS FOR AI WORKING ON THIS PROJECT

1. Read `CODE.md` before modifying the project.
2. Do not rewrite the architecture unless explicitly requested.
3. Do not modify unrelated files.
4. Before changing a feature, trace its complete frontend → backend → database flow.
5. Preserve existing APIs unless the user explicitly asks for API changes.
6. Preserve existing database schema unless explicitly asked to change it.
7. Check existing components/services before creating duplicates.
8. Reuse existing utilities and patterns.
9. Do not introduce new dependencies unless necessary.
10. Never expose or hardcode secrets.
11. When changing an API, update both its frontend caller and backend implementation.
12. When changing database fields, check every frontend/backend reference.
13. After making changes, check for TypeScript/JavaScript errors and broken imports.
14. Explain exactly which files were changed and why.
15. Do not make speculative changes.
16. If something is unclear, inspect the relevant source files before making assumptions.

---

## 20. FINAL PROJECT SUMMARY

* **Stack:** React 19 (Vite) + FastAPI (Python) + PostgreSQL (Supabase).
* **Architecture:** Conditional role routing frontend, parameterized SQL query pooling backend, Row Level Security databases.
* **Frontend Entry Point:** [`main.tsx`](file:///Users/anishsingh/Documents/GitHub/Smart-Tourist-Safety/frontend/src/main.tsx)
* **Backend Entry Point:** [`main.py`](file:///Users/anishsingh/Documents/GitHub/Smart-Tourist-Safety/backend/main.py)
* **Database:** PostgreSQL on Supabase (`public` schema).
* **Authentication:** Supabase Auth (JWT HS256 tokens mapping).
* **Main API Routers:** `auth.py`, `tourists.py`, `sos.py`, `incidents.py`, `authority.py`, `audit_logs.py`.
* **Main Frontend Panels:** `TouristApp.tsx` (Trips, Alerts, Profile) & Authority command tabs (`ModuleSOSMap`, `ModuleTouristTracking`, `ModuleAIHub`, `ModuleBroadcast`, `ModuleAnalyticsAudit`).
* **Deployment:** Railway (App servers) + Supabase (Database/Auth).
