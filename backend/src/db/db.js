// Data access layer — PostgreSQL (Neon in the pilot, any Postgres elsewhere).
//
// The function names below are the seam the whole backend was written against:
// routes only ever call these, never SQL. That is what makes this swap safe
// and what will let a future schema change happen in one file.
//
// MULTI-SHOP: every product and transaction belongs to exactly one shop.
// Read functions take a shop_id; transaction functions do not, because a
// transaction id is globally unique and already knows its shop — resolving it
// from the row is the correct ownership rule for bills, reports and sends.
//
// TESTS: when DB_FILE is set (node --test runs each file in its own process),
// the lowdb implementation is used instead, so `npm test` stays offline and
// never touches the real database. Both implementations expose the same
// functions with the same return shapes.

const path = require("path");
const fs = require("fs");
const { randomUUID } = require("crypto");

const USE_PG = !process.env.DB_FILE;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// Postgres returns NUMERIC as a string (to avoid float precision loss). The
// app, the bill renderer and the report all do arithmetic on these values, so
// normalise at the boundary rather than in fifteen call sites.
function num(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isNaN(n) ? null : n;
}

function validatePriceUpdate(itemIndex, value) {
  if (!Number.isSafeInteger(itemIndex) || itemIndex < 0 || itemIndex > 2147483647) {
    throw new Error("item_index must be a nonnegative integer");
  }
  if ((typeof value !== "number" && typeof value !== "string") ||
      (typeof value === "string" && value.trim() === "")) {
    throw new Error("price must be a finite number >= 0");
  }
  const price = Number(value);
  if (!Number.isFinite(price) || price < 0) {
    throw new Error("price must be a finite number >= 0");
  }
  return price;
}

function shapeProduct(row) {
  return {
    product_id: row.product_id,
    shop_id: row.shop_id,
    name: row.name,
    brand: row.brand,
    category: row.category,
    purchase_price: num(row.purchase_price),
    selling_price: num(row.selling_price),
    stock_qty: num(row.stock_qty) ?? 0,
    min_stock_level: num(row.min_stock_level),
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

function shapeTransaction(row) {
  const items = Array.isArray(row.items) ? row.items : row.items || [];
  return {
    transaction_id: row.transaction_id,
    shop_id: row.shop_id,
    customer_phone: row.customer_phone,
    items,
    total_amount: num(row.total_amount) ?? 0,
    status: row.status,
    payment_status: row.payment_status,
    bill_image_path: row.bill_image_path,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
  };
}

function shapeShop(row) {
  return {
    shop_id: row.shop_id,
    shop_code: row.shop_code,
    shop_name: row.shop_name,
    shop_type: row.shop_type,
    upi_id: row.upi_id,
    owner_phone: row.owner_phone,
    active: row.active,
  };
}

// A shop code the owner actually types: no 0/O or 1/I confusion.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateShopCode(length = 6) {
  const { randomInt } = require("crypto");
  let out = "";
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

// ---------------------------------------------------------------------------
// PostgreSQL implementation
// ---------------------------------------------------------------------------

let pool = null;

function pgPool() {
  if (pool) return pool;
  const { Pool } = require("pg");
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Neon and most managed Postgres need TLS; a local dev database does not.
    ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || "")
      ? false
      : { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
  });
  return pool;
}

async function query(text, params) {
  const res = await pgPool().query(text, params);
  return res.rows;
}

