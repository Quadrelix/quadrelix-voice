// Simple file-based JSON database — good enough for MVP.
// Swap this for PostgreSQL/Firestore later without changing the rest of the app much.

const { Low } = require("lowdb");
const { JSONFile } = require("lowdb/node");
const path = require("path");
const { randomUUID } = require("crypto");

const file = path.join(__dirname, "data.json");
const adapter = new JSONFile(file);
const defaultData = {
  shops: [
    {
      shop_id: "shop_1",
      shop_name: "Rohit General Store",
      upi_id: "9302248439@axl", // TODO: replace with real UPI ID
      owner_phone: "9302248439",
    },
  ],
  transactions: [],
};

const db = new Low(adapter, defaultData);

async function init() {
  await db.read();
  db.data ||= defaultData;
  await db.write();
}

async function createTransaction({ shop_id, items }) {
  await db.read();
  const transaction = {
    transaction_id: randomUUID(),
    shop_id,
    customer_phone: null,
    items, // [{ product_name, quantity, price, line_total }]
    total_amount: items.reduce((sum, i) => sum + i.line_total, 0),
    status: "draft", // draft -> awaiting_contact -> confirmed -> sent
    bill_image_path: null,
    created_at: new Date().toISOString(),
  };
  db.data.transactions.push(transaction);
  await db.write();
  return transaction;
}

async function addItemToTransaction(transaction_id, item) {
  await db.read();
  const txn = db.data.transactions.find((t) => t.transaction_id === transaction_id);
  if (!txn) throw new Error("Transaction not found");
  txn.items.push(item);
  txn.total_amount = txn.items.reduce((sum, i) => sum + i.line_total, 0);
  await db.write();
  return txn;
}

async function updateTransactionItem(transaction_id, itemIndex, item) {
  await db.read();
  const txn = db.data.transactions.find((t) => t.transaction_id === transaction_id);
  if (!txn) throw new Error("Transaction not found");
  if (txn.status === "sent") throw new Error("A sent bill cannot be edited");
  if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= txn.items.length) {
    throw new Error("Item not found");
  }

  txn.items[itemIndex] = item;
  txn.total_amount = txn.items.reduce((sum, current) => sum + current.line_total, 0);
  // A later edit makes any previously generated image out of date.
  txn.bill_image_path = null;
  await db.write();
  return txn;
}

async function removeTransactionItem(transaction_id, itemIndex) {
  await db.read();
  const txn = db.data.transactions.find((t) => t.transaction_id === transaction_id);
  if (!txn) throw new Error("Transaction not found");
  if (txn.status === "sent") throw new Error("A sent bill cannot be edited");
  if (!Number.isInteger(itemIndex) || itemIndex < 0 || itemIndex >= txn.items.length) {
    throw new Error("Item not found");
  }
  if (txn.items.length === 1) throw new Error("The last item cannot be removed; edit it instead");

  txn.items.splice(itemIndex, 1);
  txn.total_amount = txn.items.reduce((sum, current) => sum + current.line_total, 0);
  // A later edit makes any previously generated image out of date.
  txn.bill_image_path = null;
  await db.write();
  return txn;
}

async function setCustomerPhone(transaction_id, phone) {
  await db.read();
  const txn = db.data.transactions.find((t) => t.transaction_id === transaction_id);
  if (!txn) throw new Error("Transaction not found");
  txn.customer_phone = phone;
  txn.status = "confirmed";
  await db.write();
  return txn;
}

async function markBillGenerated(transaction_id, bill_image_path) {
  await db.read();
  const txn = db.data.transactions.find((t) => t.transaction_id === transaction_id);
  if (!txn) throw new Error("Transaction not found");
  txn.bill_image_path = bill_image_path;
  await db.write();
  return txn;
}

async function markSent(transaction_id) {
  await db.read();
  const txn = db.data.transactions.find((t) => t.transaction_id === transaction_id);
  if (!txn) throw new Error("Transaction not found");
  txn.status = "sent";
  await db.write();
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
  createTransaction,
  addItemToTransaction,
  updateTransactionItem,
  removeTransactionItem,
  setCustomerPhone,
  markBillGenerated,
  markSent,
  getTransaction,
  getShop,
};
