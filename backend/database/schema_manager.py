# Automatic Database Schema Manager for Suraksha Setu

import logging
from db import is_db_active, get_db_cursor
from database.schema_definition import TABLES
from database.migration_v2 import run_v2_migration
from database.rls_policies import POLICIES

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("database")

def check_and_create_extensions(cur):
    """Safely attempts to create required extensions without crashing if privileges are restricted."""
    extensions = ["uuid-ossp", "pgcrypto"]
    for ext in extensions:
        try:
            cur.execute(f'CREATE EXTENSION IF NOT EXISTS "{ext}";')
            logger.info(f"[DATABASE] Extension {ext} verified/created.")
        except Exception as e:
            logger.warning(f"[DATABASE] Failed to check/create extension {ext}: {e}. Continuing...")

def table_exists(cur, table_name: str) -> bool:
    cur.execute("""
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name = %s
        );
    """, (table_name,))
    return cur.fetchone()[0]

def create_table(cur, table_name: str, table_info: dict):
    logger.info(f"[DATABASE] Creating table {table_name}...")
    col_defs = []
    for col_name, col_config in table_info["columns"].items():
        col_type = col_config["type"]
        default_expr = col_config.get("default")
        nullable = col_config.get("nullable", True)
        
        line = f"{col_name} {col_type}"
        if default_expr:
            line += f" DEFAULT {default_expr}"
        if not nullable:
            line += " NOT NULL"
        col_defs.append(line)
        
    if "primary_key" in table_info:
        col_defs.append(f"PRIMARY KEY ({table_info['primary_key']})")
        
    query = f"CREATE TABLE public.{table_name} (\n    " + ",\n    ".join(col_defs) + "\n);"
    cur.execute(query)
    logger.info(f"[DATABASE] Created table {table_name} successfully.")

def get_existing_columns(cur, table_name: str) -> dict:
    cur.execute("""
        SELECT column_name, data_type, is_nullable 
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = %s;
    """, (table_name,))
    return {row[0]: {"type": row[1], "nullable": row[2] == "YES"} for row in cur.fetchall()}

def add_column(cur, table_name: str, col_name: str, col_config: dict):
    logger.info(f"[DATABASE] Adding missing column {col_name} to table {table_name}...")
    col_type = col_config["type"]
    default_expr = col_config.get("default")
    nullable = col_config.get("nullable", True)
    
    query = f"ALTER TABLE public.{table_name} ADD COLUMN {col_name} {col_type}"
    if default_expr:
         query += f" DEFAULT {default_expr}"
    if not nullable:
         query += " NOT NULL"
         
    cur.execute(query)
    logger.info(f"[DATABASE] Added missing column {col_name} successfully.")

def unique_index_exists(cur, table_name: str, col_name: str) -> bool:
    # A unique constraint or index is represented in pg_indexes
    cur.execute("""
        SELECT EXISTS (
            SELECT 1 FROM pg_indexes 
            WHERE schemaname = 'public' 
              AND tablename = %s 
              AND indexdef LIKE 'CREATE UNIQUE INDEX%' 
              AND indexdef LIKE '%%(' || %s || ')%%'
        );
    """, (table_name, col_name))
    return cur.fetchone()[0]

def add_unique_constraint(cur, table_name: str, col_name: str):
    constraint_name = f"uq_{table_name}_{col_name}"
    logger.info(f"[DATABASE] Creating unique constraint {constraint_name} on {table_name}({col_name})...")
    query = f"ALTER TABLE public.{table_name} ADD CONSTRAINT {constraint_name} UNIQUE ({col_name});"
    cur.execute(query)
    logger.info(f"[DATABASE] Created unique constraint {constraint_name} successfully.")

def check_constraint_exists(cur, table_name: str, constraint_name: str) -> bool:
    cur.execute("""
        SELECT EXISTS (
            SELECT 1 FROM information_schema.table_constraints 
            WHERE table_schema = 'public' 
              AND table_name = %s 
              AND constraint_name = %s
        );
    """, (table_name, constraint_name))
    return cur.fetchone()[0]

def add_check_constraint(cur, table_name: str, constraint_name: str, check_expr: str):
    logger.info(f"[DATABASE] Adding check constraint {constraint_name} on table {table_name}...")
    query = f"ALTER TABLE public.{table_name} ADD CONSTRAINT {constraint_name} {check_expr};"
    cur.execute(query)
    logger.info(f"[DATABASE] Added check constraint {constraint_name} successfully.")

