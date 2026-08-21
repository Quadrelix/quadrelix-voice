import axios from "axios";

// TODO: change this to your backend's actual address.
// - Android emulator talking to a backend on your laptop -> "http://10.0.2.2:3000"
// - Physical phone on same wifi as your laptop           -> "http://<your-laptop-ip>:3000"
// - Deployed backend (Render/Railway/etc.)                -> "https://your-backend-url.com"
const BASE_URL = "http://192.168.43.161:3000";

const api = axios.create({ baseURL: BASE_URL });

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
