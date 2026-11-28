// AccountMenu.js — the one button on the right of the Home header.
//
// It replaces two controls that sat 8 px apart (the language pill and the shop
// chip), which were easy to mis-tap. The avatar opens a bottom sheet that holds
// everything account-level in one place: profile, language, shop details, UPI,
// Voice Lock and switch shop. Design: mobile-app/design.md, change 1.
//
// Built with React Native's own Modal + Animated, so it runs in Expo Go (no new
// native package).

import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '../services/i18n';
import { useShop } from '../services/ShopContext';
import LanguageToggle from './LanguageToggle';
import { colors, shadow } from '../theme';
import appConfig from '../app.json';

const APP_VERSION = appConfig?.expo?.version || '';
const SHEET_OFFSET = 600; // start position below the screen for the slide-up

function initialsOf(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || 'S';
}

// "9876543210" -> "98765 43210", the way people read a mobile number aloud.
function prettyPhone(p) {
  const d = String(p || '').replace(/\D/g, '');
  return d.length === 10 ? `${d.slice(0, 5)} ${d.slice(5)}` : d;
}

/**
 * Props:
 *   shop  — the shop from /api/shop (shop_name, upi_id, owner_phone), may be null while loading
 *   voice — the Voice Lock status from /api/voice-status, may be null
 */
export default function AccountMenu({ shop, voice }) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { t } = useI18n();
  const { shop: activeShop, switchShop } = useShop();
  const [open, setOpen] = useState(false);

  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(SHEET_OFFSET)).current;

  const shopName = shop?.shop_name || activeShop?.shop_name || t('home.defaultShop');
  const shopCode = activeShop?.shop_code;
  const phone = prettyPhone(shop?.owner_phone);

  // Same signals as the Home cards. The dot only counts Voice Lock when the
  // lock is actually in use: with mode "off" nobody needs to enrol, and a dot
  // that never goes away would teach people to ignore it.
  const upiMissing = !!shop && !shop.upi_id;
  const voiceInUse = !!voice && voice.mode !== 'off';
  const voiceNeedsSetup = voiceInUse && !voice.enrolled;
  const voiceOn = voiceInUse && !!voice.enrolled;
  const needsAttention = upiMissing || voiceNeedsSetup;

  useEffect(() => {
    if (!open) return;
    fade.setValue(0);
    slide.setValue(SHEET_OFFSET);
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 150, useNativeDriver: true }),
      Animated.timing(slide, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start();
  }, [open, fade, slide]);

  function close(after) {
    Animated.parallel([
      Animated.timing(fade, { toValue: 0, duration: 120, useNativeDriver: true }),
      Animated.timing(slide, { toValue: SHEET_OFFSET, duration: 180, useNativeDriver: true }),
    ]).start(() => {
      setOpen(false);
      if (typeof after === 'function') after();
    });
  }

  const go = (route) => close(() => navigation.navigate(route));

  function onSwitchShop() {
    close(() => {
      Alert.alert(t('home.switchTitle'), t('home.switchBody', { shop: shopName }), [
        { text: t('home.switchNo'), style: 'cancel' },
        { text: t('home.switchYes'), style: 'destructive', onPress: () => switchShop() },
      ]);
    });
  }

  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        activeOpacity={0.8}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel={t('menu.a11yLabel', { shop: shopName })}
      >
        <View style={s.avatar}>
          <Text style={s.avatarText}>{initialsOf(shopName)}</Text>
        </View>
        {needsAttention && <View style={s.dot} />}
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="none" onRequestClose={() => close()} statusBarTranslucent>
        <Animated.View style={[s.backdrop, { opacity: fade }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => close()}
            accessibilityRole="button"
            accessibilityLabel={t('menu.close')}
          />
        </Animated.View>

        <Animated.View
          style={[
            s.sheet,
            { paddingBottom: insets.bottom + 12, transform: [{ translateY: slide }] },
          ]}
        >
          <View style={s.handle} />

          {/* Profile */}
          <View style={s.profile}>
            <View style={[s.avatar, s.avatarLg]}>
              <Text style={[s.avatarText, s.avatarTextLg]}>{initialsOf(shopName)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.shopName} numberOfLines={1}>{shopName}</Text>
              <Text style={s.shopMeta} numberOfLines={1}>
                {[shopCode && t('menu.code', { code: shopCode }), phone].filter(Boolean).join('  ·  ')}
              </Text>
            </View>
          </View>

          <View style={s.divider} />

          {/* Language */}
          <View style={s.row}>
            <View style={s.iconTile}>
              <Ionicons name="language-outline" size={19} color={colors.primary} />
            </View>
            <Text style={s.rowLabel}>{t('menu.language')}</Text>
            <LanguageToggle size="lg" />
          </View>

          <View style={s.divider} />

          <MenuRow icon="storefront-outline" label={t('menu.shopDetails')} onPress={() => go('ShopDetails')} />
          <MenuRow
            icon="qr-code-outline"
            label={t('menu.upi')}
            tag={upiMissing ? { text: t('menu.upiAdd'), kind: 'warn' } : null}
            onPress={() => go('ShopDetails')}
          />
          <MenuRow
            icon="shield-checkmark-outline"
            label={t('menu.voiceLock')}
            tag={
              voiceNeedsSetup ? { text: t('menu.voiceSetup'), kind: 'warn' }
                : voiceOn ? { text: t('menu.voiceOn'), kind: 'ok' }
                  : null
            }
            onPress={() => go('VoiceEnroll')}
          />

          <View style={s.divider} />

          <TouchableOpacity style={s.row} onPress={onSwitchShop} activeOpacity={0.7} accessibilityRole="button">
            <View style={[s.iconTile, { backgroundColor: colors.redSoft }]}>
              <Ionicons name="swap-horizontal" size={19} color={colors.red} />
            </View>
            <Text style={[s.rowLabel, { color: colors.red }]}>{t('menu.switchShop')}</Text>
          </TouchableOpacity>

          {!!APP_VERSION && (
            <Text style={s.version}>BizMate AI · {t('menu.version', { v: APP_VERSION })}</Text>
          )}
        </Animated.View>
      </Modal>
    </>
  );
}

