# Backend — AI Business Assistant MVP

Tested and working. Pure JS — no native compilation, no database server needed
(uses a JSON file via `lowdb`, swap for Postgres/Firestore later).

## Setup

```bash
npm install
cp .env.example .env
node src/server.js
```

Server runs on `http://localhost:3000` (or `PORT` from `.env`).

## How Text/Voice Parsing Works

Both modes return the same shape, one entry per product:

```js
[{ quantity: 2, unit: "kilo", product: "Aam", price: 60 }]
```

- `price` is always **per unit**, never a lot total, so `line_total = quantity × price`
  always holds. `"₹50 ka 2 kilo namak"` is ₹50 *per kilo* → ₹100 on the bill.
  Shopkeepers quote rates, not lot totals.
- `price` is `null` when none was spoken. It stays `null` — the app asks the owner
  to fill it in via `/api/update-item-price`. Guessing would print a wrong number
  on a real customer's bill.
- `unit` is the unit of measure when one was spoken (`kilo`, `packet`, `dozen`…),
  `null` otherwise. It is kept **out** of the product name so the bill reads
  "Aam | 2 kilo", and so mangoes sold by the kilo and by the piece stay one
  product. Abbreviations normalise (`kg` → `kilo`); Devanagari units stay as
  spoken (`किलो` → `किलो`) so a Hindi bill doesn't come out half-translated.

`src/services/parser.js` has two modes:

- **Regex parser** (default, no setup needed) — converts spoken number-words to
  digits (`"तीन सौ"` → 300), splits multi-item sentences on `and`/`aur`/`,`, then
  reads each piece **without relying on word order**. It looks for a number
  *marked* as money — `₹` before it, a postposition (`की`/`का`/`के`) after it, or a
  currency word (`रुपये`/`rupaye`/`rs`) after it — wherever that number sits, and
  treats what's left as quantity, unit and product. So all of these land the same:

  ```
  "2 kilo aam ₹60"   "aam 2 kilo ₹60"   "aam ₹60 2 kilo"   "₹60 kilo 2 kilo aam"
  "₹2 की मिर्च"       "मिर्च ₹2 की"
  ```

  When no number carries a marker it falls back to reading by position (first
  number = quantity, last = price), which is what handles `"2 saree 3000"`.

  **What it can't do:** normalise brand *position*. `"Tata namak"` bills as
  "Tata Namak" but `"namak Tata"` bills as "Namak Tata" — telling a brand from a
  product name needs knowledge a regex doesn't have. The count, unit and price are
  still right either way, so the money on the bill is unaffected.
- **LLM parser** (optional, and what makes word order *fully* free) — set
  `GEMINI_API_KEY` in `.env` and it'll use Gemini instead, falling back to regex if
  the API call fails for any reason. It reports `brand` as its own field, so
  `"Tata namak"` and `"namak Tata"` both come back as brand `Tata` + product
  `Namak`. Get a free key at https://aistudio.google.com/apikey.

  The default model is `gemini-3.5-flash-lite`, chosen for latency: measured on a
  real key it answers in **4–5s**, where `gemini-3.7-flash` took **33–45s** and
  allowed only **20 requests a day** on the free tier. Override with `GEMINI_MODEL`
  if you want to compare, but check the wall-clock — a shopkeeper is standing at the
  counter waiting for this.

  `unit` is pinned to an enum in the request schema, and whatever comes back is run
  through the same alias table the regex parser uses. Both guards are deliberate:
  live replies from the bigger model have fused the answer and its reasoning into
  that field (`"kiloShort/kilo/etc"`), which would otherwise print verbatim in the
  Qty column of a customer's bill. An unrecognisable unit becomes `null` — the bill
  loses a word, not its credibility.

## Tests

```bash
npm test              # offline; no API key needed
node mutation-check.js # sabotages parser.js to prove the tests aren't vacuous
```

## API Endpoints

| Method | Path | Body | Purpose |
|---|---|---|---|
| POST | `/api/parse-item` | `{ text, transaction_id? }` | Parse a spoken/typed sale line, start or add to a draft transaction |
| POST | `/api/confirm-contact` | `{ transaction_id, phone }` | Attach customer's phone number |
| POST | `/api/generate-bill` | `{ transaction_id }` | Render the bill PNG + UPI QR, save to `generated_bills/` |
| POST | `/api/send-bill` | `{ transaction_id }` | Send bill via WhatsApp (currently simulated — see below) |
| GET | `/api/transaction/:id` | — | Fetch current transaction state |

Generated bill images are also served statically at `http://localhost:3000/bills/<filename>.png`.

## Making WhatsApp Sending Real

Right now `src/services/whatsapp.js` only logs what it *would* send. To make it real:

1. Pick a provider — **Twilio** is the fastest to get testing with (has a WhatsApp
   sandbox you can use immediately, no business verification needed for testing):
   https://www.twilio.com/whatsapp
2. Set `WHATSAPP_PROVIDER=twilio` and your credentials in `.env`
3. Fill in the `TODO` block in `sendBillOnWhatsApp()` inside `whatsapp.js`
4. **Important:** most providers need the image at a **public URL**, not a local
   file path. You'll need to either:
   - Upload `generated_bills/*.png` to something like S3/Cloudinary first, or
   - Deploy this backend somewhere public (Render, Railway, Fly.io) so
     `http://your-backend-url.com/bills/<file>.png` is reachable from Twilio's servers

## Making the UPI QR Real

Already fully working — it encodes a standard `upi://pay?...` deep link that any
UPI app can scan. Just replace the placeholder `upi_id` in `src/db/db.js`
(`"rohitstore@upi"`) with your actual shop UPI ID.

## Swapping the Database

`src/db/db.js` currently writes to a local `data.json` file via `lowdb` — zero
setup, but not safe for concurrent writes at scale. When you're ready to move to
Postgres/Firestore, this is the only file you need to rewrite; every route file
just calls its exported functions (`createTransaction`, `setCustomerPhone`, etc.)
so the rest of the app won't need to change.
