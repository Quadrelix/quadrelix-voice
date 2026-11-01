// Real-PostgreSQL regression tests for sale completion. The lowdb adapter used
// by the rest of the suite cannot prove any of this: locking, rollback and the
// frozen-bill guards only exist in the SQL.
//
// Explicit opt-in only. Never reads DATABASE_URL or .env for test credentials.
// Each run creates and drops its own schema in the supplied test database.
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

test("PostgreSQL finalizeSale: atomic, idempotent under races, freezes the bill", {
  skip: !process.env.TEST_DATABASE_URL && "Set TEST_DATABASE_URL to a disposable PostgreSQL database",
}, async (t) => {
  const { Client } = require("pg");
  const schema = `finalize_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await admin.connect();
  let db;
  t.after(async () => {
    try { if (db) await db.close(); }
    finally {
      try { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); }
      finally { await admin.end(); }
    }
  });
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.searchParams.set("options", `-c search_path=${schema}`);
  process.env.DATABASE_URL = url.toString();
  delete process.env.DB_FILE;
  db = require("../src/db/db");
  await db.init();
  await db.init(); // the schema (incl. ALTER/UPDATE backfills) must be re-runnable

  const shop = await db.createShop({ shop_name: "Finalize regression" });
  const stock = async (id) =>
    (await db.listProducts(shop.shop_id)).find((p) => p.product_id === id).stock_qty;
  const mkProduct = (name, qty) =>
    db.upsertProduct(shop.shop_id, { name, purchase_price: 5, selling_price: 10, stock_qty: qty, min_stock_level: null });
  const mkSale = (items) => db.createTransaction({ shop_id: shop.shop_id, items });
  const line = (product, quantity) => ({
    product_name: product.name, quantity, price: 10, line_total: quantity * 10,
    product_id: product.product_id, purchase_price: 5,
  });

  await t.test("concurrent finalize calls deduct stock exactly once", async () => {
    const rice = await mkProduct("Rice", 100);
    const sale = await mkSale([line(rice, 4)]);
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        db.finalizeSale(sale.transaction_id, {
          phone: "9876543210", payment_status: "paid", bill_image_path: `bill-${i}.png`,
        }))
    );
    assert.equal(results.filter((r) => !r.already_finalized).length, 1, "exactly one winner");
    assert.equal(await stock(rice.product_id), 96);
    const final = await db.getTransaction(sale.transaction_id);
    assert.equal(final.status, "confirmed");
    assert.ok(final.finalized_at);
    // Every caller sees the winner's bill, not its own.
    for (const r of results) assert.equal(r.transaction.bill_image_path, final.bill_image_path);
  });

  await t.test("a failure part-way through rolls the WHOLE sale back", async () => {
    const sugar = await mkProduct("Sugar", 50);
    // The second line carries a product_id that is not a UUID: its stock UPDATE
    // throws AFTER the transaction row was updated and Sugar was deducted.
    const bad = { ...line(sugar, 1), product_id: "not-a-uuid" };
    const sale = await mkSale([line(sugar, 5), bad]);
    await assert.rejects(
      db.finalizeSale(sale.transaction_id, { phone: "9876543210", bill_image_path: "bill-x.png" })
    );
    assert.equal(await stock(sugar.product_id), 50, "no partial stock deduction survived");
    const after = await db.getTransaction(sale.transaction_id);
    assert.equal(after.finalized_at, null, "the sale is NOT marked complete");
    assert.equal(after.bill_image_path, null, "no bill marker without its stock movement");
    assert.equal(after.status, "draft");
    assert.equal(after.customer_phone, null);
  });

  await t.test("an incomplete bill cannot be finalized", async () => {
    const empty = await mkSale([]);
    await assert.rejects(db.finalizeSale(empty.transaction_id, { bill_image_path: "x.png" }), /no items/);
    const unpriced = await mkSale([{ product_name: "Tomato", quantity: 1, price: null, line_total: null }]);
    await assert.rejects(db.finalizeSale(unpriced.transaction_id, { bill_image_path: "x.png" }), /missing a price/);
    await assert.rejects(db.finalizeSale(randomUUID(), { bill_image_path: "x.png" }), /not found/);
  });

  await t.test("a finalized bill is frozen against every edit", async () => {
    const oil = await mkProduct("Oil", 20);
    const sale = await mkSale([line(oil, 2)]);
    await db.finalizeSale(sale.transaction_id, { phone: "9876543210", bill_image_path: "bill-y.png" });
    const frozen = (p) => assert.rejects(p, (e) => e.code === "bill_frozen");
    await frozen(db.addItemsToTransaction(sale.transaction_id, [line(oil, 1)]));
    await frozen(db.updateItemPrice(sale.transaction_id, 0, 99));
    await frozen(db.setCustomerPhone(sale.transaction_id, "9999999999"));
    const final = await db.getTransaction(sale.transaction_id);
    assert.equal(final.total_amount, 20);
    assert.equal(final.customer_phone, "9876543210");
    assert.equal(await stock(oil.product_id), 18);
    // A missing transaction is still "not found", not "frozen".
    await assert.rejects(db.updateItemPrice(randomUUID(), 0, 5), /not found/i);
  });

  await t.test("delivery status is separate from the sale", async () => {
    const salt = await mkProduct("Salt", 9);
    const sale = await mkSale([line(salt, 1)]);
    await db.finalizeSale(sale.transaction_id, { phone: "9876543210", bill_image_path: "bill-z.png" });
    assert.equal((await db.getTransaction(sale.transaction_id)).delivery_status, "none");
    const simulated = await db.markDelivery(sale.transaction_id, "simulated");
    assert.equal(simulated.status, "confirmed", "simulated is not 'sent'");
    const failed = await db.markDelivery(sale.transaction_id, "failed");
    assert.equal(failed.status, "confirmed");
    const sent = await db.markDelivery(sale.transaction_id, "sent");
    assert.equal(sent.status, "sent");
    assert.equal(sent.delivery_status, "sent");
  });
});
