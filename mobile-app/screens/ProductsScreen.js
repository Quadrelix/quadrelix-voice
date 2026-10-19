// ProductsScreen.js — the owner's catalog.
//
// Add/edit the shop's products (name, brand, purchase price, selling price,
// stock, category, low-stock alert level). This is what makes voice sales skip
// the "Price?" step and what powers the profit report.
//
// The daily report used to live here as a second tab; it now has its own tab
// (ReportsScreen), so this screen is only about the catalog.

import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import {
  listProducts,
  createProduct,
  updateProduct,
  deleteProduct,
} from '../services/api';
import { colors, shadow, money } from '../theme';

const EMPTY_FORM = {
  name: '', brand: '', category: '',
  purchase_price: '', selling_price: '', stock_qty: '', min_stock_level: '',
};

export default function ProductsScreen() {
  const navigation = useNavigation();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const [products, setProducts] = useState([]);
  const [query, setQuery] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null); // null = create mode
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const data = await listProducts();
      setProducts(data.products || []);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Backend se connect nahi hua');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        String(p.name).toLowerCase().includes(q) ||
        String(p.brand || '').toLowerCase().includes(q) ||
        String(p.category || '').toLowerCase().includes(q)
    );
  }, [products, query]);

  const lowCount = products.filter(
    (p) => p.min_stock_level != null && (p.stock_qty || 0) <= p.min_stock_level
  ).length;

  function openForm(product) {
    setError(null);
    setEditingId(product?.product_id ?? null);
    setForm(
      product
        ? {
            name: product.name || '',
            brand: product.brand || '',
            category: product.category || '',
            purchase_price: String(product.purchase_price ?? ''),
            selling_price: String(product.selling_price ?? ''),
            stock_qty: String(product.stock_qty ?? ''),
            min_stock_level: String(product.min_stock_level ?? ''),
          }
        : EMPTY_FORM
    );
    setFormOpen(true);
  }

  async function save() {
    if (!form.name.trim() || form.selling_price === '') {
      setError('Naam aur selling price zaroori hai');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: form.name.trim(),
        brand: form.brand.trim() || null,
        category: form.category.trim() || null,
        purchase_price: form.purchase_price === '' ? null : Number(form.purchase_price),
        selling_price: Number(form.selling_price),
        stock_qty: form.stock_qty === '' ? 0 : Number(form.stock_qty),
        min_stock_level: form.min_stock_level === '' ? null : Number(form.min_stock_level),
      };
      if (editingId) await updateProduct(editingId, payload);
      else await createProduct(payload);
      setFormOpen(false);
      await reload();
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Save nahi hua');
    } finally {
      setSaving(false);
    }
  }

  async function remove(product) {
    try {
      await deleteProduct(product.product_id);
      await reload();
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Delete nahi hua');
    }
  }

  return (
    <View style={s.screen}>
      <View style={s.header}>
        <View>
          <Text style={s.title}>Products</Text>
          <Text style={s.subtitle}>
            {products.length} items{lowCount > 0 ? ` · ${lowCount} stock kam` : ''}
          </Text>
        </View>
        <TouchableOpacity style={s.reportBtn} onPress={() => navigation.navigate('Reports')}>
          <Ionicons name="bar-chart" size={15} color={colors.primary} />
          <Text style={s.reportBtnText}>Report</Text>
        </TouchableOpacity>
      </View>

      {/* Search — catalogs grow past a screenful quickly. */}
      <View style={s.searchBox}>
        <Ionicons name="search" size={17} color={colors.faint} />
        <TextInput
          style={s.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Naam, brand ya category se dhundo"
          placeholderTextColor={colors.faint}
        />
        {query ? (
          <TouchableOpacity onPress={() => setQuery('')}>
            <Ionicons name="close-circle" size={17} color={colors.faint} />
          </TouchableOpacity>
        ) : null}
      </View>

      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 48 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(p) => p.product_id}
          contentContainerStyle={s.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); reload(); }}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <Text style={s.emptyText}>
              {query
                ? 'Is naam se koi product nahi mila.'
                : 'Koi product nahi hai.\n"+ Add" se products daalo — phir\nprice bolna zaroori nahi padega.'}
            </Text>
          }
          renderItem={({ item }) => {
            const low = item.min_stock_level != null && (item.stock_qty || 0) <= item.min_stock_level;
            return (
              <View style={s.card}>
                <View style={[s.iconBox, low && s.iconBoxLow]}>
                  <Ionicons name="cube" size={20} color={low ? colors.orange : colors.primary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.name} numberOfLines={1}>
                    {item.name}
                    {item.brand ? <Text style={s.brand}> · {item.brand}</Text> : null}
                  </Text>
                  <Text style={s.meta}>
                    {money(item.purchase_price ?? 0)} → {money(item.selling_price)}
                    {'   '}
                    <Text style={low ? s.lowStock : null}>
                      stock {item.stock_qty ?? 0}{low ? ' (kam!)' : ''}
                    </Text>
                  </Text>
                </View>
                <TouchableOpacity style={s.iconBtn} onPress={() => openForm(item)}>
                  <Ionicons name="create-outline" size={18} color={colors.sub} />
                </TouchableOpacity>
                <TouchableOpacity style={s.iconBtn} onPress={() => remove(item)}>
                  <Ionicons name="trash-outline" size={18} color={colors.red} />
                </TouchableOpacity>
              </View>
            );
          }}
        />
      )}

      {!!error && <Text style={s.errorText}>{error}</Text>}

      <TouchableOpacity style={s.addBtn} onPress={() => openForm(null)} activeOpacity={0.85}>
        <Ionicons name="add" size={20} color="#fff" />
        <Text style={s.addBtnText}>Add Product</Text>
      </TouchableOpacity>

      {/* Add/edit modal */}
      <Modal visible={formOpen} transparent animationType="slide" onRequestClose={() => setFormOpen(false)}>
        <View style={s.modalWrap}>
          <View style={s.modalCard}>
            <View style={s.modalHandle} />
            <Text style={s.modalTitle}>{editingId ? 'Product Edit' : 'Naya Product'}</Text>

            <Text style={s.label}>Naam *</Text>
            <TextInput style={s.input} value={form.name}
              onChangeText={(v) => setForm({ ...form, name: v })}
              placeholder="jaise: Dettol Sabun" placeholderTextColor={colors.faint} />

            <View style={s.inputRow}>
              <View style={s.inputHalf}>
                <Text style={s.label}>Brand</Text>
                <TextInput style={s.input} value={form.brand}
                  onChangeText={(v) => setForm({ ...form, brand: v })}
                  placeholder="Dettol" placeholderTextColor={colors.faint} />
              </View>
              <View style={s.inputHalf}>
                <Text style={s.label}>Category</Text>
                <TextInput style={s.input} value={form.category}
                  onChangeText={(v) => setForm({ ...form, category: v })}
                  placeholder="Sabun" placeholderTextColor={colors.faint} />
              </View>
            </View>

            <View style={s.inputRow}>
              <View style={s.inputHalf}>
                <Text style={s.label}>Purchase ₹</Text>
                <TextInput style={s.input} value={form.purchase_price} keyboardType="numeric"
                  onChangeText={(v) => setForm({ ...form, purchase_price: v })}
                  placeholder="18" placeholderTextColor={colors.faint} />
              </View>
              <View style={s.inputHalf}>
                <Text style={s.label}>Selling ₹ *</Text>
                <TextInput style={s.input} value={form.selling_price} keyboardType="numeric"
                  onChangeText={(v) => setForm({ ...form, selling_price: v })}
                  placeholder="25" placeholderTextColor={colors.faint} />
              </View>
            </View>

            <View style={s.inputRow}>
              <View style={s.inputHalf}>
                <Text style={s.label}>Stock</Text>
                <TextInput style={s.input} value={form.stock_qty} keyboardType="numeric"
                  onChangeText={(v) => setForm({ ...form, stock_qty: v })}
                  placeholder="40" placeholderTextColor={colors.faint} />
              </View>
              <View style={s.inputHalf}>
                <Text style={s.label}>Min stock alert</Text>
                <TextInput style={s.input} value={form.min_stock_level} keyboardType="numeric"
                  onChangeText={(v) => setForm({ ...form, min_stock_level: v })}
                  placeholder="10" placeholderTextColor={colors.faint} />
              </View>
            </View>

            {error ? <Text style={s.errorText}>{error}</Text> : null}

            <View style={s.modalBtnRow}>
              <TouchableOpacity style={s.modalCancel} onPress={() => setFormOpen(false)}>
                <Text style={s.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.modalSave, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
                <Text style={s.modalSaveText}>{saving ? 'Saving...' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 60, paddingBottom: 12,
  },
  title: { fontSize: 26, fontWeight: '800', color: colors.text, letterSpacing: -0.4 },
  subtitle: { fontSize: 12.5, color: colors.sub, marginTop: 3 },
  reportBtn: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.primarySoft,
    borderRadius: 20, paddingVertical: 8, paddingHorizontal: 13,
  },
  reportBtnText: { color: colors.primary, fontSize: 12.5, fontWeight: '700', marginLeft: 5 },

  searchBox: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card,
    borderRadius: 14, marginHorizontal: 20, paddingHorizontal: 12, height: 44,
    borderWidth: 1, borderColor: colors.line,
  },
  searchInput: { flex: 1, marginLeft: 8, fontSize: 13.5, color: colors.text },

  list: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 90 },
  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card,
    borderRadius: 16, padding: 12, marginBottom: 10, ...shadow,
  },
  iconBox: {
    width: 42, height: 42, borderRadius: 12, backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  iconBoxLow: { backgroundColor: colors.orangeSoft },
  name: { fontSize: 14.5, fontWeight: '700', color: colors.text },
  brand: { color: colors.sub, fontWeight: '400', fontSize: 13 },
  meta: { fontSize: 11.5, color: colors.sub, marginTop: 3 },
  lowStock: { color: colors.orange, fontWeight: '700' },
  iconBtn: { padding: 8, marginLeft: 2 },

  errorText: { color: colors.red, fontSize: 12, marginHorizontal: 20, marginBottom: 6 },
  emptyText: { color: colors.faint, textAlign: 'center', marginTop: 48, fontSize: 13, lineHeight: 22 },

  addBtn: {
    position: 'absolute', left: 20, right: 20, bottom: 16,
    flexDirection: 'row', backgroundColor: colors.primary, borderRadius: 16,
    paddingVertical: 15, alignItems: 'center', justifyContent: 'center', ...shadow,
  },
  addBtnText: { color: '#fff', fontSize: 15.5, fontWeight: '700', marginLeft: 6 },

  modalWrap: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, paddingTop: 10, paddingBottom: 30,
  },
  modalHandle: {
    alignSelf: 'center', width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.line, marginBottom: 14,
  },
  modalTitle: { color: colors.text, fontSize: 19, fontWeight: '800', marginBottom: 4 },
  label: { color: colors.sub, fontSize: 11.5, marginBottom: 5, marginTop: 10, fontWeight: '600' },
  input: {
    backgroundColor: colors.bg, borderRadius: 12, color: colors.text, fontSize: 15,
    paddingVertical: 11, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.line,
  },
  inputRow: { flexDirection: 'row', gap: 12 },
  inputHalf: { flex: 1 },
  modalBtnRow: { flexDirection: 'row', gap: 12, marginTop: 20 },
  modalCancel: {
    flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 14,
    paddingVertical: 14, alignItems: 'center',
  },
  modalCancelText: { color: colors.sub, fontSize: 15, fontWeight: '600' },
  modalSave: { flex: 1, backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  modalSaveText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
