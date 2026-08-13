# Project Memory

## Project

Smart Tourist Safety Application

## Backend Goal

Build only the required P0 application logic and APIs.

## P0 Scope

### Authentication

* Register
* Login
* Authentication/session handling

### Tourist

* Create tourist profile
* Get tourist profile
* Update tourist profile
* Basic Digital ID information

### SOS

* Receive SOS request
* Capture tourist ID
* Capture location
* Create incident

### Incident

* Create incident
* Get active incidents
* Get incident details
* Update incident status

### Authority

* Authority login/API
* Get alerts
* Get incidents
* Get tourist details
* Get incident location

## Required Deliverables

1. API contract
2. Authentication APIs
3. Tourist APIs
4. Digital Identity API
5. SOS API
6. Incident APIs
7. Alert APIs
8. Authority APIs
9. API documentation/testing collection

## Development Rules

* Implement one task at a time.
* Keep the backend minimal.
* Do not add features outside the P0 scope.
* Do not invent database tables or columns.
* Do not modify the database schema.
* Do not add unnecessary abstractions.
* Do not add unnecessary dependencies.
* Reuse existing code whenever possible.
* Wait for my instruction before implementing the next task.

## Current Status

* Backend folder exists
* Project memory: Complete
* Database schema: Complete schema available — PostgreSQL connection pending
* Backend architecture: Complete
* API contract: Complete
* Backend foundation: Implemented
* Tourist APIs: Implemented — temporary in-memory storage
* Database integration: Pending PostgreSQL connection details
* Authentication: Implemented — temporary in-memory storage
* Digital Identity API: Implemented — temporary in-memory storage
* SOS API: Implemented — temporary in-memory storage
* Incident APIs: Implemented — temporary in-memory storage
* Alert APIs: Implemented — temporary in-memory storage
* Authority data APIs: Implemented — temporary in-memory storage
* Authority authentication: Implemented — temporary in-memory storage
* Testing/documentation: Complete

**Note:** Authentication, Tourist APIs, Digital Identity API, SOS API, Incident APIs, Alert APIs, and Authority APIs currently use temporary in-memory storage for local API development. PostgreSQL integration will replace this storage once the project's database connection details are provided.

## Database

PostgreSQL schema (read-only contract — do not modify):

### tourists

* tourist_id UUID PRIMARY KEY
* digital_id VARCHAR
* full_name VARCHAR
* kyc_document_type VARCHAR
* kyc_verified BOOLEAN
* phone VARCHAR
* email VARCHAR
* emergency_contact VARCHAR
* preferred_language VARCHAR
* created_at TIMESTAMPTZ

### locations

* location_id UUID PRIMARY KEY
* name VARCHAR
* latitude DECIMAL
* longitude DECIMAL
* risk_level VARCHAR
* recorded_at TIMESTAMPTZ

### itinerary_entries

* itinerary_id UUID PRIMARY KEY
* tourist_id UUID FOREIGN KEY → tourists.tourist_id
* location_id UUID FOREIGN KEY → locations.location_id
* planned_arrival TIMESTAMPTZ
* planned_departure TIMESTAMPTZ

### incidents

* incident_id UUID PRIMARY KEY
* tourist_id UUID FOREIGN KEY → tourists.tourist_id
* location_id UUID FOREIGN KEY → locations.location_id
* incident_type VARCHAR
* severity VARCHAR
* status VARCHAR
* description TEXT
* created_at TIMESTAMPTZ
* authority_id UUID FOREIGN KEY → authorities.authority_id

### alerts

* alert_id UUID PRIMARY KEY
* incident_id UUID FOREIGN KEY → incidents.incident_id
* channel VARCHAR
* recipient VARCHAR
* sent_at TIMESTAMPTZ

### responses

* response_id UUID PRIMARY KEY
* incident_id UUID FOREIGN KEY → incidents.incident_id
* responder_unit VARCHAR
* action_taken TEXT
* resolved_at TIMESTAMPTZ
* authority_id UUID FOREIGN KEY → authorities.authority_id

### authorities

