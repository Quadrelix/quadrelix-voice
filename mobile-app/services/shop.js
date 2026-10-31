// Which shop this phone belongs to.
//
// A shopkeeper installs the app once and types the code the founder gave them.
// From then on the phone sends that code with every request; the backend
// resolves it to a shop id and scopes everything to it. One phone = one shop,
// which is exactly right for a counter: nobody shares a phone between two
// shops at the same time.
//
// Kept in AsyncStorage (not memory) so a restart, a dead battery or an app
// update does not ask for the code again.

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'bizmate.activeShop';

let cached = undefined; // undefined = not read yet, null = no shop chosen

/**
 * Read the active shop, once per app run.
 * Returns { shop_code, shop_name, shop_id } or null.
 */
export async function getActiveShop() {
  if (cached !== undefined) return cached;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    cached = raw ? JSON.parse(raw) : null;
  } catch {
    cached = null;
  }
  return cached;
}

export async function setActiveShop(shop) {
  cached = shop;
  await AsyncStorage.setItem(KEY, JSON.stringify(shop));
}

export async function clearActiveShop() {
  cached = null;
  await AsyncStorage.removeItem(KEY);
}

// Code the owner types: uppercase, no spaces, no dashes. "wrfp 79" and
// "WRFP-79" both become "WRFP79".
export function normalizeShopCode(input) {
  return String(input || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}