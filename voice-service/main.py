"""
main.py — Voice Lock
FastAPI microservice: speaker verification for the shop billing pipeline.

Endpoints
---------
GET  /health   — open; boot check used by Node backend (checkVoiceService)
POST /enroll   — register owner voice (call 3-5 times with different clips)  [token]
POST /verify   — check if audio clip belongs to the enrolled owner            [token]
GET  /status   — enrollment state, threshold, sample count                    [token]
POST /reset    — delete the stored profile (re-enrollment)                    [token]
POST /embed    — raw embedding, debugging/calibration only                    [token]

Security
--------
Everything except /health requires the X-Voice-Token header to match
VOICE_SERVICE_TOKEN. The service binds to 127.0.0.1 (see run command below),
so the phone can never reach it — only Node can. The token is the second
layer: without it, anything else running on the laptop could overwrite the
owner's voice profile.

Run
---
venv\\Scripts\\uvicorn main:app --host 127.0.0.1 --port 8000

Note on async: endpoints are plain `def`, not `async def`. FastAPI runs sync
endpoints in a threadpool, so a 2 s ffmpeg+torch verify does not block the
event loop and /health keeps answering while a verify is in flight.
"""

import hmac
import json
import logging
import os
import shutil
import tempfile
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

# Windows terminal encoding fix
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
os.environ["PYTHONUTF8"] = "1"

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile

import speaker
import store

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("voice_lock")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

def _threshold() -> float:
    try:
        return float(os.getenv("VOICE_THRESHOLD", "0.30"))
    except ValueError:
        return 0.30

DEFAULT_SPEAKER = "shop_1_owner"
SERVICE_TOKEN = os.getenv("VOICE_SERVICE_TOKEN", "")  # empty = token check off (dev)

MAX_UPLOAD_BYTES = 5 * 1024 * 1024   # a 30 s m4a is ~500 KB; 5 MB is generous
VERIFY_LOG = Path(__file__).parent / "verify_log.jsonl"
ENROLL_OUTLIER_SCORE = 0.15          # below this vs the other clips = wrong voice/noise

