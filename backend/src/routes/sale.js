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
const { rateLimit, concurrency, lockout, clientIp } = require("../middleware/limits");

// ---------------------------------------------------------------------------
// Shop resolution and ownership
// ---------------------------------------------------------------------------
// Every command a shop makes arrives with its shop code (X-Shop-Code). The code
// is the pilot's credential: it selects the shop AND authorises the caller, so
// it is long enough to be unguessable at API speed (32^6) and wrong guesses are
// locked out per IP. A transaction id is NOT a credential: every route that
// touches a transaction first checks that it belongs to the shop named by the
// request, so knowing (or guessing) another shop's id gets a 404.
//
// Resolution order:
//   1. X-Shop-Code header   — the app's normal path
//   2. ?shop_code=          — curl / debugging
//   3. ?shop_id= with a valid ADMIN_TOKEN — admin tooling
//   4. the legacy demo shop — only when ALLOW_LEGACY_SHOP=1 (local debugging)

let legacyShopCache = null; // shop_1 era data, demo/legacy only

function adminTokenOk(req) {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return false;
  const given = String(req.header("Authorization") || "").replace(/^Bearer\s+/i, "");
  return given && given === token;
}

const shopCodeLockout = lockout({ windowMs: 15 * 60 * 1000, maxFailures: 20 });
const pinLockout = lockout({ windowMs: 15 * 60 * 1000, maxFailures: 10 });

async function resolveShop(req) {
  const code = req.header("X-Shop-Code") || req.query.shop_code;
  if (code) return (await db.getShopByCode(code)) || null;

  const shopId = req.query.shop_id;
  if (shopId && adminTokenOk(req)) return (await db.getShop(shopId)) || null;

  if (process.env.ALLOW_LEGACY_SHOP === "1") {
    const legacy = process.env.LEGACY_SHOP_ID || "legacy_demo";
    if (!legacyShopCache) legacyShopCache = await db.getShop(legacy);
    return legacyShopCache || null;
  }
  return null;
}

// Express helper: resolve the shop (once per request), or answer 401/404/429
// and return null.
async function requireShop(req, res) {
  if (req.shop) return req.shop;
  if (shopCodeLockout.check(req, res)) return null;

  const hadCode = Boolean(req.header("X-Shop-Code") || req.query.shop_code);
  const shop = await resolveShop(req);
  if (!shop) {
    if (hadCode) shopCodeLockout.fail(req);
    res.status(hadCode ? 404 : 401).json({
      error: hadCode ? "Unknown shop code" : "Shop code required",
      hint: "App me dukaan ka code daalein.",
    });
    return null;
  }
  req.shop = shop;
  return shop;
}

// Middleware form: runs BEFORE multer so an unauthenticated caller can never
// make the server accept (or write to disk) an upload.
async function shopGate(req, res, next) {
  if (await requireShop(req, res)) next();
}

/**
 * The only way a route may obtain a transaction by id. Returns
 * { shop, transaction } or answers 404 — the SAME 404 for "no such id" and
 * "someone else's id", so ids cannot be probed.
 */
async function ownedTransaction(req, res, transactionId) {
  const shop = await requireShop(req, res);
  if (!shop) return null;
  const transaction = transactionId ? await db.getTransaction(String(transactionId)) : null;
  if (!transaction || transaction.shop_id !== shop.shop_id) {
    res.status(404).json({ error: "Transaction not found" });
    return null;
  }
  return { shop, transaction };
}

// One error shape for every route. Frozen bills are a conflict (409), an
// upstream timeout is a gateway timeout (504), everything else keeps the old 400.
function sendError(res, err, status = 400) {
  if (err && err.code === "bill_frozen") {
    return res.status(409).json({ error: err.message, code: "bill_frozen" });
  }
  if (err && (err.code === "ECONNABORTED" || err.code === "ETIMEDOUT")) {
    return res.status(504).json({ error: "Awaaz service dheemi hai — dobara boliye." });
  }
  return res.status(status).json({ error: err && err.message ? err.message : "Request failed" });
}

