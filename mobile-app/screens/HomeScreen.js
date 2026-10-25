// HomeScreen.js — the shop dashboard ("BizMate AI" home).
//
// The mockup's idea in one line: the shopkeeper should be able to start a sale
// with ONE tap and should see how today is going without pressing anything.
// Everything on this screen is therefore either (a) a shortcut into the voice
// flow, or (b) a read of /api/report/daily + /api/transactions — real numbers,
// never placeholder ones.
//
// It refreshes on focus, so returning from a voice sale updates the summary
// immediately.

import React, { useCallback, useState } from 'react';
import { errorMessage } from '../services/errorMessage';
import {
  ActivityIndicator,
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
import {
  getShop,
  dailyReport,
  recentTransactions,
} from '../services/api';
import { colors, shadow, shadowStrong, money } from '../theme';

const QUICK_ACTIONS = [
  { key: 'sale', label: 'New Sale', sub: 'Add sale quickly', icon: 'cart', fg: colors.green, bg: colors.greenSoft },
  { key: 'products', label: 'Products', sub: 'View & manage', icon: 'cube', fg: colors.orange, bg: colors.orangeSoft },
  { key: 'customers', label: 'Customers', sub: 'Credit & history', icon: 'people', fg: colors.purple, bg: colors.purpleSoft },
  { key: 'reports', label: 'Reports', sub: 'Sales & profit', icon: 'bar-chart', fg: colors.pink, bg: colors.pinkSoft },
];

const EXAMPLES = [
  '"Ramesh bought 5 shirts for 2500"',
  '"Show today\'s sales"',
  '"Check stock of rice"',
];

export default function HomeScreen() {
  const navigation = useNavigation();
  const [shop, setShop] = useState(null);
  const [report, setReport] = useState(null);
  const [recent, setRecent] = useState([]);
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
    } catch (e) {
      setError(errorMessage(e, 'Server se connect nahi hua'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
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

  const goSale = () => navigation.navigate('HandsFree');
  const onQuick = (key) => {
    if (key === 'sale') return goSale();
    if (key === 'products') return navigation.navigate('Products');
    if (key === 'customers') return navigation.navigate('Customers');
    if (key === 'reports') return navigation.navigate('Reports');
  };

  const lowStockCount = report?.low_stock?.length || 0;
  const shopName = shop?.shop_name || 'My Shop';
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
          <View style={s.logoBox}>
            <Ionicons name="storefront" size={20} color={colors.primary} />
          </View>
          <View>
            <Text style={s.brand}>
              BizMate <Text style={s.brandAi}>AI</Text>
            </Text>
            <Text style={s.tagline}>Your Smart Business Assistant</Text>
          </View>
        </View>

        <View style={s.headerRight}>
          <TouchableOpacity style={s.bell} onPress={() => navigation.navigate('Products')}>
            <Ionicons name="notifications-outline" size={20} color={colors.text} />
            {lowStockCount > 0 && (
              <View style={s.badge}>
                <Text style={s.badgeText}>{lowStockCount}</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={s.shopChip} onPress={() => navigation.navigate('Products')}>
            <View style={s.shopAvatar}>
              <Text style={s.shopAvatarText}>{initials || 'S'}</Text>
            </View>
            <Text style={s.shopChipText} numberOfLines={1}>{shopName}</Text>
            <Ionicons name="chevron-down" size={14} color={colors.sub} />
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
          <Text style={s.heroTitle}>
            Just <Text style={s.heroTitleAccent}>Speak</Text>
          </Text>
          <Text style={s.heroSubtitle}>I'll handle the rest ✨</Text>
          <Text style={s.heroCaption}>
            Record sales, check stock, get reports{'\n'}— all with your voice.
          </Text>

          <TouchableOpacity onPress={goSale} activeOpacity={0.85} style={s.micWrap}>
            <View style={s.micRingOuter}>
              <View style={s.micRingInner}>
                <LinearGradient
                  colors={['#4A8DFF', '#2563EB']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={s.micBtn}
                >
                  <Ionicons name="mic" size={38} color="#fff" />
                </LinearGradient>
              </View>
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={s.tapPill} onPress={goSale}>
            <Text style={s.tapPillText}>Tap to speak</Text>
            <Ionicons name="arrow-forward" size={15} color={colors.primary} />
          </TouchableOpacity>

          <View style={s.examples}>
            {EXAMPLES.map((ex) => (
              <View key={ex} style={s.exampleChip}>
                <Text style={s.exampleText}>{ex}</Text>
              </View>
            ))}
          </View>
        </LinearGradient>

        {/* ── Quick access ─────────────────────────────────────────────── */}
        <Text style={s.sectionTitle}>Quick Access</Text>
        <View style={s.quickGrid}>
          {QUICK_ACTIONS.map((a) => (
            <TouchableOpacity key={a.key} style={s.quickCard} onPress={() => onQuick(a.key)}>
              <View style={[s.quickIcon, { backgroundColor: a.bg }]}>
                <Ionicons name={a.icon} size={22} color={a.fg} />
              </View>
              <Text style={s.quickLabel}>{a.label}</Text>
              <Text style={s.quickSub} numberOfLines={1}>{a.sub}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Today's summary ──────────────────────────────────────────── */}
        <View style={s.sectionHead}>
          <Text style={s.sectionTitle}>Today's Summary</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Reports')} style={s.viewMore}>
            <Text style={s.viewMoreText}>View more</Text>
            <Ionicons name="arrow-forward" size={13} color={colors.primary} />
          </TouchableOpacity>
        </View>

        {loading && !report ? (
          <ActivityIndicator color={colors.primary} style={{ marginVertical: 24 }} />
        ) : (
          <View style={s.summaryGrid}>
            <SummaryTile
              icon="cash" fg={colors.green} bg={colors.greenSoft}
              value={money(report?.total_sales)} label="Total Sales"
            />
            <SummaryTile
              icon="bag-handle" fg={colors.primary} bg={colors.primarySoft}
              value={String(report?.transactions ?? 0)} label="Transactions"
            />
            <SummaryTile
              icon="trending-up" fg={colors.orange} bg={colors.orangeSoft}
              value={money(report?.total_profit)} label="Total Profit"
            />
            <SummaryTile
              icon="cube" fg={colors.purple} bg={colors.purpleSoft}
              value={String(lowStockCount)} label="Low Stock Items"
              onPress={() => navigation.navigate('Products')}
            />
          </View>
        )}

        {/* ── Recent sales ─────────────────────────────────────────────── */}
        <View style={s.sectionHead}>
          <Text style={s.sectionTitle}>Recent Sales</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Reports')} style={s.viewMore}>
            <Text style={s.viewMoreText}>See all</Text>
            <Ionicons name="arrow-forward" size={13} color={colors.primary} />
          </TouchableOpacity>
        </View>

        <View style={s.recentCard}>
          {recent.length === 0 ? (
            <Text style={s.emptyText}>
              Abhi tak koi sale nahi.{'\n'}Mic dabao aur pehli bill banao.
            </Text>
          ) : (
            recent.map((t, i) => <SaleRow key={t.transaction_id} txn={t} last={i === recent.length - 1} />)
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
    <Wrap style={s.summaryTile} onPress={onPress}>
      <View style={[s.summaryIcon, { backgroundColor: bg }]}>
        <Ionicons name={icon} size={18} color={fg} />
      </View>
      <Text style={s.summaryValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={s.summaryLabel}>{label}</Text>
    </Wrap>
  );
}

// "2× Dettol Sabun, 1× Chini" -> a one-line summary that fits the row.
function itemSummary(txn) {
  const items = txn.items || [];
  if (items.length === 0) return '—';
  const parts = items.slice(0, 2).map((it) => `${it.quantity}× ${it.product_name}`);
  if (items.length > 2) parts.push(`+${items.length - 2} more`);
  return parts.join(', ');
}

// The shopkeeper recognises a repeating customer by the last 4 digits, and the
// phone is all the voice flow collects — so that's what the row shows.
function SaleRow({ txn, last }) {
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
          {shortPhone || 'Customer'}
          {txn.payment_status === 'credit' ? '  ·  Udaar' : ''}
        </Text>
        <Text style={s.saleItems} numberOfLines={1}>{itemSummary(txn)}</Text>
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
    paddingHorizontal: 18, paddingTop: 54, paddingBottom: 10,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  logoBox: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center', marginRight: 9,
  },
  brand: { fontSize: 19, fontWeight: '800', color: colors.text, letterSpacing: -0.3 },
  brandAi: { color: colors.primary },
  tagline: { fontSize: 10.5, color: colors.sub, marginTop: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  bell: { padding: 7, marginRight: 6 },
  badge: {
    position: 'absolute', top: 2, right: 2, minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: colors.red, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  badgeText: { color: '#fff', fontSize: 9.5, fontWeight: '800' },
  shopChip: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card,
    borderRadius: 20, paddingVertical: 5, paddingLeft: 5, paddingRight: 10, maxWidth: 170,
    borderWidth: 1, borderColor: colors.line,
  },
  shopAvatar: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center', marginRight: 7,
  },
  shopAvatarText: { color: colors.primary, fontSize: 11, fontWeight: '800' },
  shopChipText: { color: colors.text, fontSize: 12, fontWeight: '700', marginRight: 4, flexShrink: 1 },

  scroll: { paddingHorizontal: 18, paddingBottom: 20 },
  errorText: { color: colors.red, fontSize: 12, marginBottom: 10 },

  // Hero
  hero: {
    borderRadius: 24, paddingTop: 22, paddingBottom: 16, paddingHorizontal: 16,
    alignItems: 'center', marginTop: 4, borderWidth: 1, borderColor: '#E3ECFF',
  },
  heroTitle: { fontSize: 27, fontWeight: '800', color: colors.text, letterSpacing: -0.5 },
  heroTitleAccent: { color: colors.primary },
  heroSubtitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginTop: 2 },
  heroCaption: { fontSize: 12.5, color: colors.sub, textAlign: 'center', marginTop: 8, lineHeight: 18 },

  micWrap: { marginTop: 18, marginBottom: 12 },
  micRingOuter: {
    width: 168, height: 168, borderRadius: 84, backgroundColor: 'rgba(37,99,235,0.08)',
    alignItems: 'center', justifyContent: 'center',
  },
  micRingInner: {
    width: 128, height: 128, borderRadius: 64, backgroundColor: 'rgba(37,99,235,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  micBtn: {
    width: 92, height: 92, borderRadius: 46, alignItems: 'center', justifyContent: 'center',
    ...shadowStrong,
  },
  tapPill: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card,
    borderRadius: 20, paddingVertical: 8, paddingHorizontal: 16, ...shadow,
  },
  tapPillText: { color: colors.text, fontSize: 12.5, fontWeight: '700', marginRight: 6 },

  examples: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: 14, gap: 6 },
  exampleChip: {
    backgroundColor: 'rgba(255,255,255,0.75)', borderWidth: 1, borderColor: '#E3ECFF',
    borderRadius: 12, paddingVertical: 7, paddingHorizontal: 10, maxWidth: '48%',
  },
  exampleText: { color: colors.sub, fontSize: 10.5, fontWeight: '600' },

  // Sections
  sectionTitle: { fontSize: 16, fontWeight: '800', color: colors.text, marginTop: 20, marginBottom: 10 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20, marginBottom: 10 },
  viewMore: { flexDirection: 'row', alignItems: 'center' },
  viewMoreText: { color: colors.primary, fontSize: 12.5, fontWeight: '700', marginRight: 3 },

  quickGrid: { flexDirection: 'row', gap: 10 },
  quickCard: {
    flex: 1, backgroundColor: colors.card, borderRadius: 16, paddingVertical: 13,
    paddingHorizontal: 6, alignItems: 'center', ...shadow,
  },
  quickIcon: {
    width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginBottom: 8,
  },
  quickLabel: { fontSize: 12.5, fontWeight: '700', color: colors.text },
  quickSub: { fontSize: 9.5, color: colors.faint, marginTop: 2 },

  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  summaryTile: {
    width: '48.5%', flexGrow: 1, backgroundColor: colors.card, borderRadius: 16,
    padding: 13, ...shadow,
  },
  summaryIcon: {
    width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 10,
  },
  summaryValue: { fontSize: 20, fontWeight: '800', color: colors.text, letterSpacing: -0.4 },
  summaryLabel: { fontSize: 11.5, color: colors.sub, marginTop: 2, fontWeight: '600' },

  recentCard: { backgroundColor: colors.card, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 4, ...shadow },
  saleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  saleRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.line },
  saleAvatar: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center', marginRight: 11,
  },
  saleAvatarText: { color: colors.primary, fontSize: 14, fontWeight: '800' },
  saleName: { fontSize: 13.5, fontWeight: '700', color: colors.text },
  saleItems: { fontSize: 11.5, color: colors.sub, marginTop: 2 },
  saleAmount: { fontSize: 13.5, fontWeight: '800', color: colors.text },
  saleTime: { fontSize: 10.5, color: colors.faint, marginTop: 2 },
  emptyText: { color: colors.faint, fontSize: 12.5, textAlign: 'center', lineHeight: 19, paddingVertical: 22 },
});
