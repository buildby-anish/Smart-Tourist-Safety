"""
Generates the complete Supabase SQL migration script (directive Phase 4)
directly from database/schema_definition.py and database/rls_policies.py —
the same data structures schema_manager.py uses to build the schema at
runtime — so the exported .sql file can never drift out of sync with what
the running application actually creates.

Usage: python3 generate_sql_migration.py > database/migrations/002_directive_schema.sql
"""
from database.schema_definition import TABLES
from database.rls_policies import POLICIES


def emit_extensions() -> str:
    return (
        "-- ============================================================\n"
        "-- Extensions\n"
        "-- ============================================================\n"
        'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";\n'
        'CREATE EXTENSION IF NOT EXISTS "pgcrypto";\n'
        'CREATE EXTENSION IF NOT EXISTS "postgis";\n\n'
    )


def emit_table(table_name: str, info: dict) -> str:
    lines = [f"-- {table_name}\n", f"CREATE TABLE IF NOT EXISTS public.{table_name} (\n"]
    col_defs = []
    for col_name, col_config in info["columns"].items():
        line = f"    {col_name} {col_config['type']}"
        if col_config.get("default"):
            line += f" DEFAULT {col_config['default']}"
        if not col_config.get("nullable", True):
            line += " NOT NULL"
        col_defs.append(line)
    if "primary_key" in info:
        col_defs.append(f"    PRIMARY KEY ({info['primary_key']})")
    lines.append(",\n".join(col_defs))
    lines.append("\n);\n")
    return "".join(lines)


def emit_constraints(table_name: str, info: dict) -> str:
    out = []
    for col in info.get("uniques", []):
        out.append(
            f"ALTER TABLE public.{table_name} ADD CONSTRAINT uq_{table_name}_{col} UNIQUE ({col});\n"
        )
    for name, expr in info.get("constraints", {}).items():
        out.append(f"ALTER TABLE public.{table_name} ADD CONSTRAINT {name} {expr};\n")
    return "".join(out)


def emit_foreign_keys(table_name: str, info: dict) -> str:
    out = []
    for fk in info.get("foreign_keys", []):
        col = fk["column"]
        ref_schema = fk["references_schema"]
        ref_table = fk["references_table"]
        ref_col = fk["references_column"]
        on_delete = fk.get("on_delete", "NO ACTION")
        out.append(
            f"ALTER TABLE public.{table_name} ADD CONSTRAINT fk_{table_name}_{col} "
            f"FOREIGN KEY ({col}) REFERENCES {ref_schema}.{ref_table}({ref_col}) ON DELETE {on_delete};\n"
        )
    return "".join(out)


def emit_indexes(table_name: str, info: dict) -> str:
    out = []
    for index_name, col_expr in info.get("indexes", {}).items():
        out.append(f"CREATE INDEX IF NOT EXISTS {index_name} ON public.{table_name}({col_expr});\n")
    return "".join(out)


def emit_rls(table_name: str) -> str:
    return (
        f"ALTER TABLE public.{table_name} ENABLE ROW LEVEL SECURITY;\n"
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON public.{table_name} TO authenticated;\n"
    )


def emit_is_authority_function() -> str:
    return (
        "-- SECURITY DEFINER helper for every \"is the current user an\n"
        "-- authority?\" RLS check. MUST be created before the policies below,\n"
        "-- several of which call it by name. A raw\n"
        "-- 'EXISTS (SELECT 1 FROM public.authorities ...)' subquery inlined\n"
        "-- directly into authorities' own SELECT policy (and into every other\n"
        "-- table's \"OR is an authority\" checks) re-triggers RLS on\n"
        "-- authorities every time it runs, causing \"infinite recursion\n"
        "-- detected in policy for relation \\\"authorities\\\"\". A SECURITY\n"
        "-- DEFINER function evaluates with the function owner's privileges\n"
        "-- instead of the calling role's, so it doesn't re-invoke that policy.\n"
        "CREATE OR REPLACE FUNCTION public.is_authority(uid uuid)\n"
        "RETURNS boolean\n"
        "LANGUAGE sql\n"
        "SECURITY DEFINER\n"
        "SET search_path = public\n"
        "STABLE\n"
        "AS $$\n"
        "    SELECT EXISTS (SELECT 1 FROM public.authorities a WHERE a.auth_user_id = uid);\n"
        "$$;\n\n"
    )