* authority_id UUID PRIMARY KEY
* agency_name VARCHAR
* jurisdiction VARCHAR
* contact_phone VARCHAR
* contact_email VARCHAR

### authentication

* auth_id UUID PRIMARY KEY
* tourist_id UUID FOREIGN KEY → tourists.tourist_id
* authority_id UUID FOREIGN KEY → authorities.authority_id
* username VARCHAR
* password_hash VARCHAR
* mfa_enabled BOOLEAN
* last_login_at TIMESTAMPTZ
* created_at TIMESTAMPTZ

### sos_requests

* sos_id UUID PRIMARY KEY
* tourist_id UUID FOREIGN KEY → tourists.tourist_id
* incident_id UUID FOREIGN KEY → incidents.incident_id
* location_id UUID FOREIGN KEY → locations.location_id
* triggered_at TIMESTAMPTZ
* trigger_source VARCHAR
* sos_status VARCHAR

**Note:** Complete schema available — PostgreSQL connection pending.

## Code Tree

Smart_Tourist_Safety/
├── .gitignore
├── README.md/
│   └── .gitkeep
├── backend/
│   ├── .gitkeep
│   ├── main.py
│   ├── PROJECT_MEMORY.md
│   ├── requirements.txt
│   ├── routers/
│   │   ├── alerts.py
│   │   ├── auth.py
│   │   ├── authority.py
│   │   ├── incidents.py
│   │   ├── locations.py
│   │   ├── sos.py
│   │   └── tourists.py
│   └── schemas/
│       ├── alert.py
│       ├── auth.py
│       ├── incident.py
│       ├── location.py
│       ├── sos.py
│       └── tourist.py
└── frontend/
    └── .gitkeep

---

# Backend Architecture

Minimal layered architecture for a Python REST API backed by PostgreSQL. Files listed below are planned — **not created yet**.

```
backend/
├── main.py                 # Application entry point; mounts routers, starts server
├── config.py               # Reads environment variables (DATABASE_URL, etc.)
├── db.py                   # PostgreSQL connection pool and query helpers
├── routers/
│   ├── auth.py             # Authentication routes (PENDING — no schema support yet)
│   ├── tourists.py         # Tourist profile CRUD
│   ├── digital_id.py       # Digital ID read endpoint
│   ├── sos.py              # SOS request handler; creates incident (+ optional alert)
│   ├── incidents.py        # Incident CRUD and status updates
│   ├── alerts.py           # Alert listing and creation
│   └── authority.py        # Authority-facing routes (auth PENDING)
├── schemas/
│   ├── tourist.py          # Request/response shapes for tourist endpoints
│   ├── incident.py         # Request/response shapes for incident endpoints
│   ├── alert.py            # Request/response shapes for alert endpoints
│   ├── sos.py              # Request/response shapes for SOS endpoint
│   └── location.py           # Request/response shapes for location data in responses
└── requirements.txt        # Runtime dependencies (added at implementation time)
```

### Layer purposes

| Layer | Purpose |
|---|---|
| `main.py` | Wires the app together; registers route modules; no business logic. |
| `config.py` | Centralizes configuration (DB connection string, app settings) from environment. |
| `db.py` | Manages PostgreSQL connections and executes parameterized SQL queries. |
| `routers/` | One file per domain; handles HTTP method/path, validates input, calls DB, returns responses. |
| `schemas/` | Defines request body and response field shapes; keeps routers thin. |

### Design principles

* No service/repository layer unless complexity demands it later.
* Routers talk directly to `db.py` with parameterized SQL.
* No ORM migrations — schema is fixed and external.
* Authentication middleware is **PENDING** until credential storage is clarified.
* `itinerary_entries` and `responses` tables exist but have no P0 API endpoints.

---

# API Contract

Base path: `/api/v1`

All UUIDs are strings in JSON. Timestamps are ISO 8601 strings.

---

## 1. Authentication

> **Database mapping:** `authentication`, `tourists`, `authorities`

### POST /api/v1/auth/register

