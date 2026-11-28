# Pilot ka ek hafta — roz kya karna hai, aur aakhri din kya

Do dukaanen (Pankhudi Saree Center, Manish Kirana Store), ek hafte ka trial. Maqsad:
1. Asli dukaandaaron se billing ka feedback lena.
2. Voice Lock ka data jama karna (owner ki awaaz ke score), phir threshold chunna.
Kaise kaam hota hai: `docs/VOICE_CALIBRATION.md`. Abhi ki sthiti: `docs/PILOT_STATUS.md`.

## Din 0 — dene ka din
- [ ] Pankhudi aur Manish ke code alag-alag, owner ko private WhatsApp par (kisi group me nahi).
- [ ] Owner ke phone par APK install (Android hi chalta hai). **Install ke baad app ek baar kholo, 1 minute ruko, poori band karo
      (recent apps se swipe), dobara kholo**, tab pehle screen par code + naam + mobile ke teen khane dikhte hain (naya screen OTA se aata hai).
- [ ] Code + dukaan ka naam + mobile daalo. Home par dukaan ke naam par tap: **UPI id** aur **bill ka 1–2 line ka message**.
- [ ] **Owner ki awaaz register** ("वॉइस लॉक चालू करें", 5 vaakya, 2 dukaan ke normal shor me). Bina iske koi score nahi banta.
- [ ] Ek test bill saath me: bolna -> number -> bill -> WhatsApp chat khulna -> UPI QR aur neeche ka message dikha.
- [ ] Owner ko batao: mic **sirf tab dabaye jab wo khud bol raha ho**, code kisi ko na bataye, pehli request kabhi 1 minute le sakti hai.
- [ ] Phone ka model + Android version note karo, aur ek WhatsApp number do jahan wo dikkat bataye.
- [ ] Owner se WhatsApp par ek line me sahmati: bikri ka data aur awaaz ke score pilot ke liye use honge.

## Din 1 — kya score aa rahe hain?
Owner ke 1–2 bill banane ke baad VM par (laptop ke PowerShell se login):
```powershell
ssh -i "D:\Downloads\bizmate-voice_key.pem" azureuser@85.211.253.243
```
VM ke andar:
```bash
cd ~/quadrelix-voice/voice-service/deploy
docker compose exec voice tail -n 5 /data/verify_log.jsonl
```
Aakhri rows dikhni chahiye, `speaker_id` me dukaan ka id (jaise `shop_psvybc_owner`). Rows nahi aayi to: awaaz register nahi hui,
ya Render aur VM ka token alag hai, ya Voice Lock `off` hai (Render env: `VOICE_LOCK_MODE=shadow`).

## Din 2–6 — roz ke 3 kaam (5 minute)
- [ ] UptimeRobot: backend monitor **Up** (hara), response time chhota.
- [ ] Owners ko ek line WhatsApp: "koi dikkat?" Jo bhi dikkat bataye uska screenshot maango.
- [ ] Render dashboard ke Logs me laal error to nahi.

## Din 7 — aakhri din (is order me)
1. **Voice ka log nikalo** (VM band karne se pehle):
   ```powershell
   scp -i "D:\Downloads\bizmate-voice_key.pem" azureuser@85.211.253.243:~/quadrelix-voice/voice-service/deploy/verify_log.jsonl .
   ```
   (Agar `verify_log.jsonl` us folder me na mile to VM par `docker compose exec voice cat /data/verify_log.jsonl > ~/verify_log.jsonl` chalao aur `~/verify_log.jsonl` copy karo.)
2. **Team ka 1 ghanta calibration** (1 owner + 4–5 dost "koi aur" ban kar): `docs/VOICE_CALIBRATION.md` ka step A, `TEST Team` shop par.
3. **Threshold table:** logon se mili hui log file par
   ```powershell
   cd D:\Desktop\mvp-project-sarvam\voice-service
   python analyze_log.py verify_log.jsonl --assume-owner
   ```
   `--assume-owner` ka matlab: bina label ke billing wali rows owner ki rows maani jaayengi (isliye owner ko bola tha ki mic sirf khud ke liye dabaye).
   Script "RECOMMENDED threshold" tabhi batati hai jab dusron par 0 galat-pass aur owner par 15% se kam galat-reject ho.
4. **Owners se feedback** lo. Kuch shayad chalate rehna chahein, to aage ka faisla baad me (neeche).
5. **Unka data (agar chahiye)**: Neon console -> SQL Editor me, sirf us dukaan ke (apne owner ko hi dena, kisi aur ko nahi; ye customer ke phone number bhi rakhta hai):
   ```sql
   SELECT created_at, customer_phone, total_amount, payment_status, items
   FROM transactions
   WHERE shop_id = 'shop_psvybc'      -- Manish ke liye 'shop_sbxlrz'
   ORDER BY created_at;
   ```
   Result ko CSV me export kar sakte ho.
6. **Dukaanen band karo** (code turant kaam karna band, data bacha rehta hai). Owners dukaan ka naam badal sakte hain, isliye **id se** band karo:
   ```powershell
   cd D:\Desktop\mvp-project-sarvam\backend\scripts
   powershell -ExecutionPolicy Bypass -File .\deactivate-shops.ps1 -ShopIds shop_psvybc,shop_sbxlrz
   ```
   ADMIN_TOKEN poochhega, list dikhayega, `YES` likhne par hi band karega. Galat id likhi to batayega ("No shop with id ...").
   Wapas chalu karna ho: `PATCH /api/admin/shops/<shop_id>` body `{"active": true}`.
7. **Awaaz ka fingerprint hatana** (owner kahe to): app me "आवाज़ दोबारा दर्ज करें" (PIN se) ya VM par volume saaf karna. Hum awaaz ki audio save nahi karte, sirf fingerprint aur score.
8. **Kharcha rokna:**
   - Azure portal -> VM `bizmate-voice` -> **Stop** (deallocate): isse sirf VM ke chalne ka kharcha rukta hai.
     **Disk aur static IP ka kharcha tab bhi chalta rehta hai (~Rs 25-30 roz).** Poora rokna ho to resource group `bizmate-voice-rg` **delete** karo
     (pehle voice log copy kar lo). Azure credit ka hisaab: portal -> Cost Management -> Cost analysis (Group by Resource). Pilot ke 7 din ka
     kharcha ~Rs 880 raha (credit ka ~9%), roz ~Rs 125.
   - UptimeRobot ke monitors **Pause**.

## Agar trial aage chalana ho
- Render ko **paid Starter (~$7/mahina)** par lo (soye server aur 750 ghante ke jaal se bachne ke liye).
- Azure VM ka credit/kharcha dekho, ya voice-service ke liye sasta host.
- Voice Lock ko `enforce` karne se pehle threshold ke saath demo script (music ke saath) do baar saaf nikle; sab owners ki awaaz registered ho.
- Phone OTP login (shop code ki jagah) aur Play Store, jab dukaanen badhne lagen.
