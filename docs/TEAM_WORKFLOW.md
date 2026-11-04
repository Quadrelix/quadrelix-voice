# Team guide — clone se PR tak (bilkul shuru se)

Ye guide un teammates ke liye hai jo code me change karna chahte hain: pehle apne laptop par chalakar
test karna, phir GitHub par PR banana. Har step me exact command hai. Commands **Windows PowerShell** ke hain.
Abhi kya chal raha hai: `docs/PILOT_STATUS.md`.

---------------------------------------------------------------------------------------------------

## 0. Pehle ye samajh lo (2 minute)

```
Shopkeeper ka phone (BizMate app)
        |
        v
Backend (Node, folder backend/)  --- Render par live ---  database: Neon (PostgreSQL)
        |
        v   (sirf awaaz ki jaanch ke liye)
Voice-service (Python, folder voice-service/)  --- Azure VM par live
```

| Folder | Kya hai | Live kaise hota hai |
|---|---|---|
| `mobile-app/` | Phone ka app (React Native, Expo SDK 54) | PR merge -> GitHub Action **mobile-ota** -> phones par OTA update (app **do baar** kholne par aata hai) |
| `backend/` | Node server: bill, shops, STT | PR merge -> **Render** apne aap deploy (2–3 min) |
| `voice-service/` | Python: awaaz ka fingerprint match | Abhi VM par haath se (owner karta hai) |
| `docs/` | Ye sab docs | Sirf GitHub |

**Ek baat jo pakki yaad rakhni hai:** jo bhi PR `voice-lock-integration` branch me merge hota hai, wo
**seedha asli shopkeepers ke phones aur server tak jaata hai.** Isliye merge se pehle test zaroor.

Pilot ke dauran niyam:
1. Sab PR **`voice-lock-integration`** me (main me nahi).
2. Sirf zaroori bug fix ya agreed kaam. Bina test ke merge nahi.
3. **Naya native package / nayi Android permission / icon** mat badlo (iske liye naya APK chahiye, wo sirf Owner banata hai).
4. `eas build`, `eas update` **mat chalao**. Ye Owner ka kaam hai.
5. Koi key, token, password, `.env` kabhi commit ya chat me nahi.
6. Asli shops (Pankhudi, Manish) ke code se test mat karo. Apna test shop use karo (neeche).

---------------------------------------------------------------------------------------------------

## 1. Ek baar ka setup (laptop par)

### 1.1 Ye install karo
| Cheez | Kahan se | Check karne ka command |
|---|---|---|
| Git | git-scm.com | `git --version` |
| Node.js **LTS** (v20 ya naya) | nodejs.org | `node --version` aur `npm --version` |
| VS Code (optional, code dekhne ke liye) | code.visualstudio.com | — |
| Python 3.10–3.12 (**sirf** voice-service par kaam ho to) | python.org | `python --version` |

Command PowerShell me chalao (Start -> "PowerShell").

### 1.2 GitHub
1. Owner se bolo ki tumhe GitHub repo `Quadrelix/quadrelix-voice` me **collaborator** bana de. Invite email accept karo.
2. Git ko apna naam batao (ek baar):
```powershell
git config --global user.name "Tumhara Naam"
git config --global user.email "tumhari-github-email@example.com"
```

### 1.3 Phone me Expo Go
Hamara app **Expo SDK 54** par hai. Play Store ka Expo Go naye SDK ke liye hota hai aur "incompatible" bol sakta hai.
Agar aisa bole: https://expo.dev/go kholo, **SDK 54** chuno, aur wahan se Expo Go ka Android APK download karke install karo.
(Expo account banana zaroori nahi.)

---------------------------------------------------------------------------------------------------

## 2. Code lena (clone)

```powershell
cd D:\Projects          # koi bhi folder jahan code rakhna hai (pehle bana lo)
git clone https://github.com/Quadrelix/quadrelix-voice.git
cd quadrelix-voice
git checkout voice-lock-integration
```
Ye branch asli kaam wali branch hai. Dobara kabhi kaam shuru karne se pehle hamesha:
```powershell
git checkout voice-lock-integration
git pull origin voice-lock-integration
```

---------------------------------------------------------------------------------------------------

## 3. Roz ka flow (poora ek nazar me)

1. `git pull` (upar) -> **naya branch** banao -> change karo.
2. Laptop par test (Expo Go / `npm test`).
3. `git add` -> `git commit` -> `git push`.
4. GitHub par **PR** kholo (base: `voice-lock-integration`), CI green hone do.
5. Owner review karke merge karega. Phir apne aap live.

### Naya branch (har kaam ke liye alag)
```powershell
git checkout -b fix/home-button-colour       # naam jaisa kaam waisa: fix/..., ui/..., feature/...
```

