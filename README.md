# AI Business Assistant — MVP

Voice-first sale recording → auto bill generation → WhatsApp + UPI QR delivery.

## Project Structure

```
mvp-project/
├── backend/          Node.js + Express API — TESTED AND WORKING
└── mobile-app/        React Native (Expo) app — code skeleton
```

## What Actually Works Right Now

The **backend is fully functional and already tested** end-to-end:

1. ✅ Text → parsed sale item (quantity, product, price) — works offline with a regex
   parser, or set `GEMINI_API_KEY` for smarter Hinglish understanding (free tier)
2. ✅ Contact number confirmation
3. ✅ Bill image (PNG) generation with shop details, itemized rows, total, and a
   scannable UPI QR code
4. ✅ "Send to WhatsApp" — currently **simulated** (logs what it would send).
   Wiring up real WhatsApp sending needs a WhatsApp Business API account (see below).

The **mobile app is a complete code skeleton** (3 screens + navigation + API calls)
but has NOT been run/tested here, since building and running a React Native app
needs a phone/emulator and Android/iOS build tools that aren't available in this
environment. You'll run it yourself with `npx expo start`.

## Quick Start — Backend (do this first)

```bash
cd backend
npm install
cp .env.example .env
node src/server.js
```

Server starts at `http://localhost:3000`. Test it immediately without any API keys:

```bash
# Step 1: record a sale item
curl -X POST http://localhost:3000/api/parse-item \
  -H "Content-Type: application/json" \
  -d '{"text": "5 white shirt 500 rupaye"}'
# -> copy the "transaction_id" from the response

# Step 2: confirm customer's contact number
curl -X POST http://localhost:3000/api/confirm-contact \
  -H "Content-Type: application/json" \
  -d '{"transaction_id": "<paste_id>", "phone": "9876543210"}'

# Step 3: generate the bill image
curl -X POST http://localhost:3000/api/generate-bill \
  -H "Content-Type: application/json" \
  -d '{"transaction_id": "<paste_id>"}'
# -> open backend/generated_bills/bill_<id>.png to see it

# Step 4: "send" it (simulated — check the terminal running the server for the log)
curl -X POST http://localhost:3000/api/send-bill \
  -H "Content-Type: application/json" \
  -d '{"transaction_id": "<paste_id>"}'
```

See `backend/README.md` for full API reference and how to make WhatsApp sending real.

## Quick Start — Mobile App

```bash
cd mobile-app
npm install
npx expo start
```

**Important:** the voice/mic feature (`@react-native-voice/voice`) needs native code
and will NOT work in plain "Expo Go." You need a **development build**:

```bash
npx expo prebuild
npx expo run:android   # or run:ios
```

Until you set that up, you can still test the whole flow using the text box
that's built into each screen as a fallback — type instead of speaking.

Before running, update `mobile-app/services/api.js` — set `BASE_URL` to wherever
your backend is reachable from your phone/emulator (see comments in that file).

## Recommended Next Steps (in order)

1. Get the backend running locally and confirm the 4-step curl test above works
   (it will — this has been tested).
2. Run the mobile app in Expo Go using the **text fallback** input (skip voice for
   now) to confirm phone ↔ backend networking works.
3. Set up an Expo development build to enable the real microphone/voice input.
4. Sign up for a WhatsApp Business API provider (Twilio is easiest to start with)
   and fill in the TODO in `backend/src/services/whatsapp.js`.
5. Replace the hardcoded `shop_1` in the backend with real shop onboarding once
   you're ready to support more than one shop.
6. Only after all of this works reliably — start layering in inventory, credit/udhar,
   and analytics from the original PDF.
