# Production launch review — 1 November 2026

Recommendation: fix the blockers below, then run a supervised 3–5 shop pilot before a public launch. Render deployment is a useful step, but the current code has authorization, billing correctness, and delivery problems.

Scope: local source review of the Express API, PostgreSQL adapter/schema, billing and voice services, main mobile billing screens, Android build configuration, Render blueprint, and existing tests. This is not a penetration test or a full device QA pass. The live Render health URL could not be accessed through the web tool; live environment variables, deployed commit, service tier, database configuration, backups, and actual WhatsApp delivery remain unverified. No production data was changed and no customer messages were sent.

Validation: `npm test` in `backend` passed **119/119** tests. The first sandboxed run failed to spawn workers; the approved run completed successfully. The database tests explicitly select the lowdb adapter through `DB_FILE`, so they do not validate PostgreSQL behavior. Small offline probes also reproduced the voice response mismatch, unknown-cost profit calculation, and an unauthenticated transaction read using a stubbed database and the real route handler. SQL and device-level findings below are source findings unless stated otherwise.

## Status update (same day, after fixes)

Items 1–6 of "Fix before external use" were addressed in code and covered by tests; items marked *open* below were not part of that pass.

| # | Finding | Status |
|---|---|---|
| 1 | Voice discarded with lock off | **Fixed** — `allowed` is separate from `speaker_verified` (route + app + tests) |
| 2 | Transaction IDs as authorization | **Fixed** — every transaction route checks the transaction belongs to the request's shop (same 404 for "missing" and "someone else's"); no shop code = 401; legacy demo fallback is opt-in (`ALLOW_LEGACY_SHOP=1`); wrong codes lock out the IP; voice reset/override fail closed without `VOICE_ADMIN_PIN`, overrides are per shop. Two-shop negative tests in `routes.ownership.test.js`. The shop code is still the only credential (no owner accounts/OTP yet) and `/bills/*.png` stays public behind unguessable UUID file names. |
| 3 | PostgreSQL price-update SQL | **Fixed** (verified against real PostgreSQL) |
| 4 | Non-atomic completion / stock | **Fixed** — `db.finalizeSale`: row lock + one DB transaction (bill marker, phone, payment, stock, freeze); retries and races return the existing sale. Finalized bills reject edits (409). Verified on real PostgreSQL incl. concurrent finalize and mid-sale rollback. Voids/corrections with inventory reversal are *open*. |
| 5 | Share flow / delivery claims | **Fixed** — separate `delivery_status` (`none/simulated/sent/failed`); `status='sent'` only for a real provider send; no-provider success shows "Bill ban gayi — WhatsApp pe bhejein" with the share button. Delivery receipts / queue / templates are *open*. |
| 6 | Unrestricted uploads | **Fixed** — shop gate before multer, 5 MB + audio-type filter, per-IP/per-shop/daily/in-flight limits, Sarvam (15 s) and Gemini (8 s) deadlines, central JSON error handler, temp files always removed. |
| Report | Profit overstated | **Fixed** — `total_profit` is a margin over known-cost items only, with `cost_coverage` / `missing_cost_sales`; completed sales are dated by `finalized_at`. |
| CI | PostgreSQL in CI | **Added** — `.github/workflows/backend.yml` runs the suite against a Postgres service. |

Still open from the lists below: fractional stock, payment settlement/repayment, draft recovery after app kill, DB TLS verification (`rejectUnauthorized:false`), durable bill storage, Meta/Gupshup providers and templates, history query pagination, staging/backups/monitoring.

## What is already useful

- A focused shop workflow: Hindi/Hinglish speech, catalog matching, missing-price handling, bill images, UPI QR, customer history, and daily reporting.
- Catalog matching avoids guessing when multiple products match.
- Historical purchase prices are copied onto sale items, which is the right foundation for stable historical margin calculations.
- PostgreSQL and shop-scoped product queries are already implemented. The README and older roadmap describing a single JSON database are stale.
- Bill tests include Devanagari rendering and QR decoding. The existing parser and phone-number tests are valuable.
- Tap-to-talk is the default, providing a useful starting point for noisy shops.
- Admin management routes fail closed when `ADMIN_TOKEN` is missing.

