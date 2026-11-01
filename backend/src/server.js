require("dotenv").config();
const db = require("./db/db");
const app = require("./app");
const { checkWhatsAppConfig } = require("./services/whatsapp");
const voice = require("./services/voiceVerify");

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