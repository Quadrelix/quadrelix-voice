#!/usr/bin/env node
// One-off import of the pre-multi-shop data.json into Postgres.
//
// Old data belonged to one implicit shop ("shop_1"). Importing it into a real
// pilot shop would put demo bills in that shop's report forever, so it lands
// under a dedicated `legacy_demo` shop instead (created by schema.sql).
//
// Idempotent: transaction ids are the primary key and use ON CONFLICT DO
// NOTHING, so running this twice does not duplicate anything.
//
// Usage:
//   cd backend && node src/db/migrate.js            # uses .env DATABASE_URL
//   node src/db/migrate.js --file path/to/data.json

require("dotenv").config();

const fs = require("fs");
const path = require("path");

const { Pool } = require("pg");

const LEGACY_SHOP_ID = "legacy_demo";

async function main() {
  const fileArgIndex = process.argv.indexOf("--file");
  const file =
    fileArgIndex > -1
      ? process.argv[fileArgIndex + 1]
      : path.join(__dirname, "data.json");

  if (!fs.existsSync(file)) {
    console.log(`[migrate] No legacy file at ${file} — nothing to import.`);
    return;
  }

  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const products = data.products || [];
  const transactions = data.transactions || [];

  console.log(
    `[migrate] Reading ${products.length} products, ${transactions.length} transactions`
  );

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || "")
      ? false
      : { rejectUnauthorized: false },
  });

  let productCount = 0;
  let txnCount = 0;

  try {
    // Ensure the legacy shop exists even if schema.sql was applied before it
    // was added.
    await pool.query(
      `INSERT INTO shops (shop_id, shop_code, shop_name, shop_type)
       VALUES ($1, 'LEGACY', 'Demo (legacy data)', 'demo')
       ON CONFLICT (shop_id) DO NOTHING`,
      [LEGACY_SHOP_ID]
    );

    for (const p of products) {
      // Keep the original uuid so item.product_id links still resolve.
      const res = await pool.query(
        `INSERT INTO products (product_id, shop_id, name, brand, category,
                               purchase_price, selling_price, stock_qty, min_stock_level)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (product_id) DO NOTHING`,
        [
          p.product_id,
          LEGACY_SHOP_ID,
          p.name,
          p.brand ?? null,
          p.category ?? null,
          p.purchase_price ?? null,
          p.selling_price ?? null,
          p.stock_qty ?? 0,
          p.min_stock_level ?? null,
        ]
      );
      productCount += res.rowCount;
    }

    for (const t of transactions) {
      const res = await pool.query(
        `INSERT INTO transactions (transaction_id, shop_id, customer_phone, items,
                                   total_amount, status, payment_status,
                                   bill_image_path, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (transaction_id) DO NOTHING`,
        [
          t.transaction_id,
          LEGACY_SHOP_ID,
          t.customer_phone ?? null,
          JSON.stringify(t.items || []),
          t.total_amount ?? 0,
          t.status || "draft",
          t.payment_status || "paid",
          t.bill_image_path ?? null,
          t.created_at || new Date().toISOString(),
        ]
      );
      txnCount += res.rowCount;
    }

    console.log(`[migrate] Imported ${productCount} products, ${txnCount} transactions`);
    console.log(`[migrate] They live under shop "${LEGACY_SHOP_ID}" — no pilot shop sees them.`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error("[migrate] FAILED:", e.message);
  process.exitCode = 1;
});