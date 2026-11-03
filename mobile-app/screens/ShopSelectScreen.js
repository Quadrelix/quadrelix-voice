// ShopSelectScreen.js — the first screen a new phone sees.
//
// The founder creates a shop and sends its 6-character code over WhatsApp.
// The shopkeeper types it once; the code is validated against the backend
// before it is stored, so a typo shows a clear message instead of an app that
// silently bills into the wrong shop.

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { lookupShopByCode } from '../services/api';
import { setActiveShop, normalizeShopCode } from '../services/shop';
import { errorMessage } from '../services/errorMessage';
import { useI18n } from '../services/i18n';
import LanguageToggle from '../components/LanguageToggle';
import { colors, shadow, shadowStrong } from '../theme';

const CODE_LENGTH = 6;

export default function ShopSelectScreen({ onDone }) {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const clean = normalizeShopCode(code);
  const ready = clean.length === CODE_LENGTH;

  async function connect() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const shop = await lookupShopByCode(clean);
      const active = { shop_code: clean, shop_name: shop.shop_name, shop_id: shop.shop_id };
      await setActiveShop(active);
      // Hand over the stored shape (with shop_code); chooseShop persists it
      // again, and the server's reply alone has no code to send with requests.
      onDone?.(active);
    } catch (e) {
      const status = e?.response?.status;
      if (status === 404) {
        setError(t('shop.notFound'));
      } else {
        setError(errorMessage(e, t('shop.noConnect')));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={s.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <LanguageToggle style={s.lang} />

      <View style={s.hero}>
        <Image source={require('../assets/brand/logo.png')} style={s.logo} />
        <Text style={s.brand}>
          BizMate <Text style={s.brandAi}>AI</Text>
        </Text>
      </View>

      <View style={s.card}>
        <Text style={s.label}>{t('shop.title')}</Text>
        <Text style={s.hint}>{t('shop.hint')}</Text>

        <TextInput
          style={s.input}
          value={code}
          onChangeText={(v) => {
            setCode(v);
            if (error) setError(null);
          }}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={CODE_LENGTH}
          placeholder={t('shop.placeholder')}
          placeholderTextColor={colors.faint}
          editable={!busy}
          onSubmitEditing={connect}
          returnKeyType="go"
        />

        {!!error && <Text style={s.errorText}>{error}</Text>}

        <TouchableOpacity
          style={[s.btn, (!ready || busy) && s.btnDisabled]}
          onPress={connect}
          disabled={!ready || busy}
          activeOpacity={0.85}
        >
          {busy
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.btnText}>{t('shop.open')}</Text>}
        </TouchableOpacity>

        <Text style={s.footer}>{t('shop.help')}</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: 20 },
  lang: { position: 'absolute', top: 48, right: 20 },

  hero: { alignItems: 'center', marginBottom: 22 },
  logo: { width: 92, height: 92, borderRadius: 24, marginBottom: 12 },
  brand: { fontSize: 26, fontWeight: '800', color: colors.text, letterSpacing: -0.5 },
  brandAi: { color: colors.primary },

  card: { backgroundColor: colors.card, borderRadius: 20, padding: 20, ...shadow },
  label: { fontSize: 18, fontWeight: '800', color: colors.text },
  hint: { fontSize: 13, color: colors.sub, lineHeight: 19, marginTop: 4, marginBottom: 16 },

  input: {
    backgroundColor: colors.bg, borderRadius: 14, borderWidth: 1, borderColor: colors.line,
    paddingVertical: 14, paddingHorizontal: 16, fontSize: 26, letterSpacing: 8,
    textAlign: 'center', fontWeight: '800', color: colors.text,
  },

  errorText: { color: colors.red, fontSize: 13, marginTop: 12, lineHeight: 18 },

  btn: {
    backgroundColor: colors.primary, borderRadius: 14, minHeight: 54, justifyContent: 'center',
    alignItems: 'center', marginTop: 16, ...shadowStrong,
  },
  btnDisabled: { opacity: 0.45 },
  btnText: { color: '#fff', fontSize: 17, fontWeight: '700' },

  footer: { fontSize: 12, color: colors.faint, textAlign: 'center', marginTop: 14 },
});
