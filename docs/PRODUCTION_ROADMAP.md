# Production Roadmap — From MVP to Real Shop Owners

**Goal:** Take the current MVP (voice billing app) to the point where a real shop
owner can install it from the Play Store, pay for it, and run their daily
billing on it — without our laptop, our hotspot, or our hand-holding.

**Where we are (2026-10-02):** MVP works end-to-end on one phone + one laptop:
Expo Go loads the app over Wi-Fi from our laptop's Metro, the backend is
`node src/server.js` on the same laptop behind an ngrok tunnel, data lives in
`backend/src/db/data.json`, WhatsApp goes through Twilio's sandbox, and there is
exactly one hardcoded shop (`shop_1`). Every one of those facts changes for
production. The voice pipeline itself — Sarvam STT, Gemini parsing, phone-number
detection, catalog price fill, bill PNG, profit report — is the part worth
keeping; it's the *infrastructure around it* that is prototype-shaped.

**How to read this:** §1 is the honest gap analysis (what disqualifies the MVP
from production). §2 is the phased plan. §3 is cost. §4 is legal. §5 is what we
deliberately do NOT build yet.

---

## 1. Gap analysis — what exactly is not production

### 1.1 The laptop is the server (blocker)
- Backend, database, bill images, ngrok — all on the founder's laptop over a
  hotspot whose IP changes daily (see memory of this project). A shop owner
  10 km away cannot use the app at all.
- **Fix:** backend on a cloud host (Render / Railway / Fly.io — all fine for a
  Node/Express app; ₹500–1,500/mo at pilot scale). Bill PNGs to object storage
  (S3/Cloudinary — also fixes the "Twilio must fetch the image from a public
  URL" problem, which ngrok currently solves by hand). Real domain + TLS.

### 1.2 The app is not an app (blocker)
- Users install Expo Go and paste `exp://…`. No real user will do this.
- **Fix:** EAS build (`eas.json` already exists in the repo) → standalone APK
  for direct install / Play Store listing. The `app-development.apk` in the
  repo is a *dev-client* build — it points at our dev server. A production
  build has the backend URL baked in. Note: a dev client + EAS update channels
  also let us hotfix without Play Store review delays.

### 1.3 WhatsApp is a sandbox (blocker for the core promise)
- Twilio sandbox only delivers to numbers that joined it. Real customers never
  will.
- **Fix (India-specific):** a real WhatsApp Business Account via an Indian BSP
  — Gupshup, AISensy, Interakt, Wati. Business-initiated messages (our bills)
  must use an approved **template**; utility templates are the cheap tier.
  Meta business verification is required (documents: GST/shop proof) and takes
  1–4 weeks — start this FIRST even though it's not code, because it's the
  longest lead-time item in the whole roadmap. Keep Twilio as the code-level
  abstraction: `services/whatsapp.js` already has a provider switch
  (`WHATSAPP_PROVIDER`) — add a `gupshup` implementation there; the rest of the
  code won't change.

### 1.4 One hardcoded shop (blocker for "real market")
- `DEFAULT_SHOP_ID = "shop_1"` in `routes/sale.js`, one JSON file, one owner.
  Two shops = corrupted data.
- **Fix:** multi-tenancy. Every shop owner signs up → gets `shop_id`. Every
  transaction, product and bill is scoped to it. Login by **phone + OTP**
  (shop owners forget passwords; they all have WhatsApp numbers). Database →
  **PostgreSQL** (managed: Render/Railway/Neon). The db.js function surface
  (`createTransaction`, `addItemsToTransaction` …) was kept as a seam exactly
  for this — the migration replaces that one file's internals plus adds
  `shop_id` to every call site in `routes/sale.js`.

### 1.5 Voice quality in real shops (the actual product risk)
- We added tap-to-talk + Android `voice_recognition` + (in progress) speaker
  verification. None of that is validated on 10 different shops, accents and
  noise levels.
- **Fix:** the pilot (Phase 0) IS the validation. Measure: % of utterances
  correctly billed without correction, % of phone numbers caught first try.
  Target before scaling: >90% item accuracy, >95% number accuracy. If speaker
  verification lands (separate roadmap), it goes on the cloud too — same
  pattern as the Node backend, one more container.

### 1.6 Legal — DPDP Act 2023 (blocker for real customer data)
- We collect customers' phone numbers and purchase history. India's Digital
  Personal Data Protection Act applies. Needed: a privacy policy, in-app
  consent (shop owner confirms the customer agreed to get the bill on
  WhatsApp), data-retention limits, and a deletion path. Not optional once we
  leave pilot friends-and-family territory.

### 1.7 Money in the app
- The UPI QR is generated from `shop_1.upi_id` (`rohitstore@upi` placeholder).
  Production = per-shop UPI ID (collected at onboarding). No payment gateway
  needed for v1 — the QR payment happens in the customer's own UPI app; we
  only need the shop's real ID. Udaar/credit tracking is already modeled
  (`payment_status`) — a "settle credit" flow is small and high-value.

---

## 2. Phased plan

### Phase 0 — Real pilot on the current MVP (2–4 weeks, no new architecture)
**Purpose:** prove the product with real shops before spending on production
engineering. Everything below uses the code as it stands.
- [ ] Twilio account upgraded (~$20) so sandbox → real sending to pilot numbers.
- [ ] EAS **development/preview build** APK (not Expo Go) for the 3–5 pilot
      shopkeepers' phones; bundle the current laptop IP as `BASE_URL` is not
      viable — instead run the backend on one cheap cloud host for the pilot so
      phones don't depend on our laptop. This is a half-day deploy (Render free
      tier + Postgres free tier is enough for 5 shops).
