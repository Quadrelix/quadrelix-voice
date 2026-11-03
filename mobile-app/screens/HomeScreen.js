// HomeScreen.js — the shop dashboard.
//
// One idea: start a sale with ONE tap (the big mic) and see how today is going
// without pressing anything. Everything here is either a shortcut into the
// voice flow or a read of /api/report/daily + /api/transactions — real numbers,
// never placeholders. Navigation to Products / Customers / Reports lives in the
// tab bar, so it is not repeated on this screen.
//
// It refreshes on focus, so returning from a voice sale updates the summary
// immediately.

import React, { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { errorMessage } from '../services/errorMessage';
import {
  getShop,
  dailyReport,
  recentTransactions,
  getVoiceStatus,
} from '../services/api';
import { useI18n } from '../services/i18n';
import LanguageToggle from '../components/LanguageToggle';
import { colors, shadow, shadowStrong, money } from '../theme';

export default function HomeScreen() {
  const navigation = useNavigation();
  const { t, lang } = useI18n();
  const [shop, setShop] = useState(null);
  const [report, setReport] = useState(null);
  const [recent, setRecent] = useState([]);
  const [voice, setVoice] = useState(null); // Voice Lock status (enrolled? mode?)
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async ({ silent } = {}) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [shopData, reportData, recentData] = await Promise.all([
        getShop(),
        dailyReport(),
        recentTransactions(5),
      ]);
      setShop(shopData.shop);
      setReport(reportData);
      setRecent(recentData.transactions || []);
      // Voice Lock lives on its own endpoint and must never make the whole
      // dashboard fail to load (the Python service may simply be off).
      getVoiceStatus()
        .then((v) => setVoice(v))
        .catch(() => setVoice(null));
    } catch (e) {
      setError(errorMessage(e, t('common.serverError')));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
    // t changes with the language; the load itself does not depend on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFocusEffect(
    useCallback(() => {
      load({ silent: true });
    }, [load])
  );

  const onRefresh = () => {
    setRefreshing(true);
    load({ silent: true });
  };

  const shopName = shop?.shop_name || t('home.defaultShop');


  const goSale = () => navigation.navigate('HandsFree');

  const logoTaps = useRef({ n: 0, last: 0 });
  const onLogoTap = () => {
    const now = Date.now();
    const taps = logoTaps.current;
    taps.n = now - taps.last < 1500 ? taps.n + 1 : 1; // taps must come quickly one after another
    taps.last = now;
    if (taps.n >= 5) {
      taps.n = 0;
      navigation.navigate('Calibrate');
    }
  };

  const lowStockCount = report?.low_stock?.length || 0;
  const initials = shopName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

  return (
    <View style={s.screen}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <View style={s.header}>
        <View style={s.brandRow}>
          {/* Five quick taps on the logo open the team's voice test (hidden from shopkeepers). */}
          <TouchableOpacity activeOpacity={1} onPress={onLogoTap}>
            <Image source={require('../assets/brand/logo.png')} style={s.logo} />
          </TouchableOpacity>
          <Text style={s.brand}>
            BizMate <Text style={s.brandAi}>AI</Text>
          </Text>
        </View>

        <View style={s.headerRight}>
          <LanguageToggle />
          <TouchableOpacity style={s.shopChip} onPress={() => navigation.navigate('ShopDetails')} activeOpacity={0.8}>
            <View style={s.shopAvatar}>
              <Text style={s.shopAvatarText}>{initials || 'S'}</Text>
            </View>
            <Text style={s.shopChipText} numberOfLines={1}>{shopName}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        {!!error && <Text style={s.errorText}>{error}</Text>}

        {/* ── Hero: the voice button ───────────────────────────────────── */}
        <LinearGradient
          colors={['#EEF4FF', '#F8FBFF']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={s.hero}
        >
          <Text style={s.heroTitle}>{t('home.heroTitle')}</Text>

          <TouchableOpacity onPress={goSale} activeOpacity={0.85} style={s.micWrap}>
            <View style={s.micRingOuter}>
              <View style={s.micRingInner}>
                <LinearGradient
                  colors={['#4A8DFF', '#2563EB']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={s.micBtn}
                >
                  <Ionicons name="mic" size={44} color="#fff" />
                </LinearGradient>
              </View>
            </View>
          </TouchableOpacity>

          <Text style={s.micLabel}>{t('home.micLabel')}</Text>
          <Text style={s.example}>{t('home.example')}</Text>
        </LinearGradient>

        {/* ── No UPI id yet: bills have no pay QR until the owner adds one ── */}
        {!!shop && !shop.upi_id && (
          <TouchableOpacity
            style={s.payCard}
            onPress={() => navigation.navigate('ShopDetails')}
            activeOpacity={0.85}
          >
            <View style={[s.voiceIcon, { backgroundColor: colors.orangeSoft }]}>
              <Ionicons name="qr-code-outline" size={22} color={colors.orange} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.voiceTitle}>{t('home.payMissingTitle')}</Text>
              <Text style={s.voiceSub} numberOfLines={2}>{t('home.payMissingSub')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.faint} />
          </TouchableOpacity>
        )}

        {/* ── Voice Lock ───────────────────────────────────────────────── */}
        {/* Only shown when the lock is in use or still needs setup. In the
            default "off" mode this card would just be noise on a dashboard
            the shopkeeper sees fifty times a day. */}
        {!!voice && (voice.mode !== 'off' || !voice.enrolled) && (
          <TouchableOpacity
            style={s.voiceCard}
            onPress={() => navigation.navigate('VoiceEnroll')}
            activeOpacity={0.85}
          >
            <View style={[
              s.voiceIcon,
              { backgroundColor: voice.enrolled ? colors.greenSoft : colors.orangeSoft },
            ]}>
              <Ionicons
                name={voice.enrolled ? 'shield-checkmark' : 'shield-outline'}
                size={22}
                color={voice.enrolled ? colors.green : colors.orange}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.voiceTitle}>
                {voice.enrolled ? t('home.voiceOn') : t('home.voiceSetup')}
              </Text>
              <Text style={s.voiceSub} numberOfLines={1}>
                {voice.enrolled
                  ? t('home.voiceOnSub', { n: voice.samples || 0 })
                  : t('home.voiceSetupSub')}
              </Text>
            </View>
            {!voice.service_up && voice.mode !== 'off' && (
              <Text style={s.voiceOffBadge}>{t('home.voiceOff')}</Text>
            )}
            <Ionicons name="chevron-forward" size={18} color={colors.faint} />
          </TouchableOpacity>
        )}

        {/* ── Today's summary ──────────────────────────────────────────── */}
        <View style={s.sectionHead}>
          <Text style={s.sectionTitle}>{t('home.todayTitle')}</Text>
        </View>

        {loading && !report ? (
          <ActivityIndicator color={colors.primary} style={{ marginVertical: 24 }} />
        ) : (
          <View style={s.summaryGrid}>
            <SummaryTile
              icon="cash" fg={colors.green} bg={colors.greenSoft}
              value={money(report?.total_sales)} label={t('home.totalSales')}
            />
            <SummaryTile
              icon="receipt" fg={colors.primary} bg={colors.primarySoft}
              value={String(report?.transactions ?? 0)} label={t('home.bills')}
            />
            <SummaryTile
              icon="trending-up" fg={colors.orange} bg={colors.orangeSoft}
              value={money(report?.total_profit)} label={t('home.profit')}
              onPress={() => navigation.navigate('Reports')}
            />
            <SummaryTile
              icon="cube" fg={colors.purple} bg={colors.purpleSoft}
              value={String(lowStockCount)} label={t('home.lowStock')}
              onPress={() => navigation.navigate('Products')}
            />
          </View>
        )}

        {/* ── Recent sales ─────────────────────────────────────────────── */}
        <View style={s.sectionHead}>
          <Text style={s.sectionTitle}>{t('home.recentTitle')}</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Reports')} style={s.viewMore} hitSlop={{ top: 10, bottom: 10, left: 10, right: 6 }}>
            <Text style={s.viewMoreText}>{t('home.seeAll')}</Text>
            <Ionicons name="arrow-forward" size={13} color={colors.primary} />
          </TouchableOpacity>
        </View>

        <View style={s.recentCard}>
          {recent.length === 0 ? (
            <Text style={s.emptyText}>{t('home.empty')}</Text>
          ) : (
            recent.map((txn, i) => (
              <SaleRow key={txn.transaction_id} txn={txn} last={i === recent.length - 1} t={t} />
            ))
          )}
        </View>

        <View style={{ height: 24 }} />
      </ScrollView>
    </View>
  );
}

