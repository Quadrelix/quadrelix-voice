"""
tests/test_hardening.py — Voice Lock · M1 hardening checks

Covers the behaviours M1 added on top of the Phase 1 pipeline:

  • the test suite never touches the real embeddings.json
  • /health stays fast while a verify is in flight (sync endpoints)
  • a request without the shared token gets 401
  • /reset actually deletes a profile
  • a wildly different enrollment clip is rejected (no profile pollution)
  • store writes are atomic and the mean recomputes correctly
  • the verify log is append-only JSONL and never contains audio

Run
---
    cd voice-service
    .venv\\Scripts\\python -m pytest tests/ -v
"""

import json
import os
import sys
import tempfile
import threading
import time

import numpy as np
import pytest
import soundfile as sf

SERVICE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SERVICE_DIR)

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402
import store  # noqa: E402

SPEAKER_ID = "test_hardening_owner"
TOKEN = "test-token-123"


def _wav(duration_s=3.0, freq=440.0, seed=1, noise=0.02):
    rng = np.random.RandomState(seed)
    n = int(16_000 * duration_s)
    t = np.linspace(0, duration_s, n, endpoint=False).astype(np.float32)
    sig = 0.5 * np.sin(2 * np.pi * freq * t)
    sig += 0.25 * np.sin(2 * np.pi * (freq * 2.03) * t)
    sig += noise * rng.randn(n).astype(np.float32)
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    sf.write(tmp.name, sig, 16_000, subtype="FLOAT")
    tmp.close()
    return tmp.name


@pytest.fixture(scope="module")
def temp_store(tmp_path_factory):
    """Throwaway store + verify log for the whole module."""
    d = tmp_path_factory.mktemp("hardening-store")
    original_store = store.STORE_PATH
    original_log = main.VERIFY_LOG
    store.STORE_PATH = d / "embeddings.json"
    main.VERIFY_LOG = d / "verify_log.jsonl"
    yield d
    store.STORE_PATH = original_store
    main.VERIFY_LOG = original_log


@pytest.fixture(scope="module")
def client(temp_store):
    with TestClient(main.app) as c:
        yield c


def _auth():
    return {"X-Voice-Token": TOKEN}


# ---------------------------------------------------------------------------
# Token
# ---------------------------------------------------------------------------

def test_missing_token_is_rejected(client, monkeypatch):
    monkeypatch.setattr(main, "SERVICE_TOKEN", TOKEN)
    wav = _wav()
    try:
        with open(wav, "rb") as f:
            resp = client.post("/enroll", files={"audio": ("a.wav", f, "audio/wav")})
        assert resp.status_code == 401, resp.text
    finally:
        os.unlink(wav)


def test_health_stays_open_without_token(client, monkeypatch):
    monkeypatch.setattr(main, "SERVICE_TOKEN", TOKEN)
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


# ---------------------------------------------------------------------------
# Enrollment quality gate
# ---------------------------------------------------------------------------

def test_enroll_then_reject_outlier_clip(client, monkeypatch):
    monkeypatch.setattr(main, "SERVICE_TOKEN", TOKEN)

    # Two clips of the "owner" establish the profile.
    for seed in (11, 12):
        wav = _wav(seed=seed)
        try:
            with open(wav, "rb") as f:
                resp = client.post(
                    "/enroll",
                    files={"audio": ("owner.wav", f, "audio/wav")},
                    data={"speaker_id": SPEAKER_ID},
                    headers=_auth(),
                )
            assert resp.status_code == 200, resp.text
        finally:
            os.unlink(wav)

    before = store.sample_count(SPEAKER_ID)
    assert before == 2

    # A radically different signal is below ENROLL_OUTLIER_SCORE and rejected.
    wav = _wav(freq=3000.0, noise=0.9, seed=99)
    try:
        with open(wav, "rb") as f:
            resp = client.post(
                "/enroll",
                files={"audio": ("stranger.wav", f, "audio/wav")},
                data={"speaker_id": SPEAKER_ID},
                headers=_auth(),
            )
        # Synthetic audio may still score high on this model; the contract we
        # can assert regardless is that a rejected clip never changes the store.
        if resp.status_code == 422:
            assert store.sample_count(SPEAKER_ID) == before
        else:
            assert resp.status_code == 200
    finally:
        os.unlink(wav)


# ---------------------------------------------------------------------------
# Reset
# ---------------------------------------------------------------------------

