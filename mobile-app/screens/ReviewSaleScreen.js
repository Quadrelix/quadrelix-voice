import React, { useCallback, useState } from "react";
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { getTransaction, removeItem } from "../services/api";

export default function ReviewSaleScreen({ route, navigation }) {
  const { transactionId, items: initialItems, total: initialTotal } = route.params;
  const [items, setItems] = useState(initialItems);
  const [total, setTotal] = useState(initialTotal);

  const refreshTransaction = useCallback(async () => {
    try {
      const result = await getTransaction(transactionId);
      setItems(result.transaction.items);
      setTotal(result.transaction.total_amount);
    } catch (err) {
      Alert.alert("Error", err.response?.data?.error || "Bill ki details load nahi hui");
    }
  }, [transactionId]);

  useFocusEffect(
    useCallback(() => {
      refreshTransaction();
    }, [refreshTransaction])
  );

  function handleRemove(itemIndex) {
    Alert.alert("Item Hata Dein?", "Ye item bill se remove ho jayega.", [
      { text: "Nahi", style: "cancel" },
      {
        text: "Hata Dein",
        style: "destructive",
        onPress: async () => {
          try {
            const result = await removeItem(transactionId, itemIndex);
            setItems(result.transaction.items);
            setTotal(result.transaction.total_amount);
          } catch (err) {
            Alert.alert("Item remove nahi hua", err.response?.data?.error || "Dobara try karein");
          }
        },
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Bill Check Karein</Text>
      <Text style={styles.subtitle}>Samaan aur total sahi hai?</Text>

      <FlatList
        data={items}
        keyExtractor={(_, index) => String(index)}
        style={styles.list}
        renderItem={({ item, index }) => (
          <View style={styles.itemRow}>
            <View style={styles.itemContent}>
              <Text style={styles.itemName}>{item.product_name}</Text>
              <Text style={styles.itemDetails}>
                {item.quantity} × ₹{item.price}
              </Text>
            </View>
            <View style={styles.itemActions}>
              <Text style={styles.itemPrice}>₹{item.line_total}</Text>
              <View style={styles.actionRow}>
                <TouchableOpacity
                  onPress={() => navigation.navigate("EditItem", { transactionId, itemIndex: index, item })}
                >
                  <Text style={styles.editText}>Badlein</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => handleRemove(index)}>
                  <Text style={styles.removeText}>Hata Dein</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      />

      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Total</Text>
        <Text style={styles.totalValue}>₹{total}</Text>
      </View>

      <TouchableOpacity
        style={[styles.confirmButton, items.length === 0 && styles.disabledButton]}
        disabled={items.length === 0}
        onPress={() => navigation.navigate("ConfirmContact", { transactionId, total })}
      >
        <Text style={styles.confirmButtonText}>Sahi Hai, Aage Badhein ✓</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.editButton} onPress={() => navigation.goBack()}>
        <Text style={styles.editButtonText}>Kuch Badalna Hai</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, paddingTop: 60, backgroundColor: "#fff" },
  title: { fontSize: 28, fontWeight: "700", marginBottom: 6 },
  subtitle: { fontSize: 17, color: "#555", marginBottom: 20 },
  list: { flexGrow: 0, maxHeight: 360, borderTopWidth: 1, borderTopColor: "#eee" },
  itemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  itemContent: { flex: 1 },
  itemActions: { alignItems: "flex-end", marginLeft: 12 },
  itemName: { fontSize: 17, fontWeight: "600" },
  itemDetails: { fontSize: 15, color: "#666", marginTop: 4 },
  itemPrice: { fontSize: 18, fontWeight: "700" },
  actionRow: { flexDirection: "row", gap: 14, marginTop: 8 },
  editText: { color: "#2980b9", fontWeight: "600" },
  removeText: { color: "#c0392b", fontWeight: "600" },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 20,
    marginBottom: 14,
  },
  totalLabel: { fontSize: 22, fontWeight: "700" },
  totalValue: { fontSize: 24, fontWeight: "700" },
  confirmButton: {
    backgroundColor: "#27ae60",
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: "center",
    marginBottom: 12,
  },
  confirmButtonText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  disabledButton: { backgroundColor: "#9ca3af" },
  editButton: { paddingVertical: 14, alignItems: "center" },
  editButtonText: { color: "#2980b9", fontSize: 16, fontWeight: "600" },
});