## Fix before external use

### 1. Critical: voice input is discarded with the Render defaults

Evidence: `render.yaml:37`, `backend/src/services/voiceVerify.js:89`, `backend/src/routes/sale.js:684`, `mobile-app/screens/HandsFreeScreen.js:97`.

The blueprint uses `VOICE_LOCK_MODE=off`. The backend correctly allows transcription and returns `speaker_verified:false`; the mobile app interprets that boolean as rejection and returns before parsing the transcript. The same mismatch affects allowed shadow-mode and fail-open results.

Offline reproduction: `voice.decide({mode:'off', failMode:'open'})` returned `{allow:true, verified:false, ...}`. Applying the actual mobile rejection condition discarded a nonempty sample transcript.

Fix: expose an explicit authorization-to-process field such as `allowed`, separate from biometric verification. Only discard audio when the gate denies it. Cover off, shadow, enforce, service failure, and not-enrolled cases end to end. Do not solve this by marking an unverified speaker as verified. The client also falls back to ungated transcription after request errors; make that behavior respect the selected fail policy.

### 2. Critical: transaction IDs are treated as authorization

Evidence: `backend/src/routes/sale.js:161`, `:178`, `:199`, `:231`, `:385`, `:830`; `backend/src/db/db.js:202` and other transaction methods.

Transaction reads, price changes, customer changes, bill creation, and sends do not authenticate the caller or enforce ownership. A caller who obtains a transaction ID can access or mutate that transaction. `/parse-item` and `/utterance` resolve a shop but do not verify that a supplied transaction belongs to it. UUID unpredictability is not an ownership check. Shop codes alone also grant access to shop data without an owner account/session.

Offline reproduction: the real `/transaction/:id` handler returned a synthetic shop-A transaction to a request containing no credentials, using a stubbed DB to avoid touching real records.

Fix: authenticate an owner/staff session; derive permitted shop IDs from the session; require both transaction ID and authorized shop ID in database queries. Remove the public legacy fallback from production. Protect bill downloads with authorization or scoped, expiring links. Add two-shop negative tests covering every read and mutation, including disabled shops and revoked sessions.

### 3. High: PostgreSQL price updates contain invalid SQL

Evidence: `backend/src/db/db.js:202–228`.

The same `UPDATE` assigns `items` twice in its `SET` list. PostgreSQL rejects multiple assignments to the same column. Speaking a price later or editing an item price therefore fails on this adapter even though the JSON-backed tests pass. The total update is also a separate statement, creating a concurrency risk after the syntax is repaired.

Fix: update the nested fields with a single `items` assignment and update the total atomically. Validate a finite, nonnegative price and a valid integer item index. Test against a disposable PostgreSQL database, including simultaneous item additions and price changes. This review did not execute the query against production.

### 4. High: sale completion and inventory deduction are not atomic

Evidence: `backend/src/db/db.js:248–275`; `backend/src/routes/sale.js:406–428`.

`markBillGenerated` commits the bill-path marker before deducting stock through separate queries. A failure after the marker leaves missing or partial deductions. A retry sees the marker and skips the deductions permanently. Finalize marks a sale confirmed before rendering completes, so rendering failure can leave a transaction counted as a sale without its inventory movement. Repeated finalize/send calls can also send the same message again. Finalized transactions are still editable through the item endpoints, which can change totals without applying corresponding inventory adjustments.

Fix: use a database transaction and row locking for sale completion and inventory movements. Keep sale, payment, and message-delivery states separate. Freeze completed bills; provide explicit corrections/voids with inventory adjustments. Deduplicate requests with a client operation ID. Queue outbound messages after the sale commits, with retry/status tracking. A network retry should return the existing result, not create an additional sale or stock movement.

### 5. High: the default WhatsApp path claims success but provides no normal share action

Evidence: `render.yaml:43`, `backend/src/services/whatsapp.js:16–23`, `backend/src/routes/sale.js:428`, `mobile-app/screens/HandsFreeScreen.js:227–229`, `:315–360`.

The blueprint leaves the provider blank. That returns a simulated result, but finalize records `sent` and the app displays “Bill Bhej Diya!” with a test-mode footnote. `billUrl` is populated in the failure path, and the share button only appears on that failure screen. Therefore the documented free share-sheet flow is unavailable after a normal simulated success in the main hands-free screen.

