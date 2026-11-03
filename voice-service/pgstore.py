"""
pgstore.py — optional PostgreSQL persistence for the voice service.

Why: free hosts such as Hugging Face Spaces wipe the disk on every restart,
which would delete each shop's enrolled voice profile and the verify log that
M6 needs. When VOICE_DATABASE_URL is set, store.py and main.py keep those in
Postgres (Neon) instead of files. Unset = the original file behaviour, so local
development and the VM/Docker setup are unchanged.

A dedicated variable (not DATABASE_URL) on purpose: running the service on a
laptop that also has the backend's DATABASE_URL must never write into the
production database by accident.

Tables are prefixed voice_ so they never collide with the backend's tables.
"""

import logging
import os
import threading

logger = logging.getLogger(__name__)

SCHEMA = """
CREATE TABLE IF NOT EXISTS voice_store (
  id         INT PRIMARY KEY,
  data       JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS voice_verify_log (
  id         BIGSERIAL PRIMARY KEY,
  ts         TIMESTAMPTZ NOT NULL,
  speaker_id TEXT NOT NULL,
  score      REAL,
  threshold  REAL,
  duration_s REAL,
  decision   TEXT NOT NULL,
  label      TEXT
);
CREATE INDEX IF NOT EXISTS voice_verify_log_ts_idx ON voice_verify_log (ts);
"""

_conn = None
_lock = threading.Lock()


def enabled() -> bool:
    return bool(os.getenv("VOICE_DATABASE_URL"))


def _run(fn):
    """Run fn(connection) on one cached connection, reconnecting once.

    Neon suspends idle compute and drops the TCP connection, so the first call
    after a quiet period can fail on a stale connection; one reconnect covers it.
    """
    global _conn
    import psycopg  # imported lazily: file-mode installs do not need it

    with _lock:
        for attempt in (1, 2):
            try:
                if _conn is None or _conn.closed:
                    _conn = psycopg.connect(
                        os.environ["VOICE_DATABASE_URL"],
                        autocommit=True,
                        connect_timeout=10,
                    )
                return fn(_conn)
            except (psycopg.OperationalError, psycopg.InterfaceError):
                try:
                    if _conn is not None:
                        _conn.close()
                except Exception:
                    pass
                _conn = None
                if attempt == 2:
                    raise


def ensure_schema() -> None:
    _run(lambda c: c.execute(SCHEMA))
    logger.info("Postgres persistence ready (voice_store, voice_verify_log)")


def load_store() -> dict:
    def go(c):
        row = c.execute("SELECT data FROM voice_store WHERE id = 1").fetchone()
        return row[0] if row else {}

    return _run(go)


def write_store(data: dict) -> None:
    from psycopg.types.json import Jsonb

    def go(c):
        c.execute(
            "INSERT INTO voice_store (id, data) VALUES (1, %s) "
            "ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()",
            (Jsonb(data),),
        )

    _run(go)


def append_log(line: dict) -> None:
    def go(c):
        c.execute(
            "INSERT INTO voice_verify_log (ts, speaker_id, score, threshold, duration_s, decision, label) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (
                line["ts"],
                line["speaker_id"],
                line.get("score"),
                line.get("threshold"),
                line.get("duration_s"),
                line["decision"],
                line.get("label"),
            ),
        )

    _run(go)
