// /ping is the keep-alive target for an uptime monitor on free hosting. It must answer
// instantly and must NOT touch the database (that would keep the Neon compute awake and
// burn its monthly free allowance), while /health keeps checking the database.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ping-"));
process.env.DB_FILE = path.join(tmp, "db.json");
process.env.BILLS_DIR = path.join(tmp, "bills");
process.env.UPLOAD_DIR = path.join(tmp, "uploads");

const db = require("../src/db/db");
const app = require("../src/app");

let server;
let base;
let dbCalls = 0;

test.before(async () => {
  await db.init();
  // Count every database read: /ping must make none.
  const original = db.listShops;
  db.listShops = (...args) => { dbCalls++; return original(...args); };
  await new Promise((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("GET /ping answers ok without touching the database", async () => {
  const before = dbCalls;
  const res = await fetch(`${base}/ping`);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "ok");
  assert.match(res.headers.get("content-type"), /text\/plain/);
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(dbCalls, before, "/ping must not query the database");
});

test("HEAD /ping works too (some monitors use HEAD)", async () => {
  const res = await fetch(`${base}/ping`, { method: "HEAD" });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "");
});

test("/ping needs no shop code and is not rate limited like the API", async () => {
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${base}/ping`);
    assert.equal(res.status, 200);
  }
});

test("/health still checks the database", async () => {
  const before = dbCalls;
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).db, "up");
  assert.equal(dbCalls, before + 1, "/health queries the database");
});