Fix: make “Bill saved — share on WhatsApp” the normal provider-free success flow. Store/use the returned bill filename on success. Separate simulated, ready-to-share, queued, delivered, and failed states. Opening the share sheet is not proof of delivery.

### 6. High: unrestricted paid transcription and file uploads

Evidence: `backend/src/routes/sale.js:78`, `:106`; `backend/src/services/transcribe.js:28`; `mobile-app/services/api.js:16`.

`/transcribe` has no authentication or shop requirement and calls the paid STT service. Multer has no file-size limit or file filter. No API-wide rate limiting is configured. The Sarvam request and most mobile requests have no explicit timeout. This permits resource/cost abuse and requests that leave the UI waiting for an excessive time.

Fix: authenticate before accepting uploads; enforce per-shop and per-IP request limits, concurrency limits, audio-size/duration/type limits, upstream deadlines, and usage budgets. Add centralized error handling and cleanup in `finally`. Surface recoverable network errors rather than silently discarding speech.

## Other correctness and release issues

1. **Profit is overstated when costs are missing.** `backend/src/services/report.js:37–40,71` adds all revenue but only known costs. An offline example with one sale of 100 and unknown purchase cost returns profit 100. The report screen warns about missing costs, but the headline and home dashboard still call this profit. Report known-cost gross margin separately, show missing-cost coverage, and avoid implying net profit; operating expenses are not modeled.
2. **Fractional inventory cannot be represented accurately.** `backend/src/db/schema.sql:31` uses integer stock, while the parser supports fractional weighed quantities. Use decimal quantities and an explicit base unit; define conversions before supporting both grams and kilograms against the same stock item. The current `GREATEST(0, ...)` clamp also hides overselling; decide whether to reject it or explicitly record negative/backordered stock.
3. **Some valid Indian numbers are formatted incorrectly for Twilio.** `backend/src/services/whatsapp.js:62` only prepends country code 91 when the national number does not already start with 91. A ten-digit national number beginning with 91 is therefore sent without its country code. Normalize by validated length and country context, not prefix alone.
4. **Real outbound WhatsApp needs more integration work.** The Twilio call uses a free-form body/media message without a template. Business-initiated messages outside the customer service window need an approved template. Add provider status callbacks and persist delivery state; provider acceptance is not delivery. Meta and Gupshup branches currently throw “not implemented.”
5. **Old bill URLs will disappear after a restart/deploy.** Bills are stored in `/tmp/bills` and served as static files. The send endpoint does not regenerate a missing stored file. Use private object storage plus signed links, or implement reliable regeneration from immutable sale snapshots. Keep customer documents out of unbounded public static storage.
6. **Voice override affects all shops.** `backend/src/routes/sale.js:809` accepts overrides without authentication if `VOICE_ADMIN_PIN` is unset. `backend/src/services/voiceVerify.js:44` stores one process-global override. Require authorized administration and explicitly scope changes; otherwise one override changes every shop served by that process.
7. **Payment tracking is incomplete.** Transactions default to paid; a UPI QR does not confirm receipt of payment. Finalize only writes the credit case, so re-finalizing with paid does not clear existing credit. There is no settlement or partial repayment API. Add explicit paid/unpaid/credit selection and a repayment ledger before selling this as dependable udaar tracking.
8. **Draft recovery is missing in the main voice flow.** The active transaction ID is held in a React ref. App termination loses the link to the draft, even though a server row may exist. Persist draft IDs and pending operations; restore on restart. Avoid blind retries until operations are idempotent. Add item edit/remove actions and a deliberate bill confirmation before automatic customer messaging during the pilot.
9. **Daily reporting uses draft creation time.** `report.js:27` groups by `created_at`. A draft started before midnight and completed after midnight lands on the earlier day. Store and report by `finalized_at` for completed sales.
10. **History queries grow with the entire shop history.** `db.js:164` loads all shop transactions; routes then filter, sort, aggregate, or slice in Node. Push date/status filters, pagination, and aggregates into PostgreSQL as usage grows.
11. **Release signing must be verified.** Checked-in `mobile-app/android/app/build.gradle` signs the release build with the debug signing config. Verify the actual EAS release signing setup and final artifact, configure a proper production upload key, and test a standalone install without Metro. Do not assume a development APK is a release build.
12. **Database TLS verification is disabled in code.** `db.js:102` sets `rejectUnauthorized:false`. Confirm the effective connection configuration, including connection-string options, and require certificate verification using the managed database's supported settings.

