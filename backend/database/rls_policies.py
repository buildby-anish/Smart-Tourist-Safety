# Row Level Security policies for Suraksha Setu.
#
# IMPORTANT CONTEXT: db.get_authenticated_cursor() genuinely sets
# `SET LOCAL ROLE authenticated` + `request.jwt.claims` on every request
# that uses it (see routers/*.py), so RLS is actively enforced against this
# backend's own queries, not just against direct Supabase client access.
# schema_manager.py enables RLS and grants table privileges to the
# `authenticated` role for every table, but — before this file — created no
# actual POLICY rows. Postgres's default behavior when RLS is enabled with
# zero policies is DENY ALL, for every role including one with table
# privileges. That means every authenticated query in this entire backend
# (a tourist reading their own profile, an authority reading incidents,
# etc.) would silently return zero rows against a real database with RLS
# enforced — a correctness bug that mock-offline-mode testing can never
# catch, since mock mode skips the database entirely.
#
# Each policy's `using_expr` governs which existing rows are visible/
# targetable (SELECT/UPDATE/DELETE); `check_expr` governs which new/changed
# row values are allowed (INSERT/UPDATE). `auth.uid()` is Supabase's
# built-in function returning the current JWT's `sub` claim, which this
# backend sets to `auth_user_id` — the same value stored in
# tourist_profiles.user_id / authorities.auth_user_id.

# NOTE: this used to be a raw
# "EXISTS (SELECT 1 FROM public.authorities a WHERE a.auth_user_id = auth.uid())"
# subquery. Because it's also used *on the authorities table's own SELECT
# policy* (below), that raw form caused Postgres to re-evaluate the
# authorities SELECT policy every time it checked whether the row was
# visible — infinite recursion ("infinite recursion detected in policy for
# relation \"authorities\""). public.is_authority() (created in
# schema_manager.py as a SECURITY DEFINER function) does the same check but
# runs with the function owner's privileges, so it doesn't re-trigger RLS on
# authorities. Every policy below must go through this function rather than
# querying public.authorities directly.
_IS_AUTHORITY = "public.is_authority(auth.uid())"
_OWN_TOURIST_PROFILE_ID = "(SELECT tp.id FROM public.tourist_profiles tp WHERE tp.user_id = auth.uid())"

POLICIES: dict[str, list[dict]] = {
    "tourist_profiles": [
        {"name": "select_own_or_authority", "cmd": "SELECT", "using": f"user_id = auth.uid() OR {_IS_AUTHORITY}"},
        {"name": "insert_own", "cmd": "INSERT", "check": "user_id = auth.uid()"},
        {"name": "update_own", "cmd": "UPDATE", "using": "user_id = auth.uid()", "check": "user_id = auth.uid()"},
    ],
    "authorities": [
        {"name": "select_any_authority", "cmd": "SELECT", "using": _IS_AUTHORITY},
        {"name": "insert_own", "cmd": "INSERT", "check": "auth_user_id = auth.uid()"},
        {"name": "update_own", "cmd": "UPDATE", "using": "auth_user_id = auth.uid()", "check": "auth_user_id = auth.uid()"},
    ],
    "authentication": [
        # Login/registration run through the service-role connection
        # (db.get_db_cursor(), not get_authenticated_cursor()) since a
        # session doesn't exist yet at that point — these policies exist
        # for defense-in-depth / any future authenticated-role access,
        # not because the current login flow depends on them.
        {"name": "select_own", "cmd": "SELECT", "using": "auth_user_id = auth.uid()"},
    ],
    "points_of_interest": [
        {"name": "select_all_authenticated", "cmd": "SELECT", "using": "true"},
    ],
    "locations": [
        {"name": "select_own_or_authority", "cmd": "SELECT", "using": f"tourist_id = {_OWN_TOURIST_PROFILE_ID} OR {_IS_AUTHORITY}"},
        {"name": "insert_own", "cmd": "INSERT", "check": f"tourist_id = {_OWN_TOURIST_PROFILE_ID}"},
    ],
    "geofences": [
        {"name": "select_all_authenticated", "cmd": "SELECT", "using": "true"},
        {"name": "authority_insert", "cmd": "INSERT", "check": _IS_AUTHORITY},
        {"name": "authority_update", "cmd": "UPDATE", "using": _IS_AUTHORITY, "check": _IS_AUTHORITY},
        {"name": "authority_delete", "cmd": "DELETE", "using": _IS_AUTHORITY},
    ],
    "geofence_breaches": [
        {"name": "select_own_or_authority", "cmd": "SELECT", "using": f"tourist_id = {_OWN_TOURIST_PROFILE_ID} OR {_IS_AUTHORITY}"},
        # Inserted by routers/locations.py's evaluate_geofence_breaches(),
        # which runs inside the reporting tourist's own authenticated
        # cursor — so the insert must be allowed for the tourist, not just
        # an authority.
        {"name": "insert_own", "cmd": "INSERT", "check": f"tourist_id = {_OWN_TOURIST_PROFILE_ID}"},
    ],
    "itineraries": [
        {"name": "full_access_own", "cmd": "ALL", "using": f"tourist_id = {_OWN_TOURIST_PROFILE_ID}", "check": f"tourist_id = {_OWN_TOURIST_PROFILE_ID}"},
    ],
    "incidents": [
        {"name": "select_own_or_authority", "cmd": "SELECT", "using": f"tourist_id = {_OWN_TOURIST_PROFILE_ID} OR {_IS_AUTHORITY}"},
        {"name": "insert_own_or_authority", "cmd": "INSERT", "check": f"tourist_id = {_OWN_TOURIST_PROFILE_ID} OR {_IS_AUTHORITY}"},
        {"name": "authority_update", "cmd": "UPDATE", "using": _IS_AUTHORITY, "check": _IS_AUTHORITY},
    ],
    "alerts": [
        {"name": "authority_only", "cmd": "ALL", "using": _IS_AUTHORITY, "check": _IS_AUTHORITY},
    ],
    "responses": [
        {"name": "authority_only", "cmd": "ALL", "using": _IS_AUTHORITY, "check": _IS_AUTHORITY},
    ],
    "sos_requests": [
        {"name": "select_own_or_authority", "cmd": "SELECT", "using": f"tourist_id = {_OWN_TOURIST_PROFILE_ID} OR {_IS_AUTHORITY}"},
        {"name": "insert_own", "cmd": "INSERT", "check": f"tourist_id = {_OWN_TOURIST_PROFILE_ID}"},
    ],
    "audit_logs": [
        {"name": "authority_only", "cmd": "ALL", "using": _IS_AUTHORITY, "check": _IS_AUTHORITY},
    ],
}
