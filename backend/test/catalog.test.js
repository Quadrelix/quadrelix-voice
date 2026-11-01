// Run with: npm test  (Node's built-in runner, offline, no API keys)
//
// The catalog is what turns "Price?" dead-ends into finished bills and raw
// sales into a profit report — both directions are tested here. The matcher
// must NEVER guess: a wrongly auto-filled price lands on a real bill nobody
// is watching, so ambiguous is treated as no-match everywhere below.

const test = require("node:test");
const assert = require("node:assert");
const os = require("node:os");
const path = require("node:path");

// Each test file runs in its own process — pointing the db at a throwaway file
// before the first require keeps these tests off the real data.json.
process.env.DB_FILE = path.join(os.tmpdir(), `catalog-test-${process.pid}.json`);

const { findCatalogMatch, autoFillPrices } = require("../src/services/productMatch");
const { dailyReport, toISTDate } = require("../src/services/report");
const db = require("../src/db/db");

const CATALOG = [
  { product_id: "p1", name: "Dettol Sabun", brand: "Dettol", purchase_price: 18, selling_price: 25, stock_qty: 40, min_stock_level: 10 },
  { product_id: "p2", name: "Tata Namak", brand: "Tata", purchase_price: 20, selling_price: 25, stock_qty: 5, min_stock_level: 8 },
  { product_id: "p3", name: "Sabun", brand: null, purchase_price: 8, selling_price: 10, stock_qty: 20, min_stock_level: null },
  { product_id: "p4", name: "Lux Sabun", brand: "Lux", purchase_price: 30, selling_price: 40, stock_qty: 15, min_stock_level: null },
];

// --- Matching ---------------------------------------------------------------

test("exact name match fills the price", () => {
  assert.strictEqual(findCatalogMatch(CATALOG, { product: "dettol sabun" }).product_id, "p1");
});

test("a subset word matches when exactly one product holds it", () => {
  // "namak" appears only inside "Tata Namak".
  assert.strictEqual(findCatalogMatch(CATALOG, { product: "Namak" }).product_id, "p2");
});

test("an exact catalog name wins over subset ambiguity", () => {
  // "Sabun" IS a product here (p3) — the shopkeeper said the exact name, so
  // that beats the two branded soaps it also sits inside.
  assert.strictEqual(findCatalogMatch(CATALOG, { product: "sabun" }).product_id, "p3");
});

test("ambiguous subset match returns null, never a guess", () => {
  // Without the generic exact name, "sabun" sits inside two products.
  const noExact = CATALOG.filter((p) => p.name !== "Sabun");
  assert.strictEqual(findCatalogMatch(noExact, { product: "sabun" }), null);
});

test("a spoken brand steers past a same-name generic product", () => {
  // "Lux ... sabun": the generic "Sabun" (p3) is an exact name match, but Lux
  // was said — the brand vetoes it and "Lux Sabun" (p4) wins.
  assert.strictEqual(findCatalogMatch(CATALOG, { product: "Sabun", brand: "Lux" }).product_id, "p4");
  assert.strictEqual(findCatalogMatch(CATALOG, { product: "Sabun", brand: "Dettol" }).product_id, "p1");
});

test("no catalog, no match, no crash", () => {
  assert.strictEqual(findCatalogMatch([], { product: "sabun" }), null);
  assert.strictEqual(findCatalogMatch(null, { product: "sabun" }), null);
});

// --- Auto-fill ---------------------------------------------------------------

test("unpriced items get the catalog price and the product link", () => {
  const items = [{ quantity: 3, product: "Dettol Sabun", price: null }];
  assert.strictEqual(autoFillPrices(items, CATALOG), 1);
  assert.strictEqual(items[0].price, 25);
  assert.strictEqual(items[0].product_id, "p1");
});