- [ ] Onboard 3–5 real shops (friends/family first): their catalog, their UPI
      ID, their WhatsApp opt-in.
- [ ] Weekly review: accuracy numbers, "when did the app annoy you", bill
      corrections.
- [ ] Meanwhile: start Meta business verification (longest lead time).
- **Done when:** 3+ shops used it for 2 weeks and sent real bills; accuracy
  targets in §1.5 met; a shopkeeper says they'd pay.

### Phase 1 — Multi-tenant foundation (3–5 weeks)
- [ ] PostgreSQL schema: `shops`, `users` (phone-OTP), `products`,
      `transactions`, `items` (all keyed by `shop_id`). Migrate the db.js seam.
- [ ] Phone-OTP auth (Whisper/MSG91/Twilio Verify — or OTP via the WhatsApp
      provider itself, cheaper in India). JWT sessions.
- [ ] `shop_id` on every route (replaces `DEFAULT_SHOP_ID`); ownership checks.
- [ ] Bill images → S3/Cloudinary with signed URLs; drop ngrok entirely.
- [ ] Billing images per shop (shop name/logo/UPI on the PNG — billImage.js
      already renders from the `shop` record).
- **Done when:** two demo shops exist on the cloud deployment with separate
  data, and neither can see the other.

### Phase 2 — Real WhatsApp delivery (3–4 weeks, overlaps Phase 1)
- [ ] BSP chosen and business verification completed (Gupshup/AISensy).
- [ ] Template message submitted & approved for the bill (utility category).
- [ ] `services/whatsapp.js`: `gupshup` provider behind the existing switch.
- [ ] Fallback behavior when a customer is outside the 24h session window
      (template handles this — that's the point).
- **Done when:** a real customer (not sandbox-joined) receives a bill.

### Phase 3 — The public app (2–3 weeks)
- [ ] EAS production build; Play Store listing (closed testing track first —
      12 testers for 14 days is Google's current requirement before open
      production).
- [ ] Hindi-first onboarding: signup → OTP → shop name, category, UPI ID →
      "5 products bolo ya type karo" seed catalog.
- [ ] Subscription: a plan gate is enough for v1 (free trial 14 days →
      ₹99–299/mo via UPI autopay/Razorpay later; manual renewals acceptable at
      5 shops).
- **Done when:** a stranger can go from Play Store to a sent bill with zero
  help from us.

### Phase 4 — Compliance & ops (continuous, starts by Phase 2)
- [ ] Privacy policy + in-app consent + data-delete path (DPDP).
- [ ] Daily DB backups (managed Postgres usually includes this — verify).
- [ ] Uptime monitoring + error tracking (Sentry free tier).
- [ ] A support channel (WhatsApp number of our own — drink our own champagne).

---

## 3. Cost reality (pilot scale, monthly)

| Item | Cost (₹) |
|---|---|
| Cloud host (Render/Railway) | 0–850 |
| Managed Postgres (Neon/Railway) | 0–700 |
| Bill image storage (Cloudinary free tier) | 0 |
| WhatsApp utility messages (~₹0.30–0.80/bill; 100 bills/day) | ~900–2,400 |
| Sarvam STT (~₹0.15–0.5/min; 2 min/customer) | ~300–900 |
| Gemini parsing (per-utterance) | ~100–300 |
| **Total for one shop at ~100 bills/day** | **~1,300–5,000** |

→ Price the product at ₹299–499/month per shop and unit economics work from
the first customer. At 5 pilot shops we run at a small loss — acceptable.

## 4. What we deliberately do NOT build yet
- No web dashboard (the phone app + report screen is enough for v1).
- No inventory purchase-order automation, no GST invoices, no accounting
  exports (CSV export is a 1-day add when a shop asks).
- No iOS (kirana owners are overwhelmingly Android).
- No AI upselling/analytics beyond the daily report.
- No on-device voice model (keep it cloud until offline demand is proven).

## 5. Who does what
- **Founder (user):** Phase 0 pilots, Twilio recharge, Meta business
  verification paperwork, shop relationships, pricing.
- **Teammate:** speaker verification (existing roadmap), then Phase 1
  Postgres/auth (this doc).
- **Claude:** architecture reviews, implementation pairing on any phase.

**First three actions this week, in order:**
1. Twilio recharge ($20) — unblocks live bills today.
2. Start Meta business verification — longest lead time, zero code.
3. Deploy current backend to Render (free tier) so pilot phones stop depending
   on the laptop — half a day, no code changes beyond env config.
