// Run with: npm test   (offline, no service, no mic)
//
// decide() is the entire Voice Lock policy in one pure function, so it is the
// one thing that must be exhaustively tested. Every combination below is a
// real situation: owner speaking, customer speaking, service crashed on a busy
// morning, a clip too short to score, and a shop that hasn't enrolled yet.

const test = require("node:test");
const assert = require("node:assert");

const { decide } = require("../src/services/voiceVerify");

const VERIFIED = { status: "ok", is_speaker: true, score: 0.62, threshold: 0.3 };
const REJECTED = { status: "ok", is_speaker: false, score: 0.11, threshold: 0.3 };
const TOO_SHORT = { status: "ok", is_speaker: false, score: 0, reason: "too_short" };
const DOWN = new Error("connect ECONNREFUSED 127.0.0.1:8000");

// --- off mode ---------------------------------------------------------------

test("off mode: everything passes, nothing is claimed as verified", () => {
  for (const result of [VERIFIED, REJECTED, TOO_SHORT]) {
    const d = decide({ mode: "off", result, failMode: "open" });
    assert.strictEqual(d.allow, true);
    assert.strictEqual(d.verified, false);
    assert.strictEqual(d.lockState, "off");
  }
});

test("off mode does not even look at a service error", () => {
  const d = decide({ mode: "off", error: DOWN, failMode: "closed" });
  assert.strictEqual(d.allow, true);
});

// --- enforce mode -----------------------------------------------------------

test("enforce: the owner is allowed and marked verified", () => {
  const d = decide({ mode: "enforce", result: VERIFIED });
  assert.strictEqual(d.allow, true);
  assert.strictEqual(d.verified, true);
  assert.strictEqual(d.lockState, "ok");
});

test("enforce: a stranger is blocked", () => {
  const d = decide({ mode: "enforce", result: REJECTED });
  assert.strictEqual(d.allow, false);
  assert.strictEqual(d.verified, false);
  assert.strictEqual(d.reason, "not_speaker");
});

test("enforce: a too-short clip is blocked with its own reason", () => {
  const d = decide({ mode: "enforce", result: TOO_SHORT });
  assert.strictEqual(d.allow, false);
  assert.strictEqual(d.reason, "too_short");
});

test("enforce: service down fails open by default — billing keeps working", () => {
  const d = decide({ mode: "enforce", error: DOWN, failMode: "open" });
  assert.strictEqual(d.allow, true);
  assert.strictEqual(d.verified, false);
  assert.strictEqual(d.reason, "service_down");
  assert.strictEqual(d.lockState, "off"); // app shows the badge
});

test("enforce: fail-closed blocks when the service is down", () => {
  const d = decide({ mode: "enforce", error: DOWN, failMode: "closed" });
  assert.strictEqual(d.allow, false);
  assert.strictEqual(d.reason, "service_down");
});

// --- shadow mode ------------------------------------------------------------

test("shadow: the owner is verified but the lock is not enforcing", () => {
  const d = decide({ mode: "shadow", result: VERIFIED });
  assert.strictEqual(d.allow, true);
  assert.strictEqual(d.verified, true);
  assert.strictEqual(d.lockState, "shadow");
});

test("shadow: a stranger passes — but is NOT marked verified", () => {
  // The point of shadow: billing is untouched, and the app must not tell the
  // shopkeeper "verified" when it wasn't.
  const d = decide({ mode: "shadow", result: REJECTED });
  assert.strictEqual(d.allow, true);
  assert.strictEqual(d.verified, false);
  assert.strictEqual(d.reason, "shadow_reject");
  assert.strictEqual(d.lockState, "shadow");
});

test("shadow: a too-short clip is still allowed in shadow", () => {
  // D2 says reject when enforcing; in shadow we must reproduce today's
  // behaviour exactly, otherwise the week of data is not comparable.
  const d = decide({ mode: "shadow", result: TOO_SHORT });
  assert.strictEqual(d.allow, true);
  assert.strictEqual(d.verified, false);
});

test("shadow: service down still lets everything through", () => {
  const d = decide({ mode: "shadow", error: DOWN, failMode: "open" });
  assert.strictEqual(d.allow, true);
  assert.strictEqual(d.lockState, "off");
});

// --- invalid input ----------------------------------------------------------

test("an unknown mode falls back to off, never to enforce", () => {
  // A typo in .env must not silently lock the shop out of billing.
  for (const mode of ["ENFORCE?", "on", "", null, undefined]) {
    const d = decide({ mode, result: REJECTED });
    assert.strictEqual(d.allow, true, String(mode));
  }
});

test("an unknown fail mode falls back to open", () => {
  const d = decide({ mode: "enforce", error: DOWN, failMode: "maybe" });
  assert.strictEqual(d.allow, true);
});

test("the lock state always answers the app's question", () => {
  for (const d of [
    decide({ mode: "off" }),
    decide({ mode: "shadow", result: VERIFIED }),
    decide({ mode: "enforce", result: VERIFIED }),
    decide({ mode: "enforce", result: REJECTED }),
  ]) {
    assert.ok(["off", "shadow", "ok"].includes(d.lockState), d.lockState);
  }
});