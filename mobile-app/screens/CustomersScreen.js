// CustomersScreen.js — who owes me money?
//
// The voice flow collects only a phone number, never a name, so the phone IS
// the customer for now. The two numbers that matter at a kirana counter are
// total spent (a good customer) and udaar outstanding (money to collect), so
// those lead; the list is newest-first because that's who the shopkeeper
// remembers.

import React, { useCallback, useState } from 'react';
import { errorMessage } from '../services/errorMessage';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { listCustomers } from '../services/api';
import { useI18n } from '../services/i18n';
import { colors, shadow, money } from '../theme';

function formatPhone(phone) {
  const digits = String(phone || '').replace(/^91(?=\d{10}$)/, '');
  return digits.replace(/(\d{5})(\d{5})/, '$1 $2');
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata',
  });
}

export default function CustomersScreen() {
  const { t } = useI18n();
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await listCustomers();
      setCustomers(data.customers || []);
    } catch (e) {
      setError(errorMessage(e, t('common.serverError')));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const totalCredit = customers.reduce((sum, c) => sum + (c.credit_outstanding || 0), 0);

  return (
    <View style={s.screen}>
      <View style={s.header}>
        <Text style={s.title}>{t('customers.title')}</Text>
        <Text style={s.subtitle}>{t('customers.count', { n: customers.length })}</Text>
      </View>

      {totalCredit > 0 && (
        <View style={s.creditBanner}>
          <View style={s.creditIcon}>
            <Ionicons name="wallet" size={20} color={colors.orange} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.creditValue}>{money(totalCredit)}</Text>
            <Text style={s.creditLabel}>{t('customers.creditTotal')}</Text>
          </View>
        </View>
      )}

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 48 }} />
      ) : (
        <FlatList
          data={customers}
          keyExtractor={(c) => c.phone}
          contentContainerStyle={s.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={<Text style={s.emptyText}>{t('customers.empty')}</Text>}
          renderItem={({ item }) => (
            <View style={s.card}>
              <View style={s.avatar}>
                <Text style={s.avatarText}>{String(item.phone).slice(-2)}</Text>
              </View>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={s.phone} numberOfLines={1}>{formatPhone(item.phone)}</Text>
                <Text style={s.meta} numberOfLines={1}>
                  {item.purchases === 1
                    ? t('customers.bill')
                    : t('customers.bills', { n: item.purchases })}
                  {' · '}
                  {t('customers.last', { date: formatDate(item.last_purchase) })}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={s.spent}>{money(item.total_spent)}</Text>
                {item.credit_outstanding > 0 ? (
                  <Text style={s.credit}>
                    {t('customers.credit', { amount: money(item.credit_outstanding) })}
                  </Text>
                ) : (
                  <Text style={s.paid}>{t('customers.paid')}</Text>
                )}
              </View>
            </View>
          )}
        />
      )}

      {!!error && <Text style={s.errorText}>{error}</Text>}
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 20, paddingTop: 60, paddingBottom: 12 },
  title: { fontSize: 26, fontWeight: '800', color: colors.text, letterSpacing: -0.4 },
  subtitle: { fontSize: 14, color: colors.sub, marginTop: 3 },

  creditBanner: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.orangeSoft,
    borderRadius: 16, padding: 14, marginHorizontal: 20, marginBottom: 6,
  },
  creditIcon: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  creditValue: { fontSize: 22, fontWeight: '800', color: colors.orange },
  creditLabel: { fontSize: 14, color: '#92400E', marginTop: 1 },

  list: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24 },
  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card,
    borderRadius: 16, padding: 13, marginBottom: 10, minHeight: 64, ...shadow,
  },
  avatar: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: colors.purpleSoft,
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  avatarText: { color: colors.purple, fontSize: 14, fontWeight: '800' },
  phone: { fontSize: 15, fontWeight: '700', color: colors.text, letterSpacing: 0.5 },
  meta: { fontSize: 13, color: colors.sub, marginTop: 3 },
  spent: { fontSize: 15, fontWeight: '800', color: colors.text },
  credit: { fontSize: 13, color: colors.orange, fontWeight: '700', marginTop: 3 },
  paid: { fontSize: 13, color: colors.green, marginTop: 3, fontWeight: '600' },
  emptyText: { color: colors.faint, fontSize: 14, textAlign: 'center', marginTop: 48, lineHeight: 22 },
  errorText: { color: colors.red, fontSize: 13, textAlign: 'center', marginBottom: 12 },
});