function SummaryTile({ icon, fg, bg, value, label, onPress }) {
  const Wrap = onPress ? TouchableOpacity : View;
  return (
    <Wrap style={s.summaryTile} onPress={onPress} activeOpacity={0.8}>
      <View style={[s.summaryIcon, { backgroundColor: bg }]}>
        <Ionicons name={icon} size={20} color={fg} />
      </View>
      <Text style={s.summaryValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={s.summaryLabel} numberOfLines={1}>{label}</Text>
    </Wrap>
  );
}

// "2× Dettol Sabun, 1× Chini" -> a one-line summary that fits the row.
function itemSummary(txn, t) {
  const items = txn.items || [];
  if (items.length === 0) return '—';
  const parts = items.slice(0, 2).map((it) => `${it.quantity}× ${it.product_name}`);
  if (items.length > 2) parts.push(t('home.moreItems', { n: items.length - 2 }));
  return parts.join(', ');
}

// The shopkeeper recognises a repeating customer by the phone number, and the
// phone is all the voice flow collects — so that's what the row shows.
function SaleRow({ txn, last, t }) {
  const phone = txn.customer_phone || '';
  const shortPhone = phone ? phone.replace(/^91/, '').replace(/(\d{3})(\d{3})(\d{4})/, '$1 $2$3') : '';
  const initial = phone.slice(-1) || '?';
  const time = txn.created_at
    ? new Date(txn.created_at).toLocaleTimeString('en-IN', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Kolkata',
      })
    : '';
  return (
    <View style={[s.saleRow, !last && s.saleRowBorder]}>
      <View style={s.saleAvatar}>
        <Text style={s.saleAvatarText}>{initial}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.saleName} numberOfLines={1}>
          {shortPhone || t('home.customer')}
          {txn.payment_status === 'credit' ? `  ·  ${t('home.credit')}` : ''}
        </Text>
        <Text style={s.saleItems} numberOfLines={1}>{itemSummary(txn, t)}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={s.saleAmount}>{money(txn.total_amount)}</Text>
        <Text style={s.saleTime}>{time}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingTop: 52, paddingBottom: 10,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  logo: { width: 36, height: 36, borderRadius: 10, marginRight: 9 },
  brand: { fontSize: 19, fontWeight: '800', color: colors.text, letterSpacing: -0.3 },
  brandAi: { color: colors.primary },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  shopChip: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card,
    borderRadius: 20, paddingVertical: 4, paddingLeft: 4, paddingRight: 10, maxWidth: 120,
    borderWidth: 1, borderColor: colors.line,
  },
  shopAvatar: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center', marginRight: 6,
  },
  shopAvatarText: { color: colors.primary, fontSize: 11, fontWeight: '800' },
  shopChipText: { color: colors.text, fontSize: 12, fontWeight: '700', flexShrink: 1 },

  scroll: { paddingHorizontal: 18, paddingBottom: 20 },
  errorText: { color: colors.red, fontSize: 13, marginBottom: 10 },

  // Hero
  hero: {
    borderRadius: 24, paddingTop: 22, paddingBottom: 20, paddingHorizontal: 16,
    alignItems: 'center', marginTop: 4, borderWidth: 1, borderColor: '#E3ECFF',
  },
  heroTitle: { fontSize: 22, fontWeight: '800', color: colors.text, letterSpacing: -0.3, textAlign: 'center' },

  micWrap: { marginTop: 16, marginBottom: 10 },
  micRingOuter: {
    width: 176, height: 176, borderRadius: 88, backgroundColor: 'rgba(37,99,235,0.08)',
    alignItems: 'center', justifyContent: 'center',
  },
  micRingInner: {
    width: 136, height: 136, borderRadius: 68, backgroundColor: 'rgba(37,99,235,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  micBtn: {
    width: 100, height: 100, borderRadius: 50, alignItems: 'center', justifyContent: 'center',
    ...shadowStrong,
  },
  micLabel: { color: colors.text, fontSize: 15, fontWeight: '700' },
  example: { color: colors.sub, fontSize: 12.5, marginTop: 6, textAlign: 'center' },

  // Sections
  sectionTitle: { fontSize: 16, fontWeight: '800', color: colors.text },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 22, marginBottom: 10 },
  viewMore: { flexDirection: 'row', alignItems: 'center' },
  viewMoreText: { color: colors.primary, fontSize: 13, fontWeight: '700', marginRight: 3 },

  payCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card,
    borderRadius: 16, padding: 13, marginTop: 14, borderWidth: 1.5, borderColor: colors.orangeSoft, ...shadow,
  },
  voiceCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card,
    borderRadius: 16, padding: 13, marginTop: 14, ...shadow,
  },
  voiceIcon: {
    width: 42, height: 42, borderRadius: 12, alignItems: 'center',
    justifyContent: 'center', marginRight: 11,
  },
  voiceTitle: { fontSize: 14, fontWeight: '800', color: colors.text },
  voiceSub: { fontSize: 12, color: colors.sub, marginTop: 2 },
  voiceOffBadge: {
    fontSize: 11, fontWeight: '800', color: colors.orange, backgroundColor: colors.orangeSoft,
    borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3, marginRight: 6,
  },

  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  summaryTile: {
    width: '48.5%', flexGrow: 1, backgroundColor: colors.card, borderRadius: 16,
    padding: 14, ...shadow,
  },
  summaryIcon: {
    width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  summaryValue: { fontSize: 22, fontWeight: '800', color: colors.text, letterSpacing: -0.4 },
  summaryLabel: { fontSize: 12.5, color: colors.sub, marginTop: 2, fontWeight: '600' },

  recentCard: { backgroundColor: colors.card, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 4, ...shadow },
  saleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  saleRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.line },
  saleAvatar: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center', marginRight: 11,
  },
  saleAvatarText: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  saleName: { fontSize: 14, fontWeight: '700', color: colors.text },
  saleItems: { fontSize: 12, color: colors.sub, marginTop: 2 },
  saleAmount: { fontSize: 14, fontWeight: '800', color: colors.text },
  saleTime: { fontSize: 11, color: colors.faint, marginTop: 2 },
  emptyText: { color: colors.sub, fontSize: 13, textAlign: 'center', lineHeight: 20, paddingVertical: 22 },
});
