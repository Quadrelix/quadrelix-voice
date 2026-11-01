// The Express app, separate from server.js so tests can mount it on an
// ephemeral port without booting the database, Twilio checks or app.listen.

const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const multer = require("multer");

const db = require("./db/db");
const saleRoutes = require("./routes/sale");
const adminRoutes = require("./routes/admin");
const { rateLimit } = require("./middleware/limits");

const app = express();

// Render (and any reverse proxy) terminates TLS in front of us: without this,
// req.ip is the proxy's address and every shop would share one rate-limit bucket.
app.set("trust proxy", 1);

app.use(cors());
app.use(express.json({ limit: "100kb" }));

// Bill PNGs. On a laptop this is backend/generated_bills; on Render the disk
// is ephemeral, so BILLS_DIR points at /tmp. Bills are regenerable (see
// ensureBillFile in routes/sale.js), so losing old files is acceptable for the
// pilot. File names embed the transaction UUID, so they are not guessable.
const BILLS_DIR = process.env.BILLS_DIR || path.join(__dirname, "..", "generated_bills");
fs.mkdirSync(BILLS_DIR, { recursive: true });
app.use("/bills", express.static(BILLS_DIR, { index: false, dotfiles: "deny" }));

// Coarse per-IP ceiling over the whole API; the per-shop and audio limits sit
// on the individual routes.
app.use("/api", rateLimit({ windowMs: 60 * 1000, max: 300 }));

app.use("/api/admin", adminRoutes);
app.use("/api", saleRoutes);

app.get("/", (req, res) => {
  res.json({ status: "AI Business Assistant backend is running" });
});

// Health check for Render and for "is the database reachable?" during setup.
app.get("/health", async (req, res) => {
  try {
    const shopCount = (await db.listShops()).length;
    res.json({ ok: true, db: "up", shops: shopCount });
  } catch (e) {
    res.status(503).json({ ok: false, db: "down", error: e.message });
  }
});

// One place that turns upload rejections and unexpected throws into JSON.
// Express 5 forwards async handler rejections here too.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err instanceof multer.MulterError) {
    const tooBig = err.code === "LIMIT_FILE_SIZE";
    return res.status(tooBig ? 413 : 400).json({
      error: tooBig ? "Audio file bahut badi hai" : `Upload error: ${err.code}`,
    });
  }
  if (err && err.type === "entity.too.large") {
    return res.status(413).json({ error: "Request bahut badi hai" });
  }
  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Invalid JSON body" });
  }
  if (err && err.status && err.status < 500) {
    return res.status(err.status).json({ error: err.message });
  }
  console.error("UNHANDLED ERROR:", err);
  res.status(500).json({ error: "Server mein kuch gadbad hui" });
});

module.exports = app;
