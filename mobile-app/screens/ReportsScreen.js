// ReportsScreen.js — "aaj kitna bikra, kitna profit?"
//
// The same numbers the old Products-screen report tab showed, promoted to its
// own tab and restyled: sales / cost / profit / bills / udaar, then best
// sellers and low stock. Pull down to refresh.

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
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { dailyReport } from '../services/api';
import { colors, shadow, money } from '../theme';

export default function ReportsScreen() {
  const navigation = useNavigation();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setReport(await dailyReport());
    } catch (e) {
      setError(errorMessage(e, 'Server se connect nahi hua'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata',
  });

  return (
    <View style={s.screen}>
      <View style={s.header}>
        <Text style={s.title}>Reports</Text>
        <Text style={s.subtitle}>{today}</Text>
      </View>

      {loading && !report ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 60 }} />
      ) : (
        <ScrollView
          contentContainerStyle={s.scroll}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={colors.primary}
            />
          }
        >
          {!!error && <Text style={s.errorText}>{error}</Text>}

          {/* Profit is the headline — it's the number the owner actually wants. */}
          <View style={s.heroCard}>
            <Text style={s.heroLabel}>Aaj ka profit</Text>
            <Text style={s.heroValue}>{money(report?.total_profit)}</Text>
            <Text style={s.heroSub}>
              {money(report?.total_sales)} sale − {money(report?.total_cost)} cost
            </Text>
          </View>

          <View style={s.grid}>
            <Cell
              icon="cash" fg={colors.green} bg={colors.greenSoft}
              value={money(report?.total_sales)} label="Total Sales"
            />
            <Cell
              icon="receipt" fg={colors.primary} bg={colors.primarySoft}
              value={String(report?.transactions ?? 0)} label="Bills"
            />
            <Cell
              icon="bag" fg={colors.orange} bg={colors.orangeSoft}
              value={money(report?.total_cost)} label="Total Cost"
            />
            <Cell
              icon="wallet" fg={colors.red} bg={colors.redSoft}
              value={money(report?.outstanding_credit)} label="Udaar Baaki"
            />
          </View>

          {!!report?.unknown_cost_items && (
            <View style={s.noteBox}>
              <Ionicons name="information-circle" size={16} color={colors.orange} />
              <Text style={s.noteText}>
                {report.unknown_cost_items} item{report.unknown_cost_items !== 1 ? 's' : ''} ka purchase
                price nahi hai — profit unka cost ginke nahi hai. Products me price daalo.
              </Text>
            </View>
          )}

          {!!report?.best_sellers?.length && (
            <View style={s.card}>
              <Text style={s.cardTitle}>Sabse zyada bika</Text>
              {report.best_sellers.map((p, i) => (
                <View key={i} style={[s.row, i < report.best_sellers.length - 1 && s.rowBorder]}>
                  <View style={s.rank}>
                    <Text style={s.rankText}>{i + 1}</Text>
                  </View>
                  <Text style={s.rowName} numberOfLines={1}>{p.name}</Text>
                  <Text style={s.rowMeta}>× {p.quantity}</Text>
                  <Text style={s.rowValue}>{money(p.revenue)}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={s.card}>
            <Text style={s.cardTitle}>Stock kam hai</Text>
            {report?.low_stock?.length ? (
              report.low_stock.map((p, i) => (
                <View key={i} style={[s.row, i < report.low_stock.length - 1 && s.rowBorder]}>
                  <Ionicons name="alert-circle" size={16} color={colors.orange} style={{ marginRight: 8 }} />
                  <Text style={s.rowName} numberOfLines={1}>{p.name}</Text>
                  <Text style={s.rowMeta}>{p.stock_qty} left</Text>
                </View>
              ))
            ) : (
              <Text style={s.allGood}>Sab stock theek hai 👍</Text>
            )}
            <TouchableOpacity style={s.linkBtn} onPress={() => navigation.navigate('Products')}>
              <Text style={s.linkBtnText}>Products kholo</Text>
              <Ionicons name="arrow-forward" size={14} color={colors.primary} />
            </TouchableOpacity>
          </View>

          <View style={{ height: 24 }} />
        </ScrollView>
      )}
    </View>
  );
}

function Cell({ icon, fg, bg, value, label }) {
  return (
    <View style={s.cell}>
      <View style={[s.cellIcon, { backgroundColor: bg }]}>
        <Ionicons name={icon} size={17} color={fg} />
      </View>
      <Text style={s.cellValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={s.cellLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 20, paddingTop: 60, paddingBottom: 12 },
  title: { fontSize: 26, fontWeight: '800', color: colors.text, letterSpacing: -0.4 },
  subtitle: { fontSize: 12.5, color: colors.sub, marginTop: 3 },
  scroll: { paddingHorizontal: 20, paddingBottom: 20 },
  errorText: { color: colors.red, fontSize: 12, marginBottom: 10 },

  heroCard: {
    backgroundColor: colors.primary, borderRadius: 22, padding: 20,
    alignItems: 'center', marginBottom: 12, ...shadow,
  },
  heroLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 12.5, fontWeight: '600' },
  heroValue: { color: '#fff', fontSize: 40, fontWeight: '800', letterSpacing: -1, marginTop: 4 },
  heroSub: { color: 'rgba(255,255,255,0.75)', fontSize: 12, marginTop: 6 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  cell: { width: '48.5%', flexGrow: 1, backgroundColor: colors.card, borderRadius: 16, padding: 13, ...shadow },
  cellIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 9 },
  cellValue: { fontSize: 18, fontWeight: '800', color: colors.text, letterSpacing: -0.3 },
  cellLabel: { fontSize: 11.5, color: colors.sub, marginTop: 2, fontWeight: '600' },

  noteBox: {
    flexDirection: 'row', backgroundColor: colors.orangeSoft, borderRadius: 12,
    padding: 12, marginTop: 12, alignItems: 'flex-start',
  },
  noteText: { color: '#92400E', fontSize: 11.5, lineHeight: 17, marginLeft: 8, flex: 1 },

  card: { backgroundColor: colors.card, borderRadius: 16, padding: 14, marginTop: 12, ...shadow },
  cardTitle: { fontSize: 14, fontWeight: '800', color: colors.text, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.line },
  rank: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center', marginRight: 9,
  },
  rankText: { color: colors.primary, fontSize: 10.5, fontWeight: '800' },
  rowName: { flex: 1, fontSize: 13.5, color: colors.text, fontWeight: '600' },
  rowMeta: { fontSize: 12, color: colors.sub, marginLeft: 8 },
  rowValue: { fontSize: 13, fontWeight: '700', color: colors.green, marginLeft: 10, minWidth: 62, textAlign: 'right' },
  allGood: { color: colors.green, fontSize: 12.5, paddingVertical: 8 },
  linkBtn: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  linkBtnText: { color: colors.primary, fontSize: 12.5, fontWeight: '700', marginRight: 4 },
});
