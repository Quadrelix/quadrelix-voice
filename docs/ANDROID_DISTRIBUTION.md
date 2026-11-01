# Installing the app without Expo Go

The Android app installs on the shopkeeper's phone as a standalone APK. Its
JavaScript is bundled into the APK; Metro, Expo Go, a laptop, and shared Wi-Fi
are not needed. Internet access is still needed for Render and cloud speech
processing.

The API address is configured in `mobile-app/services/api.js`:
`https://quadrelix-voice-backend.onrender.com`.

The installed app is named **BizMate AI**. Its Android package and signing
identity stay the same so subsequent builds can update existing installs.

The repository-root `.easignore` excludes local SDK/NDK paths
(`android/local.properties`), generated build files, backend files, and local
secrets from cloud uploads. Native Android source remains included. The two
earlier preview builds failed because the Linux builder received Windows NDK
paths; keep these machine-specific files out of future uploads.

## Build a pilot APK

From `mobile-app`, run:

```powershell
eas build --platform android --profile preview
```

The `preview` profile explicitly disables the development client, builds an
APK, and increments the Android version code using EAS's remote version source.
EAS manages the cloud build and signing credentials. Preserve the signing key
and package name across releases so existing installs can be updated.

Open the completed EAS build page and use its install/download link. Check
the project's internal-build access settings before sharing: shopkeepers
should not need an Expo account to download a pilot build.

## What the shopkeeper does

1. Open the download link on an Android phone and download the APK.
2. If Android prompts, allow installation from the browser used to download it.
3. Install and open the app.
4. Allow microphone access when prompted.
5. Enter the shop code assigned by the founder.

Message to copy when the APK is ready (replace both placeholders):

> BizMate AI install karein: [APK DOWNLOAD LINK]
> Link kholkar APK download karein, phir Install dabayein. Android permission
> maange to is browser se installation allow karein. App kholkar microphone
> permission dein aur dukaan ka code [SHOP CODE] enter karein.
> Internet chahiye; Expo Go install karne ki zaroorat nahi hai.

Do not send an Expo development QR or a development-client APK as the customer
app. A preview APK has the app code included.

## Render and Google Play have different roles

- Render runs the API. Visiting the backend URL does not install the app.
- EAS can supply the APK download link directly. A website hosted on Render can
  also provide a button linking to that APK; a website is optional.
- The `production` build profile is for the Google Play release path. Android
  App Bundles (AAB files) are uploaded to Play Console, not installed directly
  by shopkeepers.

## Updates and verification

Backend redeployments update the API, not the installed mobile app. The current
native manifest disables Expo OTA updates. For mobile changes, build and
distribute a new APK (or publish an update through Google Play later).

Before sharing any build, install it on a test device, stop Metro, use mobile
data, and check shop selection, microphone permission, voice input, bill totals,
app restart, and lost connectivity. Verify that it opens the billing app
directly without asking for a development server.

Building an APK does not resolve the security and billing blockers identified
in `LAUNCH_REVIEW_2026-11-01.md`. Use synthetic shop/customer data for testing
until those blockers are fixed. The voice-flow fix supports the previous API
response format so a staggered mobile/backend rollout is possible.

References:
- https://docs.expo.dev/build-reference/apk/
- https://docs.expo.dev/build/internal-distribution/
