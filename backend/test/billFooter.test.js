// Per-shop bill footer (thank-you text printed under the QR code).
//
// Over real HTTP for the admin API (create/patch/validation) and straight at the
// renderer for the picture itself. Offline: lowdb file + the bundled fonts.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "footer-"));
process.env.DB_FILE = path.join(tmp, "db.json");
process.env.BILLS_DIR = path.join(tmp, "bills");
process.env.UPLOAD_DIR = path.join(tmp, "uploads");
process.env.ADMIN_TOKEN = "footer-test-token";
delete process.env.GEMINI_API_KEY;
delete process.env.WHATSAPP_PROVIDER;

const db = require("../src/db/db");
const app = require("../src/app");
const { generateBillImage } = require("../src/services/billImage");

let server;
let base;

test.before(async () => {
  await db.init();
  await new Promise((resolve) => { server = app.listen(0, "127.0.0.1", resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function admin(method, route, body) {
  const res = await fetch(base + route, {
    method,
    headers: { Authorization: "Bearer footer-test-token", "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

function pngHeight(file) {
  const buf = fs.readFileSync(file);
  return buf.readUInt32BE(20);
}

const items = [{ product_name: "साड़ी", quantity: 1, price: 1200, line_total: 1200 }];
let n = 0;
const bill = (footer) => ({
  transaction: { transaction_id: `footer-${++n}`, items, total_amount: 1200 },
  shop: { shop_name: "Pankhudi Saree Center", owner_phone: "9876543210", upi_id: "p@upi", bill_footer: footer },
});

const PANKHUDI = [
  "PANKHUDI SAREE CENTER",
  "",
  "Dear Customer,",
  "Thank you for choosing us!",
  "",
  "Your bill is attached for your reference.",
  "",
  "Pankhudi Saree Center",
  "Elegance in Every Thread.",
].join("\n");

test("a shop can be created with a footer and it is returned and stored", async () => {
  const r = await admin("POST", "/api/admin/shops", {
    shop_name: "Pankhudi Saree Center",
    shop_type: "kapda",
    upi_id: "pankhudi@upi",
    owner_phone: "9876543210",
    bill_footer: PANKHUDI,
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.shop.bill_footer, PANKHUDI);

  const stored = await db.getShop(r.body.shop.shop_id);
  assert.equal(stored.bill_footer, PANKHUDI);
});

test("a shop created without a footer has none, and PATCH can set and clear it", async () => {
  const created = await admin("POST", "/api/admin/shops", { shop_name: "Manish Kirana Store" });
  assert.equal(created.status, 201);
  assert.equal(created.body.shop.bill_footer ?? null, null);
  const id = created.body.shop.shop_id;

  const set = await admin("PATCH", `/api/admin/shops/${id}`, { bill_footer: "  Dhanyavaad!\nPhir aaiye  " });
  assert.equal(set.status, 200);
  assert.equal(set.body.shop.bill_footer, "Dhanyavaad!\nPhir aaiye", "trimmed");

  const cleared = await admin("PATCH", `/api/admin/shops/${id}`, { bill_footer: "" });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.shop.bill_footer ?? null, null);
});

test("an over-long footer is rejected on create and on patch", async () => {
  const tooLong = "x".repeat(601);
  const created = await admin("POST", "/api/admin/shops", { shop_name: "Too Long", bill_footer: tooLong });
  assert.equal(created.status, 400);

  const ok = await admin("POST", "/api/admin/shops", { shop_name: "Fine Shop" });
  const patched = await admin("PATCH", `/api/admin/shops/${ok.body.shop.shop_id}`, { bill_footer: tooLong });
  assert.equal(patched.status, 400);
});

test("the footer makes the bill taller and a footer-less bill is unchanged", async () => {
  const plain = pngHeight(await generateBillImage(bill(null)));
  const withFooter = pngHeight(await generateBillImage(bill(PANKHUDI)));
  assert.ok(withFooter > plain + 100, `footer should add height (${plain} -> ${withFooter})`);
  assert.equal(pngHeight(await generateBillImage(bill(""))), plain, "empty footer adds nothing");
  assert.equal(pngHeight(await generateBillImage(bill("   \n  \n"))), plain, "blank footer adds nothing");
});

test("emoji are dropped so the bill never prints empty boxes", async () => {
  const withEmoji = pngHeight(await generateBillImage(bill("🌸 PANKHUDI SAREE CENTER 🌸\n\nThank you! ❤️\n🙏 Visit Again!")));
  const without = pngHeight(await generateBillImage(bill("PANKHUDI SAREE CENTER\n\nThank you!\nVisit Again!")));
  assert.equal(withEmoji, without, "same layout once the emoji are removed");
});

test("long lines wrap instead of running off the bill", async () => {
  const short = pngHeight(await generateBillImage(bill("Thank you")));
  const long = pngHeight(await generateBillImage(bill(
    "Thank you for shopping with us, we hope to see you again very soon, and please tell your family and friends about our shop"
  )));
  assert.ok(long > short + 20, `long text should wrap onto more lines (${short} -> ${long})`);
});

test("Hindi footer text renders", async () => {
  const file = await generateBillImage(bill("धन्यवाद! फिर पधारिए\nआपकी अपनी दुकान"));
  assert.ok(fs.statSync(file).size > 5000);
});
