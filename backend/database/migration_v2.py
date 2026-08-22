# One-time, data-preserving migration from the pre-directive schema to the
# directive-aligned schema (see schema_definition.py header for the full
# mapping rationale). Runs once, before schema_manager's generic
# create/add pass, guarded so it is a no-op on a fresh database or on any
# subsequent boot after it has already run.
#
# This does NOT attempt geofences/geofence_breaches (new concepts, no old
# data to preserve) or the itineraries reshape (old itinerary_entries used
# a location_id FK to a POI; new itineraries uses a JSONB destinations
# blob — these are different enough shapes that a lossy structural
# rename would be worse than starting the new table empty and leaving
# old data queryable in itinerary_entries for manual review).

import logging

logger = logging.getLogger("database")


def _table_exists(cur, table_name: str) -> bool:
    cur.execute(
        """
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = %s
        );
        """,
        (table_name,),
    )
    return cur.fetchone()[0]


def _column_exists(cur, table_name: str, column_name: str) -> bool:
    cur.execute(
        """
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = %s AND column_name = %s
        );
        """,
        (table_name, column_name),
    )
    return cur.fetchone()[0]


def _migrate_tourists_to_tourist_profiles(cur):
    if not _table_exists(cur, "tourists") or _table_exists(cur, "tourist_profiles"):
        return
    logger.info("[MIGRATION v2] Renaming tourists -> tourist_profiles...")
    cur.execute("ALTER TABLE public.tourists RENAME TO tourist_profiles;")
    cur.execute("ALTER TABLE public.tourist_profiles RENAME COLUMN tourist_id TO id;")
    cur.execute("ALTER TABLE public.tourist_profiles RENAME COLUMN auth_user_id TO user_id;")
    cur.execute("ALTER TABLE public.tourist_profiles RENAME COLUMN phone TO phone_number;")
    # digital_id becomes the new human-readable tourist_id code; existing
    # values are preserved as-is even if they predate the TOUR-YYYY-HEX format.
    cur.execute("ALTER TABLE public.tourist_profiles RENAME COLUMN digital_id TO tourist_id;")
    # kyc_verified (bool) -> kyc_status (text): add the new column, backfill
    # from the old one, then drop the old one.
    if _column_exists(cur, "tourist_profiles", "kyc_verified") and not _column_exists(
        cur, "tourist_profiles", "kyc_status"
    ):
        cur.execute(
            "ALTER TABLE public.tourist_profiles ADD COLUMN kyc_status VARCHAR(50) NOT NULL DEFAULT 'PENDING';"
        )
        cur.execute(
            """
            UPDATE public.tourist_profiles
            SET kyc_status = CASE WHEN kyc_verified THEN 'VERIFIED' ELSE 'PENDING' END;
            """
        )
        cur.execute("ALTER TABLE public.tourist_profiles DROP COLUMN kyc_verified;")
    if _column_exists(cur, "tourist_profiles", "kyc_document_type"):
        cur.execute("ALTER TABLE public.tourist_profiles RENAME COLUMN kyc_document_type TO govt_id_type;")
    # emergency_contact (single VARCHAR) -> emergency_contacts (JSONB array).
    if _column_exists(cur, "tourist_profiles", "emergency_contact") and not _column_exists(
        cur, "tourist_profiles", "emergency_contacts"
    ):
        cur.execute(
            "ALTER TABLE public.tourist_profiles ADD COLUMN emergency_contacts JSONB NOT NULL DEFAULT '[]'::jsonb;"
        )
        cur.execute(
            """
            UPDATE public.tourist_profiles
            SET emergency_contacts = CASE
                WHEN emergency_contact IS NOT NULL AND emergency_contact <> ''
                THEN jsonb_build_array(jsonb_build_object(
                    'name', NULL, 'relation', NULL, 'phone', emergency_contact
                ))
                ELSE '[]'::jsonb
            END;
            """
        )
        cur.execute("ALTER TABLE public.tourist_profiles DROP COLUMN emergency_contact;")
    # username did not exist before; backfill from email/tourist_id so the
    # NOT NULL constraint the new schema adds doesn't fail on existing rows.
    if not _column_exists(cur, "tourist_profiles", "username"):
        cur.execute("ALTER TABLE public.tourist_profiles ADD COLUMN username VARCHAR(255);")
        cur.execute(
            """
            UPDATE public.tourist_profiles
            SET username = COALESCE(email, tourist_id, id::text)
            WHERE username IS NULL;
            """
        )
        cur.execute("ALTER TABLE public.tourist_profiles ALTER COLUMN username SET NOT NULL;")
    logger.info("[MIGRATION v2] tourists -> tourist_profiles migration complete.")


