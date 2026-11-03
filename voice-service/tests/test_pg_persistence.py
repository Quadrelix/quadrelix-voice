"""
tests/test_pg_persistence.py — the optional Postgres persistence (pgstore.py)

Skipped unless TEST_VOICE_DATABASE_URL points at a THROWAWAY Postgres (the
tests create and empty the voice_* tables). Example:

    docker run -d --name vpg -e POSTGRES_PASSWORD=test -p 54330:5432 postgres:16-alpine
    set TEST_VOICE_DATABASE_URL=postgresql://postgres:test@localhost:54330/postgres
    .venv\\Scripts\\python -m pytest tests/test_pg_persistence.py -v
"""

import os
import sys
from datetime import datetime, timezone

import numpy as np
import pytest

SERVICE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SERVICE_DIR)

TEST_URL = os.getenv("TEST_VOICE_DATABASE_URL")
pytestmark = pytest.mark.skipif(not TEST_URL, reason="TEST_VOICE_DATABASE_URL not set")

import pgstore  # noqa: E402
import store  # noqa: E402


@pytest.fixture(autouse=True)
def pg(monkeypatch, tmp_path):
    monkeypatch.setenv("VOICE_DATABASE_URL", TEST_URL)
    # If persistence wrongly fell back to files, embeddings.json would appear here.
    monkeypatch.setattr(store, "STORE_PATH", tmp_path / "embeddings.json")
    pgstore._conn = None
    pgstore.ensure_schema()
    pgstore._run(lambda c: c.execute("TRUNCATE voice_store, voice_verify_log"))
    yield tmp_path
    pgstore._run(lambda c: c.execute("TRUNCATE voice_store, voice_verify_log"))
    if pgstore._conn is not None:
        pgstore._conn.close()
        pgstore._conn = None


def _vec(seed):
    v = np.random.RandomState(seed).randn(192).astype(np.float32)
    return v / np.linalg.norm(v)


def test_enrollment_round_trips_through_postgres_not_the_file(pg):
    samples = [_vec(1), _vec(2)]
    store.save_embedding("shop_a_owner", np.mean(samples, axis=0), samples)

    assert not (pg / "embeddings.json").exists()
    assert store.is_enrolled("shop_a_owner")
    assert store.sample_count("shop_a_owner") == 2
    mean, loaded = store.load_embedding("shop_a_owner")
    assert mean is not None and mean.shape == (192,)
    assert len(loaded) == 2
    assert np.allclose(loaded[0], samples[0], atol=1e-6)  # values survive the JSONB round trip


def test_two_shops_stay_separate_and_survive_a_dropped_connection():
    store.save_embedding("shop_a_owner", _vec(1), [_vec(1)])
    store.save_embedding("shop_b_owner", _vec(7), [_vec(7)])
    pgstore._conn.close()  # what Neon does to an idle connection

    assert store.is_enrolled("shop_a_owner")
    assert store.is_enrolled("shop_b_owner")
    assert not store.is_enrolled("shop_c_owner")


def test_reset_removes_only_that_shops_profile():
    store.save_embedding("shop_a_owner", _vec(1), [_vec(1)])
    store.save_embedding("shop_b_owner", _vec(7), [_vec(7)])

    assert store.reset("shop_a_owner") is True
    assert not store.is_enrolled("shop_a_owner")
    assert store.is_enrolled("shop_b_owner")
    assert store.reset("shop_a_owner") is False


def test_verify_log_rows_are_stored_with_an_empty_label_column():
    pgstore.append_log({
        "ts": datetime.now(timezone.utc).isoformat(),
        "speaker_id": "shop_a_owner",
        "score": 0.6123,
        "threshold": 0.3,
        "duration_s": 4.2,
        "decision": "accepted",
    })
    rows = pgstore._run(
        lambda c: c.execute(
            "SELECT speaker_id, score, decision, label FROM voice_verify_log"
        ).fetchall()
    )
    assert len(rows) == 1
    assert rows[0][0] == "shop_a_owner"
    assert rows[0][2] == "accepted"
    assert rows[0][3] is None
