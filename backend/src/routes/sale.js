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

const DEFAULT_SHOP_ID = "shop_1"; // MVP: single shop, hardcoded

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

    const parsedItems = await parseSaleItems(text);
    // A price the shopkeeper didn't say can come from the catalog — this is
    // what removes the "Price?" dead-end for known products.
    autoFillPrices(parsedItems, await db.listProducts());
    const newItems = parsedItems.map(toStoredItem);

    let transaction;
    if (transaction_id) {
      transaction = await db.addItemsToTransaction(transaction_id, newItems);
    } else {
      transaction = await db.createTransaction({ shop_id: DEFAULT_SHOP_ID, items: newItems });
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
    const transaction = await db.updateItemPrice(transaction_id, item_index, Number(price));
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
    const { phone, rest } = findPhoneNumber(text);

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
        autoFillPrices(parsed, await db.listProducts());
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
            : await db.createTransaction({ shop_id: DEFAULT_SHOP_ID, items: storedNewItems });
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
  const products = await db.listProducts();
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
  const product = await db.upsertProduct({
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
  const products = await db.listProducts();
  if (!products.some((p) => p.product_id === req.params.id)) {
    return res.status(404).json({ error: "Product not found" });
  }
  const product = await db.upsertProduct({
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
  const deleted = await db.deleteProduct(req.params.id);
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
  const report = dailyReport({
    transactions: await db.listTransactions(),
    products: await db.listProducts(),
    date,
  });
  res.json(report);
});

/**
 * The shop profile — the app header shows the real shop name instead of a
 * hardcoded label. MVP: always shop_1.
 */
router.get("/shop", async (req, res) => {
  const shop = await db.getShop(DEFAULT_SHOP_ID);
  if (!shop) return res.status(404).json({ error: "Shop not found" });
  res.json({ shop });
});

/**
 * Recent sales for the home dashboard. Confirmed/sent only — drafts are
 * half-heard sentences, not sales. Newest first, capped by ?limit (max 50).
 * Items are summarised by the app; this returns them as stored.
 */
router.get("/transactions", async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
  const transactions = (await db.listTransactions())
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
  const byPhone = new Map();
  for (const t of await db.listTransactions()) {
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

/**
 * Convenience — fetch a transaction's current state.
 */
router.get("/transaction/:id", async (req, res) => {
  const transaction = await db.getTransaction(req.params.id);
  if (!transaction) return res.status(404).json({ error: "Not found" });
  res.json({ transaction });
});

module.exports = router;
