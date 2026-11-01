// Upload and abuse controls, over real HTTP. Kept in its own file because the
// failed-code lockout is per IP and the whole test process shares 127.0.0.1.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "limits-"));
process.env.DB_FILE = path.join(tmp, "db.json");
process.env.BILLS_DIR = path.join(tmp, "bills");
process.env.UPLOAD_DIR = path.join(tmp, "uploads");
delete process.env.SARVAM_API_KEY; // any request that reached STT would fail loudly
process.env.STT_DAILY_LIMIT = "1000";

const db = require("../src/db/db");
const app = require("../src/app");

let server;
let base;
let shop;

test.before(async () => {
  await db.init();
  shop = await db.createShop({ shop_name: "Limits Shop" });
  await new Promise((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
});

function audioForm(bytes, type = "audio/m4a") {
  const form = new FormData();
  form.append("audio", new Blob([new Uint8Array(bytes)], { type }), "recording.m4a");
  return form;
}
const uploads = () => fs.readdirSync(process.env.UPLOAD_DIR);

test("an unauthenticated upload is refused before anything touches the disk", async () => {
  for (const route of ["/api/transcribe", "/api/verify-and-transcribe", "/api/enroll-voice"]) {
    const res = await fetch(base + route, { method: "POST", body: audioForm(1000) });
    assert.equal(res.status, 401, route);
  }
  assert.deepEqual(uploads(), [], "no temp file was written");
});

test("oversized and non-audio uploads are rejected, and cleaned up", async () => {
  const headers = { "X-Shop-Code": shop.shop_code };
  const big = await fetch(base + "/api/transcribe", {
    method: "POST", headers, body: audioForm(6 * 1024 * 1024),
  });
  assert.equal(big.status, 413);

  const wrongType = await fetch(base + "/api/transcribe", {
    method: "POST", headers, body: audioForm(1000, "text/plain"),
  });
  assert.equal(wrongType.status, 415);

  // A valid small clip gets past the gate and fails only at the (absent) STT key.
  const ok = await fetch(base + "/api/transcribe", { method: "POST", headers, body: audioForm(1000) });
  assert.equal(ok.status, 400);
  assert.match((await ok.json()).error, /SARVAM_API_KEY/);
  await new Promise((r) => setTimeout(r, 50)); // unlink is fire-and-forget
  assert.deepEqual(uploads(), [], "temp files are removed on every path");
});

test("a malformed JSON body gets a clean 400, not a stack trace", async () => {
  const res = await fetch(base + "/api/utterance", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shop-Code": shop.shop_code },
    body: "{not json",
  });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "Invalid JSON body");
});

test("per-shop rate limit answers 429 with Retry-After", async () => {
  const headers = { "X-Shop-Code": shop.shop_code, "Content-Type": "application/json" };
  let limited = null;
  for (let i = 0; i < 100 && !limited; i++) {
    const res = await fetch(base + "/api/utterance", {
      method: "POST", headers, body: JSON.stringify({ text: "haan" }),
    });
    if (res.status === 429) limited = res;
  }
  assert.ok(limited, "the 91st request in a minute is refused");
  assert.ok(Number(limited.headers.get("retry-after")) >= 1);
});

test("guessing shop codes locks the caller out (LAST: it blocks this IP)", async () => {
  let locked = false;
  for (let i = 0; i < 40 && !locked; i++) {
    const res = await fetch(base + "/api/shop", { headers: { "X-Shop-Code": `BAD${i}` } });
    if (res.status === 429) locked = true;
  }
  assert.ok(locked, "after repeated wrong codes the IP gets 429");
  // Even a correct code is refused while locked out — that is the point.
  const res = await fetch(base + "/api/shop", { headers: { "X-Shop-Code": shop.shop_code } });
  assert.equal(res.status, 429);
});
