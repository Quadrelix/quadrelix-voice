import axios from "axios";

export const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

const api = axios.create({ baseURL: BASE_URL });

export function getBillImageUrl(billImagePath, cacheKey) {
  if (!billImagePath || !BASE_URL) return null;

  // The backend runs on Windows, so its returned path may use either slash.
  const filename = billImagePath.split(/[\\/]/).pop();
  if (!filename) return null;
  const cacheSuffix = cacheKey ? `?v=${encodeURIComponent(cacheKey)}` : "";
  return `${BASE_URL}/bills/${encodeURIComponent(filename)}${cacheSuffix}`;
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

export async function updateItem(transactionId, itemIndex, item) {
  const res = await api.put(`/api/transaction/${transactionId}/items/${itemIndex}`, item);
  return res.data;
}

export async function removeItem(transactionId, itemIndex) {
  const res = await api.delete(`/api/transaction/${transactionId}/items/${itemIndex}`);
  return res.data;
}

export async function getTransaction(transactionId) {
  const res = await api.get(`/api/transaction/${transactionId}`);
  return res.data;
}

export default api;
