# Programmatic Database Schema Definitions for Suraksha Setu

TABLES = {
    "tourists": {
        "columns": {
            "tourist_id": {"type": "UUID", "default": "gen_random_uuid()", "nullable": False},
            "auth_user_id": {"type": "UUID", "nullable": True},
            "digital_id": {"type": "VARCHAR(255)", "nullable": True},
            "full_name": {"type": "VARCHAR(255)", "nullable": False},
            "kyc_document_type": {"type": "VARCHAR(100)", "nullable": True},
            "kyc_verified": {"type": "BOOLEAN", "default": "FALSE", "nullable": False},
            "phone": {"type": "VARCHAR(30)", "nullable": True},
            "email": {"type": "VARCHAR(255)", "nullable": True},
            "emergency_contact": {"type": "VARCHAR(255)", "nullable": True},
            "preferred_language": {"type": "VARCHAR(100)", "nullable": True},
            "created_at": {"type": "TIMESTAMPTZ", "default": "NOW()", "nullable": False}
        },
        "primary_key": "tourist_id",
        "uniques": ["auth_user_id", "digital_id"],
        "foreign_keys": [
            {
                "column": "auth_user_id",
                "references_schema": "auth",
                "references_table": "users",
                "references_column": "id",
                "on_delete": "CASCADE"
            }
        ],
        "constraints": {
            "chk_tourists_kyc": "CHECK (kyc_verified = FALSE OR kyc_document_type IS NOT NULL)"
        },
        "indexes": {
            "idx_tourists_auth_user_id": "auth_user_id",
            "idx_tourists_digital_id": "digital_id"
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
            "tourist_id": {"type": "UUID", "nullable": True},
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
                "column": "tourist_id",
                "references_schema": "public",
                "references_table": "tourists",
                "references_column": "tourist_id",
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
            "chk_authentication_type": "CHECK ((tourist_id IS NOT NULL AND authority_id IS NULL) OR (tourist_id IS NULL AND authority_id IS NOT NULL))"
        },
        "indexes": {
            "idx_authentication_username": "username",
            "idx_authentication_tourist_id": "tourist_id",
            "idx_authentication_authority_id": "authority_id"
        }
    },
    "locations": {
        "columns": {
            "location_id": {"type": "UUID", "default": "gen_random_uuid()", "nullable": False},
            "name": {"type": "VARCHAR(255)", "nullable": False},
            "latitude": {"type": "DECIMAL(10,7)", "nullable": False},
            "longitude": {"type": "DECIMAL(10,7)", "nullable": False},
            "risk_level": {"type": "VARCHAR(50)", "nullable": False},
            "recorded_at": {"type": "TIMESTAMPTZ", "default": "NOW()", "nullable": False}
        },
        "primary_key": "location_id",
        "uniques": [],
        "foreign_keys": [],
        "constraints": {
            "chk_locations_coords": "CHECK (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180)"
        },
        "indexes": {
            "idx_locations_coords": "latitude, longitude"
        }
    },
    "itinerary_entries": {
        "columns": {
            "itinerary_id": {"type": "UUID", "default": "gen_random_uuid()", "nullable": False},
            "tourist_id": {"type": "UUID", "nullable": False},
            "location_id": {"type": "UUID", "nullable": False},
            "planned_arrival": {"type": "TIMESTAMPTZ", "nullable": True},
            "planned_departure": {"type": "TIMESTAMPTZ", "nullable": True}
        },
        "primary_key": "itinerary_id",
        "uniques": [],
        "foreign_keys": [
            {
                "column": "tourist_id",
                "references_schema": "public",
                "references_table": "tourists",
                "references_column": "tourist_id",
                "on_delete": "CASCADE"
            },
            {
                "column": "location_id",
                "references_schema": "public",
                "references_table": "locations",
                "references_column": "location_id",
                "on_delete": "CASCADE"
            }
        ],
        "constraints": {
            "chk_itinerary_entries_dates": "CHECK (planned_arrival IS NULL OR planned_departure IS NULL OR planned_departure >= planned_arrival)"
        },
        "indexes": {
            "idx_itinerary_entries_tourist_id": "tourist_id"
        }
    },
    "incidents": {
        "columns": {
            "incident_id": {"type": "UUID", "default": "gen_random_uuid()", "nullable": False},
            "tourist_id": {"type": "UUID", "nullable": False},
            "location_id": {"type": "UUID", "nullable": False},
            "incident_type": {"type": "VARCHAR(100)", "nullable": False},
            "severity": {"type": "VARCHAR(50)", "nullable": False},
            "status": {"type": "VARCHAR(50)", "nullable": False},
            "description": {"type": "TEXT", "nullable": True},
            "created_at": {"type": "TIMESTAMPTZ", "default": "NOW()", "nullable": False},
            "authority_id": {"type": "UUID", "nullable": True}
        },
        "primary_key": "incident_id",
        "uniques": [],
        "foreign_keys": [
            {
                "column": "tourist_id",
                "references_schema": "public",
                "references_table": "tourists",
                "references_column": "tourist_id",
                "on_delete": "CASCADE"
            },
            {
                "column": "location_id",
                "references_schema": "public",
                "references_table": "locations",
                "references_column": "location_id",
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
        "indexes": {
            "idx_incidents_status": "status",
            "idx_incidents_created_at": "created_at"
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
                "references_column": "incident_id",
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
                "references_column": "incident_id",
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
            "location_id": {"type": "UUID", "nullable": False},
            "authority_id": {"type": "UUID", "nullable": True},
            "triggered_at": {"type": "TIMESTAMPTZ", "default": "NOW()", "nullable": False},
            "trigger_source": {"type": "VARCHAR(100)", "nullable": False},
            "sos_status": {"type": "VARCHAR(50)", "nullable": False}
        },
        "primary_key": "sos_id",
        "uniques": [],
        "foreign_keys": [
            {
                "column": "tourist_id",
                "references_schema": "public",
                "references_table": "tourists",
                "references_column": "tourist_id",
                "on_delete": "CASCADE"
            },
            {
                "column": "incident_id",
                "references_schema": "public",
                "references_table": "incidents",
                "references_column": "incident_id",
                "on_delete": "CASCADE"
            },
            {
                "column": "location_id",
                "references_schema": "public",
                "references_table": "locations",
                "references_column": "location_id",
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
    }
}
