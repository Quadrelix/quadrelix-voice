// End-to-end over real HTTP: two shops, one app. Nothing here stubs the routes —
// the shop gate, ownership checks, finalize and freeze all run as in production.
// Only the database adapter (lowdb file) and the absent WhatsApp provider differ.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ownership-"));
process.env.DB_FILE = path.join(tmp, "db.json");
process.env.BILLS_DIR = path.join(tmp, "bills");
process.env.UPLOAD_DIR = path.join(tmp, "uploads");
delete process.env.GEMINI_API_KEY; // offline regex parser
delete process.env.WHATSAPP_PROVIDER; // simulated delivery
delete process.env.ALLOW_LEGACY_SHOP;

const db = require("../src/db/db");
const app = require("../src/app");

let server;
let base;
let shopA;
let shopB;

test.before(async () => {
  await db.init();
  shopA = await db.createShop({ shop_name: "Shop A", upi_id: "a@upi", owner_phone: "9000000001" });
  shopB = await db.createShop({ shop_name: "Shop B", upi_id: "b@upi", owner_phone: "9000000002" });
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
    headers: {
      ...(code ? { "X-Shop-Code": code } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, body: json };
}

async function newSaleForA(text = "2 aam 60 rupay") {
  const r = await call("POST", "/api/utterance", { code: shopA.shop_code, body: { text } });
  assert.equal(r.status, 200);
  assert.ok(r.body.transaction, "sale created");
  return r.body.transaction;
}

test("no shop code at all is refused — there is no silent demo-shop fallback", async () => {
  const noCode = await call("GET", "/api/products");
  assert.equal(noCode.status, 401);
  const badCode = await call("GET", "/api/products", { code: "ZZZZZZ" });
  assert.equal(badCode.status, 404);
});

test("shop B can neither read nor change shop A's transaction, on any route", async () => {
  const txn = await newSaleForA();
  const id = txn.transaction_id;
  const before = await db.getTransaction(id);

  const attacks = [
    ["GET", `/api/transaction/${id}`],
    ["POST", "/api/update-item-price", { transaction_id: id, item_index: 0, price: 1 }],
    ["POST", "/api/confirm-contact", { transaction_id: id, phone: "9876543210" }],
    ["POST", "/api/generate-bill", { transaction_id: id }],
    ["POST", "/api/send-bill", { transaction_id: id }],
    ["POST", "/api/finalize", { transaction_id: id, phone: "9876543210" }],
    ["POST", "/api/parse-item", { transaction_id: id, text: "5 sabun 10 rupay" }],
    ["POST", "/api/utterance", { transaction_id: id, text: "5 sabun 10 rupay" }],
  ];
  for (const [method, route, body] of attacks) {
    const r = await call(method, route, { code: shopB.shop_code, body });
    assert.equal(r.status, 404, `${method} ${route} must 404 for another shop`);
    assert.equal(r.body.error, "Transaction not found");
  }
  // ...and with no credentials at all.
  assert.equal((await call("GET", `/api/transaction/${id}`)).status, 401);

  assert.deepEqual(await db.getTransaction(id), before, "nothing about the sale changed");
  assert.equal((await call("GET", `/api/transaction/${id}`, { code: shopA.shop_code })).status, 200);
});

test("a disabled shop's code stops working", async () => {
  const shop = await db.createShop({ shop_name: "Closing Shop" });
  assert.equal((await call("GET", "/api/shop", { code: shop.shop_code })).status, 200);
  await db.updateShop(shop.shop_id, { active: false });
  assert.equal((await call("GET", "/api/shop", { code: shop.shop_code })).status, 404);
});

test("finalize completes once: stock moves once, delivery is honest, the bill freezes", async () => {
  const code = shopA.shop_code;
  const created = await call("POST", "/api/products", {
    code, body: { name: "Aam", purchase_price: 40, selling_price: 60, stock_qty: 10 },
  });
  assert.equal(created.status, 201);
  const sale = await call("POST", "/api/utterance", { code, body: { text: "2 aam" } });
  assert.equal(sale.body.transaction.items[0].price, 60, "catalog price filled");
  const id = sale.body.transaction.transaction_id;

  const first = await call("POST", "/api/finalize", {
    code, body: { transaction_id: id, phone: "9876543210", payment_status: "credit" },
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.delivery_status, "simulated", "no provider -> not claimed as sent");
  assert.equal(first.body.transaction.status, "confirmed", "simulated delivery is not 'sent'");
  assert.equal(first.body.transaction.payment_status, "credit");
  assert.ok(first.body.bill_filename, "bill file name always returned (share sheet needs it)");
  assert.ok(first.body.transaction.finalized_at);
  const stockAfterFirst = (await call("GET", "/api/products", { code })).body.products[0].stock_qty;
  assert.equal(stockAfterFirst, 8);

  // A retry after a dropped response: same sale back, nothing repeated.
  const retry = await call("POST", "/api/finalize", {
    code, body: { transaction_id: id, phone: "9876543210", payment_status: "paid" },
  });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.already_finalized, true);
  assert.equal(retry.body.transaction.payment_status, "credit", "a retry cannot rewrite the sale");
  assert.equal((await call("GET", "/api/products", { code })).body.products[0].stock_qty, 8);

  // Frozen: no edits of any kind after completion.
  const edit = await call("POST", "/api/update-item-price", {
    code, body: { transaction_id: id, item_index: 0, price: 1 },
  });
  assert.equal(edit.status, 409);
  assert.equal(edit.body.code, "bill_frozen");
  const more = await call("POST", "/api/utterance", { code, body: { transaction_id: id, text: "3 sabun 10 rupay" } });
  assert.equal(more.status, 409);
  const phoneChange = await call("POST", "/api/confirm-contact", {
    code, body: { transaction_id: id, phone: "9999999999" },
  });
  assert.equal(phoneChange.status, 409);
  assert.match(phoneChange.body.error, /finalized/);
  assert.equal((await db.getTransaction(id)).total_amount, 120);
});

test("a failed WhatsApp send never undoes the sale and is reported as failed", async (t) => {
  const code = shopA.shop_code;
  const sale = await newSaleForA("1 sabun 20 rupay");
  // A configured provider with missing credentials throws inside the real send.
  process.env.WHATSAPP_PROVIDER = "twilio";
  delete process.env.TWILIO_SID;
  t.after(() => { delete process.env.WHATSAPP_PROVIDER; });

  const r = await call("POST", "/api/finalize", {
    code, body: { transaction_id: sale.transaction_id, phone: "9876543210" },
  });
  assert.equal(r.status, 200, "the SALE succeeded");
  assert.equal(r.body.delivery_status, "failed");
  assert.match(r.body.send_error, /TWILIO/i);
  assert.ok(r.body.bill_filename);
  assert.equal(r.body.transaction.status, "confirmed");
  assert.equal((await db.getTransaction(sale.transaction_id)).delivery_status, "failed");
});

test("voice override and reset fail closed without an admin PIN, and are per shop", async () => {
  delete process.env.VOICE_ADMIN_PIN;
  const open = await call("POST", "/api/voice-override", { code: shopA.shop_code, body: { mode: "off" } });
  assert.equal(open.status, 503);
  const reset = await call("POST", "/api/voice-reset", { code: shopA.shop_code, body: { pin: "" } });
  assert.equal(reset.status, 503);

  process.env.VOICE_ADMIN_PIN = "4321";
  try {
    const wrong = await call("POST", "/api/voice-override", { code: shopA.shop_code, body: { mode: "off", pin: "0000" } });
    assert.equal(wrong.status, 403);
    const ok = await call("POST", "/api/voice-override", { code: shopA.shop_code, body: { mode: "off", pin: "4321" } });
    assert.equal(ok.status, 200);
    const voice = require("../src/services/voiceVerify");
    assert.equal(voice.mode(shopA.shop_id), "off");
    assert.equal(voice.mode(shopB.shop_id), "off", "env default (off) — and importantly not changed by A");
    process.env.VOICE_LOCK_MODE = "enforce";
    assert.equal(voice.mode(shopA.shop_id), "off", "A is overridden");
    assert.equal(voice.mode(shopB.shop_id), "enforce", "B keeps its own mode");
    await call("POST", "/api/voice-override", { code: shopA.shop_code, body: { mode: "clear", pin: "4321" } });
    assert.equal(voice.mode(shopA.shop_id), "enforce");
  } finally {
    delete process.env.VOICE_ADMIN_PIN;
    delete process.env.VOICE_LOCK_MODE;
  }
});
