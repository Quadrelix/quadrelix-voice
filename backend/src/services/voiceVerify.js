// Client for the Python voice-lock service (voice-service/, port 8000).
//
// The gate lives here, not in the app, because the decision has to be
// consistent and testable: `decide()` is a pure function, so every combination
// of mode / result / error / fail-mode can be checked in npm test without a
// mic, a model, or a running service.
//
// Modes (VOICE_LOCK_MODE):
//   off      — behave exactly like before Voice Lock existed
//   shadow   — verify and log every score, never block
//   enforce  — block audio that isn't the owner
//
// VOICE_FAIL_MODE decides what happens when the service is unreachable:
//   open (default) — allow the audio, log loudly, app shows "Voice Lock off".
//                    A dead verification service must not stop billing.
//   closed         — reject the audio.

const fs = require("fs");
const FormData = require("form-data");
const axios = require("axios");

const SERVICE_URL = () => process.env.VOICE_SERVICE_URL || "http://127.0.0.1:8000";
const TOKEN = () => process.env.VOICE_SERVICE_TOKEN || "";

// One voice profile per shop. The Python service keys everything by
// speaker_id, so "kapda_delhi_owner" and "kirana_pune_owner" are two separate
// profiles with no service change. VOICE_SPEAKER_ID overrides for local
// single-shop debugging.
const speakerIdFor = (shopId) =>
  process.env.VOICE_SPEAKER_ID || `${shopId || "shop_1"}_owner`;

function validMode(value) {
  const m = String(value || "off").toLowerCase();
  return ["off", "shadow", "enforce"].includes(m) ? m : "off";
}

function validFailMode(value) {
  return String(value || "open").toLowerCase() === "closed" ? "closed" : "open";
}

// Runtime override (set by /api/voice-override). In-memory by design: a
// restart returns to the .env value, so a temporary "off" can't be forgotten
// and silently become permanent. Keyed by shop so one shop's bad day never
// changes another shop's lock; the "*" key is a process-wide override that only
// code (not an HTTP route) may set.
const overrides = new Map();

function setOverride(value, shopId = "*") {
  if (value) overrides.set(shopId, validMode(value));
  else overrides.delete(shopId);
}

function getOverride(shopId = "*") {
  return overrides.get(shopId) ?? overrides.get("*") ?? null;
}

function mode(shopId) {
  return getOverride(shopId) || validMode(process.env.VOICE_LOCK_MODE);
}

function failMode() {
  return validFailMode(process.env.VOICE_FAIL_MODE);
}

function headers(extra = {}) {
  const h = { ...extra };
  if (TOKEN()) h["X-Voice-Token"] = TOKEN();
  return h;
}

/**
 * decide({ mode, result, error, failMode }) -> { allow, verified, reason, lockState }
 *
 * Pure — no I/O, no env reads beyond the arguments. This is the whole policy:
 *
 *   off                        -> allow, verified=false, lockState='off'
 *   service error + fail open  -> allow, verified=false, lockState='off'
 *   service error + fail closed-> block
 *   too_short                  -> block (D2: a sub-1.5 s clip is unreliable,
 *                                 and "das rupay" is the only thing lost)
 *   not enrolled               -> shadow: allow+log; enforce: block
 *   verified                   -> allow
 *   rejected                   -> shadow: allow+log; enforce: block
 *
 * `lockState` is what the app shows: 'off' means the badge, 'ok' means the
 * lock is doing its job, 'shadow' means it is measuring but not enforcing.
 */
function decide({ mode: rawMode, result, error, failMode: rawFailMode } = {}) {
  const m = validMode(rawMode);
  const fm = validFailMode(rawFailMode);

  if (m === "off") {
    return { allow: true, verified: false, reason: "lock_off", lockState: "off" };
  }

  if (error) {
    if (fm === "closed") {
      return { allow: false, verified: false, reason: "service_down", lockState: "off" };
    }
    console.warn(
      `[VOICE LOCK] service unreachable (${error.message || error}) — failing OPEN, billing continues`
    );
    return { allow: true, verified: false, reason: "service_down", lockState: "off" };
  }

  // Shadow must reproduce today's behaviour EXACTLY — allowing every clip and
  // only recording what enforcement would have decided. Checking too_short
  // before this branch would make shadow drop short clips, which is a change
  // in behaviour and would make the week of collected data incomparable.
  if (m === "shadow") {
    if (result?.is_speaker === true) {
      return { allow: true, verified: true, reason: "verified", lockState: "shadow" };
    }
    console.log(
      `[VOICE LOCK] shadow: would reject ` +
        `(reason=${result?.reason || "not_speaker"} score=${result?.score ?? "n/a"} ` +
        `threshold=${result?.threshold ?? "n/a"})`
    );
    return {
      allow: true,
      verified: false,
      reason: result?.reason === "too_short" ? "shadow_too_short" : "shadow_reject",
      lockState: "shadow",
    };
  }

  if (result?.reason === "too_short") {
    return { allow: false, verified: false, reason: "too_short", lockState: "ok" };
  }

  if (result?.is_speaker === true) {
    return { allow: true, verified: true, reason: "verified", lockState: "ok" };
  }

  return { allow: false, verified: false, reason: "not_speaker", lockState: "ok" };
}

