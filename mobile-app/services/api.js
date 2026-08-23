import axios from "axios";

export const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL;

const api = axios.create({ baseURL: BASE_URL });

export function getBillImageUrl(billImagePath) {
  if (!billImagePath || !BASE_URL) return null;

  // The backend runs on Windows, so its returned path may use either slash.
  const filename = billImagePath.split(/[\\/]/).pop();
  return filename ? `${BASE_URL}/bills/${encodeURIComponent(filename)}` : null;
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

export default api;
