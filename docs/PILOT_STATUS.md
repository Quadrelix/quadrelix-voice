# Pilot status — ab kya chal raha hai (2 Nov 2026)

Ye doc teammates ke liye hai: ek nazar me dikhe ki kya live hai, kya ban raha hai,
aur kaun sa kaam kiska hai. Kaam kaise karna hai: `docs/TEAM_WORKFLOW.md`.
Voice-service ko host kaise karna hai: `docs/VOICE_SERVICE_DEPLOY.md`.

## Maqsad
2 asli dukaanon (Pankhudi Saree Center, Apki Kirana Shop) ko **7 din** ke liye app dena, taaki
asli awaaz ka data mile aur Voice Lock ka threshold chuna ja sake (M6), phir `enforce` mode (M7).

## Abhi kya live hai
| Cheez | Sthiti |
|---|---|
| Backend | Render (`quadrelix-voice-backend.onrender.com`), branch `voice-lock-integration` se auto-deploy, DB Neon Postgres |
| App (Android APK) | build `6630a1af`, versionCode 9, runtimeVersion 1.1.0, OTA channel `preview` |
| App ke JS/UI change | PR merge -> GitHub Action `mobile-ota` -> EAS Update (phone ko 2 baar app kholne par naya UI) |
| Bolna (STT) | Sarvam, Render ke env me `SARVAM_API_KEY` |
| Bill bhejna | "WhatsApp se bhejein": customer ke number ki chat seedha khulti hai aur bill ki image attach hoti hai, shopkeeper ko Send dabana padta hai. Caption abhi nahi. |
| Voice Lock | Render par abhi `off`. Pilot ke liye `shadow` karna hai (voice-service host hone ke baad). |

## Ho chuka (launch review ke items 1-6)
Shop ownership checks, atomic sale finalize, delivery status alag, upload/rate limits, sahi profit math,
Postgres CI. Detail: `docs/LAUNCH_REVIEW_2026-11-01.md`.

## Voice Lock ka track (docs/SPEAKER_VERIFICATION_ROADMAP.md)
- M1-M5: ho chuke (service, Node routes, app enrollment screen, shadow-mode gate).
- **M2 baaki:** `voice-service/clips/` ke folders khaali hain. Asli recordings (owner 5 enroll + 15 test, dusre 10+, TV 5, overlap 5)
  karke `python evaluate.py` chalana hai aur table README me likhna hai. Ye go/no-go gate hai.
- **Hosting baaki:** Oracle Always Free VM par Docker (`voice-service/Dockerfile`, `voice-service/deploy/`). Docker image abhi
  local me pura build nahi hua (net timeout), VM par pehli build me check hoga.
- **M6:** voice-service hosted + `VOICE_LOCK_MODE=shadow` + har shop owner ki awaaz registered -> 5-7 din ka score log.
  Labels ke liye scripted sessions (ghar waale/customer/TV alag bolein) chahiye, warna sirf owner ki awaaz aayegi.
- **M7:** threshold tay hone ke baad `enforce`. Ye tabhi jab har shop ki awaaz registered ho, warna uska mic reject hoga.
- Pilot me abhi awaaz ka koi data **nahi** milta jab tak Voice Lock `off` hai; backend audio store nahi karta.

## Khule sawaal (owner tay karega)
- Pilot me awaaz ke clips opt-in store hon (7 din, sahmati ke saath) ya sirf score?
- WhatsApp caption aur automatic bhejna: WhatsApp Business API (Meta verification) — shuru nahi hua.
- Staging environment (alag Render + alag DB) — hazaaron shops se pehle.

## Pilot ke 7 din ke niyam
- `voice-lock-integration` me sirf zaroori bug fix merge hon (OTA seedha shopkeepers ke phone par jaata hai).
- Sab PR `voice-lock-integration` me, bina test kiye merge nahi.
- Naye shops sirf owner banata hai (`POST /api/admin/shops`). Demo shops (`WRFP79`, `BR997K`) asli logon ko nahi.
- Koi key/token/PIN chat, code ya commit me nahi.

## Baaki bade kaam (pilot ke baad)
Fractional stock, udaar settlement, draft recovery, DB TLS verify, durable bill storage, owner login (OTP),
Play Store release, monitoring (Sentry), versioned DB migrations, paid Render/Neon.