| | |
|---|---|
| **Purpose** | Register a new account. |
| **Request body** | **PENDING** — schema has no credential fields. Interim candidate: same fields as `POST /tourists` plus unspecified credential fields. |
| **Response fields** | **PENDING** — likely `tourist_id` + session/token fields once auth storage is defined. |
| **Status codes** | `201` Created (**PENDING**), `400` Bad Request, `409` Conflict (**PENDING**) |

### POST /api/v1/auth/login

| | |
|---|---|
| **Purpose** | Authenticate and establish a session. |
| **Request body** | **PENDING** — no credential columns exist (e.g. email/phone + secret). |
| **Response fields** | **PENDING** — session token or cookie reference. |
| **Status codes** | `200` OK (**PENDING**), `401` Unauthorized (**PENDING**), `400` Bad Request |

### POST /api/v1/auth/logout

| | |
|---|---|
| **Purpose** | End the current session. |
| **Request body** | None (session identified via header/cookie — mechanism **PENDING**). |
| **Response fields** | `{ "message": "logged out" }` |
| **Status codes** | `200` OK, `401` Unauthorized (**PENDING** if session invalid) |

### GET /api/v1/auth/session

| | |
|---|---|
| **Purpose** | Return the currently authenticated principal. |
| **Request parameters** | Session token via header/cookie — mechanism **PENDING**. |
| **Response fields** | **PENDING** — likely `{ "tourist_id": "<uuid>" }` for tourists; authority identity **PENDING**. |
| **Status codes** | `200` OK (**PENDING**), `401` Unauthorized (**PENDING**) |

---

## 2. Tourist

### POST /api/v1/tourists

| | |
|---|---|
| **Purpose** | Create a tourist profile. |
| **Request body** | `{ "digital_id", "full_name", "kyc_document_type", "kyc_verified", "phone", "email", "emergency_contact", "preferred_language" }` — all optional except those required by business rules at implementation time; only columns from `tourists` table. |
| **Response fields** | `{ "tourist_id", "digital_id", "full_name", "kyc_document_type", "kyc_verified", "phone", "email", "emergency_contact", "preferred_language", "created_at" }` |
| **Status codes** | `201` Created, `400` Bad Request |

### GET /api/v1/tourists/{tourist_id}

| | |
|---|---|
| **Purpose** | Get a tourist profile by ID. |
| **Request parameters** | Path: `tourist_id` (UUID). |
| **Response fields** | `{ "tourist_id", "digital_id", "full_name", "kyc_document_type", "kyc_verified", "phone", "email", "emergency_contact", "preferred_language", "created_at" }` |
| **Status codes** | `200` OK, `404` Not Found |

### PATCH /api/v1/tourists/{tourist_id}

| | |
|---|---|
| **Purpose** | Update a tourist profile (partial update). |
| **Request body** | Any subset of `{ "digital_id", "full_name", "kyc_document_type", "kyc_verified", "phone", "email", "emergency_contact", "preferred_language" }`. |
| **Response fields** | Updated tourist object (same fields as GET). |
| **Status codes** | `200` OK, `400` Bad Request, `404` Not Found |

---

## 3. Digital Identity

### GET /api/v1/tourists/{tourist_id}/digital-id

| | |
|---|---|
| **Purpose** | Return basic Digital ID information for a tourist. |
| **Request parameters** | Path: `tourist_id` (UUID). |
| **Response fields** | `{ "tourist_id", "digital_id", "full_name", "kyc_document_type", "kyc_verified" }` |
| **Status codes** | `200` OK, `404` Not Found |

---

## 4. SOS

### POST /api/v1/sos

| | |
|---|---|
| **Purpose** | Receive an SOS request; capture tourist ID and location; create an incident. |
| **Request body** | `{ "tourist_id" (UUID, required), "location_id" (UUID, optional), "latitude" (decimal, optional), "longitude" (decimal, optional), "description" (string, optional), "severity" (string, optional) }`. Either `location_id` or both `latitude` and `longitude` must be provided. If coordinates are given, backend resolves to a `locations` row (lookup or insert using existing columns). |
| **Response fields** | `{ "incident_id", "tourist_id", "location_id", "incident_type", "severity", "status", "description", "created_at" }` — `incident_type` set to `"SOS"`. |
| **Status codes** | `201` Created, `400` Bad Request, `404` Not Found (tourist or location not found) |

