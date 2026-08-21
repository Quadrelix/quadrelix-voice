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

`src/services/parser.js` has two modes:

- **Regex parser** (default, no setup needed) — handles simple sentences like
  `"5 white shirt 500 rupaye"` or `"2 saree 3000"`. Pulls the first number as
  quantity, last number as price, everything in between as the product name.
- **LLM parser** (optional, better for natural Hinglish) — set `ANTHROPIC_API_KEY`
  in `.env` and it'll automatically use Claude to parse instead, falling back to
  regex if the API call fails for any reason.

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