function MenuRow({ icon, label, tag, onPress }) {
  return (
    <TouchableOpacity style={s.row} onPress={onPress} activeOpacity={0.7} accessibilityRole="button">
      <View style={s.iconTile}>
        <Ionicons name={icon} size={19} color={colors.primary} />
      </View>
      <Text style={s.rowLabel} numberOfLines={1}>{label}</Text>
      {!!tag && (
        <View style={[s.tag, tag.kind === 'ok' ? s.tagOk : s.tagWarn]}>
          <View style={[s.tagDot, { backgroundColor: tag.kind === 'ok' ? colors.green : colors.orange }]} />
          <Text style={[s.tagText, { color: tag.kind === 'ok' ? colors.green : colors.orange }]}>{tag.text}</Text>
        </View>
      )}
      <Ionicons name="chevron-forward" size={18} color={colors.faint} />
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  // Header button
  avatar: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line,
  },
  avatarText: { color: colors.primary, fontSize: 15, fontWeight: '800' },
  dot: {
    position: 'absolute', top: -1, right: -1, width: 12, height: 12, borderRadius: 6,
    backgroundColor: colors.orange, borderWidth: 2, borderColor: colors.bg,
  },

  // Sheet
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.4)' },
  sheet: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 10, ...shadow,
  },
  handle: {
    alignSelf: 'center', width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.line, marginBottom: 14,
  },

  profile: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingBottom: 14 },
  avatarLg: { width: 52, height: 52, borderRadius: 26 },
  avatarTextLg: { fontSize: 19 },
  shopName: { fontSize: 18, fontWeight: '800', color: colors.text },
  shopMeta: { fontSize: 13, color: colors.sub, marginTop: 3 },

  divider: { height: 1, backgroundColor: colors.line, marginVertical: 6 },

  row: { flexDirection: 'row', alignItems: 'center', minHeight: 56, gap: 12 },
  iconTile: {
    width: 36, height: 36, borderRadius: 11, backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center',
  },
  rowLabel: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.text },

  tag: {
    flexDirection: 'row', alignItems: 'center', borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 3, marginRight: 4,
  },
  tagWarn: { backgroundColor: colors.orangeSoft },
  tagOk: { backgroundColor: colors.greenSoft },
  tagDot: { width: 6, height: 6, borderRadius: 3, marginRight: 5 },
  tagText: { fontSize: 12, fontWeight: '700' },

  version: { textAlign: 'center', fontSize: 11, color: colors.faint, marginTop: 10 },
});