# ---------------------------------------------------------------------------
# Lifespan — load model ONCE at startup, not per request
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load the ECAPA model before the server starts accepting requests."""
    logger.info("=== Voice Lock service starting up ===")
    if SERVICE_TOKEN:
        logger.info("Token auth: ENABLED")
    else:
        logger.warning("Token auth: DISABLED (VOICE_SERVICE_TOKEN is empty) — dev only")
    speaker.load_model()
    speaker.warm_up()
    logger.info("Model ready (threshold=%.2f).", _threshold())
    yield
    logger.info("=== Voice Lock service shutting down ===")


app = FastAPI(
    title="Voice Lock — Speaker Verification Service",
    description=(
        "Verifies that an audio clip belongs to the enrolled shop owner. "
        "Only verified audio is forwarded to Sarvam STT for transcription."
    ),
    version="0.2.0",
    lifespan=lifespan,
)

# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

def require_token(x_voice_token: str | None = Header(default=None, alias="X-Voice-Token")):
    """
    Reject requests without the shared secret.

    hmac.compare_digest, not ==, so the check takes the same time whether the
    first character is wrong or the last — a timing oracle on a token that
    guards biometric data is not worth leaving open.
    """
    if not SERVICE_TOKEN:
        return  # dev mode: no token configured
    if not x_voice_token or not hmac.compare_digest(x_voice_token, SERVICE_TOKEN):
        raise HTTPException(status_code=401, detail="Invalid or missing X-Voice-Token")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _save_upload(upload: UploadFile) -> str:
    """
    Save an upload to a temp file and return that path.

    Caps the size: an unbounded upload fills the disk, and this endpoint is
    reachable by anything holding the token.
    """
    suffix = Path(upload.filename).suffix if upload.filename else ".wav"
    tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    written = 0
    with tmp:
        while True:
            chunk = upload.file.read(64 * 1024)
            if not chunk:
                break
            written += len(chunk)
            if written > MAX_UPLOAD_BYTES:
                tmp.close()
                Path(tmp.name).unlink(missing_ok=True)
                raise HTTPException(
                    status_code=413,
                    detail=f"Audio file too large (max {MAX_UPLOAD_BYTES // (1024 * 1024)} MB)",
                )
            tmp.write(chunk)
    return tmp.name


def _log_verify(speaker_id: str, score: float, threshold: float, duration: float, decision: str):
    """
    Append one JSON line per verify. Never stores audio — only the numbers
    needed to tune the threshold later from real shop use (M6).
    """
    try:
        line = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "speaker_id": speaker_id,
            "score": round(float(score), 4),
            "threshold": round(float(threshold), 4),
            "duration_s": round(float(duration), 2),
            "decision": decision,
        }
        with open(VERIFY_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(line) + "\n")
    except Exception as e:  # logging must never fail a verify
        logger.warning("Could not write verify log: %s", e)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health", summary="Boot check for Node backend")
def health():
    """
    Fast, unauthenticated status. Called by Node at startup and for the
    'Voice Lock off' badge in the app.
    """
    return {
        "status": "ok",
        "model": "ecapa-voxceleb",
        "enrolled": store.is_enrolled(DEFAULT_SPEAKER),
        "threshold": _threshold(),
    }


@app.get("/status", summary="Enrollment state", dependencies=[Depends(require_token)])
def status(speaker_id: str = DEFAULT_SPEAKER):
    return {
        "speaker_id": speaker_id,
        "enrolled": store.is_enrolled(speaker_id),
        "samples": store.sample_count(speaker_id),
        "threshold": _threshold(),
    }


@app.post("/enroll", summary="Register owner voice embedding", dependencies=[Depends(require_token)])
def enroll(
    audio: UploadFile = File(..., description="Audio clip (.m4a or .wav), min 1.5s"),
    speaker_id: str = Form(DEFAULT_SPEAKER, description="Speaker identifier"),
):
    """
    Add a new voice sample for the owner.
    Call 3-5 times with different clips for a stable mean embedding.

    Quality check: a clip whose similarity to the mean of the OTHER clips is
    far below ENROLL_OUTLIER_SCORE is rejected. Otherwise one customer
    speaking nearby, or one noisy recording, becomes part of the profile and
    every later verification compares against a polluted reference.
    """
    tmp_path = _save_upload(audio)

    try:
        vec, _duration = speaker.embed_with_meta(tmp_path)
    except speaker.ClipTooShortError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Embed failed during /enroll: %s", e)
        raise HTTPException(status_code=400, detail=f"Audio processing failed: {e}")
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    # Compare against the clips already stored — BEFORE adding this one.
    others_mean = store.mean_of_existing(speaker_id)
    similarity_to_others = None
    if others_mean is not None:
        similarity_to_others = speaker.compare(others_mean, vec)
        if similarity_to_others < ENROLL_OUTLIER_SCORE:
            logger.warning(
                "/enroll REJECTED speaker='%s' similarity_to_others=%.4f < %.2f",
                speaker_id, similarity_to_others, ENROLL_OUTLIER_SCORE,
            )
            raise HTTPException(
                status_code=422,
                detail=(
                    f"This clip doesn't match your earlier recordings "
                    f"(similarity {similarity_to_others:.2f}). "
                    f"Record again — same person, same phone, same mic position."
                ),
            )

    mean_vec, samples = store.update_mean(speaker_id, vec)

    logger.info(
        "/enroll speaker='%s' samples=%d similarity_to_others=%s",
        speaker_id, len(samples),
        "n/a" if similarity_to_others is None else f"{similarity_to_others:.4f}",
    )

    return {
        "speaker_id": speaker_id,
        "embedding_stored": True,
        "samples": len(samples),
        # Kept for contract compatibility. This is the similarity of this clip
        # to the mean of the PREVIOUS clips (null for the very first clip) —
        # NOT a self-inflated comparison against a mean that includes it.
        "similarity_mean": None if similarity_to_others is None else round(float(similarity_to_others), 4),
    }


@app.post("/verify", summary="Verify if audio belongs to enrolled owner", dependencies=[Depends(require_token)])
def verify(
    audio: UploadFile = File(..., description="Audio clip (.m4a or .wav), min 1.5s"),
    speaker_id: str = Form(DEFAULT_SPEAKER, description="Speaker identifier"),
):
    """
    Compare audio clip against stored owner embedding.

    IMPORTANT: A low score is NOT an HTTP error.
    Only throw 4xx/5xx on real errors (bad audio, not enrolled, model missing).

    Response shape (contract with Node backend):
    {
      "speaker_id": "shop_1_owner",
      "score": 0.41,
      "is_speaker": true,
      "threshold": 0.30
    }
    """
    if not store.is_enrolled(speaker_id):
        raise HTTPException(
            status_code=404,
            detail=f"Speaker '{speaker_id}' is not enrolled. Call /enroll first.",
        )

    tmp_path = _save_upload(audio)

    try:
        vec, duration = speaker.embed_with_meta(tmp_path)
    except speaker.ClipTooShortError:
        logger.info("/verify speaker='%s' result=too_short", speaker_id)
        _log_verify(speaker_id, 0.0, _threshold(), 0.0, "too_short")
        return {
            "speaker_id": speaker_id,
            "score": 0.0,
            "is_speaker": False,
            "threshold": _threshold(),
            "reason": "too_short",
        }
    except Exception as e:
        logger.error("Embed failed during /verify: %s", e)
        raise HTTPException(status_code=400, detail=f"Audio processing failed: {e}")
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    mean_vec, _ = store.load_embedding(speaker_id)
    threshold = _threshold()
    score = speaker.compare(mean_vec, vec)
    is_speaker = bool(score >= threshold)

    logger.info(
        "/verify speaker='%s' score=%.4f is_speaker=%s threshold=%.2f duration=%.2fs",
        speaker_id, score, is_speaker, threshold, duration,
    )
    _log_verify(speaker_id, score, threshold, duration, "accepted" if is_speaker else "rejected")

    return {
        "speaker_id": speaker_id,
        "score": round(float(score), 4),
        "is_speaker": is_speaker,
        "threshold": threshold,
    }


@app.post("/reset", summary="Delete the stored voice profile", dependencies=[Depends(require_token)])
def reset(speaker_id: str = Form(DEFAULT_SPEAKER)):
    """
    Delete the owner's stored embeddings so enrollment can start over.

    Node gates this behind the admin PIN; the token is the service-level check.
    """
    removed = store.reset(speaker_id)
    return {"speaker_id": speaker_id, "reset": removed, "enrolled": False}


@app.post("/embed", summary="Return raw embedding vector (debugging)", dependencies=[Depends(require_token)])
def embed_only(audio: UploadFile = File(...)):
    """
    Returns the raw 192-dim embedding for an audio clip.
    Used for threshold calibration (M2/M6). Not called by Node in production.
    """
    tmp_path = _save_upload(audio)
    try:
        vec, _duration = speaker.embed_with_meta(tmp_path)
    except speaker.ClipTooShortError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Audio processing failed: {e}")
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    return {"embedding": vec.tolist(), "shape": list(vec.shape)}