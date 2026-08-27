import json
import logging
from contextlib import contextmanager
import psycopg2
import psycopg2.extras
from psycopg2.pool import ThreadedConnectionPool
from config import Config

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("db")

# Without this, psycopg2 has no idea how to serialize Python's uuid.UUID
# objects (what uuid4() returns, and what every router in this codebase
# passes directly as a query parameter — e.g. cur.execute(..., (auth_id, ...))
# where auth_id = uuid4()) into a SQL value. That fails at query time with
# "can't adapt type 'UUID'" — which only ever surfaces against a real
# database, never in mock/offline mode, since mock mode skips SQL execution
# entirely. This registers the adapter once, globally, for every connection
# from the pool below, instead of needing str(x) at every call site.
psycopg2.extras.register_uuid()

pool = None
DB_ACTIVE = False

if Config.DATABASE_URL:
    try:
        # Initialize the threaded connection pool.
        #
        # IMPORTANT: maxconn must stay comfortably below the Postgres
        # session-mode pooler's own client limit (Supabase's pooler logs
        # "EMAXCONNSESSION ... max clients are limited to pool_size: 15").
        # This pool previously used maxconn=20, which is *larger* than that
        # upstream ceiling — so under any real concurrent load (tourist
        # location pings + SOS submits + authority polling all opening a
        # connection per request via get_db_cursor/get_authenticated_cursor)
        # this process alone could ask the pooler for more sessions than it
        # will ever grant. Every request past the 15th then failed with
        # psycopg2.OperationalError, which surfaced as "Error in session
        # verification" on *every* authenticated endpoint — including
        # geofence listing (silently swallowed by the frontend's try/catch,
        # so the Manage Geofences panel looked empty) and geofence breach
        # bookkeeping (the debounce INSERT never committed, so the same
        # breach re-fired an incident on every subsequent ping instead of
        # being suppressed for _BREACH_DEBOUNCE).
        #
        # 10 leaves headroom under the 15-connection ceiling for other
        # concurrent clients (migrations, psql, etc.) hitting the same
        # pooler. Raise this only if the upstream pooler's pool_size is
        # also raised.
        pool = ThreadedConnectionPool(
            minconn=1,
            maxconn=10,
            dsn=Config.DATABASE_URL
        )
        # Test connection
        conn = pool.getconn()
        with conn.cursor() as cur:
            cur.execute("SELECT 1;")
        pool.putconn(conn)
        DB_ACTIVE = True
        logger.info("Database connection pool initialized successfully.")
    except Exception as e:
        logger.warning(f"Failed to connect to database: {e}. Falling back to in-memory mode.")
        pool = None
        DB_ACTIVE = False
else:
    logger.info("DATABASE_URL not configured. Running in mock offline mode.")


def is_db_active() -> bool:
    return DB_ACTIVE


@contextmanager
def get_db_cursor(commit: bool = False):
    if not DB_ACTIVE or pool is None:
        raise RuntimeError("Database connection is not active.")
    conn = pool.getconn()
    cur = conn.cursor()
    try:
        yield cur
        if commit:
            conn.commit()
    except Exception as e:
        conn.rollback()
        raise e
    finally:
        cur.close()
        pool.putconn(conn)


@contextmanager
def get_authenticated_cursor(auth_user_id, commit: bool = False):
    if not DB_ACTIVE or pool is None:
        raise RuntimeError("Database connection is not active.")
    conn = pool.getconn()
    cur = conn.cursor()
    try:
        # Set JWT claims in the transaction
        claims_str = json.dumps({"sub": str(auth_user_id), "role": "authenticated"})
        cur.execute("SELECT set_config('request.jwt.claims', %s, true);", (claims_str,))
        # Set local role to authenticated
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