test("a spoken price is kept, but the catalog cost snapshot is still linked", () => {
  // The shopkeeper may be quoting a discount — never overwrite their number.
  // The link matters anyway: profit and stock need the product, whatever the
  // sale price was.
  const items = [{ quantity: 1, product: "Dettol Sabun", price: 20 }];
  assert.strictEqual(autoFillPrices(items, CATALOG), 0); // nothing FILLED
  assert.strictEqual(items[0].price, 20); // spoken price survives
  assert.strictEqual(items[0].product_id, "p1");
  assert.strictEqual(items[0].purchase_price, 18);
});

test("no match leaves the item unpriced", () => {
  const items = [{ quantity: 2, product: "shampoo", price: null }];
  assert.strictEqual(autoFillPrices(items, CATALOG), 0);
  assert.strictEqual(items[0].price, null);
});

// --- Stock, payment, snapshots (db on a temp file) ---------------------------

test("bill generation deducts stock exactly once, across a /finalize retry", async () => {
  await db.init();
  assert.strictEqual((await db.listProducts("shop_test")).length, 0);

  await db.upsertProduct("shop_test", { name: "Chini", purchase_price: 40, selling_price: 50, stock_qty: 10, min_stock_level: null });
  const productId = (await db.listProducts("shop_test"))[0].product_id;

  // Same shop as the product: markBillGenerated only deducts stock from the
  // transaction's own shop, so a mismatch here is (correctly) a no-op.
  const txn = await db.createTransaction({
    shop_id: "shop_test",
    items: [
      { product_name: "Chini", quantity: 4, unit: null, price: 50, product_id: productId, purchase_price: 40, line_total: 200 },
    ],
  });
  await db.setCustomerPhone(txn.transaction_id, "9876543210");
  await db.setPaymentStatus(txn.transaction_id, "credit");

  // The bill is rendered (goods left the shop) — stock drops. A WhatsApp
  // failure then a /finalize retry must NOT deduct again.
  await db.markBillGenerated(txn.transaction_id, "bill-x.png");
  await db.markBillGenerated(txn.transaction_id, "bill-x.png");
  await db.markSent(txn.transaction_id); // send succeeded later — no deduction here

  assert.strictEqual((await db.listProducts("shop_test"))[0].stock_qty, 6);
  const final = await db.getTransaction(txn.transaction_id);
  assert.strictEqual(final.payment_status, "credit");
  assert.strictEqual(final.status, "sent");
  assert.strictEqual(final.bill_image_path, "bill-x.png");
});

// --- Daily report ------------------------------------------------------------

test("the day's numbers: sales, cost, profit, unknown cost, credit, low stock", () => {
  const transactions = [
    {
      status: "sent", payment_status: "paid", total_amount: 175,
      created_at: "2026-10-02T10:00:00+05:30", // 02 Oct in IST
      items: [
        { product_name: "Dettol Sabun", quantity: 3, line_total: 75, purchase_price: 18 },
        { product_name: "Chips", quantity: 2, line_total: 100, purchase_price: null }, // off-catalog
      ],
    },
    {
      status: "confirmed", payment_status: "credit", total_amount: 50,
      created_at: "2026-10-02T20:00:00+05:30",
      items: [{ product_name: "Sabun", quantity: 5, line_total: 50, purchase_price: 8 }],
    },
    {
      status: "draft", payment_status: "paid", total_amount: 999, // a half-heard sentence, not a sale
      created_at: "2026-10-02T12:00:00+05:30",
      items: [{ product_name: "Kela", quantity: 12, line_total: 999, purchase_price: 1 }],
    },
    {
      status: "sent", payment_status: "paid", total_amount: 30,
      created_at: "2026-10-02T23:30:00Z", // = 03 Oct 05:00 IST — tomorrow, excluded
      items: [{ product_name: "Sabun", quantity: 3, line_total: 30, purchase_price: 8 }],
    },
  ];

  const report = dailyReport({ transactions, products: CATALOG, date: "2026-10-02" });

  assert.strictEqual(report.transactions, 2);
  assert.strictEqual(report.total_sales, 225); // 175 + 50
  assert.strictEqual(report.total_cost, 3 * 18 + 5 * 8); // 94 — Chips' cost is unknown, not zero
  // Margin covers only items with a known cost: Dettol 75 + Sabun 50 = 125
  // revenue against 94 cost. Chips' 100 is NOT profit — its cost is unknown.
  assert.strictEqual(report.total_profit, 125 - 94);
  assert.strictEqual(report.known_cost_sales, 125);
  assert.strictEqual(report.missing_cost_sales, 100);
  assert.strictEqual(report.cost_coverage, 125 / 225);
  assert.strictEqual(report.unknown_cost_items, 1);
  assert.strictEqual(report.outstanding_credit, 50);
  assert.deepStrictEqual(report.best_sellers[0], { name: "Sabun", quantity: 5, revenue: 50 });
  // low stock: Tata Namak (5 <= 8). Dettol Sabun is above its min; the two
  // soaps without a min set never flag.
  assert.strictEqual(report.low_stock.length, 1);
  assert.strictEqual(report.low_stock[0].name, "Tata Namak");
});