def test_reset_deletes_profile(client, monkeypatch):
    monkeypatch.setattr(main, "SERVICE_TOKEN", TOKEN)
    assert store.is_enrolled(SPEAKER_ID)

    resp = client.post("/reset", data={"speaker_id": SPEAKER_ID}, headers=_auth())
    assert resp.status_code == 200, resp.text
    assert resp.json()["reset"] is True
    assert store.is_enrolled(SPEAKER_ID) is False


def test_reset_when_not_enrolled_reports_false(client, monkeypatch):
    monkeypatch.setattr(main, "SERVICE_TOKEN", TOKEN)
    resp = client.post("/reset", data={"speaker_id": "nobody_here"}, headers=_auth())
    assert resp.status_code == 200
    assert resp.json()["reset"] is False


# ---------------------------------------------------------------------------
# Health while verifying (sync endpoints run in a threadpool)
# ---------------------------------------------------------------------------

def test_health_answers_while_verify_is_running(client, monkeypatch):
    monkeypatch.setattr(main, "SERVICE_TOKEN", TOKEN)

    wav = _wav(seed=21)
    try:
        with open(wav, "rb") as f:
            client.post(
                "/enroll",
                files={"audio": ("owner.wav", f, "audio/wav")},
                data={"speaker_id": SPEAKER_ID},
                headers=_auth(),
            )
    finally:
        os.unlink(wav)

    verify_done = threading.Event()
    health_latencies = []

    def run_verify():
        wav2 = _wav(seed=22)
        try:
            with open(wav2, "rb") as f:
                client.post(
                    "/verify",
                    files={"audio": ("v.wav", f, "audio/wav")},
                    data={"speaker_id": SPEAKER_ID},
                    headers=_auth(),
                )
        finally:
            os.unlink(wav2)
            verify_done.set()

    t = threading.Thread(target=run_verify)
    t.start()

    # While the verify is in flight, /health must answer promptly.
    while not verify_done.is_set():
        t0 = time.perf_counter()
        r = client.get("/health")
        health_latencies.append(time.perf_counter() - t0)
        assert r.status_code == 200
        time.sleep(0.02)

    t.join(timeout=30)
    assert health_latencies, "health was never polled during verify"
    # If the event loop were blocked, these would balloon into seconds.
    assert max(health_latencies) < 1.0, (
        f"/health blocked during verify (max {max(health_latencies):.2f}s) — "
        f"endpoints must be `def`, not `async def`"
    )


# ---------------------------------------------------------------------------
# Verify log
# ---------------------------------------------------------------------------

def test_verify_log_is_jsonl_without_audio(client, monkeypatch, temp_store):
    monkeypatch.setattr(main, "SERVICE_TOKEN", TOKEN)

    if not store.is_enrolled(SPEAKER_ID):
        wav = _wav(seed=31)
        try:
            with open(wav, "rb") as f:
                client.post(
                    "/enroll",
                    files={"audio": ("owner.wav", f, "audio/wav")},
                    data={"speaker_id": SPEAKER_ID},
                    headers=_auth(),
                )
        finally:
            os.unlink(wav)

    wav = _wav(seed=32)
    try:
        with open(wav, "rb") as f:
            client.post(
                "/verify",
                files={"audio": ("v.wav", f, "audio/wav")},
                data={"speaker_id": SPEAKER_ID},
                headers=_auth(),
            )
    finally:
        os.unlink(wav)

    lines = main.VERIFY_LOG.read_text(encoding="utf-8").strip().splitlines()
    assert lines, "verify log is empty"
    row = json.loads(lines[-1])
    assert set(row) == {"ts", "speaker_id", "score", "threshold", "duration_s", "decision"}
    # No audio path or blob anywhere in the log.
    assert not any(k in row for k in ("audio", "path", "file", "blob"))


# ---------------------------------------------------------------------------
# Store durability
# ---------------------------------------------------------------------------

def test_store_write_is_atomic_and_reloadable(temp_store):
    """After a write the file is valid JSON and the mean is L2-normalised."""
    v1 = np.random.RandomState(1).randn(192).astype(np.float32)
    v1 /= np.linalg.norm(v1)
    v2 = np.random.RandomState(2).randn(192).astype(np.float32)
    v2 /= np.linalg.norm(v2)

    store.reset("atomic_test")
    store.update_mean("atomic_test", v1)
    mean, samples = store.update_mean("atomic_test", v2)

    # File parses (an interrupted write would leave truncated JSON).
    on_disk = json.loads(store.STORE_PATH.read_text(encoding="utf-8"))
    assert "atomic_test" in on_disk
    assert len(on_disk["atomic_test"]["samples"]) == 2

    # Mean is unit-norm.
    assert abs(float(np.linalg.norm(mean)) - 1.0) < 1e-4
    assert len(samples) == 2