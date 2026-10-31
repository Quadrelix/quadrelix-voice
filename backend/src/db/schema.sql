-- BizMate / quadrelix-voice — PostgreSQL schema
--
-- One row per shop; every product and transaction belongs to exactly one shop.
-- Applied by `npm run db:migrate` (idempotent), or pasted into the Neon SQL
-- editor on first setup.
--
-- Why `items` is JSONB: the utterance parser rewrites the whole item array
-- (add items, fill a price, recount). A normalized items table would mean
-- rewriting every one of those paths for zero pilot benefit. Revisit when
-- analytics need SQL over line items — the data is all there, just nested.

CREATE TABLE IF NOT EXISTS shops (
  shop_id      TEXT PRIMARY KEY,
  shop_code    TEXT UNIQUE NOT NULL,          -- 6-character code the owner types
  shop_name    TEXT NOT NULL,
  shop_type    TEXT,                          -- 'kapda' | 'kirana' | ...
  upi_id       TEXT,
  owner_phone  TEXT,
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  product_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         TEXT NOT NULL REFERENCES shops(shop_id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  brand           TEXT,
  category        TEXT,
  purchase_price  NUMERIC,
  selling_price   NUMERIC,                    -- NULL = no fixed price
  stock_qty       INTEGER NOT NULL DEFAULT 0,
  min_stock_level INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS products_shop_idx ON products (shop_id);

CREATE TABLE IF NOT EXISTS transactions (
  transaction_id  TEXT PRIMARY KEY,
  shop_id         TEXT NOT NULL REFERENCES shops(shop_id) ON DELETE CASCADE,
  customer_phone  TEXT,
  items           JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_amount    NUMERIC NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'draft',      -- draft | confirmed | sent
  payment_status  TEXT NOT NULL DEFAULT 'paid',       -- paid | credit
  bill_image_path TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transactions_shop_time_idx
  ON transactions (shop_id, created_at DESC);

-- Legacy JSON data from before multi-shop is imported under this shop, so it
-- never appears in a real pilot shop's reports.
INSERT INTO shops (shop_id, shop_code, shop_name, shop_type, upi_id, owner_phone)
VALUES ('legacy_demo', 'LEGACY', 'Demo (legacy data)', 'demo', NULL, NULL)
ON CONFLICT (shop_id) DO NOTHING;

-- gen_random_uuid() ships with PostgreSQL 13+ (pgcrypto is built in).
-- If the Neon project is older, run: CREATE EXTENSION IF NOT EXISTS pgcrypto;