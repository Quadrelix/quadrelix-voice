# BizMate AI — Voice Billing for Indian Shops

Voice-first billing app: shopkeeper **bolta hai**, app sale bana deti hai,
bill (PNG + UPI QR) banti hai aur WhatsApp pe jaati hai. Plus product catalog,
automatic profit calculation, daily report, customers (udaar) — sab voice ya
few taps me.

```
backend/       Node.js + Express API  (JSON file DB, no database server needed)
mobile-app/    React Native (Expo SDK 54) app — Expo Go se test hota hai
```

---

## Quick Start (laptop pe run karne ke liye)

> Zaroorat hai: **Node.js 18+** (recommended 22), aur mobile ke liye **Expo Go**
> app apne Android phone pe (Play Store se, free).

### 1. Backend (pehle ye karo)

```bash
cd backend
npm install
cp .env.example .env    # Windows: copy .env.example .env
npm test                # optional — 100 tests, offline, koi API key nahi chahiye
npm start
```

Server chala to: `http://localhost:3000` pe "AI Business Assistant backend is
running" milega. **Bina kisi API key ke sab basic flows kaam karte hain** —
parsing offline regex parser se hota hai aur WhatsApp "simulated" mode me
(console me log hota hai, asli send nahi).

**API keys kahan lagti hain (`backend/.env`):**

| Key | Kya karta hai | Chahiye kya? |
|---|---|---|
| `GEMINI_API_KEY` | Smart Hinglish item parsing (multi-item) | Optional — khaali chhodo to offline parser |
| `SARVAM_API_KEY` | Voice recording → text (STT) | **Voice ke liye zaroori** — [sarvam.ai](https://www.sarvam.ai) free key |
| `WHATSAPP_PROVIDER` / Twilio | Asli WhatsApp send | Optional — khaali to simulated |

### 2. Mobile app

```bash
cd mobile-app
npm install
npx expo start
```

Expo terminal me QR code dikhega. **Phone ko laptop ke usi Wi-Fi pe** rakho,
Expo Go me QR scan karo. (Expo Go install: Play Store → "Expo Go" → free.)

**Mobile app ka ek hi important change** — apne laptop ka IP address:

`mobile-app/services/api.js` me:

```js
export const BASE_URL = "http://<YOUR-LAPTOP-IP>:3000";
```

Apna laptop IP nikalne ke liye:
- Windows: `ipconfig` → Wi-Fi ka `IPv4 Address`
- Phone aur laptop same Wi-Fi pe hone chahiye, warna app backend nahi milega

> 💡 IP change hua to sirf `api.js` me ye ek line badlo aur app reload karo.
> `10.157.20.161` jaisa static IP nahi hota — har Wi-Fi pe badalta hai.

---

## App me kya-kya hai

| Screen | Kya karta hai |
|---|---|
| **Home** | Dashboard — aaj ki sale/profit, recent sales, low stock, quick actions |
| **Mic (center)** | Voice billing — "2 Dettol sabun 10 rupay" bolo, number bolo, bill ready |
| **Products** | Catalog — add/edit products, purchase/selling price, stock, min-stock |
| **Customers** | Phone se customer history, udaar (credit) outstanding |
| **Reports** (More) | Aaj ka profit, sales/cost, best sellers, stock kam |

### Voice billing ka flow

1. Home pe mic dabao (ya bottom center mic)
2. Bolo: *"2 Dettol sabun"* — items list me aa jate hain
3. Catalog me price hai to auto-fill ho jata hai; nahi hai to *"10 rupay"* bolo
4. Number bolo: *"number 9876543210"* — 3 second countdown, bill ban ke jata hai
5. WhatsApp pe bhejne ka button (ya "Server se bhejein")

> **Shor-safe mode:** dukaan me music/noise ho to mic sirf tab record karta hai
> jab tum dabate ho. Header me "🛡 Shor-safe" / "🎧 Auto" se mode badlo.

---

## Backend API (test ke liye handy)

```bash
# Naya product (selling price OPTIONAL — kuch products ka fixed rate nahi hota)
curl -X POST http://localhost:3000/api/products \
  -H "Content-Type: application/json" \
  -d '{"name":"Aam","purchase_price":40,"stock_qty":10}'

# Voice-utterance (items + number ek saath)
curl -X POST http://localhost:3000/api/utterance \
  -H "Content-Type: application/json" \
  -d '{"text":"2 aam 60 rupay number 9876543210"}'

# Aaj ka report
curl http://localhost:3000/api/report/daily

# Saare products
curl http://localhost:3000/api/products

# Recent sales
curl "http://localhost:3000/api/transactions?limit=5"

# Customers (udaar samet)
curl http://localhost:3000/api/customers
```

---

## Tests

```bash
cd backend
npm test        # 100 tests — offline, fast, koi API key nahi
```

Tests kya cover karte hain: item parser (Hindi + English), phone number
detection (Devanagari digits + English digit-words), catalog matching (kabhi
galat price guess nahi karta), profit report (IST day boundary, udaar,
unknown-cost), bill image generation, aur optional selling price.

---

## Important files

```
backend/src/routes/sale.js        saare API endpoints
backend/src/services/parser.js    text → sale items (offline regex + Gemini)
backend/src/services/productMatch.js  catalog matching (conservative, no guessing)
backend/src/services/report.js    daily report (IST) — profit, udaar, low stock
backend/src/db/db.js              JSON file DB (atomic writes) — data.json
mobile-app/screens/HomeScreen.js  dashboard
mobile-app/screens/HandsFreeScreen.js  voice billing flow
mobile-app/services/api.js        BASE_URL yahan badlo
```

> ⚠️ **`.env` kabhi commit mat karo** — secrets hain. Already `.gitignore` me hai.
> `backend/src/db/data.json` (runtime data) bhi git se bahar hai.

---

## Roadmap / status

- ✅ MVP — voice billing, catalog, profit report, customers, share-sheet
- 🔜 Speaker verification ("voice lock") — roadmap: `docs/SPEAKER_VERIFICATION_ROADMAP.md`
- 🔜 Production — cloud deploy, multi-shop, real WhatsApp Business API:
  `docs/PRODUCTION_ROADMAP.md`
