# Programmatic Database Schema Definitions for Suraksha Setu
#
# Renamed/remapped to match the project's SYSTEM & PROJECT DIRECTIVE
# (Phase 1, Section 4: Unified Entity & Schema Mapping) on 2026-08-21.
#
# Notes on mapping decisions (documented since the directive itself is
# ambiguous or silent on a few points):
#
# 1. Directive's `users / tourist_profiles` maps to Supabase's built-in
#    `auth.users` (for `users`) + this schema's `tourist_profiles` (for
#    the profile row). We do not duplicate auth.users in our own tables.
# 2. The OLD `locations` table (points of interest: name, risk_level) is
#    NOT the same thing as the directive's `locations` table (live GPS
#    pings: tourist_id, speed, heading, geom). These are different
#    concepts that happened to share a name. The old table is renamed to
#    `points_of_interest`; a NEW `locations` table is added matching the
#    directive's live-tracking definition.
# 3. `tourist_profiles.tourist_id` is the human-readable public code
#    (format TOUR-YYYY-[HEX], enforced in application code at
#    generation time) and is distinct from `tourist_profiles.id`, the
#    internal UUID primary key used for all foreign keys. Every FK that
#    conceptually points "to a tourist" points at `tourist_profiles.id`.
# 4. `authorities`, `authentication`, `alerts`, `responses` are not part
#    of the directive's 6 listed entities (auth/staff accounts, OTP
#    verification, alert dispatch, and officer response logs). They are
#    kept with their existing names/shapes since the directive does not
#    ask for them to change and the dashboard's officer/agency model
#    still needs them.
# 5. `incidents.incident_type` is now constrained to the directive's
#    enum (SOS, GEOFENCE_BREACH, MANUAL) instead of free text, and gains
#    `ai_risk_score` + `priority` per the directive's AI Risk
#    Prioritization Engine spec. The old free-text `severity` column is
#    dropped in favor of `priority`.