test("toISTDate maps a UTC evening to the next IST day", () => {
  assert.strictEqual(toISTDate("2026-10-02T23:30:00Z"), "2026-10-03");
  assert.strictEqual(toISTDate("2026-10-02T18:29:00Z"), "2026-10-02");
});

// --- Optional selling price -------------------------------------------------
//
// Not every product has a fixed counter price. Loose vegetables, a daily
// rate, anything the shopkeeper quotes per customer — those go into the
// catalog with NO selling price, and the price is spoken at billing time.
// The catalog match still works (product_id links, purchase_price snapshots,
// stock deducts); only the price auto-fill is skipped.

test("a product with no fixed selling price leaves the spoken price alone", () => {
  const catalog = [
    { product_id: "v1", name: "Aam", brand: null, purchase_price: 40, selling_price: null, stock_qty: 10 },
  ];
  const items = [{ product: "Aam", quantity: 3, price: 60 }]; // price SPOKEN
  const filled = autoFillPrices(items, catalog);
  assert.strictEqual(filled, 0); // nothing was filled from the catalog
  assert.strictEqual(items[0].price, 60); // the spoken price stands
  assert.strictEqual(items[0].product_id, "v1"); // still linked to the catalog
  assert.strictEqual(items[0].purchase_price, 40); // cost snapshot for profit
});

test("a product with no fixed selling price stays unpriced until spoken", () => {
  const catalog = [
    { product_id: "v1", name: "Aam", brand: null, purchase_price: 40, selling_price: null, stock_qty: 10 },
  ];
  const items = [{ product: "Aam", quantity: 3, price: null }]; // no price spoken yet
  const filled = autoFillPrices(items, catalog);
  assert.strictEqual(filled, 0);
  assert.strictEqual(items[0].price, null); // still needs a price — the app shows "Price?"
  assert.strictEqual(items[0].product_id, "v1");
});

test("a fixed selling price still auto-fills when nothing was spoken", () => {
  const catalog = [
    { product_id: "p1", name: "Dettol Sabun", brand: "Dettol", purchase_price: 18, selling_price: 25, stock_qty: 40 },
  ];
  const items = [{ product: "Dettol Sabun", quantity: 2, price: null }];
  const filled = autoFillPrices(items, catalog);
  assert.strictEqual(filled, 1);
  assert.strictEqual(items[0].price, 25);
});

test("a catalog product can be saved without a selling price", async () => {
  const product = await db.upsertProduct("shop_test", {
    name: "Sabzi", brand: null, category: "Sabzi",
    purchase_price: 30, selling_price: null, stock_qty: 20, min_stock_level: 5,
  });
  assert.strictEqual(product.selling_price, null);
  const found = (await db.listProducts("shop_test")).find((p) => p.product_id === product.product_id);
  assert.strictEqual(found.selling_price, null);
  assert.strictEqual(found.purchase_price, 30);
});
