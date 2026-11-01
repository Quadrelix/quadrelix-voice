const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const router = express.Router();

const db = require("../db/db");
const { parseSaleItems } = require("../services/parser");
const { transcribeAudio } = require("../services/transcribe");
const { generateBillImage } = require("../services/billImage");
const { sendBillOnWhatsApp } = require("../services/whatsapp");
const { findPhoneNumber } = require("../services/phoneNumber");
const { hasItemContent, matchPriceFill } = require("../services/utterance");
const { autoFillPrices } = require("../services/productMatch");
const { dailyReport, toISTDate } = require("../services/report");
const voice = require("../services/voiceVerify");

// ---------------------------------------------------------------------------
// Shop resolution
// ---------------------------------------------------------------------------
// Every command a shop makes arrives with its shop code. The code is what the
// owner typed once in the app; it is NOT a secret (it selects a shop, it does
// not authorise an account) — the pilot relies on stores being physical, not
// on the code being unguessable. Admin routes are the ones behind a token.
//
// Resolution order:
//   1. X-Shop-Code header   — the app's normal path
//   2. ?shop_code=          — curl / debugging
//   3. ?shop_id= with a valid ADMIN_TOKEN — admin tooling
//
// Transactions do NOT need this: a transaction id is unique and carries its
// own shop_id, which is the right ownership rule for its bill, report row and
// send. Scoping those by a request header would let one shop read another's
// bill by guessing an id.

let legacyShopCache = null; // shop_1 era data, demo/legacy only

function adminTokenOk(req) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return false;
  const given = String(req.header("Authorization") || "").replace(/^Bearer\s+/i, "");
  return given && given === token;
}

/**
 * resolveShop(req) -> shop row, or null when the request names no valid shop.
 * Caches the legacy fallback so an old app build without a shop code can
 * still be debugged locally.
 */
async function resolveShop(req) {
  const code = req.header("X-Shop-Code") || req.query.shop_code;
  if (code) return (await db.getShopByCode(code)) || null;

  const shopId = req.query.shop_id;
  if (shopId && adminTokenOk(req)) return (await db.getShop(shopId)) || null;

  // No shop named at all.
  const legacy = process.env.LEGACY_SHOP_ID || "legacy_demo";
  if (!legacyShopCache) legacyShopCache = await db.getShop(legacy);
  return legacyShopCache || null;
}

// Express helper: resolve, or answer 404/400 and return null.
async function requireShop(req, res) {
  const shop = await resolveShop(req);
  if (!shop) {
    res.status(404).json({
      error: "Unknown shop code",
      hint: "App me dukaan ka code daalein.",
    });
    return null;
  }
  return shop;
}

const UPLOAD_DIR = path.join(__dirname, "..", "..", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const upload = multer({ dest: UPLOAD_DIR });

// Parser shape -> stored shape. Shared by /parse-item and /utterance so the
// line_total arithmetic exists in exactly one place.
function toStoredItem(p) {
  return {
    product_name: p.product,
    quantity: p.quantity,
    unit: p.unit ?? null, // "kilo" / "packet" / null — shown next to the quantity
    price: p.price, // may be null — needs filling in before bill generation
    // Catalog link + cost snapshot (from autoFillPrices). The SNAPSHOT is the
    // point: the day's profit report reads these, so editing catalog prices
    // later never rewrites what a past sale actually cost.
    product_id: p.product_id ?? null,
    purchase_price: p.purchase_price ?? null,
    // The parser guarantees price is PER UNIT, never a lot total, so this
    // multiplication is right for weighed goods too: "₹50 ka 2 kilo namak"
    // is ₹50 per kilo = ₹100.
    line_total: p.price != null ? p.quantity * p.price : null,
  };
}

/**
 * STEP 0 (voice flow) — Owner records audio, we transcribe it to text.
 * Multipart form upload, field name: "audio"
 * Returns: { text: string }
 * The app then calls /parse-item with that text, same as the typed flow.
 */
router.post("/transcribe", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "audio file is required" });
    const text = await transcribeAudio(req.file.path);
    fs.unlink(req.file.path, () => {}); // cleanup temp file, don't block response
    res.json({ text });
   } catch (err) {
    console.error("TRANSCRIBE ERROR:", err.message);
    if (req.file) fs.unlink(req.file.path, () => {});
    res.status(400).json({ error: err.message });
  }
});

