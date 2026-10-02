// ProductsScreen.js — the owner's catalog + the evening numbers.
//
// Two tabs, one screen:
//  • PRODUCTS: add/edit the shop's products (name, brand, purchase price,
//    selling price, stock, category, low-stock alert level). This is what
//    makes voice sales skip the "Price?" step and what powers profit.
//  • REPORT: "aaj kitna bikra, kitna profit?" — today's sales, cost, profit,
//    best sellers, outstanding udaar and low stock, straight off /api/report/daily.

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import {
  listProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  dailyReport,
} from '../services/api';

const EMPTY_FORM = {
  name: '', brand: '', category: '',
  purchase_price: '', selling_price: '', stock_qty: '', min_stock_level: '',
};

export default function ProductsScreen() {
  const navigation = useNavigation();
  const [tab, setTab] = useState('products');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Products tab state
  const [products, setProducts] = useState([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null); // null = create mode
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Report tab state
  const [report, setReport] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listProducts();
      setProducts(data.products || []);
      const r = await dailyReport();
      setReport(r);
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Backend se connect nahi hua');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

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

  const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

  // ── Report tab ───────────────────────────────────────────────────────────
  if (tab === 'report') {
    return (
      <View style={st.container}>
        <View style={st.topRow}>
          <TouchableOpacity style={st.backBtn} onPress={() => setTab('products')}>
          <Text style={st.backBtnText}>← Products</Text>
        </TouchableOpacity>
          <Text style={st.title}>Aaj ka Report</Text>
        </View>

        {loading && <ActivityIndicator size="large" color="#2980b9" style={{ marginTop: 40 }} />}
        {error && <Text style={st.errorText}>{error}</Text>}

        {report && (
          <FlatList
            data={null}
            ListEmptyComponent={
              <View>
                <View style={st.reportRow}>
                  <Text style={st.bigMoney}>{money(report.total_sales)}</Text>
                  <Text style={st.bigMoneyLabel}>aaj ki sale</Text>
                </View>

                <View style={st.reportGrid}>
                  <View style={st.reportCell}>
                    <Text style={st.cellValue}>{money(report.total_cost)}</Text>
                    <Text style={st.cellLabel}>total cost</Text>
                  </View>
                  <View style={st.reportCellGreen}>
                    <Text style={st.cellValueGreen}>{money(report.total_profit)}</Text>
                    <Text style={st.cellLabel}>profit</Text>
                  </View>
                </View>
                <View style={st.reportGrid}>
                  <View style={st.reportCell}>
                    <Text style={st.cellValue}>{report.transactions}</Text>
                    <Text style={st.cellLabel}>bills</Text>
                  </View>
                  <View style={[st.reportCell, report.outstanding_credit > 0 && st.reportCellOrange]}>
                    <Text style={[st.cellValue, report.outstanding_credit > 0 && st.cellValueOrange]}>
                      {money(report.outstanding_credit)}
                    </Text>
                    <Text style={st.cellLabel}>udaar baaki</Text>
                  </View>
                </View>

                {!!report.unknown_cost_items && (
                  <Text style={st.reportNote}>
                    ⚠ {report.unknown_cost_items} items ka purchase price nahi hai (catalog mein add karo) —
                    profit unka cost ginke nahi hai.
                  </Text>
                )}

                {!!report.best_sellers?.length && (
                  <View style={st.section}>
                    <Text style={st.sectionTitle}>Aaj sabse zyada bika</Text>
                    {report.best_sellers.map((p, i) => (
                      <View key={i} style={st.bestRow}>
                        <Text style={st.bestName}>{p.name}</Text>
                        <Text style={st.bestQty}>× {p.quantity} · {money(p.revenue)}</Text>
                      </View>
                    ))}
                  </View>
                )}

                {!!report.low_stock?.length && (
                  <View style={st.section}>
                    <Text style={st.sectionTitleOrange}>Stock kam hai</Text>
                    {report.low_stock.map((p, i) => (
                      <View key={i} style={st.bestRow}>
                        <Text style={st.bestName}>{p.name}</Text>
                        <Text style={st.bestQty}>{p.stock_qty} bacha (min {p.min_stock_level})</Text>
                      </View>
                    ))}
                  </View>
                )}

                <TouchableOpacity style={st.refreshBtn} onPress={reload}>
                  <Text style={st.refreshBtnText}>Refresh</Text>
                </TouchableOpacity>
              </View>
            }
          />
        )}
      </View>
    );
  }

  // ── Products tab ─────────────────────────────────────────────────────────
  return (
    <View style={st.container}>
      <View style={st.topRow}>
        <TouchableOpacity style={st.backBtn} onPress={() => navigation.goBack()}>
          <Text style={st.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <Text style={st.title}>Products</Text>
        <TouchableOpacity style={st.tabBtn} onPress={() => setTab('report')}>
          <Text style={st.tabBtnText}>Aaj ka Report →</Text>
        </TouchableOpacity>
      </View>

      {loading && <ActivityIndicator size="large" color="#2980b9" style={{ marginTop: 40 }} />}
      {error && <Text style={st.errorText}>{error}</Text>}

      {!loading && (
        <FlatList
          data={products}
          keyExtractor={(p) => p.product_id}
          style={st.list}
          ListEmptyComponent={
            <Text style={st.emptyText}>
              Koi product nahi hai.{'\n'}"+ Add" se products daalo — phir{'\n'}price bolna zaroori nahi padega.
            </Text>
          }
          renderItem={({ item }) => {
            const low = item.min_stock_level != null && (item.stock_qty || 0) <= item.min_stock_level;
            return (
              <View style={st.itemRow}>
                <View style={st.itemLeft}>
                  <Text style={st.itemName}>
                    {item.name}
                    {item.brand ? <Text style={st.itemBrand}> · {item.brand}</Text> : null}
                  </Text>
                  <Text style={st.itemSub}>
                    {money(item.purchase_price ?? 0)} → {money(item.selling_price)} · stock:{' '}
                    <Text style={low && st.lowStock}>{item.stock_qty ?? 0}{low ? ' (kam!)' : ''}</Text>
                  </Text>
                </View>
                <TouchableOpacity style={st.miniBtn} onPress={() => openForm(item)}>
                  <Text style={st.miniBtnText}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[st.miniBtn, st.miniBtnDanger]} onPress={() => remove(item)}>
                  <Text style={[st.miniBtnText, st.miniBtnDangerText]}>✕</Text>
                </TouchableOpacity>
              </View>
            );
          }}
        />
      )}

      <TouchableOpacity style={st.addBtn} onPress={() => openForm(null)}>
        <Text style={st.addBtnText}>+ Add</Text>
      </TouchableOpacity>

      {/* Add/edit modal */}
      <Modal visible={formOpen} transparent animationType="slide" onRequestClose={() => setFormOpen(false)}>
        <View style={st.modalWrap}>
          <View style={st.modalCard}>
            <Text style={st.modalTitle}>{editingId ? 'Product Edit' : 'Naya Product'}</Text>

            <Text style={st.label}>Naam *</Text>
            <TextInput style={st.input} value={form.name}
              onChangeText={(v) => setForm({ ...form, name: v })}
              placeholder="jaise: Dettol Sabun" placeholderTextColor="#555" />

            <View style={st.inputRow}>
              <View style={st.inputHalf}>
                <Text style={st.label}>Brand</Text>
                <TextInput style={st.input} value={form.brand}
                  onChangeText={(v) => setForm({ ...form, brand: v })}
                  placeholder="Dettol" placeholderTextColor="#555" />
              </View>
              <View style={st.inputHalf}>
                <Text style={st.label}>Category</Text>
                <TextInput style={st.input} value={form.category}
                  onChangeText={(v) => setForm({ ...form, category: v })}
                  placeholder="Sabun" placeholderTextColor="#555" />
              </View>
            </View>

            <View style={st.inputRow}>
              <View style={st.inputHalf}>
                <Text style={st.label}>Purchase ₹</Text>
                <TextInput style={st.input} value={form.purchase_price} keyboardType="numeric"
                  onChangeText={(v) => setForm({ ...form, purchase_price: v })}
                  placeholder="18" placeholderTextColor="#555" />
              </View>
              <View style={st.inputHalf}>
                <Text style={st.label}>Selling ₹ *</Text>
                <TextInput style={st.input} value={form.selling_price} keyboardType="numeric"
                  onChangeText={(v) => setForm({ ...form, selling_price: v })}
                  placeholder="25" placeholderTextColor="#555" />
              </View>
            </View>

            <View style={st.inputRow}>
              <View style={st.inputHalf}>
                <Text style={st.label}>Stock</Text>
                <TextInput style={st.input} value={form.stock_qty} keyboardType="numeric"
                  onChangeText={(v) => setForm({ ...form, stock_qty: v })}
                  placeholder="40" placeholderTextColor="#555" />
              </View>
              <View style={st.inputHalf}>
                <Text style={st.label}>Min stock alert</Text>
                <TextInput style={st.input} value={form.min_stock_level} keyboardType="numeric"
                  onChangeText={(v) => setForm({ ...form, min_stock_level: v })}
                  placeholder="10" placeholderTextColor="#555" />
              </View>
            </View>

            {error ? <Text style={st.errorText}>{error}</Text> : null}

            <View style={st.modalBtnRow}>
              <TouchableOpacity style={st.modalCancel} onPress={() => setFormOpen(false)}>
                <Text style={st.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[st.modalSave, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
                <Text style={st.modalSaveText}>{saving ? 'Saving...' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f1117', padding: 20, paddingTop: 56 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  title: { fontSize: 24, fontWeight: '800', color: '#fff' },
  backBtn: { paddingVertical: 6, paddingHorizontal: 10 },
  backBtnText: { color: '#2980b9', fontSize: 14, fontWeight: '600' },
  tabBtn: { backgroundColor: '#1c2030', borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12 },
  tabBtnText: { color: '#2ecc71', fontSize: 13, fontWeight: '700' },
  errorText: { color: '#e74c3c', fontSize: 13, marginBottom: 8 },

  list: { flex: 1 },
  emptyText: { color: '#4a5568', textAlign: 'center', marginTop: 40, fontSize: 14, lineHeight: 24 },
  itemRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#1e2535',
  },
  itemLeft: { flex: 1 },
  itemName: { color: '#ecf0f1', fontSize: 16, fontWeight: '600' },
  itemBrand: { color: '#7f8c8d', fontWeight: '400', fontSize: 14 },
  itemSub: { color: '#7f8c8d', fontSize: 13, marginTop: 2 },
  lowStock: { color: '#e67e22', fontWeight: '700' },
  miniBtn: { borderWidth: 1, borderColor: '#2d3748', borderRadius: 6, paddingVertical: 6, paddingHorizontal: 10, marginLeft: 8 },
  miniBtnText: { color: '#bdc3c7', fontSize: 12 },
  miniBtnDanger: { borderColor: '#8b3a2e' },
  miniBtnDangerText: { color: '#e74c3c' },

  addBtn: {
    backgroundColor: '#2980b9', borderRadius: 10, paddingVertical: 16,
    alignItems: 'center', marginTop: 12,
  },
  addBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  modalWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: '#151929', borderTopLeftRadius: 16, borderTopRightRadius: 16,
    padding: 20, paddingTop: 24,
  },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 16 },
  label: { color: '#7f8c8d', fontSize: 12, marginBottom: 4, marginTop: 10 },
  input: {
    backgroundColor: '#1c2030', borderRadius: 8, color: '#fff', fontSize: 15,
    paddingVertical: 10, paddingHorizontal: 12,
  },
  inputRow: { flexDirection: 'row', gap: 12 },
  inputHalf: { flex: 1 },
  modalBtnRow: { flexDirection: 'row', gap: 12, marginTop: 20, marginBottom: 8 },
  modalCancel: { flex: 1, borderWidth: 1, borderColor: '#2d3748', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  modalCancelText: { color: '#bdc3c7', fontSize: 15, fontWeight: '600' },
  modalSave: { flex: 1, backgroundColor: '#2980b9', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  modalSaveText: { color: '#fff', fontSize: 15, fontWeight: '700' },

  reportRow: { alignItems: 'center', marginVertical: 24 },
  bigMoney: { color: '#2ecc71', fontSize: 44, fontWeight: '800' },
  bigMoneyLabel: { color: '#7f8c8d', fontSize: 15, marginTop: 4 },
  reportGrid: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  reportCell: {
    flex: 1, backgroundColor: '#1c2030', borderRadius: 10,
    paddingVertical: 16, alignItems: 'center',
  },
  reportCellGreen: {
    flex: 1, backgroundColor: 'rgba(46,204,113,0.12)', borderRadius: 10,
    paddingVertical: 16, alignItems: 'center',
  },
  reportCellOrange: { backgroundColor: 'rgba(230,126,34,0.15)' },
  cellValue: { color: '#ecf0f1', fontSize: 22, fontWeight: '800' },
  cellValueGreen: { color: '#2ecc71', fontSize: 22, fontWeight: '800' },
  cellValueOrange: { color: '#e67e22', fontSize: 22, fontWeight: '800' },
  cellLabel: { color: '#7f8c8d', fontSize: 12, marginTop: 4 },
  reportNote: { color: '#e67e22', fontSize: 12, marginBottom: 12, lineHeight: 17 },
  section: { marginTop: 20 },
  sectionTitle: { color: '#bdc3c7', fontSize: 15, fontWeight: '700', marginBottom: 8 },
  sectionTitleOrange: { color: '#e67e22', fontSize: 15, fontWeight: '700', marginBottom: 8 },
  bestRow: {
    flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: '#1e2535',
  },
  bestName: { color: '#ecf0f1', fontSize: 14 },
  bestQty: { color: '#7f8c8d', fontSize: 13 },
  refreshBtn: {
    borderWidth: 1, borderColor: '#2d3748', borderRadius: 10,
    paddingVertical: 12, alignItems: 'center', marginTop: 24,
  },
  refreshBtnText: { color: '#bdc3c7', fontSize: 14, fontWeight: '600' },
});