**Side effect:** May also insert an `alerts` row (channel/recipient determined at implementation; no defaults invented here).

---

## 5. Incident

### POST /api/v1/incidents

| | |
|---|---|
| **Purpose** | Create an incident (non-SOS path). |
| **Request body** | `{ "tourist_id", "location_id", "incident_type", "severity", "status", "description" }` |
| **Response fields** | `{ "incident_id", "tourist_id", "location_id", "incident_type", "severity", "status", "description", "created_at" }` |
| **Status codes** | `201` Created, `400` Bad Request, `404` Not Found |

### GET /api/v1/incidents

| | |
|---|---|
| **Purpose** | Get active incidents. |
| **Request parameters** | Query: `status` (string, optional — e.g. filter for active statuses). |
| **Response fields** | `[ { "incident_id", "tourist_id", "location_id", "incident_type", "severity", "status", "description", "created_at" } ]` |
| **Status codes** | `200` OK |

### GET /api/v1/incidents/{incident_id}

| | |
|---|---|
| **Purpose** | Get incident details. |
| **Request parameters** | Path: `incident_id` (UUID). |
| **Response fields** | `{ "incident_id", "tourist_id", "location_id", "incident_type", "severity", "status", "description", "created_at" }` |
| **Status codes** | `200` OK, `404` Not Found |

### PATCH /api/v1/incidents/{incident_id}

| | |
|---|---|
| **Purpose** | Update incident status (and optionally other fields). |
| **Request body** | `{ "status" (required), "severity" (optional), "description" (optional) }` |
| **Response fields** | Updated incident object (same fields as GET). |
| **Status codes** | `200` OK, `400` Bad Request, `404` Not Found |

---

## 6. Alerts

### GET /api/v1/alerts

| | |
|---|---|
| **Purpose** | List alerts, optionally filtered by incident. |
| **Request parameters** | Query: `incident_id` (UUID, optional). |
| **Response fields** | `[ { "alert_id", "incident_id", "channel", "recipient", "sent_at" } ]` |
| **Status codes** | `200` OK |

### POST /api/v1/alerts

| | |
|---|---|
| **Purpose** | Record an alert dispatch for an incident. |
| **Request body** | `{ "incident_id", "channel", "recipient" }` |
| **Response fields** | `{ "alert_id", "incident_id", "channel", "recipient", "sent_at" }` |
| **Status codes** | `201` Created, `400` Bad Request, `404` Not Found |

---

## 7. Authority

> **Database mapping:** `authorities`, `authentication`, `incidents`, `tourists`, `locations`, `alerts`

### POST /api/v1/authority/login

| | |
|---|---|
| **Purpose** | Authenticate an authority user. |
| **Request body** | Credentials mapping to `authentication` / `authorities`. |
| **Response fields** | Session/token for authority principal. |
| **Status codes** | `200` OK, `401` Unauthorized, `400` Bad Request |

### GET /api/v1/authority/alerts

| | |
|---|---|
| **Purpose** | Authority view of alerts. |
| **Request parameters** | Query: `incident_id` (UUID, optional). |
| **Response fields** | `[ { "alert_id", "incident_id", "channel", "recipient", "sent_at" } ]` |
| **Status codes** | `200` OK, `401` Unauthorized |

### GET /api/v1/authority/incidents

| | |
|---|---|
| **Purpose** | Authority view of incidents. |
| **Request parameters** | Query: `status` (string, optional). |
| **Response fields** | `[ { "incident_id", "tourist_id", "location_id", "incident_type", "severity", "status", "description", "created_at" } ]` |
| **Status codes** | `200` OK, `401` Unauthorized |

### GET /api/v1/authority/tourists/{tourist_id}