// ---------------------------------------------------------------------------
// Upload and rate limits. Audio endpoints spend real money (Sarvam), so they are
// gated by shop first, limited per IP / shop / day / in-flight, and size-capped.
// ---------------------------------------------------------------------------
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, "..", "..", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const AUDIO_MAX_BYTES = 5 * 1024 * 1024; // a 30 s m4a is ~500 KB
const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: AUDIO_MAX_BYTES, files: 1, fields: 8, parts: 12 },
  fileFilter(req, file, cb) {
    if (/^audio\//.test(file.mimetype) || file.mimetype === "video/mp4") return cb(null, true);
    cb(Object.assign(new Error("Sirf audio file chalegi"), { status: 415 }));
  },
});

const byShop = (req) => req.shop?.shop_id;
const audioLimits = [
  rateLimit({ windowMs: 60 * 1000, max: 60, key: clientIp }),
  rateLimit({ windowMs: 60 * 1000, max: 30, key: byShop }),
  rateLimit({
    windowMs: 24 * 60 * 60 * 1000,
    max: Number(process.env.STT_DAILY_LIMIT) || 1000,
    key: byShop,
    message: "Aaj ki voice limit poori ho gayi — kal dobara try karein.",
  }),
  concurrency({ max: 3, key: byShop }),
];
const textLimits = [rateLimit({ windowMs: 60 * 1000, max: 90, key: byShop })];

