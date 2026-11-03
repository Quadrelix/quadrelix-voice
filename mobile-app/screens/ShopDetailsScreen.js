// ShopDetailsScreen.js — the owner's own shop details.
//
// The founder creates a shop with just a code. The owner then decides what their
// bills say: the shop name and mobile number printed at the top, a 1-2 line thank-you
// note at the bottom, and where customers pay (the UPI id behind the pay QR). Nobody
// else ever has to collect or see those details. This screen is also where an owner
// switches to a different shop.

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
import { setActiveShop, getActiveShop } from '../services/shop';
import { useShop } from '../services/ShopContext';
import { errorMessage } from '../services/errorMessage';
import { useI18n } from '../services/i18n';
import { colors, shadow, shadowStrong } from '../theme';

const NOTE_LINE_MAX = 80;

export default function ShopDetailsScreen() {
  const navigation = useNavigation();
  const { t } = useI18n();
  const { switchShop } = useShop();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [note, setNote] = useState('');
  const [savedUpi, setSavedUpi] = useState('');
  const [upi, setUpi] = useState('');
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
          setName(shop.shop_name || '');
          setPhone(shop.owner_phone || '');
          setNote(shop.bill_footer || '');
          setSavedUpi(shop.upi_id || '');
          setUpi(shop.upi_id || '');
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

  function edit(setter) {
    return (v) => {
      setter(v);
      setError(null);
      setDone(false);
    };
  }

  function explain(e) {
    const code = e?.response?.data?.code;
    if (code === 'bad_name') return t('shopDetails.badName');
    if (code === 'bad_upi') return t('shopDetails.badUpi');
    if (code === 'bad_phone') return t('shopDetails.badPhone');
    if (code === 'bad_footer') return t('shopDetails.badNote');
    if (e?.response?.status === 429) return t('shopDetails.tooMany');
    return errorMessage(e, t('common.serverError'));
  }

  // The note under the bill is at most 2 lines; checked here so the owner sees why,
  // before the server would refuse it.
  function noteProblem() {
    const lines = note.split('\n').map((l) => l.trim()).filter(Boolean);
    return lines.length > 2 || lines.some((l) => [...l].length > NOTE_LINE_MAX);
  }

  async function doSave() {
    setSaving(true);
    setError(null);
    setDone(false);
    try {
      const shop = await updateShopDetails({
        shop_name: name.trim(),
        owner_phone: phone.trim(),
        upi_id: upi.trim(),
        bill_footer: note,
      });
      setName(shop.shop_name || '');
      setPhone(shop.owner_phone || '');
      setNote(shop.bill_footer || '');
      setSavedUpi(shop.upi_id || '');
      setUpi(shop.upi_id || '');

      // Keep the name shown elsewhere in the app (Home header) in step with the server.
      const active = await getActiveShop();
      if (active && shop.shop_name && active.shop_name !== shop.shop_name) {
        await setActiveShop({ ...active, shop_name: shop.shop_name });
      }

      setDone(true);
      doneTimer.current = setTimeout(() => setDone(false), 3500);
    } catch (e) {
      setError(explain(e));
    } finally {
      setSaving(false);
    }
  }

  // The UPI id decides where customers' money goes, so changing an existing one
  // asks first. Entering one for the first time does not.
  function onSave() {
    if (name.trim().length < 2) { setError(t('shopDetails.badName')); return; }
    if (noteProblem()) { setError(t('shopDetails.badNote')); return; }
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
    Alert.alert(t('home.switchTitle'), t('home.switchBody', { shop: name }), [
      { text: t('home.switchNo'), style: 'cancel' },
      { text: t('home.switchYes'), style: 'destructive', onPress: () => switchShop() },
    ]);
  }

  const noteLines = note.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 2);

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
          <Text style={s.sectionTitle}>{t('shopDetails.billSection')}</Text>
          <View style={s.card}>
            <Text style={s.label}>{t('shopDetails.name')}</Text>
            <TextInput
              style={s.input}
              value={name}
              onChangeText={edit(setName)}
              maxLength={60}
              editable={!saving}
            />

            <Text style={[s.label, s.gap]}>{t('shopDetails.phone')}</Text>
            <TextInput
              style={s.input}
              value={phone}
              onChangeText={edit(setPhone)}
              placeholder={t('shopDetails.phonePlaceholder')}
              placeholderTextColor={colors.faint}
              keyboardType="phone-pad"
              maxLength={14}
              editable={!saving}
            />

            <Text style={[s.label, s.gap]}>{t('shopDetails.note')}</Text>
            <TextInput
              style={[s.input, s.noteInput]}
              value={note}
              onChangeText={edit(setNote)}
              placeholder={t('shopDetails.notePlaceholder')}
              placeholderTextColor={colors.faint}
              multiline
              maxLength={170}
              textAlignVertical="top"
              editable={!saving}
            />
            <Text style={s.hint}>{t('shopDetails.noteHint')}</Text>

            <Text style={[s.label, s.gap]}>{t('shopDetails.preview')}</Text>
            <View style={s.preview}>
              <Text style={s.previewName} numberOfLines={2}>{name.trim() || '—'}</Text>
              {!!phone.trim() && (
                <Text style={s.previewContact}>{t('shopDetails.contact')}: {phone.trim()}</Text>
              )}
              <View style={s.previewRule} />
              {noteLines.length > 0
                ? noteLines.map((l, i) => <Text key={i} style={s.previewNote}>{l}</Text>)
                : <Text style={s.previewNoteEmpty}>—</Text>}
            </View>
          </View>

          <Text style={s.sectionTitle}>{t('shopDetails.payment')}</Text>
          <View style={s.card}>
            <Text style={s.label}>{t('shopDetails.upi')}</Text>
            <TextInput
              style={s.input}
              value={upi}
              onChangeText={edit(setUpi)}
              placeholder={t('shopDetails.upiPlaceholder')}
              placeholderTextColor={colors.faint}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              editable={!saving}
            />
            <Text style={s.hint}>{t('shopDetails.upiHint')}</Text>
          </View>

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
  scroll: { padding: 20, paddingBottom: 50 },

  sectionTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginTop: 6, marginBottom: 10 },
  card: { backgroundColor: colors.card, borderRadius: 16, padding: 16, marginBottom: 14, ...shadow },
  label: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: 8 },
  gap: { marginTop: 18 },
  input: {
    backgroundColor: colors.bg, borderRadius: 12, borderWidth: 1, borderColor: colors.line,
    minHeight: 50, paddingHorizontal: 14, fontSize: 16, color: colors.text,
  },
  noteInput: { minHeight: 76, paddingTop: 12, paddingBottom: 12 },
  hint: { fontSize: 12.5, color: colors.sub, marginTop: 6 },

  preview: {
    borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff',
    padding: 14,
  },
  previewName: { fontSize: 18, fontWeight: '800', color: '#000' },
  previewContact: { fontSize: 12.5, color: '#555', marginTop: 2 },
  previewRule: { height: 1, backgroundColor: '#ddd', marginVertical: 12 },
  previewNote: { fontSize: 14, color: '#222', textAlign: 'center', lineHeight: 21 },
  previewNoteEmpty: { fontSize: 14, color: colors.faint, textAlign: 'center' },

  error: { color: colors.red, fontSize: 13.5, marginTop: 4, lineHeight: 19 },
  ok: { color: colors.green, fontSize: 14, fontWeight: '700', marginTop: 4 },

  saveBtn: {
    backgroundColor: colors.primary, borderRadius: 14, minHeight: 54, alignItems: 'center',
    justifyContent: 'center', marginTop: 16, ...shadowStrong,
  },
  saveText: { color: '#fff', fontSize: 17, fontWeight: '700' },

  switchBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    minHeight: 48, marginTop: 26, borderRadius: 14, borderWidth: 1.5, borderColor: colors.redSoft,
    backgroundColor: colors.card,
  },
  switchText: { color: colors.red, fontSize: 15, fontWeight: '700' },
});