def foreign_key_exists(cur, table_name: str, col_name: str) -> bool:
    cur.execute("""
        SELECT EXISTS (
            SELECT 1 FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND tc.table_schema = 'public'
              AND tc.table_name = %s
              AND kcu.column_name = %s
        );
    """, (table_name, col_name))
    return cur.fetchone()[0]

def referenced_table_exists(cur, ref_schema: str, ref_table: str) -> bool:
    cur.execute("""
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables 
            WHERE table_schema = %s AND table_name = %s
        );
    """, (ref_schema, ref_table))
    return cur.fetchone()[0]

def add_foreign_key(cur, table_name: str, fk_info: dict):
    col = fk_info["column"]
    ref_schema = fk_info["references_schema"]
    ref_table = fk_info["references_table"]
    ref_col = fk_info["references_column"]
    on_delete = fk_info.get("on_delete", "NO ACTION")
    
    constraint_name = f"fk_{table_name}_{col}"
    
    if not referenced_table_exists(cur, ref_schema, ref_table):
        logger.warning(f"[DATABASE] Referenced table {ref_schema}.{ref_table} does not exist. "
                       f"Skipping foreign key {constraint_name} for now.")
        return
        
    logger.info(f"[DATABASE] Creating foreign key constraint {constraint_name} on {table_name}({col}) -> {ref_schema}.{ref_table}({ref_col})...")
    query = f"""
        ALTER TABLE public.{table_name} 
        ADD CONSTRAINT {constraint_name} 
        FOREIGN KEY ({col}) 
        REFERENCES {ref_schema}.{ref_table}({ref_col}) 
        ON DELETE {on_delete};
    """
    cur.execute(query)
    logger.info(f"[DATABASE] Created foreign key constraint {constraint_name} successfully.")

def index_exists(cur, table_name: str, index_name: str) -> bool:
    cur.execute("""
        SELECT EXISTS (
            SELECT 1 FROM pg_indexes 
            WHERE schemaname = 'public' 
              AND tablename = %s 
              AND indexname = %s
        );
    """, (table_name, index_name))
    return cur.fetchone()[0]

def create_index(cur, table_name: str, index_name: str, col_expr: str):
    logger.info(f"[DATABASE] Creating missing index {index_name} on {table_name}({col_expr})...")
    query = f"CREATE INDEX {index_name} ON public.{table_name}({col_expr});"
    cur.execute(query)
    logger.info(f"[DATABASE] Created index {index_name} successfully.")

def policy_exists(cur, table_name: str, policy_name: str) -> bool:
    cur.execute("""
        SELECT EXISTS (
            SELECT 1 FROM pg_policies
            WHERE schemaname = 'public' AND tablename = %s AND policyname = %s
        );
    """, (table_name, policy_name))
    return cur.fetchone()[0]

def create_policy(cur, table_name: str, policy: dict):
    """
    Creates one RLS policy. See database/rls_policies.py for why these
    matter: RLS enabled with zero policies denies all access, even for a
    role with GRANTed table privileges.
    """
    name = policy["name"]
    cmd = policy["cmd"]
    using_expr = policy.get("using")
    check_expr = policy.get("check")

    logger.info(f"[DATABASE] Creating RLS policy {name} ({cmd}) on {table_name}...")
    query = f"CREATE POLICY {name} ON public.{table_name} FOR {cmd} TO authenticated"
    if using_expr:
        query += f" USING ({using_expr})"
    if check_expr:
        query += f" WITH CHECK ({check_expr})"
    query += ";"
    cur.execute(query)
    logger.info(f"[DATABASE] Created RLS policy {name} successfully.")

def trigger_exists(cur, trigger_name: str, table_name: str) -> bool:
    cur.execute("""
        SELECT EXISTS (
            SELECT 1 FROM pg_trigger t
            JOIN pg_class c ON t.tgrelid = c.oid
            WHERE t.tgname = %s AND c.relname = %s AND NOT t.tgisinternal
        );
    """, (trigger_name, table_name))
    return cur.fetchone()[0]

