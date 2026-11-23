# BizMate AI — Mobile App Design

The living design record for `mobile-app/`. Every UI change is planned here
first, then built. Newest change at the top of the change log.

---

## Design principles (apply to every screen)

1. **Shopkeeper first.** Used at a busy counter, often one-handed, in daylight.
   Big touch targets (min 44×44), high contrast, few words.
2. **Voice is the hero.** Nothing in a header may compete with the mic.
3. **Two languages, always.** No hard-coded text. Every string lives in
   `i18n/strings/*.js` in both `hi` and `en` (check: `node scripts/check-i18n.js`).
   Hindi strings run longer, so layouts must not depend on short labels.
4. **One theme.** Colours, shadows and money formatting come only from `theme.js`.
5. **Expo Go compatible.** No new native packages (team rule). Use React Native
   built-ins (`Modal`, `Animated`, `Pressable`) and `@expo/vector-icons`.

### Tokens in use (`theme.js`)

| Token | Value | Use |
|---|---|---|
| `bg` | `#F5F7FB` | Screen background |
| `card` | `#FFFFFF` | Cards, sheets, chips |
| `text` / `sub` / `faint` | `#0F172A` / `#64748B` / `#94A3B8` | Primary / secondary / hint text |
| `line` | `#E8EDF5` | Hairlines, borders |
| `primary` / `primarySoft` | `#2563EB` / `#E8F0FE` | Actions, active state, avatar |
| `orange` / `orangeSoft` | `#D97706` / `#FEF3C7` | "Needs attention" |
| `red` / `redSoft` | `#DC2626` / `#FEE2E2` | Destructive (switch shop) |
| `shadow` | soft | Cards, sheet |

---

## Change log

### 1. Home header: one profile/menu button instead of Language pill + Profile chip

**Status:** Built locally (2026-11-23), awaiting review and PR.

**Built differently from the plan:**
- The attention dot and the "Set up" tag count Voice Lock only when the lock is
  **in use** (`mode` is not `off`). With the lock off nobody needs to enrol,
  and a dot that never goes away teaches people to ignore it. UPI missing
  still always shows the dot.
- The Help row is left out until there is a help screen to open.

#### Problem

The Home header's right side holds two separate controls side by side
(`HomeScreen.js`, the `headerRight` row):

```
┌──────────────────────────────────────────────┐
│ [logo] BizMate AI      [हिं|EN] [DS Dev Sh…] │
└──────────────────────────────────────────────┘
```

- The language pill and the shop chip sit **8 px apart**, so it's easy to tap
  the wrong one, especially with a thumb.
- The shop chip is capped at 120 px wide, so the shop name gets cut off ("Dev Sh…").
- There's no room to add anything else (Voice Lock, help, switch shop), and
  those features are scattered: Voice Lock is a card on Home, switch shop is
  at the bottom of Shop Details, and UPI setup is a card on Home.
- With the Hindi labels the row gets even tighter.

#### Solution