TABLES = {
    "tourist_profiles": {
        "columns": {
            "id": {"type": "UUID", "default": "gen_random_uuid()", "nullable": False},
            "user_id": {"type": "UUID", "nullable": True},
            "username": {"type": "VARCHAR(255)", "nullable": False},
            "full_name": {"type": "VARCHAR(255)", "nullable": False},
            "tourist_id": {"type": "VARCHAR(30)", "nullable": True},
            "phone_number": {"type": "VARCHAR(30)", "nullable": True},
            "email": {"type": "VARCHAR(255)", "nullable": True},
            "emergency_contacts": {"type": "JSONB", "default": "'[]'::jsonb", "nullable": False},
            "govt_id_type": {"type": "VARCHAR(100)", "nullable": True},
            "govt_id_number": {"type": "VARCHAR(255)", "nullable": True},
            "id_photo_url": {"type": "TEXT", "nullable": True},
            "kyc_status": {"type": "VARCHAR(50)", "default": "'PENDING'", "nullable": False},
            "preferred_language": {"type": "VARCHAR(100)", "nullable": True},
            "created_at": {"type": "TIMESTAMPTZ", "default": "NOW()", "nullable": False},
            # --- KYC issuer + Sepolia blockchain anchoring (migration
            # 004_kyc_blockchain_anchoring.sql). Additive only. Never store
            # raw govt_id_number, DOB, or photos on-chain — only these
            # pseudonymous fields (hash + tx reference) ever get anchored,
            # per the zero-PII-on-chain rule. ---
            "kyc_document_type": {"type": "VARCHAR(50)", "nullable": True},
            "kyc_issuer": {"type": "VARCHAR(50)", "default": "'DigiLocker_Demo'", "nullable": True},
            "kyc_verification_hash": {"type": "VARCHAR(66)", "nullable": True},
            "kyc_salt": {"type": "VARCHAR(64)", "nullable": True},
            "kyc_verified_at": {"type": "TIMESTAMPTZ", "nullable": True},
            "blockchain_tx_hash": {"type": "VARCHAR(66)", "nullable": True},
            "blockchain_block_number": {"type": "BIGINT", "nullable": True}
        },
        "primary_key": "id",
        "uniques": ["user_id", "username", "tourist_id"],
        "foreign_keys": [
            {
                "column": "user_id",
                "references_schema": "auth",
                "references_table": "users",
                "references_column": "id",
                "on_delete": "CASCADE"
            }
        ],
        "constraints": {
            "chk_tourist_profiles_kyc": "CHECK (kyc_status IN ('PENDING','VERIFIED','REJECTED'))"
        },
        "indexes": {
            "idx_tourist_profiles_user_id": "user_id",
            "idx_tourist_profiles_tourist_id": "tourist_id"
        }
    },
    "authorities": {
        "columns": {
            "authority_id": {"type": "UUID", "default": "gen_random_uuid()", "nullable": False},
            "auth_user_id": {"type": "UUID", "nullable": True},
            "agency_name": {"type": "VARCHAR(255)", "nullable": False},
            "jurisdiction": {"type": "VARCHAR(255)", "nullable": True},
            "contact_phone": {"type": "VARCHAR(30)", "nullable": True},
            "contact_email": {"type": "VARCHAR(255)", "nullable": True}
        },
        "primary_key": "authority_id",
        "uniques": ["auth_user_id"],
        "foreign_keys": [
            {
                "column": "auth_user_id",
                "references_schema": "auth",
                "references_table": "users",
                "references_column": "id",
                "on_delete": "CASCADE"
            }
        ],
        "constraints": {},
        "indexes": {
            "idx_authorities_auth_user_id": "auth_user_id"
        }
    },
    "authentication": {
        "columns": {
            "auth_id": {"type": "UUID", "default": "gen_random_uuid()", "nullable": False},
            "auth_user_id": {"type": "UUID", "nullable": False},
            "tourist_profile_id": {"type": "UUID", "nullable": True},
            "authority_id": {"type": "UUID", "nullable": True},
            "username": {"type": "VARCHAR(255)", "nullable": False},
            "mfa_enabled": {"type": "BOOLEAN", "default": "FALSE", "nullable": False},
            "last_login_at": {"type": "TIMESTAMPTZ", "nullable": True},
            "created_at": {"type": "TIMESTAMPTZ", "default": "NOW()", "nullable": False}
        },
        "primary_key": "auth_id",
        "uniques": ["auth_user_id", "username"],
        "foreign_keys": [
            {
                "column": "auth_user_id",
                "references_schema": "auth",
                "references_table": "users",
                "references_column": "id",
                "on_delete": "CASCADE"
            },
            {
                "column": "tourist_profile_id",
                "references_schema": "public",
                "references_table": "tourist_profiles",
                "references_column": "id",
                "on_delete": "CASCADE"
            },
            {
                "column": "authority_id",
                "references_schema": "public",
                "references_table": "authorities",
                "references_column": "authority_id",
                "on_delete": "CASCADE"
            }
        ],
        "constraints": {
            "chk_authentication_type": "CHECK ((tourist_profile_id IS NOT NULL AND authority_id IS NULL) OR (tourist_profile_id IS NULL AND authority_id IS NOT NULL))"
        },
        "indexes": {
            "idx_authentication_username": "username",
            "idx_authentication_tourist_profile_id": "tourist_profile_id",
            "idx_authentication_authority_id": "authority_id"
        }
    },
    "points_of_interest": {
        "columns": {
            "poi_id": {"type": "UUID", "default": "gen_random_uuid()", "nullable": False},
            "name": {"type": "VARCHAR(255)", "nullable": False},
            "latitude": {"type": "DECIMAL(10,7)", "nullable": False},
            "longitude": {"type": "DECIMAL(10,7)", "nullable": False},
            "risk_level": {"type": "VARCHAR(50)", "nullable": False},
            "recorded_at": {"type": "TIMESTAMPTZ", "default": "NOW()", "nullable": False}
        },
        "primary_key": "poi_id",
        "uniques": [],
        "foreign_keys": [],
        "constraints": {
            "chk_points_of_interest_coords": "CHECK (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)"
        },
        "indexes": {
            "idx_points_of_interest_coords": "latitude, longitude"
        }
    },
    "locations": {
        "columns": {
            "id": {"type": "UUID", "default": "gen_random_uuid()", "nullable": False},
            "tourist_id": {"type": "UUID", "nullable": False},
            "latitude": {"type": "DECIMAL(10,7)", "nullable": False},
            "longitude": {"type": "DECIMAL(10,7)", "nullable": False},
            "speed": {"type": "DECIMAL(6,2)", "nullable": True},
            "heading": {"type": "DECIMAL(6,2)", "nullable": True},
            "geom": {"type": "GEOMETRY(Point,4326)", "nullable": True},
            "recorded_at": {"type": "TIMESTAMPTZ", "default": "NOW()", "nullable": False}
        },
        "primary_key": "id",
        "uniques": [],
        "foreign_keys": [
            {
                "column": "tourist_id",
                "references_schema": "public",
                "references_table": "tourist_profiles",
                "references_column": "id",
                "on_delete": "CASCADE"
            }
        ],
        "constraints": {
            "chk_locations_coords": "CHECK (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)"
        },
        "indexes": {
            "idx_locations_tourist_id": "tourist_id",
            "idx_locations_recorded_at": "recorded_at",
            "idx_locations_geom": "geom USING GIST",
            # Supports GET /authority/locations/live's
            # "DISTINCT ON (tourist_id) ... ORDER BY tourist_id, recorded_at DESC"
            # query — the two existing single-column indexes above can't
            # satisfy that access pattern efficiently on their own; Postgres
            # would still need a sort/scan across every row per tourist.
            # This composite index lets it walk straight to each tourist's
            # single latest row instead.
            "idx_locations_tourist_recorded": "tourist_id, recorded_at DESC"
        }
    },
    "geofences": {
        "columns": {
            "id": {"type": "UUID", "default": "gen_random_uuid()", "nullable": False},
            "name": {"type": "VARCHAR(255)", "nullable": False},
            "zone_type": {"type": "VARCHAR(50)", "nullable": False},
            "coordinates": {"type": "JSONB", "nullable": False},
            "geom": {"type": "GEOMETRY(Polygon,4326)", "nullable": True},
            "is_active": {"type": "BOOLEAN", "default": "TRUE", "nullable": False},
            "created_at": {"type": "TIMESTAMPTZ", "default": "NOW()", "nullable": False},
            # --- Merged from location-geofencing-backend-main (migration
            # 003_geofence_engine_merge.sql). Additive only — every existing
            # POLYGON/SAFE|BUFFER|RESTRICTED geofence row keeps working
            # unchanged (geometry_type defaults to 'POLYGON'). ---
            "geometry_type": {"type": "VARCHAR(16)", "default": "'POLYGON'", "nullable": False},
            "center_lat": {"type": "DOUBLE PRECISION", "nullable": True},
            "center_lng": {"type": "DOUBLE PRECISION", "nullable": True},
            "radius_m": {"type": "DOUBLE PRECISION", "nullable": True},
            "severity": {"type": "VARCHAR(16)", "default": "'MEDIUM'", "nullable": False},
            "warning_message": {"type": "TEXT", "nullable": True},
            "is_crowd_zone": {"type": "BOOLEAN", "default": "FALSE", "nullable": False}
        },
        "primary_key": "id",
        "uniques": [],
        "foreign_keys": [],
        "constraints": {
            # Widened (not replaced) in migration 003 to also allow Tanvi's
            # UNSAFE/WARNING zone types alongside the original
            # SAFE/BUFFER/RESTRICTED set — schema_manager.py only ever ADDS
            # a constraint by name, it never edits an existing one in
            # place, so the actual DROP+ADD for existing databases lives in
            # the migration file, not here. This entry reflects the target
            # state for schema_manager's on-conflict-skip check and for
            # fresh databases created via generate_sql_migration.py.
            "chk_geofences_zone_type": "CHECK (zone_type IN ('SAFE','BUFFER','RESTRICTED','UNSAFE','WARNING'))",
            "chk_geofences_geometry_type": "CHECK (geometry_type IN ('CIRCLE','POLYGON'))",
            "chk_geofences_severity": "CHECK (severity IN ('LOW','MEDIUM','HIGH','CRITICAL'))"
        },
        "indexes": {
            "idx_geofences_zone_type": "zone_type",
            "idx_geofences_geom": "geom USING GIST"
        }
    },
    "geofence_breaches": {
        "columns": {
            "id": {"type": "UUID", "default": "gen_random_uuid()", "nullable": False},
            "tourist_id": {"type": "UUID", "nullable": False},
            "geofence_id": {"type": "UUID", "nullable": False},
            "latitude": {"type": "DECIMAL(10,7)", "nullable": False},
            "longitude": {"type": "DECIMAL(10,7)", "nullable": False},
            "breach_time": {"type": "TIMESTAMPTZ", "default": "NOW()", "nullable": False},
            "sms_sent": {"type": "BOOLEAN", "default": "FALSE", "nullable": False},
            # --- Merged from Tanvi's geofence_events model (migration 003).
            # Rather than a separate public.geofence_events table duplicating
            # this one, breach rows now carry event_type/severity/message
            # directly — geofence_breaches was already the single record of
            # a tourist crossing into a hazard zone, this just enriches it. ---
            "event_type": {"type": "VARCHAR(32)", "default": "'ENTERED'", "nullable": False},
            "severity": {"type": "VARCHAR(16)", "default": "'MEDIUM'", "nullable": False},
            "message": {"type": "TEXT", "nullable": True}
        },
        "primary_key": "id",
        "uniques": [],
        "foreign_keys": [
            {
                "column": "tourist_id",
                "references_schema": "public",
                "references_table": "tourist_profiles",
                "references_column": "id",
                "on_delete": "CASCADE"
            },
            {
                "column": "geofence_id",
                "references_schema": "public",
                "references_table": "geofences",
                "references_column": "id",
                "on_delete": "CASCADE"
            }
        ],
        "constraints": {},
        "indexes": {
            "idx_geofence_breaches_tourist_id": "tourist_id",
            "idx_geofence_breaches_geofence_id": "geofence_id",
            "idx_geofence_breaches_breach_time": "breach_time"
        }
    },
    "itineraries": {
        "columns": {
            "id": {"type": "UUID", "default": "gen_random_uuid()", "nullable": False},
            "tourist_id": {"type": "UUID", "nullable": False},
            "title": {"type": "VARCHAR(255)", "nullable": False},
            "destinations": {"type": "JSONB", "default": "'[]'::jsonb", "nullable": False},
            "start_date": {"type": "DATE", "nullable": True},
            "end_date": {"type": "DATE", "nullable": True},
            "created_at": {"type": "TIMESTAMPTZ", "default": "NOW()", "nullable": False}
        },
        "primary_key": "id",
        "uniques": [],
        "foreign_keys": [
            {
                "column": "tourist_id",
                "references_schema": "public",
                "references_table": "tourist_profiles",
                "references_column": "id",
                "on_delete": "CASCADE"
            }
        ],
        "constraints": {
            "chk_itineraries_dates": "CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date)"
        },
        "indexes": {
            "idx_itineraries_tourist_id": "tourist_id"
        }
    },
    "incidents": {
        "columns": {
            "id": {"type": "UUID", "default": "gen_random_uuid()", "nullable": False},
            "incident_type": {"type": "VARCHAR(50)", "nullable": False},
            "tourist_id": {"type": "UUID", "nullable": False},
            "latitude": {"type": "DECIMAL(10,7)", "nullable": False},
            "longitude": {"type": "DECIMAL(10,7)", "nullable": False},
            "ai_risk_score": {"type": "SMALLINT", "nullable": True},
            "priority": {"type": "VARCHAR(20)", "nullable": False, "default": "'LOW'"},
            "status": {"type": "VARCHAR(50)", "nullable": False, "default": "'OPEN'"},
            "description": {"type": "TEXT", "nullable": True},
            "assigned_officer_id": {"type": "UUID", "nullable": True},
            "created_at": {"type": "TIMESTAMPTZ", "default": "NOW()", "nullable": False}
        },
        "primary_key": "id",
        "uniques": [],
        "foreign_keys": [
            {
                "column": "tourist_id",
                "references_schema": "public",
                "references_table": "tourist_profiles",
                "references_column": "id",
                "on_delete": "CASCADE"
            },
            {
                "column": "assigned_officer_id",
                "references_schema": "public",
                "references_table": "authorities",
                "references_column": "authority_id",
                "on_delete": "SET NULL"
            }
        ],
        "constraints": {
            "chk_incidents_type": "CHECK (incident_type IN ('SOS','GEOFENCE_BREACH','MANUAL'))",
            "chk_incidents_priority": "CHECK (priority IN ('LOW','MEDIUM','HIGH','CRITICAL'))",
            "chk_incidents_status": "CHECK (status IN ('OPEN','INVESTIGATING','RESOLVED'))",
            "chk_incidents_risk_score": "CHECK (ai_risk_score IS NULL OR ai_risk_score BETWEEN 1 AND 100)"
        },
        "indexes": {
            "idx_incidents_status": "status",
            "idx_incidents_priority": "priority",
            "idx_incidents_created_at": "created_at",
            "idx_incidents_tourist_id": "tourist_id"
        }
    },
    "alerts": {
        "columns": {
            "alert_id": {"type": "UUID", "default": "gen_random_uuid()", "nullable": False},
            "incident_id": {"type": "UUID", "nullable": False},
            "authority_id": {"type": "UUID", "nullable": True},
            "channel": {"type": "VARCHAR(50)", "nullable": False},
            "recipient": {"type": "VARCHAR(255)", "nullable": False},
            "sent_at": {"type": "TIMESTAMPTZ", "default": "NOW()", "nullable": False}
        },
        "primary_key": "alert_id",
        "uniques": [],
        "foreign_keys": [
            {
                "column": "incident_id",
                "references_schema": "public",
                "references_table": "incidents",
                "references_column": "id",
                "on_delete": "CASCADE"
            },
            {
                "column": "authority_id",
                "references_schema": "public",
                "references_table": "authorities",
                "references_column": "authority_id",
                "on_delete": "SET NULL"
            }
        ],
        "constraints": {},
        "indexes": {}
    },
    "responses": {
        "columns": {
            "response_id": {"type": "UUID", "default": "gen_random_uuid()", "nullable": False},
            "incident_id": {"type": "UUID", "nullable": False},
            "responder_unit": {"type": "VARCHAR(255)", "nullable": True},
            "action_taken": {"type": "TEXT", "nullable": True},
            "resolved_at": {"type": "TIMESTAMPTZ", "nullable": True},
            "authority_id": {"type": "UUID", "nullable": False}
        },
        "primary_key": "response_id",
        "uniques": [],
        "foreign_keys": [
            {
                "column": "incident_id",
                "references_schema": "public",
                "references_table": "incidents",
                "references_column": "id",
                "on_delete": "CASCADE"
            },
            {
                "column": "authority_id",
                "references_schema": "public",
                "references_table": "authorities",
                "references_column": "authority_id",
                "on_delete": "CASCADE"
            }
        ],
        "constraints": {},
        "indexes": {}
    },
    "sos_requests": {
        "columns": {
            "sos_id": {"type": "UUID", "default": "gen_random_uuid()", "nullable": False},
            "tourist_id": {"type": "UUID", "nullable": False},
            "incident_id": {"type": "UUID", "nullable": True},
            "latitude": {"type": "DECIMAL(10,7)", "nullable": False},
            "longitude": {"type": "DECIMAL(10,7)", "nullable": False},
            "battery_status": {"type": "SMALLINT", "nullable": True},
            "authority_id": {"type": "UUID", "nullable": True},
            "triggered_at": {"type": "TIMESTAMPTZ", "default": "NOW()", "nullable": False},
            "trigger_source": {"type": "VARCHAR(100)", "nullable": False},
            "sos_status": {"type": "VARCHAR(50)", "nullable": False, "default": "'PENDING'"}
        },
        "primary_key": "sos_id",
        "uniques": [],
        "foreign_keys": [
            {
                "column": "tourist_id",
                "references_schema": "public",
                "references_table": "tourist_profiles",
                "references_column": "id",
                "on_delete": "CASCADE"
            },
            {
                "column": "incident_id",
                "references_schema": "public",
                "references_table": "incidents",
                "references_column": "id",
                "on_delete": "CASCADE"
            },
            {
                "column": "authority_id",
                "references_schema": "public",
                "references_table": "authorities",
                "references_column": "authority_id",
                "on_delete": "SET NULL"
            }
        ],
        "constraints": {
            "chk_sos_requests_status": "CHECK (sos_status IN ('PENDING','ACKNOWLEDGED','DISPATCHED','RESOLVED'))"
        },
        "indexes": {
            "idx_sos_requests_tourist_id": "tourist_id",
            "idx_sos_requests_status": "sos_status"
        }
    },
    "audit_logs": {
        "columns": {
            "audit_id": {"type": "UUID", "default": "gen_random_uuid()", "nullable": False},
            "authority_id": {"type": "UUID", "nullable": False},
            "action_type": {"type": "VARCHAR(50)", "nullable": False},
            "target_id": {"type": "VARCHAR(255)", "nullable": False},
            "reason": {"type": "TEXT", "nullable": True},
            "details": {"type": "TEXT", "nullable": True},
            "ip_address": {"type": "VARCHAR(64)", "nullable": True},
            "created_at": {"type": "TIMESTAMPTZ", "default": "NOW()", "nullable": False}
        },
        "primary_key": "audit_id",
        "uniques": [],
        "foreign_keys": [
            {
                "column": "authority_id",
                "references_schema": "public",
                "references_table": "authorities",
                "references_column": "authority_id",
                "on_delete": "CASCADE"
            }
        ],
        "constraints": {},
        "indexes": {
            "idx_audit_logs_authority_id": "authority_id",
            "idx_audit_logs_created_at": "created_at"
        }
    },
    "chain_blocks": {
        # Offline-fallback ledger (migration 004_kyc_blockchain_anchoring.sql).
        # Ported from location-geofencing-backend-main/app/identity/chain.py's
        # append-only, SHA-256 hash-linked block pattern, rewritten against
        # this table instead of a SQLAlchemy model. Used by
        # backend/blockchain/mock_adapter.py whenever no Sepolia RPC
        # URL/private key is configured (local dev, offline demo), so a KYC
        # verification always gets an anchor record even without testnet
        # access. Real Sepolia anchors (backend/blockchain/sepolia_adapter.py)
        # write tx hash/block number directly onto tourist_profiles instead
        # and do not use this table.
        "columns": {
            "block_index": {"type": "INTEGER", "nullable": False},
            "timestamp": {"type": "TIMESTAMPTZ", "default": "NOW()", "nullable": False},
            "data": {"type": "TEXT", "nullable": False},
            "previous_hash": {"type": "VARCHAR(64)", "nullable": False},
            "hash": {"type": "VARCHAR(64)", "nullable": False}
        },
        "primary_key": "block_index",
        "uniques": [],
        "foreign_keys": [],
        "constraints": {},
        "indexes": {}
    }
}