def _migrate_locations_to_points_of_interest(cur):
    # Only the OLD locations table (name/risk_level, no tourist_id column)
    # gets renamed. If a `locations` table already exists in the new shape
    # (has a tourist_id column), leave it alone — schema_manager created it.
    if not _table_exists(cur, "locations"):
        return
    if _column_exists(cur, "locations", "tourist_id"):
        return  # already the new-shape table
    if _table_exists(cur, "points_of_interest"):
        return
    logger.info("[MIGRATION v2] Renaming old locations (POI) -> points_of_interest...")
    cur.execute("ALTER TABLE public.locations RENAME TO points_of_interest;")
    cur.execute("ALTER TABLE public.points_of_interest RENAME COLUMN location_id TO poi_id;")
    logger.info("[MIGRATION v2] locations -> points_of_interest migration complete.")


def _migrate_incidents_columns(cur):
    if not _table_exists(cur, "incidents"):
        return
    if _column_exists(cur, "incidents", "incident_id") and not _column_exists(cur, "incidents", "id"):
        cur.execute("ALTER TABLE public.incidents RENAME COLUMN incident_id TO id;")
    if _column_exists(cur, "incidents", "severity") and not _column_exists(cur, "incidents", "priority"):
        cur.execute("ALTER TABLE public.incidents RENAME COLUMN severity TO priority;")
    # Old free-text incident_type values won't satisfy the new CHECK
    # (SOS/GEOFENCE_BREACH/MANUAL). Map anything unrecognized to MANUAL so
    # the constraint can be added without failing on legacy rows.
    cur.execute(
        """
        UPDATE public.incidents
        SET incident_type = 'MANUAL'
        WHERE incident_type NOT IN ('SOS','GEOFENCE_BREACH','MANUAL');
        """
    )
    # incidents previously had no latitude/longitude — it referenced a
    # location_id (POI) instead. Add the new columns; a follow-up backfill
    # from the old location_id join can be run manually if that history
    # matters, since the FK target (points_of_interest) is a different
    # concept than "where the incident happened."
    if _column_exists(cur, "incidents", "location_id") and not _column_exists(
        cur, "incidents", "latitude"
    ):
        cur.execute("ALTER TABLE public.incidents ADD COLUMN latitude DECIMAL(10,7);")
        cur.execute("ALTER TABLE public.incidents ADD COLUMN longitude DECIMAL(10,7);")
        cur.execute(
            """
            UPDATE public.incidents i
            SET latitude = p.latitude, longitude = p.longitude
            FROM public.points_of_interest p
            WHERE i.location_id = p.poi_id AND i.latitude IS NULL;
            """
        )
        logger.warning(
            "[MIGRATION v2] incidents.latitude/longitude backfilled from linked "
            "points_of_interest where possible. Rows with no matching POI (or "
            "no location_id) still have NULL coordinates and need manual review "
            "before the NOT NULL constraint can be safely enforced."
        )


def _migrate_sos_requests_columns(cur):
    if not _table_exists(cur, "sos_requests"):
        return
    if _column_exists(cur, "sos_requests", "location_id") and not _column_exists(
        cur, "sos_requests", "latitude"
    ):
        cur.execute("ALTER TABLE public.sos_requests ADD COLUMN latitude DECIMAL(10,7);")
        cur.execute("ALTER TABLE public.sos_requests ADD COLUMN longitude DECIMAL(10,7);")
        cur.execute(
            """
            UPDATE public.sos_requests s
            SET latitude = p.latitude, longitude = p.longitude
            FROM public.points_of_interest p
            WHERE s.location_id = p.poi_id AND s.latitude IS NULL;
            """
        )
        logger.warning(
            "[MIGRATION v2] sos_requests.latitude/longitude backfilled where a "
            "matching points_of_interest row existed. Remaining NULLs need "
            "manual review."
        )
    if not _column_exists(cur, "sos_requests", "battery_status"):
        cur.execute("ALTER TABLE public.sos_requests ADD COLUMN battery_status SMALLINT;")


def run_v2_migration(cur):
    """Entry point called once from schema_manager before the generic pass."""
    logger.info("[MIGRATION v2] Checking for legacy-schema tables to migrate...")
    _migrate_tourists_to_tourist_profiles(cur)
    _migrate_locations_to_points_of_interest(cur)
    _migrate_incidents_columns(cur)
    _migrate_sos_requests_columns(cur)
    logger.info("[MIGRATION v2] Legacy migration check complete.")
