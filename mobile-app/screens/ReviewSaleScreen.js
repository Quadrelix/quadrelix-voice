import React from "react";
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";

export default function ReviewSaleScreen({ route, navigation }) {
  const { transactionId, items, total } = route.params;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Bill Check Karein</Text>
      <Text style={styles.subtitle}>Samaan aur total sahi hai?</Text>

      <FlatList
        data={items}
        keyExtractor={(_, index) => String(index)}
        style={styles.list}
        renderItem={({ item }) => (
          <View style={styles.itemRow}>
            <View>
              <Text style={styles.itemName}>{item.product_name}</Text>
              <Text style={styles.itemDetails}>
                {item.quantity} × ₹{item.price}
              </Text>
            </View>
            <Text style={styles.itemPrice}>₹{item.line_total}</Text>
          </View>
        )}
      />

      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Total</Text>
        <Text style={styles.totalValue}>₹{total}</Text>
      </View>

      <TouchableOpacity
        style={styles.confirmButton}
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
  itemName: { fontSize: 17, fontWeight: "600" },
  itemDetails: { fontSize: 15, color: "#666", marginTop: 4 },
  itemPrice: { fontSize: 18, fontWeight: "700" },
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
  editButton: { paddingVertical: 14, alignItems: "center" },
  editButtonText: { color: "#2980b9", fontSize: 16, fontWeight: "600" },
});