const pgImpl = {
  async init() {
    const schemaPath = path.join(__dirname, "schema.sql");
    await pgPool().query(fs.readFileSync(schemaPath, "utf8"));
  },

  async listProducts(shopId) {
    const rows = await query(
      "SELECT * FROM products WHERE shop_id = $1 ORDER BY name ASC",
      [shopId]
    );
    return rows.map(shapeProduct);
  },

  async upsertProduct(shopId, product) {
    if (product.product_id) {
      const rows = await query(
        `UPDATE products SET name=$1, brand=$2, category=$3, purchase_price=$4,
                selling_price=$5, stock_qty=$6, min_stock_level=$7
           WHERE product_id=$8 AND shop_id=$9
         RETURNING *`,
        [
          product.name, product.brand, product.category, product.purchase_price,
          product.selling_price, product.stock_qty ?? 0, product.min_stock_level,
          product.product_id, shopId,
        ]
      );
      if (!rows.length) throw new Error("Product not found");
      return shapeProduct(rows[0]);
    }
    const rows = await query(
      `INSERT INTO products (shop_id, name, brand, category, purchase_price,
                             selling_price, stock_qty, min_stock_level)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        shopId, product.name, product.brand, product.category, product.purchase_price,
        product.selling_price, product.stock_qty ?? 0, product.min_stock_level,
      ]
    );
    return shapeProduct(rows[0]);
  },

  async deleteProduct(shopId, product_id) {
    const rows = await query(
      "DELETE FROM products WHERE product_id = $1 AND shop_id = $2 RETURNING product_id",
      [product_id, shopId]
    );
    return rows.length > 0;
  },

  async listTransactions(shopId) {
    const rows = shopId
      ? await query(
          "SELECT * FROM transactions WHERE shop_id = $1 ORDER BY created_at DESC",
          [shopId]
        )
      : await query("SELECT * FROM transactions ORDER BY created_at DESC");
    return rows.map(shapeTransaction);
  },

  async createTransaction({ shop_id, items }) {
    const total = (items || []).reduce((sum, i) => sum + (i.line_total || 0), 0);
    const rows = await query(
      `INSERT INTO transactions (transaction_id, shop_id, items, total_amount)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [randomUUID(), shop_id, JSON.stringify(items || []), total]
    );
    return shapeTransaction(rows[0]);
  },

  async addItemsToTransaction(transaction_id, items) {
    // Read-modify-write under one statement so two quick utterances cannot
    // overwrite each other's items.
    const rows = await query(
      `UPDATE transactions
          SET items = items || $2::jsonb,
              total_amount = COALESCE((
                SELECT SUM(COALESCE((e->>'line_total')::numeric, 0))
                  FROM jsonb_array_elements(items || $2::jsonb) e
              ), 0)
        WHERE transaction_id = $1
      RETURNING *`,
      [transaction_id, JSON.stringify(items || [])]
    );
    if (!rows.length) throw new Error("Transaction not found");
    return shapeTransaction(rows[0]);
  },

  async updateItemPrice(transaction_id, item_index, price) {
    price = validatePriceUpdate(item_index, price);
    const rows = await query(
      `UPDATE transactions
          SET items = jsonb_set(
                jsonb_set(items, ARRAY[$2::text, 'price'], to_jsonb($3::numeric)),
                ARRAY[$2::text, 'line_total'],
                to_jsonb((items->$2::int->>'quantity')::numeric * $3::numeric)
              ),
              total_amount = COALESCE((
                SELECT SUM(CASE WHEN ordinal = $2::bigint + 1
                  THEN (item->>'quantity')::numeric * $3::numeric
                  ELSE COALESCE((item->>'line_total')::numeric, 0) END)
                FROM jsonb_array_elements(items) WITH ORDINALITY AS lines(item, ordinal)
              ), 0)
        WHERE transaction_id = $1
          AND $2::int < jsonb_array_length(items)
      RETURNING *`,
      [transaction_id, String(item_index), price]
    );
    // Both values use the locked row in ONE UPDATE. A concurrent item append
    // or price edit must not be overwritten by a second total-only write.
    if (!rows.length) throw new Error("Transaction or item not found");
    return shapeTransaction(rows[0]);
  },

  async setCustomerPhone(transaction_id, phone) {
    const rows = await query(
      "UPDATE transactions SET customer_phone=$2, status='confirmed' WHERE transaction_id=$1 RETURNING *",
      [transaction_id, phone]
    );
    if (!rows.length) throw new Error("Transaction not found");
    return shapeTransaction(rows[0]);
  },

  async setPaymentStatus(transaction_id, payment_status) {
    const rows = await query(
      "UPDATE transactions SET payment_status=$2 WHERE transaction_id=$1 RETURNING *",
      [transaction_id, payment_status]
    );
    if (!rows.length) throw new Error("Transaction not found");
    return shapeTransaction(rows[0]);
  },

  async markBillGenerated(transaction_id, bill_image_path) {
    // Stock is deducted exactly once, HERE: the bill being rendered is the
    // moment the goods left the shop. `bill_image_path IS NULL` is the guard
    // that makes a re-run of /finalize idempotent.
    const rows = await query(
      `UPDATE transactions SET bill_image_path = $2
        WHERE transaction_id = $1 AND bill_image_path IS NULL
      RETURNING *`,
      [transaction_id, bill_image_path]
    );

    if (!rows.length) {
      const existing = await query("SELECT * FROM transactions WHERE transaction_id=$1", [transaction_id]);
      if (!existing.length) throw new Error("Transaction not found");
      return shapeTransaction(existing[0]); // already generated — stock untouched
    }

    const txn = shapeTransaction(rows[0]);
    for (const item of txn.items || []) {
      if (item.product_id == null) continue;
      await query(
        `UPDATE products SET stock_qty = GREATEST(0, COALESCE(stock_qty,0) - $3)
          WHERE product_id = $1 AND shop_id = $2`,
        [item.product_id, txn.shop_id, item.quantity || 0]
      );
    }
    return txn;
  },

  async markSent(transaction_id) {
    const rows = await query(
      "UPDATE transactions SET status='sent' WHERE transaction_id=$1 RETURNING *",
      [transaction_id]
    );
    if (!rows.length) throw new Error("Transaction not found");
    return shapeTransaction(rows[0]);
  },

  async getTransaction(transaction_id) {
    const rows = await query("SELECT * FROM transactions WHERE transaction_id=$1", [transaction_id]);
    return rows.length ? shapeTransaction(rows[0]) : undefined;
  },

  async getShop(shop_id) {
    const rows = await query("SELECT * FROM shops WHERE shop_id=$1", [shop_id]);
    return rows.length ? shapeShop(rows[0]) : undefined;
  },

  async getShopByCode(shop_code) {
    const rows = await query(
      "SELECT * FROM shops WHERE UPPER(shop_code)=UPPER($1) AND active=true",
      [String(shop_code || "").trim()]
    );
    return rows.length ? shapeShop(rows[0]) : undefined;
  },

  async listShops() {
    const rows = await query("SELECT * FROM shops ORDER BY created_at ASC");
    return rows.map(shapeShop);
  },

  async createShop({ shop_name, shop_type, upi_id, owner_phone }) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const shop_code = generateShopCode();
      try {
        const rows = await query(
          `INSERT INTO shops (shop_id, shop_code, shop_name, shop_type, upi_id, owner_phone)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [
            `shop_${shop_code.toLowerCase()}`, shop_code, shop_name,
            shop_type || null, upi_id || null, owner_phone || null,
          ]
        );
        return shapeShop(rows[0]);
      } catch (e) {
        if (e.code === "23505") continue; // unique violation — retry a new code
        throw e;
      }
    }
    throw new Error("Could not allocate a unique shop code");
  },

  async updateShop(shop_id, patch) {
    const allowed = ["shop_name", "shop_type", "upi_id", "owner_phone", "active"];
    const sets = [];
    const params = [shop_id];
    for (const key of allowed) {
      if (patch[key] !== undefined) {
        params.push(patch[key]);
        sets.push(`${key} = $${params.length}`);
      }
    }
    if (!sets.length) return this.getShop(shop_id);
    const rows = await query(
      `UPDATE shops SET ${sets.join(", ")} WHERE shop_id=$1 RETURNING *`,
      params
    );
    return rows.length ? shapeShop(rows[0]) : undefined;
  },

  async rotateShopCode(shop_id) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const code = generateShopCode();
      try {
        const rows = await query(
          "UPDATE shops SET shop_code=$2 WHERE shop_id=$1 RETURNING *",
          [shop_id, code]
        );
        return rows.length ? shapeShop(rows[0]) : undefined;
      } catch (e) {
        if (e.code === "23505") continue;
        throw e;
      }
    }
    throw new Error("Could not allocate a unique shop code");
  },

  async close() {
    if (pool) await pool.end();
    pool = null;
  },
};

// ---------------------------------------------------------------------------
// lowdb implementation — tests only (DB_FILE set)
// ---------------------------------------------------------------------------

const lowdbImpl = (() => {
  const { Low } = require("lowdb");
  const { JSONFile } = require("lowdb/node");

  // Lazy: this block is evaluated at require time even when Postgres is in
  // use, and constructing JSONFile(undefined) throws. Tests set DB_FILE
  // before requiring, so by the time init() runs the path is there.
  let db = null;

  function backend() {
    if (db) return db;
    const file = process.env.DB_FILE;
    if (!file) throw new Error("lowdb adapter used without DB_FILE (tests only)");
    db = new Low(new JSONFile(file), { shops: [], products: [], transactions: [] });
    return db;
  }

  async function save() {
    const store = backend();
    const file = process.env.DB_FILE;
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(store.data, null, 2));
    fs.renameSync(tmp, file);
  }

  return {
    async init() {
      const db = backend();
      await db.read();
      db.data ||= { shops: [], products: [], transactions: [] };
      db.data.shops ||= [];
      db.data.products ||= [];
      db.data.transactions ||= [];
      // Legacy rows created before multi-shop have no shop_id.
      for (const p of db.data.products) if (!p.shop_id) p.shop_id = "shop_1";
      await save();
    },

    async listProducts(shopId) {
      const db = backend();
      await db.read();
      return (db.data.products || []).filter((p) => (p.shop_id || "shop_1") === shopId);
    },

    async upsertProduct(shopId, product) {
      const db = backend();
      await db.read();
      const existing = product.product_id
        ? db.data.products.find((p) => p.product_id === product.product_id)
        : null;
      if (existing) {
        Object.assign(existing, product, { shop_id: shopId });
        await save();
        return existing;
      }
      const record = {
        product_id: randomUUID(),
        shop_id: shopId,
        created_at: new Date().toISOString(),
        ...product,
      };
      db.data.products.push(record);
      await save();
      return record;
    },

    async deleteProduct(shopId, product_id) {
      const db = backend();
      await db.read();
      const before = db.data.products.length;
      db.data.products = db.data.products.filter(
        (p) => !(p.product_id === product_id && (p.shop_id || "shop_1") === shopId)
      );
      await save();
      return db.data.products.length < before;
    },

    async listTransactions(shopId) {
      const db = backend();
      await db.read();
      const all = db.data.transactions || [];
      return shopId ? all.filter((t) => t.shop_id === shopId) : all;
    },

    async createTransaction({ shop_id, items }) {
      const db = backend();
      await db.read();
      const transaction = {
        transaction_id: randomUUID(),
        shop_id,
        customer_phone: null,
        items,
        total_amount: items.reduce((sum, i) => sum + (i.line_total || 0), 0),
        status: "draft",
        payment_status: "paid",
        bill_image_path: null,
        created_at: new Date().toISOString(),
      };
      db.data.transactions.push(transaction);
      await save();
      return transaction;
    },

    async addItemsToTransaction(transaction_id, items) {
      const db = backend();
      await db.read();
      const txn = db.data.transactions.find((t) => t.transaction_id === transaction_id);
      if (!txn) throw new Error("Transaction not found");
      txn.items.push(...items);
      txn.total_amount = txn.items.reduce((sum, i) => sum + (i.line_total || 0), 0);
      await save();
      return txn;
    },

    async updateItemPrice(transaction_id, item_index, price) {
      price = validatePriceUpdate(item_index, price);
      const db = backend();
      await db.read();
      const txn = db.data.transactions.find((t) => t.transaction_id === transaction_id);
      if (!txn) throw new Error("Transaction not found");
      const item = txn.items[item_index];
      if (!item) throw new Error("Item not found at that index");
      item.price = price;
      item.line_total = item.quantity * price;
      txn.total_amount = txn.items.reduce((sum, i) => sum + (i.line_total || 0), 0);
      await save();
      return txn;
    },

    async setCustomerPhone(transaction_id, phone) {
      const db = backend();
      await db.read();
      const txn = db.data.transactions.find((t) => t.transaction_id === transaction_id);
      if (!txn) throw new Error("Transaction not found");
      txn.customer_phone = phone;
      txn.status = "confirmed";
      await save();
      return txn;
    },

    async setPaymentStatus(transaction_id, payment_status) {
      const db = backend();
      await db.read();
      const txn = db.data.transactions.find((t) => t.transaction_id === transaction_id);
      if (!txn) throw new Error("Transaction not found");
      txn.payment_status = payment_status;
      await save();
      return txn;
    },

    async markBillGenerated(transaction_id, bill_image_path) {
      const db = backend();
      await db.read();
      const txn = db.data.transactions.find((t) => t.transaction_id === transaction_id);
      if (!txn) throw new Error("Transaction not found");
      const firstGeneration = txn.bill_image_path == null;
      txn.bill_image_path = bill_image_path;
      if (firstGeneration) {
        for (const item of txn.items || []) {
          if (item.product_id == null) continue;
          const product = db.data.products.find(
            (p) => p.product_id === item.product_id && (p.shop_id || "shop_1") === txn.shop_id
          );
          if (product) {
            product.stock_qty = Math.max(0, (product.stock_qty || 0) - (item.quantity || 0));
          }
        }
      }
      await save();
      return txn;
    },

    async markSent(transaction_id) {
      const db = backend();
      await db.read();
      const txn = db.data.transactions.find((t) => t.transaction_id === transaction_id);
      if (!txn) throw new Error("Transaction not found");
      txn.status = "sent";
      await save();
      return txn;
    },

    async getTransaction(transaction_id) {
      const db = backend();
      await db.read();
      return db.data.transactions.find((t) => t.transaction_id === transaction_id);
    },

    async getShop(shop_id) {
      const db = backend();
      await db.read();
      return db.data.shops.find((s) => s.shop_id === shop_id);
    },

    async getShopByCode(shop_code) {
      const db = backend();
      await db.read();
      const code = String(shop_code || "").trim().toUpperCase();
      return db.data.shops.find(
        (s) => String(s.shop_code || "").toUpperCase() === code && s.active !== false
      );
    },

    async listShops() {
      const db = backend();
      await db.read();
      return db.data.shops || [];
    },

    async createShop({ shop_name, shop_type, upi_id, owner_phone }) {
      const db = backend();
      await db.read();
      const shop_code = generateShopCode();
      const shop = {
        shop_id: `shop_${shop_code.toLowerCase()}`,
        shop_code,
        shop_name,
        shop_type: shop_type || null,
        upi_id: upi_id || null,
        owner_phone: owner_phone || null,
        active: true,
      };
      db.data.shops.push(shop);
      await save();
      return shop;
    },

    async updateShop(shop_id, patch) {
      const db = backend();
      await db.read();
      const shop = db.data.shops.find((s) => s.shop_id === shop_id);
      if (!shop) return undefined;
      for (const key of ["shop_name", "shop_type", "upi_id", "owner_phone", "active"]) {
        if (patch[key] !== undefined) shop[key] = patch[key];
      }
      await save();
      return shop;
    },

    async rotateShopCode(shop_id) {
      const db = backend();
      await db.read();
      const shop = db.data.shops.find((s) => s.shop_id === shop_id);
      if (!shop) return undefined;
      shop.shop_code = generateShopCode();
      await save();
      return shop;
    },

    async close() {},
  };
})();

const impl = USE_PG ? pgImpl : lowdbImpl;

module.exports = {
  init: (...a) => impl.init(...a),
  listProducts: (...a) => impl.listProducts(...a),
  upsertProduct: (...a) => impl.upsertProduct(...a),
  deleteProduct: (...a) => impl.deleteProduct(...a),
  listTransactions: (...a) => impl.listTransactions(...a),
  createTransaction: (...a) => impl.createTransaction(...a),
  addItemsToTransaction: (...a) => impl.addItemsToTransaction(...a),
  updateItemPrice: (...a) => impl.updateItemPrice(...a),
  setCustomerPhone: (...a) => impl.setCustomerPhone(...a),
  setPaymentStatus: (...a) => impl.setPaymentStatus(...a),
  markBillGenerated: (...a) => impl.markBillGenerated(...a),
  markSent: (...a) => impl.markSent(...a),
  getTransaction: (...a) => impl.getTransaction(...a),
  getShop: (...a) => impl.getShop(...a),
  getShopByCode: (...a) => impl.getShopByCode(...a),
  listShops: (...a) => impl.listShops(...a),
  createShop: (...a) => impl.createShop(...a),
  updateShop: (...a) => impl.updateShop(...a),
  rotateShopCode: (...a) => impl.rotateShopCode(...a),
  close: (...a) => impl.close(...a),
  generateShopCode,
};
