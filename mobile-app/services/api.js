import axios from "axios";

// TODO: change this to your backend's actual address.
// - Android emulator talking to a backend on your laptop -> "http://10.0.2.2:3000"
// - Physical phone on same wifi as your laptop           -> "http://<your-laptop-ip>:3000"
// - Deployed backend (Render/Railway/etc.)                -> "https://your-backend-url.com"
//
// Exported because screens need it to build image URLs — keep it defined here
// only, so there's one place to change when your laptop's IP moves.
export const BASE_URL = "http://10.157.20.161:3000";

const api = axios.create({ baseURL: BASE_URL });

export async function transcribeAudio(fileUri) {
  const formData = new FormData();
  formData.append("audio", {
    uri: fileUri,
    name: "recording.m4a",
    type: "audio/m4a",
  });

  const res = await api.post("/api/transcribe", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
  return res.data; // { text }
}

export async function updateItemPrice(transactionId, itemIndex, price) {
  const res = await api.post("/api/update-item-price", {
    transaction_id: transactionId,
    item_index: itemIndex,
    price,
  });
  return res.data;
}

export async function parseItem(text, transactionId) {
  const res = await api.post("/api/parse-item", {
    text,
    transaction_id: transactionId,
  });
  return res.data;
}

export async function confirmContact(transactionId, phone) {
  const res = await api.post("/api/confirm-contact", {
    transaction_id: transactionId,
    phone,
  });
  return res.data;
}

export async function generateBill(transactionId) {
  const res = await api.post("/api/generate-bill", {
    transaction_id: transactionId,
  });
  return res.data;
}

export async function sendBill(transactionId) {
  const res = await api.post("/api/send-bill", {
    transaction_id: transactionId,
  });
  return res.data;
}

export async function getTransaction(transactionId) {
  const res = await api.get(`/api/transaction/${transactionId}`);
  return res.data;
}

// --- Hands-free flow -------------------------------------------------------
// One sentence the app overheard, whatever was in it. The backend pulls out a
// phone number if there is one, parses the rest as sale items, and tells us in
// `ready_to_send` whether this bill can go out. See backend/README.md.
export async function sendUtterance(text, transactionId) {
  const res = await api.post("/api/utterance", {
    text,
    transaction_id: transactionId,
  });
  return res.data; // { transaction, parsed_items, filled_price_count, missing_price_count, detected_phone, ready_to_send, parse_error? }
}

// Attach the phone, render the bill and send it in a single request. Three
// separate calls would leave the sale half-finished if the wifi drops between
// them — phone saved, bill never sent, and nobody watching the screen.
// payment_status 'credit' marks an udaar sale (counted in the daily report's
// outstanding total instead of assumed paid).
export async function finalizeBill(transactionId, phone, paymentStatus) {
  const res = await api.post("/api/finalize", {
    transaction_id: transactionId,
    phone,
    payment_status: paymentStatus,
  });
  return res.data; // { transaction, bill_filename, send_result }
}

// --- Product catalog & daily report -----------------------------------------
// The catalog is what lets a sale skip the "Price?" step (unpriced items get
// the catalog's selling price) and what makes the profit report possible.

export async function listProducts() {
  const res = await api.get("/api/products");
  return res.data; // { products }
}

export async function createProduct(product) {
  const res = await api.post("/api/products", product);
  return res.data; // { product }
}

export async function updateProduct(productId, product) {
  const res = await api.put(`/api/products/${productId}`, product);
  return res.data; // { product }
}

export async function deleteProduct(productId) {
  const res = await api.delete(`/api/products/${productId}`);
  return res.data; // { deleted: true }
}

export async function dailyReport(date) {
  const res = await api.get("/api/report/daily", {
    params: date ? { date } : undefined,
  });
  return res.data;
}

// --- Home dashboard ---------------------------------------------------------
// The home screen answers "aaj kaisa chal raha hai?" in one glance, so it
// needs the shop's name, the last few bills and the customer list — all
// derived server-side so the phone never has to hold the whole sales history.

export async function getShop() {
  const res = await api.get("/api/shop");
  return res.data; // { shop: { shop_id, shop_name, upi_id, owner_phone } }
}

export async function recentTransactions(limit = 5) {
  const res = await api.get("/api/transactions", { params: { limit } });
  return res.data; // { transactions: [{ ...transaction }] } newest first
}

export async function listCustomers() {
  const res = await api.get("/api/customers");
  return res.data; // { customers: [{ phone, total_spent, credit_outstanding, purchases, last_purchase }] }
}

export default api;
