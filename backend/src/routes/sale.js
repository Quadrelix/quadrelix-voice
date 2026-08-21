const express = require("express");

const router = express.Router();

const db = require("../db/db");
const { parseSaleText } = require("../services/parser");
const { generateBillImage } = require("../services/billImage");
const { sendBillOnWhatsApp } = require("../services/whatsapp");

const DEFAULT_SHOP_ID = "shop_1"; // MVP: single shop, hardcoded

/**
 * STEP 1 — Owner speaks/types one or more sale items.
 *
 * Examples:
 *
 * "5 white shirt 500 rupaye"
 *
 * "5 white shirts 500 rupaye aur 2 jeans 1200 rupaye"
 *
 * body:
 * {
 *   text: string,
 *   transaction_id?: string
 * }
 *
 * If transaction_id is omitted:
 *     create a new transaction
 *
 * If transaction_id is provided:
 *     append all parsed items to the existing transaction
 */
router.post("/parse-item", async (req, res) => {
  try {
    const { text, transaction_id } = req.body;

    if (!text || !String(text).trim()) {
      return res.status(400).json({
        error: "text is required",
      });
    }

    /*
     * Parser now ALWAYS returns:
     *
     * {
     *   items: [...]
     * }
     */
    const parsed = await parseSaleText(text);

    if (
      !parsed ||
      !Array.isArray(parsed.items) ||
      parsed.items.length === 0
    ) {
      return res.status(400).json({
        error: "No sale items found",
      });
    }

    /*
     * Convert parser output into our database item format.
     */
    const items = parsed.items.map((item) => {
      const quantity = Number(item.quantity);
      const price = Number(item.price);
      const productName = String(item.product || "").trim();

      if (!productName) {
        throw new Error("Product name is missing");
      }

      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error(`Invalid quantity for "${productName}"`);
      }

      if (!Number.isFinite(price) || price < 0) {
        throw new Error(`Invalid price for "${productName}"`);
      }

      return {
        product_name: productName,
        quantity,
        price,
        line_total: quantity * price,
      };
    });

    let transaction;

    /*
     * CASE 1:
     * No transaction_id
     *
     * Start a completely new bill.
     */
    if (!transaction_id) {
      transaction = await db.createTransaction({
        shop_id: DEFAULT_SHOP_ID,
        items,
      });
    }

    /*
     * CASE 2:
     * Existing transaction
     *
     * Add every parsed item to the SAME transaction.
     */
    else {
      /*
       * First verify that the transaction exists.
       */
      transaction = await db.getTransaction(transaction_id);

      if (!transaction) {
        return res.status(404).json({
          error: "Transaction not found",
        });
      }

      /*
       * Add all items one by one.
       */
      for (const item of items) {
        transaction = await db.addItemToTransaction(
          transaction_id,
          item
        );
      }
    }

    /*
     * Return the complete current transaction.
     *
     * parsed_items = only the items extracted from
     * THIS sentence.
     *
     * transaction.items = all items currently in the bill.
     */
    return res.json({
      transaction,
      parsed_items: items,
    });
  } catch (err) {
    console.error("POST /api/parse-item error:", err);

    return res.status(400).json({
      error: err.message || "Could not parse sale",
    });
  }
});

/**
 * STEP 2 — Save customer's mobile number.
 *
 * body:
 * {
 *   transaction_id: string,
 *   phone: string
 * }
 */
router.post("/confirm-contact", async (req, res) => {
  try {
    const { transaction_id, phone } = req.body;

    if (!transaction_id || !phone) {
      return res.status(400).json({
        error: "transaction_id and phone are required",
      });
    }

    /*
     * Keep digits only.
     *
     * Example:
     * "+91 98765 43210"
     *
     * becomes:
     * "919876543210"
     */
    const cleanPhone = String(phone).replace(/\D/g, "");

    if (cleanPhone.length < 10) {
      return res.status(400).json({
        error: "That doesn't look like a valid phone number",
      });
    }

    const transaction = await db.setCustomerPhone(
      transaction_id,
      cleanPhone
    );

    return res.json({
      transaction,
    });
  } catch (err) {
    console.error("POST /api/confirm-contact error:", err);

    return res.status(400).json({
      error: err.message || "Could not save customer contact",
    });
  }
});

/**
 * STEP 3 — Generate the bill image + UPI QR.
 *
 * body:
 * {
 *   transaction_id: string
 * }
 */
router.post("/generate-bill", async (req, res) => {
  try {
    const { transaction_id } = req.body;

    if (!transaction_id) {
      return res.status(400).json({
        error: "transaction_id is required",
      });
    }

    const transaction = await db.getTransaction(transaction_id);

    if (!transaction) {
      return res.status(404).json({
        error: "Transaction not found",
      });
    }

    /*
     * Bill cannot be generated without items.
     */
    if (!transaction.items || transaction.items.length === 0) {
      return res.status(400).json({
        error: "Cannot generate bill without items",
      });
    }

    const shop = await db.getShop(transaction.shop_id);

    if (!shop) {
      return res.status(404).json({
        error: "Shop not found",
      });
    }

    /*
     * Generate:
     *
     * - bill image
     * - UPI QR
     */
    const billImagePath = await generateBillImage({
      transaction,
      shop,
    });

    /*
     * Save generated image path in transaction.
     */
    const updated = await db.markBillGenerated(
      transaction_id,
      billImagePath
    );

    return res.json({
      transaction: updated,
      bill_image_path: billImagePath,
    });
  } catch (err) {
    console.error("POST /api/generate-bill error:", err);

    return res.status(400).json({
      error: err.message || "Could not generate bill",
    });
  }
});

/**
 * STEP 4 — Send generated bill to customer's WhatsApp.
 *
 * NOTE:
 * Current whatsapp.js is a simulated/stub implementation.
 *
 * body:
 * {
 *   transaction_id: string
 * }
 */
router.post("/send-bill", async (req, res) => {
  try {
    const { transaction_id } = req.body;

    if (!transaction_id) {
      return res.status(400).json({
        error: "transaction_id is required",
      });
    }

    const transaction = await db.getTransaction(transaction_id);

    if (!transaction) {
      return res.status(404).json({
        error: "Transaction not found",
      });
    }

    if (!transaction.customer_phone) {
      return res.status(400).json({
        error: "No customer phone on this transaction yet",
      });
    }

    if (!transaction.bill_image_path) {
      return res.status(400).json({
        error: "Bill image not generated yet",
      });
    }

    const shop = await db.getShop(transaction.shop_id);

    if (!shop) {
      return res.status(404).json({
        error: "Shop not found",
      });
    }

    const result = await sendBillOnWhatsApp({
      phone: transaction.customer_phone,
      billImagePath: transaction.bill_image_path,
      totalAmount: transaction.total_amount,
      shopName: shop.shop_name,
    });

    const updated = await db.markSent(transaction_id);

    return res.json({
      transaction: updated,
      send_result: result,
    });
  } catch (err) {
    console.error("POST /api/send-bill error:", err);

    return res.status(400).json({
      error: err.message || "Could not send bill",
    });
  }
});

/**
 * Convenience endpoint:
 *
 * GET /api/transaction/:id
 *
 * Returns the complete current transaction.
 */
router.get("/transaction/:id", async (req, res) => {
  try {
    const transaction = await db.getTransaction(req.params.id);

    if (!transaction) {
      return res.status(404).json({
        error: "Not found",
      });
    }

    return res.json({
      transaction,
    });
  } catch (err) {
    console.error("GET /api/transaction/:id error:", err);

    return res.status(500).json({
      error: "Could not fetch transaction",
    });
  }
});

module.exports = router;