---------------------------------------------------------------------------------------------------

## 4. App (frontend) par kaam: Expo Go se test

Ye sabse aam kaam hai (button, text, layout). **Iske liye backend chalana zaroori nahi.**
App seedha live backend se baat karta hai.

### 4.1 Pehli baar
```powershell
cd mobile-app
npm install
```
(2–5 minute lagte hain. Warning aaye to chalega; `ERR!` aaye to neeche Troubleshooting dekho.)

### 4.2 App chalao
```powershell
npx expo start --go
```
- `--go` zaroori hai: hamare project me `expo-dev-client` bhi hai, aur bina `--go` ke Expo "development build" maangta hai, Expo Go nahi.
- Terminal me **QR code** dikhega.
- Laptop aur phone **same Wi-Fi** par hon.
- Phone me **Expo Go** kholo -> "Scan QR code" -> QR scan karo. (Pehli baar 1 minute lagta hai.)
- QR na khule to: `npx expo start --go --tunnel` (pehli baar kuch install karne ko pooch sakta hai: `y`).

### 4.3 Test shop ka code
App pehle screen par **dukaan ka code** maangta hai. Owner se **TEST shop ka code** maang lo (ye sirf team ka hai).
Code + koi bhi dukaan ka naam + mobile number daalo. Asli shops ke code kabhi mat daalna.
Ye app live backend se judta hai, to jo bill/data tum banaoge wo us **TEST shop** me jayega (isme koi dikkat nahi).

### 4.4 Code badalna
Folder `mobile-app/`:

| Kya badalna hai | File |
|---|---|
| Home screen | `screens/HomeScreen.js` |
| Bill bolne wala screen | `screens/HandsFreeScreen.js` |
| Pehla screen (code + naam + mobile) | `screens/ShopSelectScreen.js` |
| Dukaan ki jaankari (naam, UPI, bill ka message) | `screens/ShopDetailsScreen.js` |
| Products / Customers / Reports | `screens/ProductsScreen.js`, `CustomersScreen.js`, `ReportsScreen.js` |
| Rang, spacing | `theme.js` |
| Server se baat (API calls) | `services/api.js` |
| **Saara text (Hindi + English)** | `i18n/strings/*.js` |

File **save** karte hi phone par app apne aap reload hoti hai. Na ho to terminal me `r` dabao.

### 4.5 Hindi/English ka niyam (bahut zaroori)
App me har text **do bhasha** me hota hai. Screen me text seedha mat likho:
```jsx
// galat
<Text>Save karein</Text>
// sahi
const { t } = useI18n();            // upar import: import { useI18n } from '../services/i18n';
<Text>{t('shopDetails.save')}</Text>
```
Phir `i18n/strings/<screen>.js` me **dono** bhasha me wahi key daalo:
```js
en: { 'shopDetails.save': 'Save' },
hi: { 'shopDetails.save': 'सेव करें' },
```
Check karo (ye Hindi/English ki keys barabar hain ya nahi, aur koi key chhoot to nahi gayi):
```powershell
node scripts/check-i18n.js
```
Aakhir me `0 problem(s)` aana chahiye. App me **upar ke toggle (हिं | EN)** se dono bhasha me ek baar dekh lo.

### 4.6 Kya test karna hai (checklist)
- [ ] Jo screen badli use **Hindi aur English dono** me dekha.
- [ ] Lambe naam/text kat ya overlap to nahi hue (chhote phone par).
- [ ] Button dabane layak bade hain.
- [ ] Jo pehle chalta tha wo ab bhi chalta hai (code daalna, mic dabana, Home ke tiles).
- [ ] Phone ke terminal me **laal error** nahi (Metro terminal me dekho).

### 4.7 Expo Go ki seemayein
- **WhatsApp seedha customer ki chat me** kholne wala feature Expo Go me nahi chalta (uska native package sirf asli APK me hai). Expo Go me ye normal share sheet par aa jaata hai. Isko test karna ho to Owner se pucho.
- **OTA update** aur **icon** Expo Go me test nahi hote.
- Naya native package chahiye to khud mat jodo; Owner se pucho.

---------------------------------------------------------------------------------------------------

## 5. Backend par kaam: apne laptop par chalana

Jab **server ka code** badalna ho (`backend/`). Tumhare laptop par **alag, apna database** chalega, live data ko kuch nahi hota.

### 5.1 Pehli baar
```powershell
cd backend
npm install
copy .env.example .env
```
`.env.example` me local ke liye sahi values pehle se hain: `DB_FILE=./dev-db.json` (ek local file, Postgres ki zaroorat nahi),
`ADMIN_TOKEN=dev-admin`, Voice Lock band. Asli keys (`DATABASE_URL`, Sarvam, Gemini...) **kisi se maang kar mat daalna**.

