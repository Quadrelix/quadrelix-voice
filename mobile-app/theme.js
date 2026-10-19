// theme.js — one place for the app's look.
//
// Before this, every screen hardcoded its own hex codes (three different
// greens for "money"), so a single visual pass meant touching every file.
// Screens import from here instead: change a colour once, the whole app
// follows. Light theme deliberately — a kirana counter is often in daylight.

export const colors = {
  bg: "#F5F7FB",       // app background (soft blue-grey)
  card: "#FFFFFF",
  text: "#0F172A",     // near-black, softer than #000 on screens
  sub: "#64748B",      // secondary text
  faint: "#94A3B8",
  line: "#E8EDF5",     // hairlines between rows

  primary: "#2563EB",  // the app's blue
  primarySoft: "#E8F0FE",

  green: "#16A34A",
  greenSoft: "#DCFCE7",
  orange: "#D97706",
  orangeSoft: "#FEF3C7",
  purple: "#7C3AED",
  purpleSoft: "#EDE9FE",
  pink: "#DB2777",
  pinkSoft: "#FCE7F3",
  red: "#DC2626",
  redSoft: "#FEE2E2",

  white: "#FFFFFF",
  whatsapp: "#25D366",
};

// Cards float on the soft background with a barely-there shadow.
export const shadow = {
  shadowColor: "#0F172A",
  shadowOpacity: 0.06,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
};

export const shadowStrong = {
  shadowColor: "#2563EB",
  shadowOpacity: 0.25,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 6 },
  elevation: 6,
};

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

// ₹12,450 — Indian digit grouping (lakh/crore), used in every screen.
export function money(n) {
  return `₹${inr.format(Math.round(Number(n) || 0))}`;
}
