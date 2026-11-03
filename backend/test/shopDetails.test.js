// The owner sets their OWN UPI id and phone after logging in with the shop code
// (PATCH /api/shop), and a bill must never print a QR for a shop with no UPI id.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "shopdetails-"));
process.env.DB_FILE = path.join(tmp, "db.json");
process.env.BILLS_DIR = path.join(tmp, "bills");
process.env.UPLOAD_DIR = path.join(tmp, "uploads");
delete process.env.GEMINI_API_KEY;
delete process.env.ALLOW_LEGACY_SHOP;

const db = require("../src/db/db");
const app = require("../src/app");
const { generateBillImage } = require("../src/services/billImage");

let server;
let base;
let a;
let b;

test.before(async () => {
  await db.init();
  // Created exactly like the founder's script does: a name and nothing else.
  a = await db.createShop({ shop_name: "Fresh Shop A" });
  b = await db.createShop({ shop_name: "Fresh Shop B", upi_id: "b@okaxis", owner_phone: "9000000002" });
  await new Promise((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function call(method, route, { code, body } = {}) {
  const res = await fetch(base + route, {
    method,
    headers: { ...(code ? { "X-Shop-Code": code } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

test("a new shop starts with no UPI id or phone, and the owner fills them in", async () => {
  const before = await call("GET", "/api/shop", { code: a.shop_code });
  assert.equal(before.body.shop.upi_id ?? null, null);
  assert.equal(before.body.shop.owner_phone ?? null, null);

  const r = await call("PATCH", "/api/shop", {
    code: a.shop_code,
    body: { upi_id: "  pankhudi@okaxis ", owner_phone: "+91 98765 43210" },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.shop.upi_id, "pankhudi@okaxis", "trimmed");
  assert.equal(r.body.shop.owner_phone, "9876543210", "+91 and spaces removed");

  const after = await call("GET", "/api/shop", { code: a.shop_code });
  assert.equal(after.body.shop.upi_id, "pankhudi@okaxis");
  assert.equal(after.body.shop.owner_phone, "9876543210");
});

test("it only changes the shop whose code was used", async () => {
  await call("PATCH", "/api/shop", { code: a.shop_code, body: { upi_id: "changed-a@paytm" } });
  const other = await call("GET", "/api/shop", { code: b.shop_code });
  assert.equal(other.body.shop.upi_id, "b@okaxis", "shop B is untouched");
});

test("bad UPI ids and phones are refused with a code the app can translate", async () => {
  // its own shop: refused attempts count towards the per-shop edit limit too
  const a = await db.createShop({ shop_name: "Validation Shop" });
  for (const upi of ["no-at-sign", "a@", "@okaxis", "spaces in@okaxis", "x@1bank"]) {
    const r = await call("PATCH", "/api/shop", { code: a.shop_code, body: { upi_id: upi } });
    assert.equal(r.status, 400, `rejects ${upi}`);
    assert.equal(r.body.code, "bad_upi");
  }
  for (const phone of ["12345", "5876543210", "98765 4321", "abcdefghij"]) {
    const r = await call("PATCH", "/api/shop", { code: a.shop_code, body: { owner_phone: phone } });
    assert.equal(r.status, 400, `rejects ${phone}`);
    assert.equal(r.body.code, "bad_phone");
  }
  const empty = await call("PATCH", "/api/shop", { code: a.shop_code, body: {} });
  assert.equal(empty.status, 400);
  assert.equal(empty.body.code, "nothing_to_update");
});

test("a blank value clears the field", async () => {
  const r = await call("PATCH", "/api/shop", { code: a.shop_code, body: { upi_id: "" } });
  assert.equal(r.status, 200);
  assert.equal(r.body.shop.upi_id ?? null, null);
});

test("no shop code is refused", async () => {
  const r = await call("PATCH", "/api/shop", { body: { upi_id: "x@okaxis" } });
  assert.equal(r.status, 401);
});

test("the shop name and bill footer cannot be changed through this route", async () => {
  const r = await call("PATCH", "/api/shop", {
    code: b.shop_code,
    body: { upi_id: "b2@okaxis", shop_name: "Hacked", bill_footer: "pay me instead", active: false },
  });
  assert.equal(r.status, 200);
  const stored = await db.getShop(b.shop_id);
  assert.equal(stored.shop_name, "Fresh Shop B");
  assert.ok(!stored.bill_footer, "footer untouched");
  assert.notEqual(stored.active, false);
  assert.equal(stored.upi_id, "b2@okaxis");
});

test("edits are rate-limited per shop", async () => {
  const c = await db.createShop({ shop_name: "Rate Shop" });
  let last;
  for (let i = 0; i < 11; i++) {
    last = await call("PATCH", "/api/shop", { code: c.shop_code, body: { owner_phone: "9876543210" } });
  }
  assert.equal(last.status, 429);
});

const items = [{ product_name: "साड़ी", quantity: 1, price: 1200, line_total: 1200 }];
let n = 0;
const bill = (shop) => ({
  transaction: { transaction_id: `sd-${++n}`, items, total_amount: 1200 },
  shop: { shop_name: "Fresh Shop", ...shop },
});
const pngHeight = (file) => fs.readFileSync(file).readUInt32BE(20);

test("a bill for a shop with no UPI id has no QR (it would otherwise pay \"null\")", async () => {
  const withUpi = pngHeight(await generateBillImage(bill({ upi_id: "p@okaxis", owner_phone: "9876543210" })));
  const noUpi = pngHeight(await generateBillImage(bill({ upi_id: null, owner_phone: "9876543210" })));
  assert.ok(noUpi < withUpi - 250, `QR section should be gone (${withUpi} -> ${noUpi})`);
});

test("a bill still renders with neither UPI id nor phone", async () => {
  const file = await generateBillImage(bill({ upi_id: null, owner_phone: null }));
  assert.ok(fs.statSync(file).size > 3000);
  const empty = await generateBillImage(bill({ upi_id: "  ", owner_phone: "" }));
  assert.equal(pngHeight(empty), pngHeight(file), "blank strings behave like null");
});
