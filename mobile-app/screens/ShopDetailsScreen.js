// ShopDetailsScreen.js — the owner's own shop details.
//
// The founder creates a shop with just a name and a code. The owner then logs in
// with the code and enters where THEY want to be paid (UPI id) and the phone to
// print on the bill. Nobody else ever has to collect or see those details. This
// screen is also where an owner switches to a different shop.

import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { getShop, updateShopDetails } from '../services/api';
import { useShop } from '../services/ShopContext';
import { errorMessage } from '../services/errorMessage';
import { useI18n } from '../services/i18n';
import { colors, shadow, shadowStrong } from '../theme';

export default function ShopDetailsScreen() {
  const navigation = useNavigation();
  const { t } = useI18n();
  const { switchShop } = useShop();

  const [shopName, setShopName] = useState('');
  const [savedUpi, setSavedUpi] = useState('');
  const [upi, setUpi] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const doneTimer = useRef(null);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      getShop()
        .then(({ shop }) => {
          if (!alive) return;
          setShopName(shop.shop_name || '');
          setSavedUpi(shop.upi_id || '');
          setUpi(shop.upi_id || '');
          setPhone(shop.owner_phone || '');
        })
        .catch((e) => alive && setError(errorMessage(e, t('common.serverError'))))
        .finally(() => alive && setLoading(false));
      return () => {
        alive = false;
        if (doneTimer.current) clearTimeout(doneTimer.current);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  function explain(e) {
    const code = e?.response?.data?.code;
    if (code === 'bad_upi') return t('shopDetails.badUpi');
    if (code === 'bad_phone') return t('shopDetails.badPhone');
    if (e?.response?.status === 429) return t('shopDetails.tooMany');
    return errorMessage(e, t('common.serverError'));
  }

  async function doSave() {
    setSaving(true);
    setError(null);
    setDone(false);
    try {
      const shop = await updateShopDetails({ upi_id: upi.trim(), owner_phone: phone.trim() });
      setSavedUpi(shop.upi_id || '');
      setUpi(shop.upi_id || '');
      setPhone(shop.owner_phone || '');
      setDone(true);
      doneTimer.current = setTimeout(() => setDone(false), 2500);
    } catch (e) {
      setError(explain(e));
    } finally {
      setSaving(false);
    }
  }

  // The UPI id decides where customers' money goes, so changing an existing one
  // asks first. Entering one for the first time does not.
  function onSave() {
    const next = upi.trim();
    if (savedUpi && next !== savedUpi) {
      Alert.alert(t('shopDetails.changeUpiTitle'), t('shopDetails.changeUpiBody'), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('shopDetails.changeUpiYes'), style: 'destructive', onPress: doSave },
      ]);
      return;
    }
    doSave();
  }

  function onSwitchShop() {
    Alert.alert(t('home.switchTitle'), t('home.switchBody', { shop: shopName }), [
      { text: t('home.switchNo'), style: 'cancel' },
      { text: t('home.switchYes'), style: 'destructive', onPress: () => switchShop() },
    ]);
  }

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.topRow}>
        <TouchableOpacity style={s.back} onPress={() => navigation.goBack()} accessibilityLabel={t('common.back')}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={s.title}>{t('shopDetails.title')}</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
          <View style={s.nameCard}>
            <Text style={s.nameLabel}>{t('shopDetails.shopName')}</Text>
            <Text style={s.name} numberOfLines={2}>{shopName}</Text>
          </View>

          <Text style={s.sectionTitle}>{t('shopDetails.payment')}</Text>
          <View style={s.card}>
            <Text style={s.label}>{t('shopDetails.upi')}</Text>
            <TextInput
              style={s.input}
              value={upi}
              onChangeText={(v) => { setUpi(v); setError(null); setDone(false); }}
              placeholder={t('shopDetails.upiPlaceholder')}
              placeholderTextColor={colors.faint}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              editable={!saving}
            />
            <Text style={s.hint}>{t('shopDetails.upiHint')}</Text>

            <Text style={[s.label, { marginTop: 18 }]}>{t('shopDetails.phone')}</Text>
            <TextInput
              style={s.input}
              value={phone}
              onChangeText={(v) => { setPhone(v); setError(null); setDone(false); }}
              placeholder={t('shopDetails.phonePlaceholder')}
              placeholderTextColor={colors.faint}
              keyboardType="phone-pad"
              maxLength={14}
              editable={!saving}
            />

            {!!error && <Text style={s.error}>{error}</Text>}
            {done && <Text style={s.ok}>✓ {t('shopDetails.saved')}</Text>}

            <TouchableOpacity
              style={[s.saveBtn, saving && { opacity: 0.6 }]}
              onPress={onSave}
              disabled={saving}
              activeOpacity={0.85}
            >
              {saving
                ? <ActivityIndicator color="#fff" />
                : <Text style={s.saveText}>{t('shopDetails.save')}</Text>}
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={s.switchBtn} onPress={onSwitchShop} activeOpacity={0.8}>
            <Ionicons name="swap-horizontal" size={18} color={colors.red} />
            <Text style={s.switchText}>{t('shopDetails.switchShop')}</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingTop: 52 },
  topRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '800', color: colors.text, marginLeft: 4 },
  scroll: { padding: 20, paddingBottom: 40 },

  nameCard: { backgroundColor: colors.card, borderRadius: 16, padding: 16, ...shadow },
  nameLabel: { fontSize: 12.5, color: colors.sub, fontWeight: '600' },
  name: { fontSize: 20, fontWeight: '800', color: colors.text, marginTop: 4 },

  sectionTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginTop: 22, marginBottom: 10 },
  card: { backgroundColor: colors.card, borderRadius: 16, padding: 16, ...shadow },
  label: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: 8 },
  input: {
    backgroundColor: colors.bg, borderRadius: 12, borderWidth: 1, borderColor: colors.line,
    minHeight: 50, paddingHorizontal: 14, fontSize: 16, color: colors.text,
  },
  hint: { fontSize: 12.5, color: colors.sub, marginTop: 6 },
  error: { color: colors.red, fontSize: 13.5, marginTop: 14, lineHeight: 19 },
  ok: { color: colors.green, fontSize: 14, fontWeight: '700', marginTop: 14 },

  saveBtn: {
    backgroundColor: colors.primary, borderRadius: 14, minHeight: 52, alignItems: 'center',
    justifyContent: 'center', marginTop: 18, ...shadowStrong,
  },
  saveText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  switchBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    minHeight: 48, marginTop: 28, borderRadius: 14, borderWidth: 1.5, borderColor: colors.redSoft,
    backgroundColor: colors.card,
  },
  switchText: { color: colors.red, fontSize: 15, fontWeight: '700' },
});