Replace both controls with **one round avatar button** (the shop's initials).
Tapping it opens a **bottom sheet menu** that holds the profile, language and
every other account-level feature in one place.

**Header (after):**

```
┌──────────────────────────────────────────────┐
│ [logo] BizMate AI                       (DS)•│
└──────────────────────────────────────────────┘
                                         avatar, 40×40
                                         • = orange dot when something needs setup
```

- **Avatar:** 40×40 circle, `primarySoft` background, initials in `primary`,
  800 weight, 15 px. 1 px `line` border. `hitSlop` 8 on every side.
- **Attention dot:** 10×10 `orange` dot with a 2 px `bg` ring, top-right of the
  avatar. Shown when **UPI id is missing** OR **Voice Lock needs setup**
  (the same conditions that already show those Home cards).
- **Accessibility:** `accessibilityRole="button"`,
  label = "Menu, {shop name}" / "मेनू, {shop name}".

**Why a bottom sheet (not a small dropdown):**
- Within thumb reach on a phone held in one hand.
- Full-width rows fit long Hindi labels without truncating.
- Large rows (56 px) are easy to hit at a busy counter.
- Built with RN `Modal` + `Animated` slide-up, so no new native package.

#### Menu sheet layout

```
┌──────────────────────────────────────────────┐
│                   ───                         │  drag handle (visual only)
│  (DS)  Dev Shop                               │  avatar 48 + name (800, 18)
│        Code 3DBGZU · 98765 43210              │  sub, 13
├──────────────────────────────────────────────┤
│  भाषा / Language          [  हिं  |  EN  ]    │  inline segmented control
├──────────────────────────────────────────────┤
│  [🏪] Shop & bill details               ›    │  → ShopDetails
│  [₹ ] UPI payment            ● Add now  ›    │  → ShopDetails (orange tag if missing)
│  [🛡] Voice Lock             ● Set up   ›    │  → VoiceEnroll (tag if needed)
│  [? ] Help                              ›    │  → (future, hidden for now)
├──────────────────────────────────────────────┤
│  [⇄] Switch shop                              │  red text, confirm alert
│                                               │
│              BizMate AI · v1.0.0              │  faint, 11
└──────────────────────────────────────────────┘
```

**Behaviour**

| Item | Icon (Ionicons) | Action | Notes |
|---|---|---|---|
| Profile header | avatar | — | Shows shop name, shop code, owner phone (from `ShopContext`). |
| Language | `language-outline` | Switch instantly, sheet stays open | Reuse `LanguageToggle` in a larger size (`size="lg"` prop). The sheet re-renders in the new language at once, which shows the switch worked. |
| Shop & bill details | `storefront-outline` | Close sheet → `navigate('ShopDetails')` | Shop name, phone, bill note. |
| UPI payment | `qr-code-outline` | Close sheet → `navigate('ShopDetails')` | Orange "Add now" tag when `upi_id` is missing. |
| Voice Lock | `shield-checkmark-outline` | Close sheet → `navigate('VoiceEnroll')` | Status tag: "On" (green) / "Set up" (orange) / hidden when mode is `off` and enrolled. |
| Help | `help-circle-outline` | — | **Not built now.** Row reserved for later. |
| Switch shop | `swap-horizontal` | Confirm alert → `switchShop()` | Same confirm text as Shop Details (`home.switchTitle` / `home.switchYes`). Red, separated at the bottom so it isn't tapped by accident. |
| Version | — | — | From `app.json` `expo.version`. |

**Closing the sheet:** tap the dim backdrop, Android back button
(`onRequestClose`), or after choosing a row that navigates.

**Motion:** backdrop fades to `rgba(15,23,42,0.4)` in 150 ms. Sheet slides up
220 ms (`Animated.timing`, `useNativeDriver: true`). Top corners rounded 24.

**Sheet styles:** `card` background, padding 20 / bottom = safe-area inset + 12,
rows 56 px tall with a 36×36 rounded icon tile (`primarySoft` / `primary`),
labels 15 px 700 weight, hairline `line` dividers between groups.

#### What stays the same

- **Shop select (login) screen** keeps its standalone `LanguageToggle`. There
  is no shop or profile yet, and the user needs to pick a language before typing.
- The **"Add UPI"** and **"Voice Lock"** cards on Home stay for now. They are
  prompts, while the menu is the permanent home for those features. We can
  remove the cards later once the attention dot has been seen in use.
- The logo's hidden 5-tap → Calibrate gesture is unchanged.
- The bottom tab bar is unchanged.

#### Implementation plan (files)

| File | Change |
|---|---|
| `components/AccountMenu.js` | **New.** Avatar button + bottom-sheet `Modal` with the rows above. Props: `navigation`, `shop`, `voice`. |
| `components/LanguageToggle.js` | Add an optional `size="lg"` for the sheet (taller segments, 14 px text). The default look is unchanged. |
| `screens/HomeScreen.js` | Replace the `headerRight` contents (`LanguageToggle` + `shopChip`) with `<AccountMenu …/>`. Remove the now-unused `shopChip` styles. |
| `i18n/strings/menu.js` | **New.** `menu.*` keys in `hi` + `en` (a11yLabel, close, code, language, shopDetails, upi, upiAdd, voiceLock, voiceOn, voiceSetup, switchShop, version). |
| `i18n/dictionary.js` | Register `menu.js`. |

**Test checklist**
- [ ] Hindi and English: every row label fits, nothing is cut off.
- [ ] Language switch inside the sheet updates the whole app immediately.
- [ ] Attention dot appears with no UPI id and disappears after saving one.
- [ ] Android back button closes the sheet (does not leave the app).
- [ ] Switch shop asks for confirmation, then returns to the code screen.
- [ ] Small phone (≈360 px wide): header and sheet fit, no overlap.
- [ ] `node scripts/check-i18n.js` → `0 problem(s)`.
