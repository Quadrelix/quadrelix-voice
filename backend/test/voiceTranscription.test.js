// Exercise the real route handler and the mobile response policy together.
// Stub only external I/O: no PostgreSQL, Sarvam calls, Python service or mic.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { isVoiceAllowed } = require("../../mobile-app/services/voiceResponse.js");
const db = require("../src/db/db");
const voice = require("../src/services/voiceVerify");
const transcription = require("../src/services/transcribe");

test("voice route and mobile agree on allowed speech independently of verification", async (t) => {
  const transcript = "2 Dettol sabun 10 rupay";
  const transcribe = t.mock.method(transcription, "transcribeAudio", async () => transcript);
  t.mock.method(db, "getShopByCode", async () => ({ shop_id: "test_shop" }));
  t.mock.method(fs, "unlink", (file, callback) => callback(null));

  // The route destructures transcribeAudio at import time, after the stub.
  const router = require("../src/routes/sale");
  const route = router.stack.find((layer) => layer.route?.path === "/verify-and-transcribe").route;
  const handler = route.stack[route.stack.length - 1].handle;

  const cases = [
    { name: "Render default: lock off accepts unverified speech", mode: "off", allowed: true, verified: false },
    { name: "shadow accepts a non-owner", mode: "shadow", result: { is_speaker: false }, allowed: true, verified: false },
    { name: "shadow accepts short speech", mode: "shadow", result: { is_speaker: false, reason: "too_short" }, allowed: true, verified: false },
    { name: "enforce accepts the owner", mode: "enforce", result: { is_speaker: true }, allowed: true, verified: true },
    { name: "enforce rejects a non-owner before STT", mode: "enforce", result: { is_speaker: false }, allowed: false, verified: false },
    { name: "enforce rejects short speech before STT", mode: "enforce", result: { is_speaker: false, reason: "too_short" }, allowed: false, verified: false },
    { name: "enforce rejects an unenrolled shop", mode: "enforce", result: { status: "not_enrolled" }, allowed: false, verified: false },
    { name: "service outage with fail-open accepts speech", mode: "enforce", down: true, failMode: "open", allowed: true, verified: false },
    { name: "service outage with fail-closed rejects speech", mode: "enforce", down: true, failMode: "closed", allowed: false, verified: false },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async (st) => {
      st.mock.method(voice, "mode", () => scenario.mode);
      st.mock.method(voice, "failMode", () => scenario.failMode || "open");
      const verify = st.mock.method(voice, "verifySpeaker", async () => {
        if (scenario.down) throw new Error("test service unavailable");
        return scenario.result;
      });
      const callsBefore = transcribe.mock.callCount();
      const req = {
        file: { path: "synthetic-audio.m4a" },
        query: {},
        header: (name) => name === "X-Shop-Code" ? "TEST01" : undefined,
      };
      const res = {
        statusCode: 200,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; },
      };

      await handler(req, res);

      assert.equal(res.statusCode, 200);
      assert.equal(res.body.allowed, scenario.allowed);
      assert.equal(res.body.speaker_verified, scenario.verified);
      assert.equal(res.body.text, scenario.allowed ? transcript : "");
      assert.equal(isVoiceAllowed(res.body), scenario.allowed);
      assert.equal(transcribe.mock.callCount() - callsBefore, scenario.allowed ? 1 : 0);
      assert.equal(verify.mock.callCount(), scenario.mode === "off" ? 0 : 1);
      if (scenario.mode !== "off") assert.equal(verify.mock.calls[0].arguments[1], "test_shop");
    });
  }
});

test("new mobile app accepts transcripts from the previous backend during rollout", () => {
  for (const lock_state of ["off", "shadow", "ok"]) {
    assert.equal(isVoiceAllowed({ text: "2 sabun", speaker_verified: false, lock_state }), true);
  }
  // Old fail-closed responses also use lock_state=off: never infer permission
  // from that field, since it describes service health rather than the gate.
  assert.equal(isVoiceAllowed({ text: "", speaker_verified: false, lock_state: "off", reason: "service_down" }), false);
  assert.equal(isVoiceAllowed({ text: "", speaker_verified: false, lock_state: "ok" }), false);
});

test("an explicit denial takes precedence over transcript and verification fields", () => {
  assert.equal(isVoiceAllowed({ allowed: false, text: "2 sabun", speaker_verified: true }), false);
  assert.equal(isVoiceAllowed({ allowed: "false", text: "2 sabun" }), false);
  assert.equal(isVoiceAllowed(null), false);
  assert.equal(isVoiceAllowed({}), false);
});

test("allowed silence is not a speaker rejection", () => {
  assert.equal(isVoiceAllowed({ allowed: true, text: "", speaker_verified: false }), true);
});
