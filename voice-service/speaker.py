"""
speaker.py — Voice Lock
Model layer: load ECAPA-TDNN once, embed audio clips, compare embeddings.

Public API
----------
load_model()                  -> EncoderClassifier   (call once at startup)
warm_up()                     -> None  (one dummy embed so the first real
                                          request isn't the slow one)
embed(audio_path)             -> np.ndarray shape (192,), L2-normalised
embed_with_meta(audio_path)   -> (np.ndarray, duration_seconds)
compare(vec_a, vec_b)         -> float  cosine similarity in [-1, 1]
ClipTooShortError             exception raised when audio < VOICE_MIN_SECONDS

Environment
-----------
VOICE_MIN_SECONDS   shortest clip that is scored (default 1.5)
"""

import os
import subprocess
import tempfile
import logging
from pathlib import Path

import numpy as np
import soundfile as sf
import torch

# Suppress HuggingFace symlink warning on Windows
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
os.environ["PYTHONUTF8"] = "1"

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SAMPLE_RATE = 16_000                  # Hz — what ECAPA expects

def _min_seconds() -> float:
    """Read at call time so tests and tuning can override without a rebuild."""
    try:
        return float(os.getenv("VOICE_MIN_SECONDS", "1.5"))
    except ValueError:
        return 1.5

MODEL_SOURCE = "speechbrain/spkrec-ecapa-voxceleb"
MODEL_DIR = Path(__file__).parent / "pretrained_models" / "ecapa"

# ffmpeg is bounded: a verify must never hang a request thread.
FFMPEG_TIMEOUT_S = 30

# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class ClipTooShortError(ValueError):
    """Raised when the decoded audio is shorter than the minimum duration."""
    pass

# ---------------------------------------------------------------------------
# Model — singleton, loaded once at startup
# ---------------------------------------------------------------------------

_model = None  # EncoderClassifier instance


def load_model():
    """
    Load the ECAPA-TDNN model from disk (or HuggingFace on first run).
    Safe to call multiple times — returns cached instance after first load.
    Must be called once before any embed() calls.
    """
    global _model
    if _model is not None:
        return _model

    logger.info("Loading ECAPA-TDNN model from %s ...", MODEL_DIR)

    from speechbrain.inference.speaker import EncoderClassifier
    from speechbrain.utils.fetching import LocalStrategy

    _model = EncoderClassifier.from_hparams(
        source=MODEL_SOURCE,
        savedir=str(MODEL_DIR),
        run_opts={"device": "cpu"},
        # COPY_SKIP_CACHE: avoids Windows symlink privilege errors (WinError 1314)
        local_strategy=LocalStrategy.COPY_SKIP_CACHE,
    )

    logger.info("Model loaded: %s", _model.__class__.__name__)
    return _model


def warm_up() -> None:
    """
    Run one short embed right after startup.

    The first encode_batch call pays lazy kernel/JIT costs that the second
    call does not. Without this, the first shopkeeper utterance of the day
    is the slow one — exactly when nobody is patient.
    """
    if _model is None:
        load_model()
    try:
        # 0.5 s of a quiet tone: enough to warm the graph, cheap to compute.
        t = np.linspace(0, 0.5, int(SAMPLE_RATE * 0.5), endpoint=False, dtype=np.float32)
        dummy = 0.01 * np.sin(2 * np.pi * 220 * t)
        _embed_waveform(dummy)
        logger.info("Warm-up embed completed.")
    except Exception as e:  # never let warm-up stop the service
        logger.warning("Warm-up failed (service still starts): %s", e)


# ---------------------------------------------------------------------------
# Audio decoding
# ---------------------------------------------------------------------------

