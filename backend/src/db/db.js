// Simple file-based JSON database — good enough for MVP.
// Swap this for PostgreSQL/Firestore later without changing the rest of the app much.
//
// WRITES ARE ATOMIC: lowdb's JSONFile writes the real file in place, so a
// crash mid-write leaves a truncated JSON — with the sales history and the
// product catalog now living here, that's real data gone. save() writes a
// temp file and renames it over the real one, which is atomic on the same
// volume.
//
// SQLite (better-sqlite3) is the migration point when a second shop or
// concurrent writers show up — every caller goes through the functions below,
// so only this file changes. Until then: one shop, one writer, one file.

const { Low } = require("lowdb");
const { JSONFile } = require("lowdb/node");
const path = require("path");
const fs = require("fs");
const { randomUUID } = require("crypto");

// Tests point this at a throwaway file before the first require — node --test
// runs each file in its own process, so the override is file-scoped.
const file = process.env.DB_FILE || path.join(__dirname, "data.json");
const adapter = new JSONFile(file);
const defaultData = {
  shops: [
    {
      shop_id: "shop_1",
      shop_name: "Rohit General Store",
      upi_id: "rohitstore@upi", // TODO: replace with real UPI ID
      owner_phone: "9999999999",
    },
  ],
  // The owner-configured catalog (managed via the /api/products routes).
  // Items on a sale keep a product_id + purchase_price SNAPSHOT, so editing
  // catalog prices later never rewrites the profit of a sale already made.
  products: [],
  transactions: [],
};

const db = new Low(adapter, defaultData);

async function save() {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db.data, null, 2));
  fs.renameSync(tmp, file);
}

async function init() {
  await db.read();
  db.data ||= defaultData;
  db.data.products ||= []; // data.json from before the catalog feature
  await save();
}

async function listProducts() {
  await db.read();
  return db.data.products || [];
}

// Create (no product_id) or update (with one). Shape validation lives in the
// route; this just stores.
async function upsertProduct(product) {
  await db.read();
  const existing = product.product_id
    ? db.data.products.find((p) => p.product_id === product.product_id)
    : null;
  if (existing) {
    Object.assign(existing, product);
    await save();
    return existing;
  }
  const record = {
    product_id: randomUUID(),
    created_at: new Date().toISOString(),
    ...product,
  };
  db.data.products.push(record);
  await save();
  return record;
}

async function deleteProduct(product_id) {
  await db.read();
  const before = db.data.products.length;
  db.data.products = db.data.products.filter((p) => p.product_id !== product_id);
  await save();
  return db.data.products.length < before;
}

async function listTransactions() {
  await db.read();
  return db.data.transactions || [];
}

async function createTransaction({ shop_id, items }) {
  await db.read();
  const transaction = {
    transaction_id: randomUUID(),
    shop_id,
    customer_phone: null,
    // items: [{ product_name, quantity, unit, price, product_id?, purchase_price?,
    //           line_total }] — price is PER UNIT; product_id/purchase_price are
    //           the catalog link + cost snapshot when the item matched one.
    items,
    total_amount: items.reduce((sum, i) => sum + (i.line_total || 0), 0),
    status: "draft", // draft -> confirmed -> sent
    payment_status: "paid", // 'paid' | 'credit' — set to 'credit' on /finalize (udaar)
    bill_image_path: null,
    created_at: new Date().toISOString(),
  };
  db.data.transactions.push(transaction);
  await save();
  return transaction;
}

async function addItemsToTransaction(transaction_id, items) {
  await db.read();
  const txn = db.data.transactions.find((t) => t.transaction_id === transaction_id);
  if (!txn) throw new Error("Transaction not found");
  txn.items.push(...items);
  txn.total_amount = txn.items.reduce((sum, i) => sum + (i.line_total || 0), 0);
  await save();
  return txn;
}

async function updateItemPrice(transaction_id, item_index, price) {
  await db.read();
  const txn = db.data.transactions.find((t) => t.transaction_id === transaction_id);
  if (!txn) throw new Error("Transaction not found");
  const item = txn.items[item_index];
  if (!item) throw new Error("Item not found at that index");
  item.price = price;
  item.line_total = item.quantity * price;
  txn.total_amount = txn.items.reduce((sum, i) => sum + (i.line_total || 0), 0);
  await save();
  return txn;
}

async function setCustomerPhone(transaction_id, phone) {
  await db.read();
  const txn = db.data.transactions.find((t) => t.transaction_id === transaction_id);
  if (!txn) throw new Error("Transaction not found");
  txn.customer_phone = phone;
  txn.status = "confirmed";
  await save();
  return txn;
}

async function setPaymentStatus(transaction_id, payment_status) {
  await db.read();
  const txn = db.data.transactions.find((t) => t.transaction_id === transaction_id);
  if (!txn) throw new Error("Transaction not found");
  txn.payment_status = payment_status;
  await save();
  return txn;
}

async function markBillGenerated(transaction_id, bill_image_path) {
  await db.read();
  const txn = db.data.transactions.find((t) => t.transaction_id === transaction_id);
  if (!txn) throw new Error("Transaction not found");

  // Stock is deducted exactly once, HERE: the bill being rendered is the
  // moment the goods left the shop. The WhatsApp send below it can fail
  // (expired Twilio credit, sandbox window) and be retried all day — the sale
  // already happened, and the report counts 'confirmed' sales, so stock and
  // report must agree at this point, not later. The first-generation guard
  // (deduct only when bill_image_path was null) keeps a re-run of /finalize
  // from double-deducting; /send-bill retries never call this at all.
  // Items without a product_id (off-catalog sales) have nothing to deduct.
  const firstGeneration = txn.bill_image_path == null;
  txn.bill_image_path = bill_image_path;
  if (firstGeneration) {
    for (const item of txn.items || []) {
      if (item.product_id == null) continue;
      const product = db.data.products.find((p) => p.product_id === item.product_id);
      if (product) {
        product.stock_qty = Math.max(0, (product.stock_qty || 0) - (item.quantity || 0));
      }
    }
  }
  await save();
  return txn;
}

async function markSent(transaction_id) {
  await db.read();
  const txn = db.data.transactions.find((t) => t.transaction_id === transaction_id);
  if (!txn) throw new Error("Transaction not found");
  txn.status = "sent";
  await save();
  return txn;
}

async function getTransaction(transaction_id) {
  await db.read();
  return db.data.transactions.find((t) => t.transaction_id === transaction_id);
}

async function getShop(shop_id) {
  await db.read();
  return db.data.shops.find((s) => s.shop_id === shop_id);
}

module.exports = {
  init,
  listProducts,
  upsertProduct,
  deleteProduct,
  listTransactions,
  createTransaction,
  addItemsToTransaction,
  updateItemPrice,
  setCustomerPhone,
  setPaymentStatus,
  markBillGenerated,
  markSent,
  getTransaction,
  getShop,
};
