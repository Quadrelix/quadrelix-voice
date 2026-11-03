// ShopSelectScreen.js — the first screen a new phone sees.
//
// The founder creates a shop and sends its 6-character code over WhatsApp. The
// shopkeeper types the code plus their shop name and mobile number (printed on
// every bill). The code is validated against the backend before anything is
// stored, so a typo shows a clear message instead of an app that silently bills
// into the wrong shop; the name and number are then saved on the shop.

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { lookupShopByCode, setupShop } from '../services/api';
import { setActiveShop, normalizeShopCode } from '../services/shop';
import { errorMessage } from '../services/errorMessage';
import { useI18n } from '../services/i18n';
import LanguageToggle from '../components/LanguageToggle';
import { colors, shadow, shadowStrong } from '../theme';

const CODE_LENGTH = 6;

export default function ShopSelectScreen({ onDone }) {
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const clean = normalizeShopCode(code);
  const phoneDigits = phone.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
  const nameOk = name.trim().length >= 2;
  const phoneOk = /^[6-9]\d{9}$/.test(phoneDigits);
  const ready = clean.length === CODE_LENGTH && nameOk && phoneOk;

  function explain(e) {
    const status = e?.response?.status;
    const apiCode = e?.response?.data?.code;
    if (status === 404) return t('shop.notFound');
    if (apiCode === 'bad_name') return t('shop.badName');
    if (apiCode === 'bad_phone') return t('shop.badPhone');
    return errorMessage(e, t('shop.noConnect'));
  }

  async function connect() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const shop = await lookupShopByCode(clean); // 404 = wrong code
      // Save what the owner typed on the shop (it prints on their bills). The reply
      // carries the name exactly as the server stored it.
      const saved = await setupShop(clean, { shop_name: name.trim(), owner_phone: phoneDigits });
      const active = {
        shop_code: clean,
        shop_name: saved?.shop_name || shop.shop_name,
        shop_id: shop.shop_id,
      };
      await setActiveShop(active);
      // Hand over the stored shape (with shop_code); chooseShop persists it
      // again, and the server's reply alone has no code to send with requests.
      onDone?.(active);
    } catch (e) {
      setError(explain(e));
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

      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={s.hero}>
          <Image source={require('../assets/brand/logo.png')} style={s.logo} />
          <Text style={s.brand}>
            BizMate <Text style={s.brandAi}>AI</Text>
          </Text>
        </View>

        <View style={s.card}>
          <Text style={s.title}>{t('shop.title')}</Text>

          <Text style={s.label}>{t('shop.codeLabel')}</Text>
          <TextInput
            style={[s.input, s.codeInput]}
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
          />
          <Text style={s.hint}>{t('shop.hint')}</Text>

          <Text style={[s.label, s.gap]}>{t('shop.nameLabel')}</Text>
          <TextInput
            style={s.input}
            value={name}
            onChangeText={(v) => {
              setName(v);
              if (error) setError(null);
            }}
            maxLength={60}
            placeholder={t('shop.namePlaceholder')}
            placeholderTextColor={colors.faint}
            editable={!busy}
          />

          <Text style={[s.label, s.gap]}>{t('shop.phoneLabel')}</Text>
          <TextInput
            style={s.input}
            value={phone}
            onChangeText={(v) => {
              setPhone(v);
              if (error) setError(null);
            }}
            keyboardType="phone-pad"
            maxLength={14}
            placeholder={t('shop.phonePlaceholder')}
            placeholderTextColor={colors.faint}
            editable={!busy}
            onSubmitEditing={connect}
            returnKeyType="go"
          />
          <Text style={s.hint}>{t('shop.detailsHint')}</Text>

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
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  lang: { position: 'absolute', top: 48, right: 20, zIndex: 5 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 20, paddingTop: 88, paddingBottom: 30 },

  hero: { alignItems: 'center', marginBottom: 20 },
  logo: { width: 84, height: 84, borderRadius: 22, marginBottom: 10 },
  brand: { fontSize: 24, fontWeight: '800', color: colors.text, letterSpacing: -0.5 },
  brandAi: { color: colors.primary },

  card: { backgroundColor: colors.card, borderRadius: 20, padding: 20, ...shadow },
  title: { fontSize: 19, fontWeight: '800', color: colors.text, marginBottom: 14 },
  label: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: 8 },
  gap: { marginTop: 18 },

  input: {
    backgroundColor: colors.bg, borderRadius: 14, borderWidth: 1, borderColor: colors.line,
    minHeight: 52, paddingHorizontal: 16, fontSize: 16, color: colors.text,
  },
  codeInput: { fontSize: 24, letterSpacing: 8, textAlign: 'center', fontWeight: '800', paddingVertical: 12 },
  hint: { fontSize: 12.5, color: colors.sub, marginTop: 6, lineHeight: 18 },

  errorText: { color: colors.red, fontSize: 13.5, marginTop: 14, lineHeight: 19 },

  btn: {
    backgroundColor: colors.primary, borderRadius: 14, minHeight: 54, justifyContent: 'center',
    alignItems: 'center', marginTop: 20, ...shadowStrong,
  },
  btnDisabled: { opacity: 0.45 },
  btnText: { color: '#fff', fontSize: 17, fontWeight: '700' },

  footer: { fontSize: 12, color: colors.faint, textAlign: 'center', marginTop: 14 },
});
