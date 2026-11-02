# Team workflow — kaise change karein, test karein, aur phones tak pahunchayein

Abhi kya chal raha hai: `docs/PILOT_STATUS.md`. Ye doc teammates ke liye hai. Pilot me 5-6+ log APK use kar rahe hain, isliye
har change ke baad reinstall nahi hota — neeche ka flow follow karein.

## Kaun si cheez kaise deploy hoti hai

| Change kahan | Kaise live hota hai | Phone par |
|---|---|---|
| `backend/` | PR `voice-lock-integration` me merge -> **Render** auto-deploy | App ko kuch nahi karna |
| `mobile-app/` (screens, JS, UI) | PR merge -> **GitHub Action `mobile-ota`** -> EAS Update (`preview` channel) | App **do baar** kholne par naya UI (pehli baar download, doosri baar apply) |
| Native change (naya native package, nayi Android permission, package name) | Naya APK build (sirf Release Manager/Owner) | Dobara install |

Render sirf backend deploy karta hai. App ka code APK ke andar hota hai, wo sirf
OTA se (ya naye APK se) badalta hai.

## Roz ka flow (app ya backend change)

1. `git checkout voice-lock-integration && git pull`, phir naya branch: `git checkout -b fix/kuch-naam`.
2. Change karo.
3. **App change** test karo (neeche "Expo Go se test").
   **Backend change** test karo: `cd backend && npm test`.
4. Push karke PR kholo, base branch **`voice-lock-integration`**. CI (backend tests) pass honi chahiye.
5. Review ke baad merge. Baaki sab automatic hai (Render + OTA).

Sab testers abhi ek hi OTA channel (`preview`) par hain, isliye jo merge hota hai
wo seedha unke phones par jaata hai. **Bina test kiye merge mat karein.**
Galat update chala jaye to Owner `eas update:rollback` kar sakta hai.

## Expo Go se test

Pehle se chahiye: Node.js (LTS), git, aur phone me **Expo Go**. App **Expo SDK 54**
par hai. Play Store ka Expo Go "incompatible / SDK 54" bole to https://expo.dev/go
se SDK 54 wala Expo Go APK download karke install karein.

1. Repo clone karein, phir:
   ```
   cd mobile-app
   npm install
   npx expo start --go
   ```
   `--go` zaruri hai: `expo-dev-client` installed hai, isliye bina `--go` ke Expo
   dev-client maangta hai, Expo Go nahi. (Ya `npx expo start` ke baad terminal me `s` dabayein.)
2. **Koi `.env` nahi chahiye.** App me koi secret nahi hai; backend ka URL
   public hai. Sarvam/Gemini/DB/Admin keys sirf Render me hain, kisi ko mat bhejein.
3. Phone aur laptop **same Wi-Fi** par hon. Expo Go kholkar QR scan karein.
   Na khule to `npx expo start --go --tunnel` try karein, aur Windows Firewall me Node ko allow karein.
4. Pehli baar app **shop code** maangega. Ye Owner se lein (alag test shop), 6 characters
   ka code, ek baar daalna hai, phone me save rehta hai.
4. App Render ke backend (`BASE_URL` in `mobile-app/services/api.js`) se baat karta hai.
   Backend laptop par chalana ho to `BASE_URL` ko laptop ke IP par karein aur
   **push karne se pehle wapas Render ka URL** kar dein.

Expo Go me OTA aur naye native changes test nahi hote. Voice recording ek baar
asli phone (APK) par bhi check karein.

## Kya na karein

- `eas update` ya `eas build` bina Owner se pooche mat chalayein (build me
  credentials chahiye, update seedha testers tak jaata hai).
- `EXPO_TOKEN` ya koi API key chat/code/commit me mat daalein.
- Native change karein to `app.json` (`expo.android.runtimeVersion`) aur
  `android/app/src/main/res/values/strings.xml` (`expo_runtime_version`) dono
  me version badhayein, aur Owner se naya APK banwayein. Warna purane APK ko
  aisa JS milega jo uske native code ke saath nahi chalega.

## Accounts

- GitHub: `Quadrelix/quadrelix-voice`, branch `voice-lock-integration` (Render yahin se deploy karta hai).
- Expo: org `Quadrelix-team` (slug `nirmal220s-team`), project `ai-business-assistant-mobile`.
- GitHub repo secret `EXPO_TOKEN` (org robot token) OTA publish ke liye hai.
