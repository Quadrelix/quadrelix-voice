// ShopSelectScreen.js — the first screen a new phone sees.
//
// The founder creates a shop and sends its 6-character code over WhatsApp.
// The shopkeeper types it once; the code is validated against the backend
// before it is stored, so a typo shows a clear message instead of an app that
// silently bills into the wrong shop.

import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { lookupShopByCode } from '../services/api';
import { setActiveShop, normalizeShopCode } from '../services/shop';
import { errorMessage } from '../services/errorMessage';
import { colors, shadow, shadowStrong } from '../theme';

const CODE_LENGTH = 6;

export default function ShopSelectScreen({ onDone }) {
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
      await setActiveShop({
        shop_code: clean,
        shop_name: shop.shop_name,
        shop_id: shop.shop_id,
      });
      // Hand over the stored shape (with shop_code); chooseShop persists it
      // again, and the server's reply alone has no code to send with requests.
      onDone?.({ shop_code: clean, shop_name: shop.shop_name, shop_id: shop.shop_id });
    } catch (e) {
      const status = e?.response?.status;
      if (status === 404) {
        setError('Ye code nahi mila. Code dobara check karein.');
      } else {
        setError(errorMessage(e, 'Server se connect nahi hua'));
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
      <LinearGradient
        colors={['#EEF4FF', '#F8FBFF']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={s.hero}
      >
        <View style={s.logoBox}>
          <Ionicons name="storefront" size={28} color={colors.primary} />
        </View>
        <Text style={s.brand}>
          BizMate <Text style={s.brandAi}>AI</Text>
        </Text>
        <Text style={s.tagline}>Apni dukaan se jodein</Text>
      </LinearGradient>

      <View style={s.card}>
        <Text style={s.label}>Dukaan ka code</Text>
        <Text style={s.hint}>
          Dukaan ke code 6 characters ka hota hai. Jo code aapko mila hai,
          wahi yahan daalein.
        </Text>

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
          placeholder="ABC123"
          placeholderTextColor={colors.faint}
          editable={!busy}
          onSubmitEditing={connect}
          returnKeyType="go"
        />

        {!!error && (
          <View style={s.errorBox}>
            <Ionicons name="alert-circle" size={15} color={colors.red} />
            <Text style={s.errorText}>{error}</Text>
          </View>
        )}

        <TouchableOpacity
          style={[s.btn, (!ready || busy) && s.btnDisabled]}
          onPress={connect}
          disabled={!ready || busy}
          activeOpacity={0.85}
        >
          {busy
            ? <ActivityIndicator color="#fff" />
            : <Text style={s.btnText}>Dukaan kholo</Text>}
        </TouchableOpacity>

        <Text style={s.footer}>
          Code nahi hai? Dukaan chalane wale se sampark karein.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: 20 },

  hero: {
    borderRadius: 24, paddingVertical: 26, alignItems: 'center',
    borderWidth: 1, borderColor: '#E3ECFF', marginBottom: 16,
  },
  logoBox: {
    width: 60, height: 60, borderRadius: 18, backgroundColor: colors.card,
    alignItems: 'center', justifyContent: 'center', marginBottom: 12, ...shadow,
  },
  brand: { fontSize: 26, fontWeight: '800', color: colors.text, letterSpacing: -0.5 },
  brandAi: { color: colors.primary },
  tagline: { fontSize: 13, color: colors.sub, marginTop: 4 },

  card: { backgroundColor: colors.card, borderRadius: 20, padding: 20, ...shadow },
  label: { fontSize: 13, fontWeight: '800', color: colors.text },
  hint: { fontSize: 11.5, color: colors.sub, lineHeight: 17, marginTop: 5, marginBottom: 14 },

  input: {
    backgroundColor: colors.bg, borderRadius: 14, borderWidth: 1, borderColor: colors.line,
    paddingVertical: 14, paddingHorizontal: 16, fontSize: 26, letterSpacing: 8,
    textAlign: 'center', fontWeight: '800', color: colors.text,
  },

  errorBox: {
    flexDirection: 'row', alignItems: 'flex-start', backgroundColor: colors.redSoft,
    borderRadius: 10, padding: 10, marginTop: 12,
  },
  errorText: { color: colors.red, fontSize: 12, marginLeft: 7, flex: 1, lineHeight: 17 },

  btn: {
    backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 16,
    alignItems: 'center', marginTop: 16, ...shadowStrong,
  },
  btnDisabled: { opacity: 0.45 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  footer: { fontSize: 11, color: colors.faint, textAlign: 'center', marginTop: 14 },
});