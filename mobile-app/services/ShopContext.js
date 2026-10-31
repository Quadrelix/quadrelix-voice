// ShopContext — the active shop, shared by every screen.
//
// Why a context and not just AsyncStorage: the shop gate lives in App.js, but
// the switch action lives on the Home screen's header. Without shared state,
// clearing the stored code leaves App.js still rendering the tabs — the phone
// looks stuck on the old shop (this was the bug).
//
// Updates.reloadAsync() is NOT a fix here: it only works in dev/production
// builds, not in Expo Go, so switching shops silently did nothing there.

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { getActiveShop, setActiveShop, clearActiveShop } from './shop';

const ShopContext = createContext({
  shop: null,
  ready: false,
  chooseShop: async () => {},
  switchShop: async () => {},
});

export function ShopProvider({ children }) {
  const [shop, setShop] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    getActiveShop().then((stored) => {
      setShop(stored);
      setReady(true);
    });
  }, []);

  const chooseShop = useCallback(async (next) => {
    await setActiveShop(next);
    setShop(next);
  }, []);

  const switchShop = useCallback(async () => {
    await clearActiveShop();
    setShop(null);
  }, []);

  return (
    <ShopContext.Provider value={{ shop, ready, chooseShop, switchShop }}>
      {children}
    </ShopContext.Provider>
  );
}

export function useShop() {
  return useContext(ShopContext);
}