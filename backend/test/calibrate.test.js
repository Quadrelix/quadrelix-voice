// /api/calibrate-voice: score a clip and log it WITH a label, nothing else.
// A tiny stand-in voice service records what the backend sends it, so we can
// prove the label and speaker id arrive and that no bill or transcript is made.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "calibrate-"));
process.env.DB_FILE = path.join(tmp, "db.json");
process.env.BILLS_DIR = path.join(tmp, "bills");
process.env.UPLOAD_DIR = path.join(tmp, "uploads");
process.env.VOICE_SERVICE_TOKEN = "stub-token";
process.env.SARVAM_API_KEY = "must-not-be-used";
delete process.env.GEMINI_API_KEY;
delete process.env.ALLOW_LEGACY_SHOP;

const db = require("../src/db/db");
const app = require("../src/app");

let server;
let base;
let stub;
let stubReplies; // what the stand-in service answers next
const seen = []; // raw multipart bodies the stand-in received
let shop;

test.before(async () => {
  await db.init();
  shop = await db.createShop({ shop_name: "Calibration Shop", owner_phone: "9000000009" });

  stub = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      seen.push({ url: req.url, token: req.headers["x-voice-token"], body: Buffer.concat(chunks).toString("latin1") });
      const reply = stubReplies.shift() || { status: 200, json: { score: 0.5, is_speaker: true, threshold: 0.3 } };
      res.writeHead(reply.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(reply.json));
    });
  });
  await new Promise((resolve) => stub.listen(0, "127.0.0.1", resolve));
  process.env.VOICE_SERVICE_URL = `http://127.0.0.1:${stub.address().port}`;

  await new Promise((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => stub.close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
});

function post({ code = shop.shop_code, label, withAudio = true } = {}) {
  const form = new FormData();
  if (label !== undefined) form.append("label", label);
  if (withAudio) form.append("audio", new Blob([Buffer.from("fake audio bytes")], { type: "audio/mp4" }), "clip.m4a");
  return fetch(`${base}/api/calibrate-voice`, {
    method: "POST",
    headers: code ? { "X-Shop-Code": code } : {},
    body: form,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
}

test("the score comes back and the label + speaker id reach the voice service", async () => {
  seen.length = 0;
  stubReplies = [{ status: 200, json: { score: 0.4321, is_speaker: true, threshold: 0.3 } }];
  const r = await post({ label: "Owner_Noisy" });

  assert.equal(r.status, 200);
  assert.equal(r.body.status, "ok");
  assert.equal(r.body.label, "owner_noisy", "label is normalised");
  assert.equal(r.body.score, 0.4321);
  assert.equal(r.body.is_speaker, true);

  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "/verify");
  assert.equal(seen[0].token, "stub-token");
  assert.match(seen[0].body, /name="label"\r\n\r\nowner_noisy/);
  assert.match(seen[0].body, new RegExp(`name="speaker_id"\\r\\n\\r\\n${shop.shop_id}_owner`));
});

test("a shop that has not enrolled gets a clear not_enrolled answer", async () => {
  stubReplies = [{ status: 404, json: { detail: "not enrolled" } }];
  const r = await post({ label: "owner" });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "not_enrolled");
});

test("a too-short clip is reported, not treated as an error", async () => {
  stubReplies = [{ status: 200, json: { score: 0, is_speaker: false, threshold: 0.3, reason: "too_short" } }];
  const r = await post({ label: "other" });
  assert.equal(r.status, 200);
  assert.equal(r.body.reason, "too_short");
});

test("bad labels, missing audio and a missing shop code are refused without calling the service", async () => {
  seen.length = 0;
  assert.equal((await post({ label: "" })).status, 400);
  assert.equal((await post({ label: "has space" })).status, 400);
  assert.equal((await post({ label: "x".repeat(25) })).status, 400);
  assert.equal((await post({ label: "owner", withAudio: false })).status, 400);
  assert.equal((await post({ label: "owner", code: "" })).status, 401);
  assert.equal(seen.length, 0);
});

test("a down voice service is a 502, and no temp upload is left behind", async () => {
  stubReplies = [{ status: 500, json: { detail: "boom" } }];
  const r = await post({ label: "owner" });
  assert.equal(r.status, 502);
  // The temp file is removed asynchronously right after the response is sent, so give it
  // a moment instead of checking in the same instant (that raced on Linux CI).
  let left = [];
  for (let i = 0; i < 40; i++) {
    left = fs.existsSync(process.env.UPLOAD_DIR) ? fs.readdirSync(process.env.UPLOAD_DIR) : [];
    if (left.length === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.deepEqual(left, []);
});