// Temp upload cleanup — always, success or failure.
function discardUpload(req) {
  if (req.file) fs.unlink(req.file.path, () => {});
}

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
router.post("/transcribe", shopGate, ...audioLimits, upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "audio file is required" });
    const text = await transcribeAudio(req.file.path);
    res.json({ text });
  } catch (err) {
    console.error("TRANSCRIBE ERROR:", err.message);
    sendError(res, err);
  } finally {
    discardUpload(req);
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
router.post("/parse-item", shopGate, ...textLimits, async (req, res) => {
  try {
    const { text, transaction_id } = req.body;
    if (!text) return res.status(400).json({ error: "text is required" });
    const shop = req.shop;

    if (transaction_id) {
      const owned = await ownedTransaction(req, res, transaction_id);
      if (!owned) return;
    }

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
    sendError(res, err);
  }
});

/**
 * Fill in a price for an item that came back without one.
 * body: { transaction_id, item_index, price }
 */
router.post("/update-item-price", shopGate, async (req, res) => {
  try {
    const { transaction_id, item_index, price } = req.body;
    if (!transaction_id || item_index == null || price == null) {
      return res.status(400).json({ error: "transaction_id, item_index, and price are required" });
    }
    if (!(await ownedTransaction(req, res, transaction_id))) return;
    const transaction = await db.updateItemPrice(transaction_id, item_index, price);
    res.json({ transaction });
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * STEP 2 — Owner speaks the contact number, confirms "yes".
 * body: { transaction_id: string, phone: string }
 */
router.post("/confirm-contact", shopGate, async (req, res) => {
  try {
    const { transaction_id, phone } = req.body;
    if (!transaction_id || !phone) {
      return res.status(400).json({ error: "transaction_id and phone are required" });
    }
    const cleanPhone = String(phone).replace(/\D/g, "");
    if (cleanPhone.length < 10) {
      return res.status(400).json({ error: "That doesn't look like a valid phone number" });
    }
    if (!(await ownedTransaction(req, res, transaction_id))) return;
    const transaction = await db.setCustomerPhone(transaction_id, cleanPhone);
    res.json({ transaction });
  } catch (err) {
    sendError(res, err);
  }
});

// A bill PNG is re-creatable from the saved sale at any time, so a missing file
// (Render's disk is wiped on restart) is rebuilt instead of failing the send.
async function ensureBillFile(transaction, shop) {
  if (transaction.bill_image_path && fs.existsSync(transaction.bill_image_path)) {
    return transaction.bill_image_path;
  }
  return generateBillImage({ transaction, shop });
}

function billFilename(transaction) {
  return transaction.bill_image_path ? path.basename(transaction.bill_image_path) : null;
}

/**
 * STEP 3 — Generate the bill image + UPI QR, save it. This FINALIZES the sale
 * (stock moves, the bill freezes); calling it again returns the same bill.
 * body: { transaction_id: string }
 */
router.post("/generate-bill", shopGate, async (req, res) => {
  try {
    const owned = await ownedTransaction(req, res, req.body.transaction_id);
    if (!owned) return;
    const { shop, transaction } = owned;

    if (transaction.finalized_at) {
      return res.json({
        transaction,
        bill_image_path: transaction.bill_image_path,
        bill_filename: billFilename(transaction),
        already_finalized: true,
      });
    }
    if (!transaction.items.length) {
      return res.status(400).json({ error: "This bill has no items on it yet" });
    }
    if (transaction.items.some((i) => i.price == null)) {
      return res.status(400).json({ error: "Some items are missing a price — fill those in first" });
    }

    const billImagePath = await generateBillImage({ transaction, shop });
    const { transaction: updated, already_finalized } = await db.finalizeSale(
      transaction.transaction_id,
      { bill_image_path: billImagePath }
    );

    // bill_image_path is a server-side filesystem path and differs by OS
    // (backslashes on Windows) — clients should use bill_filename with the
    // /bills static route instead of trying to parse the path themselves.
    res.json({
      transaction: updated,
      bill_image_path: updated.bill_image_path,
      bill_filename: billFilename(updated),
      already_finalized,
    });
  } catch (err) {
    sendError(res, err);
  }
});

// Send (or re-send) and record what actually happened. Delivery state lives on
// its own column: 'simulated' (no provider configured) and 'failed' never turn
// into 'sent', and a failure never un-does the sale.
async function deliverBill({ transaction, shop }) {
  const billImagePath = await ensureBillFile(transaction, shop);
  try {
    const result = await sendBillOnWhatsApp({
      phone: transaction.customer_phone,
      billImagePath,
      totalAmount: transaction.total_amount,
      shopName: shop.shop_name,
    });
    const status = result.status === "simulated" ? "simulated" : "sent";
    const updated = await db.markDelivery(transaction.transaction_id, status);
    return { transaction: updated, send_result: result, delivery_status: status };
  } catch (err) {
    await db.markDelivery(transaction.transaction_id, "failed").catch(() => {});
    err.deliveryFailed = true;
    throw err;
  }
}

/**
 * STEP 4 — Send the generated bill + QR to the customer's WhatsApp.
 * body: { transaction_id: string }
 */
router.post("/send-bill", shopGate, async (req, res) => {
  try {
    const owned = await ownedTransaction(req, res, req.body.transaction_id);
    if (!owned) return;
    const { shop, transaction } = owned;
    if (!transaction.customer_phone) {
      return res.status(400).json({ error: "No customer phone on this transaction yet" });
    }
    if (!transaction.bill_image_path) {
      return res.status(400).json({ error: "Bill image not generated yet" });
    }
    // Already delivered: a repeat tap must not message the customer twice.
    if (transaction.delivery_status === "sent") {
      return res.json({
        transaction,
        send_result: { status: "sent", already_sent: true },
        delivery_status: "sent",
      });
    }
    res.json(await deliverBill({ transaction, shop }));
  } catch (err) {
    sendError(res, err);
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
router.post("/utterance", shopGate, ...textLimits, async (req, res) => {
  try {
    const { text, transaction_id } = req.body;
    if (!text) return res.status(400).json({ error: "text is required" });

    // The number comes out of the sentence before anything else looks at it —
    // left in, a 10-digit run is a quantity, and the bill reads "9876543210
    // Aam".
    const { phone, partial, rest } = findPhoneNumber(text);
    const shop = req.shop;

    let transaction = null;
    if (transaction_id) {
      const owned = await ownedTransaction(req, res, transaction_id);
      if (!owned) return;
      transaction = owned.transaction;
      if (transaction.finalized_at) {
        return res.status(409).json({
          error: "Ye bill pehle hi ban chuka hai — naya sale shuru karein.",
          code: "bill_frozen",
        });
      }
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
    sendError(res, err);
  }
});

/**
 * Attach the phone, render the bill, complete the sale, send it — in one call.
 * body: { transaction_id: string, phone: string, payment_status?: 'paid'|'credit' }
 *
 * Order matters:
 *   1. render the PNG            (no database writes — nothing to undo)
 *   2. db.finalizeSale           (ONE database transaction: phone, payment,
 *                                 bill marker, stock deduction, freeze)
 *   3. send + record delivery    (after the commit; a failure here never
 *                                 un-does the sale)
 * It is idempotent: a retry after a dropped response finds the sale already
 * finalized and returns it — no second stock deduction, no second message.
 *
 * Response: { transaction, bill_filename, send_result, delivery_status,
 *             send_error?, already_finalized? }. delivery_status is 'sent',
 * 'simulated' (no WhatsApp provider — the app offers the share sheet) or
 * 'failed'. The HTTP status is 200 in all three: the SALE succeeded.
 */
router.post("/finalize", shopGate, async (req, res) => {
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

    const owned = await ownedTransaction(req, res, transaction_id);
    if (!owned) return;
    const { shop } = owned;
    let transaction = owned.transaction;

    // Retry of a sale that already went through: answer with what exists.
    if (transaction.finalized_at) {
      return res.json({
        transaction,
        bill_filename: billFilename(transaction),
        send_result: { status: transaction.delivery_status },
        delivery_status: transaction.delivery_status,
        already_finalized: true,
      });
    }

    if (!transaction.items.length) {
      return res.status(400).json({ error: "This bill has no items on it yet" });
    }
    if (transaction.items.some((i) => i.price == null)) {
      return res.status(400).json({ error: "Some items are missing a price — fill those in first" });
    }

    // Udaar: the sale is real, only the payment is deferred. 'credit' lands
    // in the day's outstanding total on the report; anything else is 'paid'.
    const paymentStatus = req.body.payment_status === "credit" ? "credit" : "paid";

    const billImagePath = await generateBillImage({
      transaction: { ...transaction, customer_phone: cleanPhone },
      shop,
    });
    const done = await db.finalizeSale(transaction_id, {
      phone: cleanPhone,
      payment_status: paymentStatus,
      bill_image_path: billImagePath,
    });
    transaction = done.transaction;

    // Two requests raced and the other one won: it owns the send.
    if (done.already_finalized) {
      return res.json({
        transaction,
        bill_filename: billFilename(transaction),
        send_result: { status: transaction.delivery_status },
        delivery_status: transaction.delivery_status,
        already_finalized: true,
      });
    }

    const body = { bill_filename: billFilename(transaction) };
    try {
      Object.assign(body, await deliverBill({ transaction, shop }));
    } catch (err) {
      console.error("FINALIZE SEND ERROR:", err.message);
      Object.assign(body, {
        transaction: await db.getTransaction(transaction_id),
        send_result: { status: "failed" },
        delivery_status: "failed",
        send_error: err.message,
      });
    }
    res.json(body);
  } catch (err) {
    sendError(res, err);
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
    .sort((a, b) => new Date(b.finalized_at || b.created_at) - new Date(a.finalized_at || a.created_at))
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
      last_purchase: t.finalized_at || t.created_at,
    };
    agg.total_spent += t.total_amount || 0;
    if (t.payment_status === "credit") agg.credit_outstanding += t.total_amount || 0;
    agg.purchases += 1;
    const soldAt = t.finalized_at || t.created_at;
    if (new Date(soldAt) > new Date(agg.last_purchase)) agg.last_purchase = soldAt;
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
router.post("/verify-and-transcribe", shopGate, ...audioLimits, upload.single("audio"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "audio file required" });
  try {
    const gate = await runVoiceGate(req.file.path, req.shop.shop_id);

    if (!gate.allow) {
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
    return res.json({
      text,
      allowed: true,
      speaker_verified: gate.verified,
      reason: gate.reason,
      lock_state: gate.lockState,
    });
  } catch (err) {
    return sendError(res, err);
  } finally {
    discardUpload(req);
  }
});

// Verify + decide, with the service error folded into the fail mode.
async function runVoiceGate(audioPath, shopId) {
  const mode = voice.mode(shopId);
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

router.post("/enroll-voice", shopGate, ...audioLimits, upload.single("audio"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "audio file required" });
  const shop = req.shop;
  try {
    // Enrollment completes after ENROLL_TARGET_CLIPS clips. Until then more
    // clips are the normal flow; after that, a new voice can only replace the
    // profile through the PIN-gated reset — otherwise anyone holding this
    // shop's code could overwrite the owner's voice lock.
    const status = await voice.getVoiceStatus(shop.shop_id).catch(() => null);
    if (status?.enrolled && (status.samples || 0) >= ENROLL_TARGET_CLIPS) {
      return res.status(409).json({
        error: "Voice already registered. Re-enroll se pehle Voice Lock reset karein.",
        code: "already_enrolled",
      });
    }

    const result = await voice.enrollSample(req.file.path, shop.shop_id);

    if (!result.ok) {
      return res.status(result.quality_rejected ? 422 : 400).json({
        error: result.error,
        quality_rejected: Boolean(result.quality_rejected),
      });
    }
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ error: "Voice service se connect nahi hua: " + err.message });
  } finally {
    discardUpload(req);
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
      mode: voice.mode(shop.shop_id),
      service_up: false,
      error: err.message,
    });
  }
});

/**
 * Delete the stored voice profile. Requires the admin PIN so a stranger
 * holding the phone (or on the network) can't quietly re-enroll their voice.
 */
// Admin PIN check shared by reset/override. Fails CLOSED: with no PIN
// configured the action is disabled, never open. Wrong guesses are locked out.
function adminPinOk(req, res) {
  const pin = process.env.VOICE_ADMIN_PIN;
  if (!pin) {
    res.status(503).json({ error: "VOICE_ADMIN_PIN not set — ye action band hai" });
    return false;
  }
  if (pinLockout.check(req, res)) return false;
  if (String(req.body?.pin || "") !== pin) {
    pinLockout.fail(req);
    res.status(403).json({ error: "Ghalat PIN" });
    return false;
  }
  return true;
}

router.post("/voice-reset", shopGate, async (req, res) => {
  if (!adminPinOk(req, res)) return;
  try {
    const result = await voice.resetVoice(req.shop.shop_id);
    res.json(result);
  } catch (err) {
    sendError(res, err);
  }
});

/**
 * The third safety valve (PDF T7.4): an in-memory override so the owner can
 * switch the lock off for a bad day without editing .env and restarting.
 * Scoped to the calling shop — one shop's bad day never changes another's.
 * Not persisted — a restart returns to the .env value on purpose.
 */
router.post("/voice-override", shopGate, (req, res) => {
  if (!adminPinOk(req, res)) return;
  const shopId = req.shop.shop_id;
  const value = String(req.body?.mode || "").toLowerCase();
  if (value === "off" || value === "shadow" || value === "enforce") {
    voice.setOverride(value, shopId);
    console.log(`[VOICE LOCK] runtime override for ${shopId} -> ${value}`);
    return res.json({ mode: value, override: true });
  }
  if (value === "clear") {
    voice.setOverride(null, shopId);
    return res.json({ mode: voice.mode(shopId), override: false });
  }
  res.status(400).json({ error: "mode must be off | shadow | enforce | clear" });
});

/**
 * Convenience — fetch a transaction's current state.
 */
router.get("/transaction/:id", shopGate, async (req, res) => {
  const owned = await ownedTransaction(req, res, req.params.id);
  if (!owned) return;
  res.json({ transaction: owned.transaction });
});

module.exports = router;