def emit_policies(table_name: str, policies: list[dict]) -> str:
    out = []
    for p in policies:
        # DROP POLICY IF EXISTS first so re-running this file against an
        # already-migrated database replaces a stale/broken policy
        # definition (e.g. the infinite-recursion fix below) instead of
        # silently no-opping because a same-named policy already exists.
        out.append(f"DROP POLICY IF EXISTS {p['name']} ON public.{table_name};\n")
        stmt = f"CREATE POLICY {p['name']} ON public.{table_name} FOR {p['cmd']} TO authenticated"
        if p.get("using"):
            stmt += f"\n    USING ({p['using']})"
        if p.get("check"):
            stmt += f"\n    WITH CHECK ({p['check']})"
        stmt += ";\n"
        out.append(stmt)
    return "".join(out)


def emit_trigger() -> str:
    return (
        "-- Keeps public.locations.geom in sync with latitude/longitude on\n"
        "-- every insert or update, regardless of which code path wrote the\n"
        "-- row (the FastAPI backend already sets geom explicitly, but any\n"
        "-- other write path — a direct Supabase client call, a manual SQL\n"
        "-- fix — would otherwise leave geom NULL and silently break the\n"
        "-- geofence ST_Contains breach check in routers/geofences.py).\n"
        "CREATE OR REPLACE FUNCTION public.sync_locations_geom() RETURNS trigger AS $$\n"
        "BEGIN\n"
        "    NEW.geom := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326);\n"
        "    RETURN NEW;\n"
        "END;\n"
        "$$ LANGUAGE plpgsql;\n\n"
        "DROP TRIGGER IF EXISTS trg_locations_sync_geom ON public.locations;\n"
        "CREATE TRIGGER trg_locations_sync_geom\n"
        "    BEFORE INSERT OR UPDATE OF latitude, longitude ON public.locations\n"
        "    FOR EACH ROW EXECUTE FUNCTION public.sync_locations_geom();\n"
    )


def generate() -> str:
    out = []
    out.append(
        "-- =================================================================\n"
        "-- Suraksha Setu — Complete Supabase SQL Migration (Directive Phase 4)\n"
        "-- Generated from backend/database/schema_definition.py and\n"
        "-- backend/database/rls_policies.py — the same source of truth the\n"
        "-- running FastAPI backend uses to build/verify this schema at boot\n"
        "-- (database/schema_manager.py). Regenerate with:\n"
        "--   python3 generate_sql_migration.py > database/migrations/002_directive_schema.sql\n"
        "-- Safe to run against a fresh database or an existing one — every\n"
        "-- statement is idempotent (IF NOT EXISTS / CREATE OR REPLACE), except\n"
        "-- constraint and policy additions, which fail loudly on a second run\n"
        "-- instead of silently duplicating (Postgres has no native\n"
        "-- 'ADD CONSTRAINT IF NOT EXISTS'); re-running this file against an\n"
        "-- already-migrated database is safe to ignore those specific errors.\n"
        "--\n"
        "-- NOTE: this file assumes a fresh schema. If migrating an existing\n"
        "-- pre-directive database with real data in the old table names,\n"
        "-- use backend/database/migration_v2.py instead (or first) — it\n"
        "-- renames tables/columns in place so existing rows survive, which\n"
        "-- this file's CREATE TABLE statements do not attempt.\n"
        "-- =================================================================\n\n"
    )
    out.append(emit_extensions())

    out.append("-- ============================================================\n")
    out.append("-- Tables\n")
    out.append("-- ============================================================\n")
    for name, info in TABLES.items():
        out.append(emit_table(name, info))
    out.append("\n")

    out.append("-- ============================================================\n")
    out.append("-- Unique & check constraints\n")
    out.append("-- ============================================================\n")
    for name, info in TABLES.items():
        out.append(emit_constraints(name, info))
    out.append("\n")

    out.append("-- ============================================================\n")
    out.append("-- Foreign keys\n")
    out.append("-- ============================================================\n")
    for name, info in TABLES.items():
        out.append(emit_foreign_keys(name, info))
    out.append("\n")

    out.append("-- ============================================================\n")
    out.append("-- Indexes\n")
    out.append("-- ============================================================\n")
    for name, info in TABLES.items():
        out.append(emit_indexes(name, info))
    out.append("\n")

    out.append("-- ============================================================\n")
    out.append("-- Row Level Security\n")
    out.append("-- ============================================================\n")
    for name in TABLES:
        out.append(emit_rls(name))
    out.append("\n")
    out.append(emit_is_authority_function())
    for name, policies in POLICIES.items():
        out.append(emit_policies(name, policies))
    out.append("\n")

    out.append("-- ============================================================\n")
    out.append("-- Triggers\n")
    out.append("-- ============================================================\n")
    out.append(emit_trigger())

    return "".join(out)


if __name__ == "__main__":
    print(generate())
