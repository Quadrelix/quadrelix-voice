const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

process.env.DB_FILE = path.join(os.tmpdir(), `item-price-${process.pid}.json`);
const db = require("../src/db/db");
test.after(() => fs.rmSync(process.env.DB_FILE, { force: true }));

test("price edits preserve other items, fill missing prices and recalculate totals", async () => {
  await db.init();
  const txn = await db.createTransaction({ shop_id: "price_test", items: [
    { product_name: "Rice", quantity: 1.5, price: null, line_total: null },
    { product_name: "Soap", quantity: 2, price: 10, line_total: 20 },
  ] });
  const updated = await db.updateItemPrice(txn.transaction_id, 0, "12.50");
  assert.equal(updated.items[0].price, 12.5);
  assert.equal(updated.items[0].line_total, 18.75);
  assert.deepEqual(updated.items[1], txn.items[1]);
  assert.equal(updated.total_amount, 38.75);
  const free = await db.updateItemPrice(txn.transaction_id, 1, 0);
  assert.equal(free.items[1].line_total, 0);
  assert.equal(free.total_amount, 18.75);
});

test("bad price/index inputs cannot change a bill, including through the API", async () => {
  await db.init();
  const txn = await db.createTransaction({ shop_id: "price_test", items: [
    { product_name: "Soap", quantity: 2, price: 10, line_total: 20 },
  ] });
  const router = require("../src/routes/sale");
  const handler = router.stack.find(l => l.route?.path === "/update-item-price").route.stack[0].handle;
  const bad = [
    ...[-1, Infinity, -Infinity, NaN, "junk", "", " ", null, undefined, true, false, [], {}]
      .map(price => ({ item_index: 0, price })),
    ...[-1, 0.5, "0", NaN, Infinity, 2147483648, null, true, 1]
      .map(item_index => ({ item_index, price: 5 })),
  ];
  for (const input of bad) {
    await assert.rejects(db.updateItemPrice(txn.transaction_id, input.item_index, input.price));
    const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
    await handler({ body: { transaction_id: txn.transaction_id, ...input } }, res);
    assert.equal(res.code, 400, `must reject ${JSON.stringify(input)}`);
  }
  assert.deepEqual(await db.getTransaction(txn.transaction_id), txn);
  await assert.rejects(db.updateItemPrice("missing", 0, 10), /not found/i);
});
