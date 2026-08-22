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
        # Initialize the threaded connection pool
        pool = ThreadedConnectionPool(
            minconn=1,
            maxconn=20,
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