def ensure_locations_geom_trigger(cur):
    """
    Keeps public.locations.geom in sync with latitude/longitude on every
    insert or update, regardless of which code path wrote the row —
    routers/locations.py already sets geom explicitly, but any other write
    path (direct Supabase client, a future admin tool, a manual SQL fix)
    would otherwise leave geom NULL and silently break the geofence
    ST_Contains breach check in routers/geofences.py, which reads geom.
    """
    logger.info("[DATABASE] Ensuring locations geom sync trigger...")
    cur.execute("""
        CREATE OR REPLACE FUNCTION public.sync_locations_geom() RETURNS trigger AS $$
        BEGIN
            NEW.geom := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326);
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)
    if not trigger_exists(cur, "trg_locations_sync_geom", "locations"):
        cur.execute("""
            CREATE TRIGGER trg_locations_sync_geom
            BEFORE INSERT OR UPDATE OF latitude, longitude ON public.locations
            FOR EACH ROW EXECUTE FUNCTION public.sync_locations_geom();
        """)
        logger.info("[DATABASE] Created trg_locations_sync_geom trigger.")

def run_database_schema_check():
    """Runs a complete check of the Supabase PostgreSQL schemas and executes non-destructive upgrades."""
    if not is_db_active():
        logger.info("[DATABASE] Database is not active (mock offline mode). Skipping schema checks.")
        return

    logger.info("[DATABASE] Checking database schema...")
    
    try:
        # Run everything in a single transactional context
        with get_db_cursor(commit=True) as cur:
            # 1. Extensions check
            check_and_create_extensions(cur)
            try:
                cur.execute('CREATE EXTENSION IF NOT EXISTS "postgis";')
                logger.info("[DATABASE] Extension postgis verified/created.")
            except Exception as e:
                logger.warning(f"[DATABASE] Failed to check/create extension postgis: {e}. Continuing...")

            # 1b. One-time legacy-schema migration (renames old tables/columns
            # in place so existing data survives the directive schema rename).
            # Must run before table creation below, or schema_manager would
            # just create the new tables empty alongside the untouched old ones.
            try:
                run_v2_migration(cur)
            except Exception as e:
                logger.critical(
                    f"[DATABASE] Legacy migration failed: {e}. Halting schema "
                    "checks to avoid creating duplicate/empty new-shape tables "
                    "next to un-migrated old ones."
                )
                raise

            # 2. Pass 1: Table Creation, RLS enablement, and authenticated privileges
            for table_name, table_info in TABLES.items():
                if not table_exists(cur, table_name):
                    create_table(cur, table_name, table_info)
                else:
                    logger.info(f"[DATABASE] Table {table_name} exists")
                
                # Ensure Row Level Security is active and appropriate authenticated privileges exist
                try:
                    cur.execute(f"ALTER TABLE public.{table_name} ENABLE ROW LEVEL SECURITY;")
                    cur.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON public.{table_name} TO authenticated;")
                    logger.info(f"[DATABASE] RLS and authenticated privileges verified for table: {table_name}")
                except Exception as e:
                    logger.warning(f"[DATABASE] Failed to set RLS/grants on table {table_name}: {e}. Continuing...")
                    
            # 3. Pass 2: Column checks and additions
            for table_name, table_info in TABLES.items():
                existing_cols = get_existing_columns(cur, table_name)
                for col_name, col_config in table_info["columns"].items():
                    if col_name not in existing_cols:
                        add_column(cur, table_name, col_name, col_config)
                        
            # 4. Pass 3: Constraints and Unique constraint additions
            for table_name, table_info in TABLES.items():
                # Unique constraints
                for col_name in table_info.get("uniques", []):
                    if not unique_index_exists(cur, table_name, col_name):
                        add_unique_constraint(cur, table_name, col_name)
                # Check constraints
                for name, check_expr in table_info.get("constraints", {}).items():
                    if not check_constraint_exists(cur, table_name, name):
                        add_check_constraint(cur, table_name, name, check_expr)
                        
            # 5. Pass 4: Foreign Key additions
            for table_name, table_info in TABLES.items():
                for fk in table_info.get("foreign_keys", []):
                    col = fk["column"]
                    if not foreign_key_exists(cur, table_name, col):
                        add_foreign_key(cur, table_name, fk)
                        
            # 6. Pass 5: Index additions
            for table_name, table_info in TABLES.items():
                for index_name, col_expr in table_info.get("indexes", {}).items():
                    if not index_exists(cur, table_name, index_name):
                        create_index(cur, table_name, index_name, col_expr)

            # 7. Pass 6: RLS policies. Without this pass, RLS-enabled tables
            # (Pass 1 above) with zero policies deny all access to the
            # `authenticated` role — see database/rls_policies.py.
            for table_name, policies in POLICIES.items():
                for policy in policies:
                    if not policy_exists(cur, table_name, policy["name"]):
                        create_policy(cur, table_name, policy)

            # 8. Pass 7: triggers
            ensure_locations_geom_trigger(cur)
                        
        logger.info("[DATABASE] Schema verification completed successfully.")
        
    except Exception as e:
        logger.critical(f"[DATABASE] Critical error during automatic schema migration: {e}. "
                        "The application will continue starting, but database errors may persist.")