### 5.2 Server chalao
```powershell
npm start
```
`Server running on http://localhost:3000` dikhe. Pehli baar Windows poochhe "Allow Node.js on network?" to **Private networks** par Allow do.
Check (naye PowerShell me):
```powershell
Invoke-RestMethod http://localhost:3000/health
```
`ok: True` aana chahiye.

### 5.3 Apna test shop banao aur sale karke dekho (bina app ke)
```powershell
# naya shop (code milega)
Invoke-RestMethod -Method Post http://localhost:3000/api/admin/shops -Headers @{Authorization="Bearer dev-admin"} -ContentType "application/json" -Body '{"shop_name":"Dev Shop","shop_type":"kirana"}'

# us code se text bhejkar sale (CODE ki jagah upar wala shop_code)
Invoke-RestMethod -Method Post http://localhost:3000/api/utterance -Headers @{"X-Shop-Code"="CODE"} -ContentType "application/json" -Body '{"text":"2 sabun 10 rupay"}'
```
Dusre routes ke liye `README.md` ka "Backend API" hissa dekho.

### 5.4 Apna app apne backend se jodo
1. Laptop ka IP nikalo: `ipconfig` -> **IPv4 Address** (jaise `192.168.1.5`).
2. Phone ke Chrome me kholo `http://192.168.1.5:3000/health`. `{"ok":true...}` dikhe to phone laptop tak pahunch raha hai
   (na dikhe to Windows Firewall me Node ko Private network allow karo, aur Wi-Fi same ho).
3. App ko batao (ye file badalne se behtar hai, tracked file me IP kabhi commit nahi hota):
```powershell
cd ..\mobile-app
$env:EXPO_PUBLIC_API_URL="http://192.168.1.5:3000"
npx expo start --go --clear
```
(`--clear` zaroori: warna purana URL cache me rehta hai.) Ye variable sirf us PowerShell window ke liye hai.
Band karke naya window kholo to app wapas live backend se judega.
4. App me **apne local backend ke shop ka code** (5.3 me mila) daalo.

### 5.5 Awaaz (mic) local backend ke saath
Mic se bolne ke liye backend ko Sarvam ki key chahiye. Apni **free key** sarvam.ai se lo aur `backend/.env` me `SARVAM_API_KEY=` ke baad daalo.
Bina key ke bhi baaki sab (text se sale, bill, shops, reports) test ho sakta hai.

### 5.6 Backend ke tests
```powershell
cd backend
npm test
```
Ye internet aur keys ke bina chalta hai (~30 second). **0 fail** hona chahiye. (`skipped 2` normal hai: wo asli Postgres wale tests hain.)
Naya route ya logic jodo to uske **test bhi likho** (`backend/test/` me, kisi purane test ko dekh lo).

### 5.7 Voice-service (Python) par kaam
Zyadatar logon ko iski zaroorat nahi. Zaroorat ho to `voice-service/README.md` dekho:
Python venv + `pip install -r requirements.txt`, **ffmpeg** aur kam se kam ~2 GB khaali RAM chahiye (torch). Tests: `python -m pytest tests -q`.
Backend ko usse jodne ke liye `backend/.env` me `VOICE_SERVICE_URL=http://127.0.0.1:8000` aur `VOICE_LOCK_MODE=shadow`.

---------------------------------------------------------------------------------------------------

## 6. PR bhejne se pehle (checklist)

Repo ke root folder me (`quadrelix-voice`):

- [ ] `cd backend; npm test` -> **0 fail** (backend badla ho to).
- [ ] `cd mobile-app; node scripts/check-i18n.js` -> **0 problem** (app badla ho to).
- [ ] (Optional, par accha) app compile hota hai: `cd mobile-app; npx expo export --platform android` (~1–2 minute, ~1.5 GB RAM chahiye;
      dusre bade apps band kar do). Aakhir me `Exported:` aana chahiye.
- [ ] `git status` me **sirf wahi files** hain jo tumne jaan-boojh kar badli.
- [ ] Koi `.env`, key, password, `dev-db.json`, `node_modules` **nahi** hai (ye pehle se `.gitignore` me hain, phir bhi dekh lo).
- [ ] Hindi aur English dono me dekh liya.

---------------------------------------------------------------------------------------------------

## 7. Commit aur push

