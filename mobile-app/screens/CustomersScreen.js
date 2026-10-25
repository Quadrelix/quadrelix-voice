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

  const totalCredit = customers.reduce((sum, c) => sum + (c.credit_outstanding || 0), 0);

  return (
    <View style={s.screen}>
      <View style={s.header}>
        <Text style={s.title}>Customers</Text>
        <Text style={s.subtitle}>{customers.length} customers · history from bills</Text>
      </View>

      {totalCredit > 0 && (
        <View style={s.creditBanner}>
          <View style={s.creditIcon}>
            <Ionicons name="wallet" size={20} color={colors.orange} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.creditValue}>{money(totalCredit)}</Text>
            <Text style={s.creditLabel}>Udaar baaki (abhi tak vasooli nahi)</Text>
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
          ListEmptyComponent={
            <Text style={s.emptyText}>
              Abhi koi customer nahi.{'\n'}Bill banao — phone number se customer apne aap yahan aa jayega.
            </Text>
          }
          renderItem={({ item }) => (
            <View style={s.card}>
              <View style={s.avatar}>
                <Text style={s.avatarText}>{String(item.phone).slice(-2)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.phone}>{formatPhone(item.phone)}</Text>
                <Text style={s.meta}>
                  {item.purchases} bill{item.purchases !== 1 ? 's' : ''} · last {formatDate(item.last_purchase)}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={s.spent}>{money(item.total_spent)}</Text>
                {item.credit_outstanding > 0 ? (
                  <Text style={s.credit}>{money(item.credit_outstanding)} udaar</Text>
                ) : (
                  <Text style={s.paid}>sab chuka</Text>
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
  subtitle: { fontSize: 12.5, color: colors.sub, marginTop: 3 },

  creditBanner: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.orangeSoft,
    borderRadius: 16, padding: 14, marginHorizontal: 20, marginBottom: 6,
  },
  creditIcon: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: '#fff',
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  creditValue: { fontSize: 20, fontWeight: '800', color: colors.orange },
  creditLabel: { fontSize: 11.5, color: '#92400E', marginTop: 1 },

  list: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24 },
  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card,
    borderRadius: 16, padding: 13, marginBottom: 10, ...shadow,
  },
  avatar: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: colors.purpleSoft,
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  avatarText: { color: colors.purple, fontSize: 14, fontWeight: '800' },
  phone: { fontSize: 14.5, fontWeight: '700', color: colors.text, letterSpacing: 0.5 },
  meta: { fontSize: 11.5, color: colors.sub, marginTop: 3 },
  spent: { fontSize: 14.5, fontWeight: '800', color: colors.text },
  credit: { fontSize: 11.5, color: colors.orange, fontWeight: '700', marginTop: 3 },
  paid: { fontSize: 11, color: colors.green, marginTop: 3, fontWeight: '600' },
  emptyText: { color: colors.faint, fontSize: 13, textAlign: 'center', marginTop: 48, lineHeight: 21 },
  errorText: { color: colors.red, fontSize: 12, textAlign: 'center', marginBottom: 12 },
});