/**
 * STEP 1 — Owner speaks/types a sentence, possibly with MULTIPLE items.
 * "5 white shirt 500 rupaye" OR "2 red shirt aur 3 kurti" (price may be
 * missing per item — those come back with price: null and must be filled
 * in via /update-item-price before the transaction can be billed).
 *
 * body: { text: string, transaction_id?: string }
 * If transaction_id is omitted, a new transaction is started.
 */
router.post("/parse-item", async (req, res) => {
  try {
    const { text, transaction_id } = req.body;
    if (!text) return res.status(400).json({ error: "text is required" });

    const shop = await requireShop(req, res);
    if (!shop) return;

    const parsedItems = await parseSaleItems(text);
    // A price the shopkeeper didn't say can come from THIS shop's catalog —
    // this is what removes the "Price?" dead-end for known products.
    autoFillPrices(parsedItems, await db.listProducts(shop.shop_id));
    const newItems = parsedItems.map(toStoredItem);

    let transaction;
    if (transaction_id) {
      transaction = await db.addItemsToTransaction(transaction_id, newItems);
    } else {
      transaction = await db.createTransaction({ shop_id: shop.shop_id, items: newItems });
    }

    const missingPriceCount = newItems.filter((i) => i.price == null).length;

    res.json({ transaction, parsed_items: newItems, missing_price_count: missingPriceCount });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Fill in a price for an item that came back without one.
 * body: { transaction_id, item_index, price }
 */
router.post("/update-item-price", async (req, res) => {
  try {
    const { transaction_id, item_index, price } = req.body;
    if (!transaction_id || item_index == null || price == null) {
      return res.status(400).json({ error: "transaction_id, item_index, and price are required" });
    }
    const transaction = await db.updateItemPrice(transaction_id, item_index, price);
    res.json({ transaction });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * STEP 2 — Owner speaks the contact number, confirms "yes".
 * body: { transaction_id: string, phone: string }
 */
router.post("/confirm-contact", async (req, res) => {
  try {
    const { transaction_id, phone } = req.body;
    if (!transaction_id || !phone) {
      return res.status(400).json({ error: "transaction_id and phone are required" });
    }
    const cleanPhone = phone.replace(/\D/g, "");
    if (cleanPhone.length < 10) {
      return res.status(400).json({ error: "That doesn't look like a valid phone number" });
    }
    const transaction = await db.setCustomerPhone(transaction_id, cleanPhone);
    res.json({ transaction });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * STEP 3 — Generate the bill image + UPI QR, save it.
 * body: { transaction_id: string }
 */
router.post("/generate-bill", async (req, res) => {
  try {
    const { transaction_id } = req.body;
    const transaction = await db.getTransaction(transaction_id);
    if (!transaction) return res.status(404).json({ error: "Transaction not found" });

    const hasMissingPrice = transaction.items.some((i) => i.price == null);
    if (hasMissingPrice) {
      return res.status(400).json({ error: "Some items are missing a price — fill those in first" });
    }

    const shop = await db.getShop(transaction.shop_id);
    const billImagePath = await generateBillImage({ transaction, shop });
    const updated = await db.markBillGenerated(transaction_id, billImagePath);

    // bill_image_path is a server-side filesystem path and differs by OS
    // (backslashes on Windows) — clients should use bill_filename with the
    // /bills static route instead of trying to parse the path themselves.
    res.json({
      transaction: updated,
      bill_image_path: billImagePath,
      bill_filename: path.basename(billImagePath),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * STEP 4 — Send the generated bill + QR to the customer's WhatsApp.
 * body: { transaction_id: string }
 */
router.post("/send-bill", async (req, res) => {
  try {
    const { transaction_id } = req.body;
    const transaction = await db.getTransaction(transaction_id);
    if (!transaction) return res.status(404).json({ error: "Transaction not found" });
    if (!transaction.customer_phone) {
      return res.status(400).json({ error: "No customer phone on this transaction yet" });
    }
    if (!transaction.bill_image_path) {
      return res.status(400).json({ error: "Bill image not generated yet" });
    }

    const shop = await db.getShop(transaction.shop_id);
    const result = await sendBillOnWhatsApp({
      phone: transaction.customer_phone,
      billImagePath: transaction.bill_image_path,
      totalAmount: transaction.total_amount,
      shopName: shop.shop_name,
    });

    const updated = await db.markSent(transaction_id);
    res.json({ transaction: updated, send_result: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ==========================================================================
 * HANDS-FREE FLOW
 *
 * The screen above needs four taps to finish a sale. A shopkeeper with both
 * hands in a sack of rice has none to spare, so the hands-free screen sends
 * every sentence it overhears to /utterance and, when that says the sale is
 * ready, finishes it with one call to /finalize.
 *
 * These are additive. /parse-item and the three step routes above are
 * untouched, because the typed flow is the fallback for a noisy shop.
 * ========================================================================== */

/**
 * Everything the app overhears goes here — a sale line, a customer's phone
 * number, or both in one breath.
 *
 * body: { text: string, transaction_id?: string }
 * returns: {
 *   transaction, parsed_items, filled_price_count,
 *   missing_price_count,   // across the WHOLE bill, not just this sentence,
 *                          // because that's what decides if it can be sent
 *   detected_phone,        // 10 digits or null
 *   ready_to_send,         // the client's only trigger for the countdown
 *   parse_error?           // advisory; the request still succeeded
 * }
 *
 * ready_to_send is computed here rather than in the app on purpose: it is the
 * decision to send a real customer a real bill with no confirming tap, and it
 * belongs in one testable place instead of in a React state machine.
 */
router.post("/utterance", async (req, res) => {
  try {
    const { text, transaction_id } = req.body;
    if (!text) return res.status(400).json({ error: "text is required" });

    // The number comes out of the sentence before anything else looks at it —
    // left in, a 10-digit run is a quantity, and the bill reads "9876543210
    // Aam".
    const { phone, partial, rest } = findPhoneNumber(text);

    const shop = await requireShop(req, res);
    if (!shop) return;

    let transaction = null;
    if (transaction_id) {
      transaction = await db.getTransaction(transaction_id);
      if (!transaction) return res.status(404).json({ error: "Transaction not found" });
    }

    let storedNewItems = [];
    let filledPriceCount = 0;
    let parseError = null;

    // Most of what a live mic hears is not a sale — "haan", "theek hai", the
    // customer talking, or the empty remainder after a phone number was cut
    // out. Those cost a Gemini call and return an error nobody can act on, so
    // they don't get one.
    if (hasItemContent(rest)) {
      try {
        const parsed = await parseSaleItems(rest);
        // Catalog prices answer a missing price BEFORE matchPriceFill runs:
        // "aam" re-spoken after a no-price line then carries the catalog
        // price, and fills that line instead of adding a second item.
        autoFillPrices(parsed, await db.listProducts(shop.shop_id));
        const { fills, additions } = matchPriceFill(transaction ? transaction.items : [], parsed);

        // Fills first: they answer a price the bill is already blocked on.
        for (const fill of fills) {
          transaction = await db.updateItemPrice(
            transaction.transaction_id,
            fill.item_index,
            fill.price
          );
        }
        filledPriceCount = fills.length;

        storedNewItems = additions.map(toStoredItem);
        if (storedNewItems.length) {
          transaction = transaction
            ? await db.addItemsToTransaction(transaction.transaction_id, storedNewItems)
            : await db.createTransaction({ shop_id: shop.shop_id, items: storedNewItems });
        }
      } catch (err) {
        // Not fatal, and this matters: "...haan theek hai, number 987..." has a
        // phone number in it and junk where the items should be. Failing the
        // request would throw away the number the shopkeeper just dictated and
        // they'd have to say all ten digits again.
        parseError = err.message;
      }
    }

    const items = transaction ? transaction.items : [];
    const missingPriceCount = items.filter((i) => i.price == null).length;

    const response = {
      transaction,
      parsed_items: storedNewItems,
      filled_price_count: filledPriceCount,
      missing_price_count: missingPriceCount,
      detected_phone: phone,
      // Sarvam garbled the dictation but some digit-words survived — the app
      // tells the shopkeeper "number adhura suna, dobara bolo" instead of
      // looking like it ignored them.
      partial_number: partial,
      // A number alone isn't enough. An empty bill would send a customer a ₹0
      // receipt, and a missing price would send them a wrong total — in both
      // cases with nobody having pressed anything.
      ready_to_send: Boolean(phone) && items.length > 0 && missingPriceCount === 0,
    };
    if (parseError) response.parse_error = parseError;

    res.json(response);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Attach the phone, render the bill, send it — in one call.
 * body: { transaction_id: string, phone: string }
 *
 * No new logic; this is /confirm-contact + /generate-bill + /send-bill in the
 * same order. It's one call because three round trips over shop wifi is slow at
 * the counter, and because a drop between them leaves a transaction with a
 * customer's phone attached and no bill ever sent — a silent half-failure the
 * shopkeeper only discovers when the customer complains.
 */
router.post("/finalize", async (req, res) => {
  try {
    const { transaction_id, phone } = req.body;
    if (!transaction_id || !phone) {
      return res.status(400).json({ error: "transaction_id and phone are required" });
    }

    // Exactly 10, stricter than /confirm-contact. That route has a human
    // watching a confirm screen; this one sends with nothing in between.
    const cleanPhone = String(phone).replace(/\D/g, "");
    if (cleanPhone.length !== 10) {
      return res.status(400).json({ error: "That doesn't look like a valid phone number" });
    }

    let transaction = await db.getTransaction(transaction_id);
    if (!transaction) return res.status(404).json({ error: "Transaction not found" });
    if (!transaction.items.length) {
      return res.status(400).json({ error: "This bill has no items on it yet" });
    }
    if (transaction.items.some((i) => i.price == null)) {
      return res.status(400).json({ error: "Some items are missing a price — fill those in first" });
    }

    transaction = await db.setCustomerPhone(transaction_id, cleanPhone);

    // Udaar: the sale is real, only the payment is deferred. 'credit' lands
    // in the day's outstanding total on the report; anything else is 'paid'.
    const paymentStatus = req.body.payment_status === "credit" ? "credit" : "paid";
    if (paymentStatus === "credit") {
      transaction = await db.setPaymentStatus(transaction_id, "credit");
    }

    const shop = await db.getShop(transaction.shop_id);
    const billImagePath = await generateBillImage({ transaction, shop });
    transaction = await db.markBillGenerated(transaction_id, billImagePath);

    const sendResult = await sendBillOnWhatsApp({
      phone: cleanPhone,
      billImagePath,
      totalAmount: transaction.total_amount,
      shopName: shop.shop_name,
    });

    transaction = await db.markSent(transaction_id);

    res.json({
      transaction,
      bill_filename: path.basename(billImagePath),
      send_result: sendResult,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ==========================================================================
 * PRODUCT CATALOG & DAILY REPORT
 *
 * The catalog is what turns voice sales into profit numbers: purchase_price
 * powers the report, selling_price auto-fills unpriced items, stock_qty
 * counts down as bills are sent, min_stock_level flags low stock.
 * ========================================================================== */

/**
 * List the catalog. Optionally ?q= filters by name/brand substring.
 */
router.get("/products", async (req, res) => {
  const shop = await requireShop(req, res);
  if (!shop) return;
  const products = await db.listProducts(shop.shop_id);
  const q = String(req.query.q || "").toLowerCase().trim();
  const filtered = q
    ? products.filter(
        (p) =>
          String(p.name).toLowerCase().includes(q) ||
          String(p.brand || "").toLowerCase().includes(q)
      )
    : products;
  res.json({ products: filtered });
});

// Shared shape check for create/update. Returns a message or null.
//
// selling_price is OPTIONAL. Some goods have a fixed counter price (a packet
// of Maggi is always ₹14); some do not (loose vegetables, a customer's
// haggled rate, anything whose price changes by the day). For the second kind
// the shopkeeper speaks the price at billing time — so a product may have no
// selling price in the catalog at all, and the sale's spoken price stands.
//
// purchase_price is optional for the same reason: without it the profit
// report counts that item's profit as unknown rather than zero.
function validateProduct(body) {
  if (!body.name || !String(body.name).trim()) return "name is required";
  if (body.selling_price != null && body.selling_price !== "") {
    if (Number.isNaN(Number(body.selling_price)) || Number(body.selling_price) < 0) {
      return "selling_price must be a number >= 0";
    }
  }
  if (body.purchase_price != null && body.purchase_price !== "") {
    if (Number.isNaN(Number(body.purchase_price)) || Number(body.purchase_price) < 0) {
      return "purchase_price must be a number >= 0";
    }
  }
  return null;
}

// Empty string / undefined -> null (no fixed price), else the number.
function optionalPrice(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

/**
 * Add a product. body: { name, brand?, purchase_price?, selling_price?,
 * stock_qty?, category?, min_stock_level? }
 */
router.post("/products", async (req, res) => {
  const problem = validateProduct(req.body);
  if (problem) return res.status(400).json({ error: problem });
  const shop = await requireShop(req, res);
  if (!shop) return;
  const product = await db.upsertProduct(shop.shop_id, {
    name: String(req.body.name).trim(),
    brand: req.body.brand ? String(req.body.brand).trim() : null,
    category: req.body.category ? String(req.body.category).trim() : null,
    purchase_price: optionalPrice(req.body.purchase_price),
    selling_price: optionalPrice(req.body.selling_price),
    stock_qty: req.body.stock_qty != null ? Number(req.body.stock_qty) : 0,
    min_stock_level: req.body.min_stock_level != null ? Number(req.body.min_stock_level) : null,
  });
  res.status(201).json({ product });
});

/**
 * Update a product. body: same fields; product_id from the URL.
 */
router.put("/products/:id", async (req, res) => {
  const problem = validateProduct(req.body);
  if (problem) return res.status(400).json({ error: problem });
  const shop = await requireShop(req, res);
  if (!shop) return;
  const products = await db.listProducts(shop.shop_id);
  if (!products.some((p) => p.product_id === req.params.id)) {
    return res.status(404).json({ error: "Product not found" });
  }
  const product = await db.upsertProduct(shop.shop_id, {
    product_id: req.params.id,
    name: String(req.body.name).trim(),
    brand: req.body.brand ? String(req.body.brand).trim() : null,
    category: req.body.category ? String(req.body.category).trim() : null,
    purchase_price: optionalPrice(req.body.purchase_price),
    selling_price: optionalPrice(req.body.selling_price),
    stock_qty: req.body.stock_qty != null ? Number(req.body.stock_qty) : 0,
    min_stock_level: req.body.min_stock_level != null ? Number(req.body.min_stock_level) : null,
  });
  res.json({ product });
});

router.delete("/products/:id", async (req, res) => {
  const shop = await requireShop(req, res);
  if (!shop) return;
  const deleted = await db.deleteProduct(shop.shop_id, req.params.id);
  if (!deleted) return res.status(404).json({ error: "Product not found" });
  res.json({ deleted: true });
});

/**
 * The owner's evening question, answered:
 * "How much did I sell today and how much profit did I make?"
 * GET /api/report/daily?date=YYYY-MM-DD (defaults to today, IST).
 */
router.get("/report/daily", async (req, res) => {
  const date =
    String(req.query.date || "").trim() || toISTDate(new Date().toISOString());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "date must look like YYYY-MM-DD" });
  }
  const shop = await requireShop(req, res);
  if (!shop) return;
  const report = dailyReport({
    transactions: await db.listTransactions(shop.shop_id),
    products: await db.listProducts(shop.shop_id),
    date,
  });
  res.json(report);
});

/**
 * The shop profile. This is also the app's shop-code check: a phone that has
 * just been given a code calls this and, on 200, knows the code is real.
 * Deliberately returns only what the app needs — never the code list.
 */
router.get("/shop", async (req, res) => {
  const shop = await requireShop(req, res);
  if (!shop) return;
  res.json({
    shop: {
      shop_id: shop.shop_id,
      shop_name: shop.shop_name,
      shop_type: shop.shop_type,
      upi_id: shop.upi_id,
      owner_phone: shop.owner_phone,
    },
  });
});

/**
 * Recent sales for the home dashboard. Confirmed/sent only — drafts are
 * half-heard sentences, not sales. Newest first, capped by ?limit (max 50).
 * Items are summarised by the app; this returns them as stored.
 */
router.get("/transactions", async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
  const shop = await requireShop(req, res);
  if (!shop) return;
  const transactions = (await db.listTransactions(shop.shop_id))
    .filter((t) => ["confirmed", "sent"].includes(t.status))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, limit);
  res.json({ transactions });
});

/**
 * Customers — derived from confirmed/sent transactions grouped by phone.
 * We never asked for a name during the voice sale, so the phone IS the
 * customer for now. `credit_outstanding` is every udaar sale with no
 * settlement mechanism yet — same assumption as the daily report.
 */
router.get("/customers", async (req, res) => {
  const shop = await requireShop(req, res);
  if (!shop) return;
  const byPhone = new Map();
  for (const t of await db.listTransactions(shop.shop_id)) {
    if (!["confirmed", "sent"].includes(t.status)) continue;
    const phone = t.customer_phone;
    if (!phone) continue;
    const agg = byPhone.get(phone) || {
      phone,
      total_spent: 0,
      credit_outstanding: 0,
      purchases: 0,
      last_purchase: t.created_at,
    };
    agg.total_spent += t.total_amount || 0;
    if (t.payment_status === "credit") agg.credit_outstanding += t.total_amount || 0;
    agg.purchases += 1;
    if (new Date(t.created_at) > new Date(agg.last_purchase)) agg.last_purchase = t.created_at;
    byPhone.set(phone, agg);
  }
  const customers = [...byPhone.values()].sort(
    (a, b) => new Date(b.last_purchase) - new Date(a.last_purchase)
  );
  res.json({ customers });
});

// --- Voice Lock --------------------------------------------------------------
// Speaker verification lives in the Python service (voice-service/, port 8000).
// The phone never talks to it — only this backend does — so port 8000 never has
// to be reachable over Wi-Fi and the service can bind to 127.0.0.1.
//
// Why a separate /verify-and-transcribe and not a change to /transcribe: the
// typed fallback screens still use /transcribe and must never be gated. Same
// additive-route pattern the hands-free flow followed.

/**
 * Verify the clip, then transcribe it only if the owner is speaking.
 * Same multipart upload as /api/transcribe (field name: "audio").
 *
 * A rejection is HTTP 200 with empty text — to the app it looks like silence,
 * which is exactly how a customer talking should feel. It is not an error.
 */
router.post("/verify-and-transcribe", upload.single("audio"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "audio file required" });
  try {
    const shop = await requireShop(req, res);
    if (!shop) { fs.unlink(req.file.path, () => {}); return; }
    const gate = await runVoiceGate(req.file.path, shop.shop_id);

    if (!gate.allow) {
      fs.unlink(req.file.path, () => {});
      return res.json({
        text: "",
        allowed: false,
        speaker_verified: false,
        reason: gate.reason,
        lock_state: gate.lockState,
      });
    }

    // No speech in the clip is not a failure — the owner said nothing, or the
// clip was music/noise. Return empty text exactly like a rejected clip, so
// the app treats both as "nothing to bill".
    let text = "";
    try {
      text = (await transcribeAudio(req.file.path)) || "";
    } catch (e) {
      if (!/did not return a transcript/i.test(e.message)) throw e;
    }
    fs.unlink(req.file.path, () => {});
    return res.json({
      text,
      allowed: true,
      speaker_verified: gate.verified,
      reason: gate.reason,
      lock_state: gate.lockState,
    });
  } catch (err) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: err.message });
  }
});

// Verify + decide, with the service error folded into the fail mode.
async function runVoiceGate(audioPath, shopId) {
  const mode = voice.mode();
  const failMode = voice.failMode();
  if (mode === "off") {
    return voice.decide({ mode: "off", failMode });
  }

  let result = null;
  let error = null;
  try {
    result = await voice.verifySpeaker(audioPath, shopId);
    if (result.status === "not_enrolled") {
      // No profile yet: shadow mode must not block a shop that hasn't enrolled;
      // enforce mode treats it as "not the owner".
      result = { is_speaker: false, score: 0, reason: "not_enrolled" };
    }
  } catch (e) {
    console.error("[VOICE LOCK] verify failed:", e.message);
    error = e;
  }
  return voice.decide({ mode, result, error, failMode });
}

/**
 * One enrollment clip. body: multipart "audio".
 * Once enrolled, further calls are REFUSED unless the profile was reset first
 * with the admin PIN — otherwise anything on the network could overwrite the
 * owner's voice lock.
 */
// Keep in sync with VoiceEnrollScreen's five sentences.
const ENROLL_TARGET_CLIPS = 5;

router.post("/enroll-voice", upload.single("audio"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "audio file required" });
  const shop = await requireShop(req, res);
  if (!shop) { fs.unlink(req.file.path, () => {}); return; }
  try {
    // Enrollment completes after ENROLL_TARGET_CLIPS clips. Until then more
    // clips are the normal flow; after that, a new voice can only replace the
    // profile through the PIN-gated reset — otherwise anyone on the network
    // could overwrite the owner's voice lock.
    const status = await voice.getVoiceStatus(shop.shop_id).catch(() => null);
    if (status?.enrolled && (status.samples || 0) >= ENROLL_TARGET_CLIPS) {
      fs.unlink(req.file.path, () => {});
      return res.status(409).json({
        error: "Voice already registered. Re-enroll se pehle Voice Lock reset karein.",
        code: "already_enrolled",
      });
    }

    const result = await voice.enrollSample(req.file.path, shop.shop_id);
    fs.unlink(req.file.path, () => {});

    if (!result.ok) {
      return res.status(result.quality_rejected ? 422 : 400).json({
        error: result.error,
        quality_rejected: Boolean(result.quality_rejected),
      });
    }
    return res.json(result);
  } catch (err) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: "Voice service se connect nahi hua: " + err.message });
  }
});

/**
 * What the app shows on the voice screen: enrolled? mode? service up?
 */
router.get("/voice-status", async (req, res) => {
  const shop = await requireShop(req, res);
  if (!shop) return;
  try {
    const status = await voice.getVoiceStatus(shop.shop_id);
    res.json(status);
  } catch (err) {
    res.json({
      enrolled: false,
      samples: 0,
      mode: voice.mode(),
      service_up: false,
      error: err.message,
    });
  }
});

/**
 * Delete the stored voice profile. Requires the admin PIN so a stranger
 * holding the phone (or on the network) can't quietly re-enroll their voice.
 */
router.post("/voice-reset", async (req, res) => {
  const pin = process.env.VOICE_ADMIN_PIN;
  if (!pin) {
    return res.status(503).json({ error: "VOICE_ADMIN_PIN not set in .env — reset disabled" });
  }
  if (String(req.body?.pin || "") !== pin) {
    return res.status(403).json({ error: "Ghalat PIN" });
  }
  const shop = await requireShop(req, res);
  if (!shop) return;
  try {
    const result = await voice.resetVoice(shop.shop_id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * The third safety valve (PDF T7.4): an in-memory override so the owner can
 * switch the lock off for a bad day without editing .env and restarting.
 * Not persisted — a restart returns to the .env value on purpose.
 */
router.post("/voice-override", (req, res) => {
  const pin = process.env.VOICE_ADMIN_PIN;
  if (pin && String(req.body?.pin || "") !== pin) {
    return res.status(403).json({ error: "Ghalat PIN" });
  }
  const value = String(req.body?.mode || "").toLowerCase();
  if (value === "off" || value === "shadow" || value === "enforce") {
    voice.setOverride(value);
    console.log(`[VOICE LOCK] runtime override -> ${value}`);
    return res.json({ mode: value, override: true });
  }
  if (value === "clear") {
    voice.setOverride(null);
    return res.json({ mode: voice.mode(), override: false });
  }
  res.status(400).json({ error: "mode must be off | shadow | enforce | clear" });
});

/**
 * Convenience — fetch a transaction's current state.
 */
router.get("/transaction/:id", async (req, res) => {
  const transaction = await db.getTransaction(req.params.id);
  if (!transaction) return res.status(404).json({ error: "Not found" });
  res.json({ transaction });
});

module.exports = router;
