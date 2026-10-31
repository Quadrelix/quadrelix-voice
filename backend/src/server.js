require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const db = require("./db/db");
const saleRoutes = require("./routes/sale");
const adminRoutes = require("./routes/admin");
const { checkWhatsAppConfig } = require("./services/whatsapp");
const voice = require("./services/voiceVerify");

const app = express();
app.use(cors());
app.use(express.json());

// Bill PNGs. On a laptop this is backend/generated_bills; on Render the disk
// is ephemeral, so BILLS_DIR points at /tmp. Bills are regenerable and are
// sent immediately, so losing old files is acceptable for the pilot.
const BILLS_DIR = process.env.BILLS_DIR || path.join(__dirname, "..", "generated_bills");
fs.mkdirSync(BILLS_DIR, { recursive: true });
app.use("/bills", express.static(BILLS_DIR));

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

const PORT = process.env.PORT || 3000;

db.init()
  .then(async () => {
    // Surface WhatsApp misconfiguration now, not mid-sale.
    const whatsappProblems = checkWhatsAppConfig();
    for (const problem of whatsappProblems) {
      console.warn(`[WHATSAPP CONFIG] ${problem}`);
    }
    if (whatsappProblems.length) {
      console.warn("[WHATSAPP CONFIG] /api/send-bill will fail until the above is fixed.");
    } else if (!process.env.WHATSAPP_PROVIDER) {
      console.log("[WHATSAPP] Simulated mode — sends will be logged, not delivered.");
    }

    // Voice Lock status, following the WhatsApp pattern: log the mode and
    // whether the Python service answered, so a misconfigured lock is visible
    // at boot instead of surfacing mid-sale.
    voice
      .voiceBootSummary()
      .then(({ line }) => console.log(line))
      .catch(() => console.log("[VOICE LOCK] status check failed"));

    // Which shops this server serves — an operator should see the list at boot.
    try {
      const shops = await db.listShops();
      const real = shops.filter((s) => s.shop_id !== "legacy_demo");
      console.log(
        `[SHOPS] ${real.length} shop(s): ` +
          (real.map((s) => `${s.shop_name} (${s.shop_code})`).join(", ") || "none yet — create one via /api/admin/shops")
      );
    } catch (e) {
      console.warn("[SHOPS] could not list shops:", e.message);
    }

    app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  })
  .catch((e) => {
    console.error("Database init FAILED:", e.message);
    process.exit(1);
  });