def _decode_to_pcm(audio_path: str) -> np.ndarray:
    """
    Decode any audio file (m4a, wav, mp3 ...) to 16 kHz mono float32 PCM
    using an ffmpeg subprocess. Returns a 1-D numpy array.

    Raises
    ------
    FileNotFoundError  if ffmpeg is not on PATH
    ValueError         if ffmpeg exits with a non-zero code
    ClipTooShortError  if decoded audio < VOICE_MIN_SECONDS
    """
    # NamedTemporaryFile, not mktemp: mktemp returns a name and leaves the
    # create step to us, which is a race. delete=False keeps the file until
    # ffmpeg writes it; the finally block removes it either way.
    tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    tmp.close()
    tmp_wav = Path(tmp.name)
    try:
        result = subprocess.run(
            [
                "ffmpeg", "-y",           # overwrite output
                "-i", audio_path,         # input file
                "-ar", str(SAMPLE_RATE),  # resample to 16 kHz
                "-ac", "1",               # mono
                "-f", "wav",
                str(tmp_wav),
            ],
            capture_output=True,
            timeout=FFMPEG_TIMEOUT_S,
        )

        if result.returncode != 0:
            err = result.stderr.decode(errors="replace")
            raise ValueError(f"ffmpeg decode failed (code {result.returncode}): {err}")

        waveform, _sr = sf.read(str(tmp_wav), dtype="float32")

        if waveform.ndim > 1:
            waveform = waveform[:, 0]  # take first channel if stereo slips through

        min_seconds = _min_seconds()
        min_samples = int(min_seconds * SAMPLE_RATE)
        if len(waveform) < min_samples:
            duration = len(waveform) / SAMPLE_RATE
            raise ClipTooShortError(
                f"Audio is {duration:.2f}s after decode — minimum is {min_seconds}s. "
                f"Got {len(waveform)} samples, need {min_samples}."
            )

        return waveform

    finally:
        if tmp_wav.exists():
            tmp_wav.unlink()


# ---------------------------------------------------------------------------
# Embedding
# ---------------------------------------------------------------------------

def _embed_waveform(waveform: np.ndarray) -> np.ndarray:
    """Embed an already-decoded 16 kHz mono float32 waveform."""
    model = _model
    if model is None:
        raise RuntimeError("Model not loaded. Call speaker.load_model() at startup.")

    tensor = torch.tensor(waveform).unsqueeze(0)  # (1, T)

    with torch.no_grad():
        embedding = model.encode_batch(tensor)   # (1, 1, 192)

    vec = embedding.squeeze().numpy().astype(np.float32)  # (192,)

    # L2 normalise — cosine similarity then reduces to a dot product
    norm = np.linalg.norm(vec)
    if norm < 1e-8:
        raise ValueError("Embedding norm is near zero — audio may be completely silent.")

    return vec / norm


def embed_with_meta(audio_path: str):
    """
    Convert an audio file to a voice embedding, also returning its duration.

    Returns
    -------
    (np.ndarray shape (192,), float duration_seconds)

    Raises
    ------
    ClipTooShortError  if audio is shorter than VOICE_MIN_SECONDS
    RuntimeError       if load_model() was never called
    ValueError         if ffmpeg fails or audio cannot be decoded
    """
    waveform = _decode_to_pcm(audio_path)  # may raise ClipTooShortError
    duration = len(waveform) / SAMPLE_RATE
    return _embed_waveform(waveform), float(duration)


def embed(audio_path: str) -> np.ndarray:
    """
    Convert an audio file to a L2-normalised 192-dim voice embedding.

    Parameters
    ----------
    audio_path : str
        Path to any audio file supported by ffmpeg (.m4a, .wav, .mp3, ...).

    Returns
    -------
    np.ndarray  shape (192,), dtype float32, L2 norm == 1.0
    """
    vec, _duration = embed_with_meta(audio_path)
    return vec


def compare(vec_a: np.ndarray, vec_b: np.ndarray) -> float:
    """
    Cosine similarity between two L2-normalised embeddings.
    Because both vectors are unit-norm, this is simply their dot product.

    Returns
    -------
    float in [-1.0, 1.0]
        Higher = more similar.
        Same speaker typically scores 0.30–0.90 depending on recording conditions.
        Different speakers typically score -0.10–0.25.
    """
    return float(np.dot(vec_a, vec_b))