```powershell
cd D:\Projects\quadrelix-voice        # repo ka root
git status                             # kya badla, dekho
git add mobile-app/screens/HomeScreen.js mobile-app/i18n/strings/home.js     # sirf apni files (git add . se bacho)
git commit -m "Home: make the speak button bigger"
git push -u origin fix/home-button-colour     # apne branch ka naam
```
- `git add <file>` se sirf apni files jodo. Folder ka naam bhi de sakte ho: `git add mobile-app`.
- Commit message chhota aur saaf: **kya badla aur kyun** ("Fix: ..." / "Add: ...").
- "LF will be replaced by CRLF" wali warning **normal** hai (Windows), ignore karo.
- Push reject ho ("rejected ... fetch first") to: `git pull --rebase origin voice-lock-integration` phir dobara `git push`.

---------------------------------------------------------------------------------------------------

## 8. Pull Request (PR) banana

1. Push ke baad GitHub par repo kholo. Upar **"Compare & pull request"** (hara button) dikhega. Use dabao.
   (Na dikhe to: Pull requests -> New pull request.)
2. **Base branch = `voice-lock-integration`** (ye galat hua to `main` me jaayega, dhyan se dekho!). Compare = tumhara branch.
3. Title aur description likho:

```
Title:  Home: bigger speak button

Kya badla:
- ...
Kyun:
- ...
Kaise test kiya:
- Expo Go (Android), Hindi + English dono
- cd backend && npm test (0 fail)       <- agar backend badla
Screenshot: (agar UI badla ho to 1-2 screenshot lagao)
```
4. **Create pull request**.
5. Neeche **checks** chalenge: `backend / test` **hara** (tick) hona chahiye. Laal ho to "Details" dabakar dekho kya fail hua, laptop par
   `npm test` se wahi chalao, theek karke dobara push karo (PR apne aap update hota hai).
6. Owner review karega, kuch badalne ko kahe to usi branch par badlo aur push karo. Phir wo **merge** karega.

### Merge ke baad kya hota hai (tumhein kuch nahi karna)
- Backend badla ho: Render 2–3 minute me naya server chalata hai.
- App badla ho: GitHub Action `mobile-ota` update publish karta hai; phones me app **do baar** kholne par naya screen aata hai.
- Kuch bigde to Owner `eas update:rollback` se wapas laata hai. Isliye merge se pehle test.

---------------------------------------------------------------------------------------------------

## 9. Dikkat aaye to (Troubleshooting)

| Dikkat | Kya karein |
|---|---|
| Expo Go: "incompatible / SDK" | https://expo.dev/go se **SDK 54** wala Expo Go install karo |
| QR scan par app nahi khulti | Laptop-phone same Wi-Fi? Nahi to `npx expo start --go --tunnel` |
| Expo ne "development build" maanga | `--go` lagana bhool gaye: `npx expo start --go` |
| App me "Network request failed" | Live backend soya ho sakta hai (pehli request ~1 min leti hai), dobara try karo. Local backend ho to IP/Wi-Fi/Firewall dekho (5.4) |
| App purana URL/purana UI dikha rahi hai | `npx expo start --go --clear` |
| "Shop code required" / pehle screen par atak gaye | Test shop ka code galat/missing. Owner se lo |
| `npm install` me `ERR!` | `node_modules` folder aur `package-lock.json` ko chhedo mat; folder delete karke dobara `npm install`. Node LTS hai? (`node --version`) |
| Bundler "out of memory" / bahut slow | Chrome waghaira band karo, laptop me ~2 GB RAM khaali rakho |
| Port 3000 pehle se use me | Dusre PowerShell me `$env:PORT="3100"; npm start` (phir app ka URL bhi :3100) |
| PowerShell me `&&` ka error | Windows PowerShell 5 `&&` nahi samajhta. Commands **ek-ek line** me chalao |
| `git push` "rejected" | `git pull --rebase origin voice-lock-integration`, phir `git push` |
| PR par `backend / test` laal | "Details" -> kaunsa test fail hua -> laptop par `cd backend; npm test`, theek karo, push |
| Galat branch (main) me kaam kar diya | Roko, commit mat karo; Owner ko batao |
| Kuch samajh na aaye | Bina jhijhak Owner se pucho. Ghalat merge se behtar hai ek sawal |

---------------------------------------------------------------------------------------------------

## 10. Accounts aur jaankari

- GitHub repo: `Quadrelix/quadrelix-voice`, kaam ki branch: `voice-lock-integration` (Render yahin se deploy karta hai).
- Expo project: org `Quadrelix-team` (slug `nirmal220s-team`), project `ai-business-assistant-mobile`. Teammates ko Expo account **zaroori nahi** hai.
- GitHub repo secret `EXPO_TOKEN` OTA publish ke liye hai. Kisi ko nahi dena.
- Voice-service ka deploy aur calibration: `docs/VOICE_SERVICE_DEPLOY.md`, `docs/VOICE_CALIBRATION.md`.
