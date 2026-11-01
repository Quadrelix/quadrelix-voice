// Explicit opt-in only. Never reads DATABASE_URL or .env for test credentials.
// Each run creates and drops its own schema in the supplied test database.
const test = require("node:test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

test("PostgreSQL price updates: real SQL, validation and concurrent item changes", {
  skip: !process.env.TEST_DATABASE_URL && "Set TEST_DATABASE_URL to a disposable PostgreSQL database",
}, async (t) => {
  const { Client } = require("pg");
  const schema = `price_test_${randomUUID().replaceAll("-", "")}`;
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
  const shop = await db.createShop({ shop_name: "Price regression test" });
  const txn = await db.createTransaction({ shop_id: shop.shop_id, items: [
    { product_name: "Rice", quantity: 1.5, price: null, line_total: null, purchase_price: 8 },
    { product_name: "Soap", quantity: 2, price: 10, line_total: 20 },
    { product_name: "Salt", quantity: 1, price: null, line_total: null },
  ] });
  const updated = await db.updateItemPrice(txn.transaction_id, 0, "12.50");
  assert.equal(updated.items[0].price, 12.5);
  assert.equal(updated.items[0].line_total, 18.75);
  assert.equal(updated.items[0].purchase_price, 8);
  assert.deepEqual(updated.items.slice(1), txn.items.slice(1));
  assert.equal(updated.total_amount, 38.75);
  assert.deepEqual(await db.getTransaction(txn.transaction_id), updated);
  for (const price of [-1, Infinity, NaN, "", " ", null, true, [], {}]) {
    await assert.rejects(db.updateItemPrice(txn.transaction_id, 0, price), /price/);
  }
  for (const index of [-1, 0.5, "0", Infinity, 2147483648, 3]) {
    await assert.rejects(db.updateItemPrice(txn.transaction_id, index, 5));
  }
  await assert.rejects(db.updateItemPrice("missing", 0, 5), /not found/i);
  assert.deepEqual(await db.getTransaction(txn.transaction_id), updated);
  const free = await db.updateItemPrice(txn.transaction_id, 1, 0);
  assert.equal(free.total_amount, 18.75);
  assert.equal(free.items[1].line_total, 0);

  // Independent connections compete for the same row. All appended lines and
  // both price changes must survive regardless of which operation wins first.
  for (let round = 1; round <= 10; round++) {
    await Promise.all([
      db.updateItemPrice(txn.transaction_id, 0, round),
      db.addItemsToTransaction(txn.transaction_id, [
        { product_name: `Extra ${round}`, quantity: 1, price: 3, line_total: 3 },
      ]),
      db.updateItemPrice(txn.transaction_id, 1, round * 2),
    ]);
    const result = await db.getTransaction(txn.transaction_id);
    assert.equal(result.items.length, 3 + round);
    assert.equal(result.items[0].price, round);
    assert.equal(result.items[1].price, round * 2);
    assert.equal(result.total_amount, round * 8.5);
    assert.equal(result.total_amount, result.items.reduce((sum, item) => sum + (item.line_total || 0), 0));
  }
});
