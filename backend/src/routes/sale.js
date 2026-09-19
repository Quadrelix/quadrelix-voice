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

/**
 * Convenience — fetch a transaction's current state.
 */
router.get("/transaction/:id", async (req, res) => {
  const transaction = await db.getTransaction(req.params.id);
  if (!transaction) return res.status(404).json({ error: "Not found" });
  res.json({ transaction });
});

module.exports = router;