/**
 * Verify an audio FILE against the enrolled owner.
 * Returns { status: 'ok', score, is_speaker, threshold, reason? }
 *      or { status: 'not_enrolled' }
 * Throws when the service itself is unreachable / misbehaving — decide() turns
 * that into the fail mode.
 */
async function verifySpeaker(audioPath, shopId) {
  const form = new FormData();
  form.append("audio", fs.createReadStream(audioPath));
  form.append("speaker_id", speakerIdFor(shopId));

  const res = await axios.post(`${SERVICE_URL()}/verify`, form, {
    headers: headers(form.getHeaders()),
    timeout: 15000,
    validateStatus: () => true,
  });

  if (res.status === 404) return { status: "not_enrolled" };
  if (res.status === 401) {
    throw new Error("voice service rejected the token — check VOICE_SERVICE_TOKEN");
  }
  if (res.status !== 200) {
    const detail = res.data?.detail || `HTTP ${res.status}`;
    throw new Error(`Voice service error: ${detail}`);
  }

  return { status: "ok", ...res.data };
}

/**
 * One enrollment clip. Returns the service's JSON.
 * `quality_rejected: true` when the service refused the clip (422) — the app
 * shows the reason and lets the owner retry that clip.
 */
async function enrollSample(audioPath, shopId) {
  const form = new FormData();
  form.append("audio", fs.createReadStream(audioPath));
  form.append("speaker_id", speakerIdFor(shopId));

  const res = await axios.post(`${SERVICE_URL()}/enroll`, form, {
    headers: headers(form.getHeaders()),
    timeout: 30000,
    validateStatus: () => true,
  });

  if (res.status === 200) return { ok: true, ...res.data };

  if (res.status === 422) {
    return { ok: false, quality_rejected: true, error: res.data?.detail || "Clip rejected" };
  }
  if (res.status === 400) {
    return { ok: false, error: res.data?.detail || "Audio could not be processed" };
  }
  return { ok: false, error: res.data?.detail || `HTTP ${res.status}` };
}

/**
 * Enrollment state as the app needs it: enrolled? how many samples? which
 * mode is the lock in, and is the service actually up?
 */
async function getVoiceStatus(shopId) {
  if (mode(shopId) === "off") {
    // Still report whether the service is reachable, so the badge is honest.
    let serviceUp = false;
    try {
      serviceUp = await checkVoiceService();
    } catch {
      serviceUp = false;
    }
    return { enrolled: false, samples: 0, mode: "off", service_up: serviceUp };
  }

  const res = await axios.get(`${SERVICE_URL()}/status`, {
    headers: headers(),
    timeout: 3000,
    params: { speaker_id: speakerIdFor(shopId) },
  });
  return {
    enrolled: Boolean(res.data?.enrolled),
    samples: Number(res.data?.samples || 0),
    mode: mode(shopId),
    service_up: true,
    threshold: res.data?.threshold,
  };
}

/** Delete the stored profile (re-enrollment). */
async function resetVoice(shopId) {
  const form = new FormData();
  form.append("speaker_id", speakerIdFor(shopId));
  const res = await axios.post(`${SERVICE_URL()}/reset`, form, {
    headers: headers(form.getHeaders()),
    timeout: 10000,
  });
  return res.data;
}

/**
 * Boot check — same shape as checkWhatsAppConfig(): a boolean plus problems
 * to log. Never throws.
 */
async function checkVoiceService() {
  const res = await axios.get(`${SERVICE_URL()}/health`, { timeout: 2000 });
  return res.status === 200 && res.data?.status === "ok";
}

/** Human-readable summary line for server.js startup. */
async function voiceBootSummary() {
  const m = mode();
  if (m === "off") {
    return { line: "[VOICE LOCK] mode=off — all audio passes through", up: true };
  }
  try {
    const res = await axios.get(`${SERVICE_URL()}/health`, { timeout: 2000 });
    const enrolled = Boolean(res.data?.enrolled);
    return {
      line: `[VOICE LOCK] mode=${m} service=up enrolled=${enrolled}`,
      up: true,
      enrolled,
    };
  } catch (e) {
    return {
      line: `[VOICE LOCK] mode=${m} service=DOWN — fail mode=${failMode()}`,
      up: false,
      enrolled: false,
    };
  }
}

module.exports = {
  decide,
  verifySpeaker,
  enrollSample,
  getVoiceStatus,
  resetVoice,
  checkVoiceService,
  voiceBootSummary,
  mode,
  failMode,
  setOverride,
  getOverride,
  speakerIdFor,
};