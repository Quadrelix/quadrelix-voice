// i18n — Hindi / English for the whole app.
//
// Usage in a screen:
//   const { t } = useI18n();
//   <Text>{t('home.title')}</Text>
//   <Text>{t('bill.sentTo', { phone })}</Text>     // "…{phone}…" in the string
//
// Strings live in i18n/strings/<screen>.js as { en: {...}, hi: {...} } and are
// merged by i18n/dictionary.js. A key missing in the chosen language falls back
// to English, then to the key itself (so a typo is visible, never a crash).
//
// The choice is kept in AsyncStorage so it survives restarts. Default is Hindi:
// the shopkeepers this app is for read Devanagari more easily than Roman text.
// Speech recognition is separate (the backend always uses hi-IN, which handles
// Hindi-English mixing), so changing the screen language never changes how the
// shopkeeper has to speak.

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import dictionary from '../i18n/dictionary';

const KEY = 'bizmate.language';
export const LANGUAGES = ['hi', 'en'];
const DEFAULT_LANG = 'hi';

function translate(lang, key, vars) {
  let text = dictionary[lang]?.[key] ?? dictionary.en?.[key] ?? key;
  if (vars) {
    text = text.replace(/\{(\w+)\}/g, (m, name) => (vars[name] !== undefined ? String(vars[name]) : m));
  }
  return text;
}

// The language currently on screen, readable outside React (recording hooks and
// other plain modules that have to produce a message). I18nProvider keeps it in
// sync; inside components prefer `t` from useI18n().
let currentLang = DEFAULT_LANG;
export function tNow(key, vars) {
  return translate(currentLang, key, vars);
}

const I18nContext = createContext({
  lang: DEFAULT_LANG,
  ready: false,
  t: (key, vars) => translate(DEFAULT_LANG, key, vars),
  setLang: () => {},
  toggleLang: () => {},
});

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(DEFAULT_LANG);
  const [ready, setReady] = useState(false);
  currentLang = lang;

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((saved) => { if (LANGUAGES.includes(saved)) setLangState(saved); })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const setLang = useCallback((next) => {
    if (!LANGUAGES.includes(next)) return;
    setLangState(next);
    AsyncStorage.setItem(KEY, next).catch(() => {});
  }, []);

  const value = useMemo(() => ({
    lang,
    ready,
    t: (key, vars) => translate(lang, key, vars),
    setLang,
    toggleLang: () => setLang(lang === 'hi' ? 'en' : 'hi'),
  }), [lang, ready, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