| | |
|---|---|
| **Purpose** | Authority access to tourist details for an incident context. |
| **Request parameters** | Path: `tourist_id` (UUID). |
| **Response fields** | `{ "tourist_id", "digital_id", "full_name", "kyc_document_type", "kyc_verified", "phone", "email", "emergency_contact", "preferred_language", "created_at" }` |
| **Status codes** | `200` OK, `404` Not Found, `401` Unauthorized |

### GET /api/v1/authority/incidents/{incident_id}/location

| | |
|---|---|
| **Purpose** | Get the location associated with an incident. |
| **Request parameters** | Path: `incident_id` (UUID). |
| **Response fields** | `{ "location_id", "name", "latitude", "longitude", "risk_level", "recorded_at" }` — joined from `incidents.location_id` → `locations`. |
| **Status codes** | `200` OK, `404` Not Found, `401` Unauthorized |

---

# Database Mapping

| API Endpoint | Table(s) Used |
|---|---|
| POST /auth/register | `authentication`, `tourists`, `authorities` |
| POST /auth/login | `authentication`, `tourists`, `authorities` |
| POST /auth/logout | `authentication` |
| GET /auth/session | `authentication` |
| POST /tourists | `tourists` |
| GET /tourists/{tourist_id} | `tourists` |
| PATCH /tourists/{tourist_id} | `tourists` |
| GET /tourists/{tourist_id}/digital-id | `tourists` |
| POST /sos | `sos_requests`, `tourists`, `locations`, `incidents` |
| POST /incidents | `incidents`, `tourists`, `locations`, `authorities` |
| GET /incidents | `incidents` |
| GET /incidents/{incident_id} | `incidents` |
| PATCH /incidents/{incident_id} | `incidents` |
| GET /alerts | `alerts`, `incidents` |
| POST /alerts | `alerts`, `incidents` |
| POST /authority/login | `authorities`, `authentication` |
| GET /authority/alerts | `authorities`, `alerts`, `incidents` |
| GET /authority/incidents | `authorities`, `incidents` |
| GET /authority/tourists/{tourist_id} | `authorities`, `tourists` |
| GET /authority/incidents/{incident_id}/location | `authorities`, `incidents`, `locations` |

**Tables with no P0 API mapping:** `itinerary_entries`, `responses`

---

# P0 Traceability

| P0 Requirement | API Endpoint | Database Table |
|---|---|---|
| Register | POST /auth/register | `authentication`, `tourists`, `authorities` |
| Login | POST /auth/login | `authentication`, `tourists`, `authorities` |
| Authentication/session handling | POST /auth/logout, GET /auth/session | `authentication` |
| Create tourist profile | POST /tourists | `tourists` |
| Get tourist profile | GET /tourists/{tourist_id} | `tourists` |
| Update tourist profile | PATCH /tourists/{tourist_id} | `tourists` |
| Basic Digital ID information | GET /tourists/{tourist_id}/digital-id | `tourists` |
| Receive SOS request | POST /sos | `sos_requests`, `tourists`, `locations`, `incidents` |
| Capture tourist ID | POST /sos (request: `tourist_id`) | `sos_requests`, `tourists`, `locations`, `incidents` |
| Capture location | POST /sos (request: `location_id` or `latitude`/`longitude`) | `sos_requests`, `tourists`, `locations`, `incidents` |
| Create incident (via SOS) | POST /sos | `sos_requests`, `tourists`, `locations`, `incidents` |
| Create incident | POST /incidents | `incidents`, `tourists`, `locations`, `authorities` |
| Get active incidents | GET /incidents?status=... | `incidents` |
| Get incident details | GET /incidents/{incident_id} | `incidents` |
| Update incident status | PATCH /incidents/{incident_id} | `incidents` |
| Authority login/API | POST /authority/login | `authorities`, `authentication` |
| Get alerts | GET /authority/alerts | `alerts`, `incidents` |
| Get incidents | GET /authority/incidents | `incidents`, `authorities` |
| Get tourist details | GET /authority/tourists/{tourist_id} | `tourists` |
| Get incident location | GET /authority/incidents/{incident_id}/location | `incidents`, `locations` |

