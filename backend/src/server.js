require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const db = require("./db/db");
const saleRoutes = require("./routes/sale");
const { checkWhatsAppConfig } = require("./services/whatsapp");
const voice = require("./services/voiceVerify");

const app = express();
app.use(cors());
app.use(express.json());

// Serve generated bill images statically so they can be viewed/shared
app.use("/bills", express.static(path.join(__dirname, "..", "generated_bills")));

app.use("/api", saleRoutes);

app.get("/", (req, res) => {
  res.json({ status: "AI Business Assistant backend is running" });
});

const PORT = process.env.PORT || 3000;

db.init().then(() => {
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

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});
