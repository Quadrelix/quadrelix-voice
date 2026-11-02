# Team workflow — kaise change karein, test karein, aur phones tak pahunchayein

Ye doc teammates ke liye hai. Pilot me 5-6+ log APK use kar rahe hain, isliye
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

1. Phone me Play Store se **Expo Go** install karein (Expo account zaruri nahi).
2. Laptop par:
   ```
   cd mobile-app
   npm install
   npx expo start
   ```
3. Phone aur laptop **same Wi-Fi** par hon, Expo Go se QR scan karein.
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