## Render and operating plan

Keep Render if it meets measured latency and reliability needs. A platform migration is not the next priority.

- Confirm the deployed commit matches the reviewed branch and check actual environment variables without exposing secret values. The source blueprint says free plan, Voice Lock off, and simulated WhatsApp; dashboard overrides may differ.
- Use an always-on paid instance before shops depend on checkout availability. Render documents that free services sleep after 15 minutes without traffic and may take about a minute to wake. That conflicts with the mobile voice request's 20-second deadline.
- Use durable bill storage or reliable regeneration. Render's default filesystem is ephemeral on both free and paid services unless appropriate persistent storage is configured.
- Verify managed PostgreSQL backup retention and perform a restore into a separate database. Define the acceptable data-loss window and recovery time with actual evidence from the restore.
- Add uptime checks, structured request IDs, error reporting, latency metrics, queue/failure counts, and per-shop API usage. Avoid recording full customer phone numbers or voice recordings in routine logs.
- Add staging with synthetic customers, PostgreSQL integration tests in CI, reproducible installs (`npm ci` with the existing lockfile), versioned schema migrations, and a release rollback procedure.
- Document what voice/customer information is sent to external processors, retention/deletion behavior, and the actual product privacy notice. Review current launch-market and app-store requirements before public release; the older roadmap is not a current compliance assessment.

Official references checked for this review:

- [Render free-service behavior](https://render.com/docs/free)
- [Render deployment and filesystem behavior](https://render.com/docs/deploys)
- [Twilio WhatsApp customer service window](https://www.twilio.com/docs/whatsapp/api)
- [Twilio approved notification templates](https://www.twilio.com/docs/whatsapp/tutorial/send-whatsapp-notification-messages-templates)

## Practical next steps

**First engineering milestone:** fix voice acceptance, authentication/ownership, PostgreSQL price updates, atomic completion/inventory, honest sharing/delivery states, and upload abuse controls. Add regression coverage on real PostgreSQL. Finish this before onboarding unrelated shops with real customer records.

**Second milestone:** make the shopkeeper able to inspect/correct items, confirm the total, choose payment status, recover after a connection loss, reopen a saved bill, and settle credit. Test on low-cost Android hardware, mobile data, and a noisy counter. Validate bill rates and unit conversions with shopkeepers instead of assuming every spoken amount means a per-unit price.

**Pilot:** choose one shop category and a narrow set of goods/units. Onboard 3–5 shops personally; load their catalog and verify their actual UPI recipient. Run for two weeks, with a fallback billing method and a reachable support contact. Use explicit confirmation and tap-to-talk initially. Treat automatic continuous listening and speaker verification as features requiring separate field validation.

**Suggested launch gates, not industry benchmarks:** zero observed cross-shop access or duplicate stock deductions in the test suite; at least 99% of attempted pilot bills complete or recover without founder intervention; zero unexplained total/payment discrepancies in daily reconciliations; at least 95% of pilot bills require no speech correction; measured checkout latency acceptable to the shopkeepers; a successful restore drill; at least three shops use it repeatedly and agree to pay. Measure sample size and failures, not only averages. Any observed financial-data corruption blocks expansion.

**Pricing:** measure actual STT minutes, parser tokens/calls, outbound message charges, infrastructure allocation, and support effort per active shop. Choose a price and usage allowance from those costs and observed willingness to pay. The older roadmap quotes monthly per-shop costs of 1,300–5,000 and then claims prices of 299–499 make unit economics work; those figures contradict that claim if they refer to the same usage. They are also historical estimates, not verified current prices. Do not offer unlimited voice or messaging until usage is understood.

Update the old README/roadmap after the fixes. They currently describe infrastructure that has already changed and can lead deployment and launch decisions in the wrong direction.
