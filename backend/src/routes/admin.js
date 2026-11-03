// Admin routes — creating and managing shops.
//
// These are NOT called by the app. They exist so the founder can add a shop in
// seconds and hand its code to the owner over WhatsApp:
//
//   curl -X POST http://.../api/admin/shops \
//        -H "Authorization: Bearer $ADMIN_TOKEN" \
//        -H "Content-Type: application/json" \
//        -d '{"shop_name":"Sharma Kapda Store","shop_type":"kapda","upi_id":"sharma@upi","owner_phone":"9876543210"}'
//
// Every route requires ADMIN_TOKEN. Without it configured, the routes are
// closed (503) rather than open — a missing secret must fail safe.

const express = require("express");
const router = express.Router();

const db = require("../db/db");

function requireAdmin(req, res, next) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) {
    return res.status(503).json({
      error: "ADMIN_TOKEN not set — admin routes disabled",
    });
  }
  const given = String(req.header("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (given !== token) return res.status(403).json({ error: "Forbidden" });
  next();
}

router.use(requireAdmin);

const FOOTER_MAX = 600;
const FOOTER_TOO_LONG = `bill_footer must be at most ${FOOTER_MAX} characters`;
// null/"" clears the footer; false means too long.
function cleanFooter(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).replace(/\r\n/g, "\n").trim();
  if (text.length > FOOTER_MAX) return false;
  return text || null;
}

/**
 * Create a shop and return its code.
 * body: { shop_name, shop_type?, upi_id?, owner_phone?, bill_footer? }
 */
router.post("/shops", async (req, res) => {
  const { shop_name, shop_type, upi_id, owner_phone, bill_footer } = req.body || {};
  if (!shop_name || !String(shop_name).trim()) {
    return res.status(400).json({ error: "shop_name is required" });
  }
  const footer = cleanFooter(bill_footer);
  if (footer === false) return res.status(400).json({ error: FOOTER_TOO_LONG });
  try {
    const shop = await db.createShop({
      shop_name: String(shop_name).trim(),
      shop_type: shop_type ? String(shop_type).trim() : null,
      upi_id: upi_id ? String(upi_id).trim() : null,
      owner_phone: owner_phone ? String(owner_phone).replace(/\D/g, "") : null,
      bill_footer: footer,
    });
    res.status(201).json({ shop });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** All shops — the founder's control panel. */
router.get("/shops", async (req, res) => {
  try {
    res.json({ shops: await db.listShops() });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** Update name / UPI / phone / bill_footer / active. */
router.patch("/shops/:id", async (req, res) => {
  try {
    const patch = { ...(req.body || {}) };
    if (patch.bill_footer !== undefined) {
      const footer = cleanFooter(patch.bill_footer);
      if (footer === false) return res.status(400).json({ error: FOOTER_TOO_LONG });
      patch.bill_footer = footer;
    }
    const shop = await db.updateShop(req.params.id, patch);
    if (!shop) return res.status(404).json({ error: "Shop not found" });
    res.json({ shop });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/** New code — use if a code leaks or a phone is lost. */
router.post("/shops/:id/rotate-code", async (req, res) => {
  try {
    const shop = await db.rotateShopCode(req.params.id);
    if (!shop) return res.status(404).json({ error: "Shop not found" });
    res.json({ shop });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;