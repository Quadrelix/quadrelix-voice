"""
store.py — Voice Lock
Embedding persistence layer: read/write owner voice embeddings to embeddings.json.

Schema (embeddings.json)
------------------------
{
  "<speaker_id>": {
    "mean":    [float, ...],        # 192-dim L2-normalised mean embedding
    "samples": [[float, ...], ...], # individual per-clip embeddings (kept for tuning)
    "updated_at": "2026-10-30T..."
  }
}

Public API
----------
save_embedding(speaker_id, mean_vec, samples)   -> None
load_embedding(speaker_id)                       -> (mean_vec, samples) or (None, [])
update_mean(speaker_id, new_sample)              -> (mean_vec, samples)
mean_of_others(speaker_id)                       -> np.ndarray | None
is_enrolled(speaker_id)                          -> bool
reset(speaker_id)                                -> bool (True if something was removed)

Durability
----------
Writes go to a temp file in the same directory and are then os.replace()'d over
the real file. A crash mid-write leaves the old file intact — embeddings are the
only copy of the owner's voice profile, and a truncated JSON would mean
re-enrolling.

Concurrency
-----------
FastAPI runs sync endpoints in a threadpool, so two clips can arrive together.
Every read-modify-write (enroll's append) holds a process-wide lock; otherwise
two simultaneous enrolls could each read 2 samples and write 3, losing one.
"""

import json
import logging
import os
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Store location
# ---------------------------------------------------------------------------

STORE_PATH = Path(__file__).parent / "embeddings.json"

_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _load_store() -> dict:
    """Read the full JSON store from disk. Returns empty dict if file absent."""
    if STORE_PATH.exists():
        with open(STORE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def _write_store(data: dict) -> None:
    """
    Atomically replace the JSON store.

    temp file + os.replace(): on Windows os.replace is atomic on the same
    volume, so a reader either sees the old file or the new one — never half
    of each.
    """
    STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(dir=str(STORE_PATH.parent), suffix=".json.tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_name, STORE_PATH)
    except Exception:
        # Clean up the temp file if the replace never happened.
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise
    logger.debug("Store written to %s", STORE_PATH)


def _normalise(vec: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(vec)
    return vec / norm if norm > 1e-8 else vec


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def save_embedding(
    speaker_id: str,
    mean_vec: np.ndarray,
    samples: list,
) -> None:
    """
    Persist a speaker's mean embedding and individual samples to disk.
    Caller must hold _lock when this is part of a read-modify-write.
    """
    data = _load_store()
    data[speaker_id] = {
        "mean": np.asarray(mean_vec, dtype=np.float32).tolist(),
        "samples": [np.asarray(s, dtype=np.float32).tolist() for s in samples],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    _write_store(data)
    logger.info(
        "Saved embedding for '%s' — %d sample(s) stored.", speaker_id, len(samples)
    )


def load_embedding(speaker_id: str):
    """
    Load a speaker's mean embedding and individual samples from disk.

    Returns
    -------
    (mean_vec, samples)
        mean_vec : np.ndarray shape (192,), or None if speaker not enrolled
        samples  : list of np.ndarray shape (192,), empty list if not enrolled
    """
    data = _load_store()
    if speaker_id not in data:
        logger.debug("Speaker '%s' not found in store.", speaker_id)
        return None, []

    entry = data[speaker_id]
    mean_vec = np.array(entry["mean"], dtype=np.float32)
    samples = [np.array(s, dtype=np.float32) for s in entry["samples"]]
    logger.debug(
        "Loaded embedding for '%s' — %d sample(s).", speaker_id, len(samples)
    )
    return mean_vec, samples


def update_mean(speaker_id: str, new_sample: np.ndarray):
    """
    Append a new clip embedding to the speaker's sample list, recompute the
    mean, re-normalise it (L2), and persist everything to disk.

    Holds _lock across the read-modify-write so two simultaneous enrolls
    cannot lose a sample.

    Returns
    -------
    (mean_vec, samples)
    """
    with _lock:
        _, existing_samples = load_embedding(speaker_id)
        samples = existing_samples + [np.asarray(new_sample, dtype=np.float32)]

        stacked = np.stack(samples, axis=0)        # (N, 192)
        mean_vec = _normalise(stacked.mean(axis=0))

        save_embedding(speaker_id, mean_vec, samples)
        logger.info(
            "Updated mean for '%s' with %d total sample(s). New mean norm: %.4f",
            speaker_id, len(samples), float(np.linalg.norm(mean_vec)),
        )
        return mean_vec, samples


def mean_of_existing(speaker_id: str):
    """
    Mean of the speaker's ALREADY-STORED samples, or None when there are none.

    This is what /enroll compares a new clip against — and the check happens
    BEFORE the new clip is appended, so the reference never contains the clip
    being judged. (The old code compared a clip to a mean that already
    included it, which reported a self-inflated ~0.99 for every clip and
    could never catch a wrong voice.)
    """
    _, samples = load_embedding(speaker_id)
    if not samples:
        return None
    return _normalise(np.stack(samples, axis=0).mean(axis=0))


def is_enrolled(speaker_id: str) -> bool:
    """Return True if the speaker has at least one stored embedding."""
    return speaker_id in _load_store()


def sample_count(speaker_id: str) -> int:
    """How many clips the profile was built from (0 when not enrolled)."""
    data = _load_store()
    entry = data.get(speaker_id)
    return len(entry.get("samples", [])) if entry else 0


def reset(speaker_id: str) -> bool:
    """
    Delete a speaker's stored profile. Returns True if something was removed.

    This is the owner's escape hatch (re-enroll with a different voice, or
    remove biometric data on request), so it must actually delete the vectors,
    not just mark them stale.
    """
    with _lock:
        data = _load_store()
        if speaker_id not in data:
            return False
        del data[speaker_id]
        _write_store(data)
        logger.info("Reset embedding for '%s'.", speaker_id)
        return True