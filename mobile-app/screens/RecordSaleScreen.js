import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  TextInput,
  Alert,
} from "react-native";
import { useVoice } from "../services/useVoice";
import { parseItem } from "../services/api";

export default function RecordSaleScreen({ navigation }) {
  const { text, isListening, error, start, stop, setText } = useVoice();
  const [transactionId, setTransactionId] = useState(null);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  async function handleMicPress() {
    if (isListening) {
      await stop();
    } else {
      await start();
    }
  }

  // Called once we have transcribed text (from voice OR the fallback text box)
  async function handleAddItem() {
    if (!text.trim()) return;
    setLoading(true);
    try {
      const result = await parseItem(text, transactionId);
      setTransactionId(result.transaction.transaction_id);
      setItems(result.transaction.items);
      setTotal(result.transaction.total_amount);
      setText("");
    } catch (err) {
      Alert.alert(
        "Samajh nahi aaya",
        err.response?.data?.error || "Please try again, e.g. '5 shirt 500'"
      );
    } finally {
      setLoading(false);
    }
  }

  function handleNext() {
    if (!transactionId || items.length === 0) {
      Alert.alert("Pehle kam se kam ek item add karein");
      return;
    }
    navigation.navigate("ConfirmContact", { transactionId, total });
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Naya Bill</Text>

      <FlatList
        data={items}
        keyExtractor={(_, i) => String(i)}
        style={styles.list}
        renderItem={({ item }) => (
          <View style={styles.itemRow}>
            <Text style={styles.itemText}>
              {item.product_name} × {item.quantity}
            </Text>
            <Text style={styles.itemPrice}>₹{item.line_total}</Text>
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.emptyText}>Abhi tak koi item add nahi hua</Text>
        }
      />

      {items.length > 0 && (
        <Text style={styles.totalText}>Total: ₹{total}</Text>
      )}

      {/* Fallback text input — useful for testing without a dev build / mic */}
      <TextInput
        style={styles.input}
        placeholder="e.g. 5 white shirt 500 rupaye"
        value={text}
        onChangeText={setText}
      />

      {error && <Text style={styles.errorText}>Mic error: {error}</Text>}

      <TouchableOpacity
        style={[styles.micButton, isListening && styles.micButtonActive]}
        onPress={handleMicPress}
      >
        <Text style={styles.micButtonText}>
          {isListening ? "🎙 Sun raha hoon..." : "🎙 Bolo"}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.addButton}
        onPress={handleAddItem}
        disabled={loading || !text.trim()}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.addButtonText}>+ Item Add Karein</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={styles.nextButton} onPress={handleNext}>
        <Text style={styles.nextButtonText}>Aage Badhein →</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, paddingTop: 60, backgroundColor: "#fff" },
  title: { fontSize: 24, fontWeight: "bold", marginBottom: 16 },
  list: { flexGrow: 0, maxHeight: 220, marginBottom: 8 },
  itemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  itemText: { fontSize: 16 },
  itemPrice: { fontSize: 16, fontWeight: "600" },
  emptyText: { color: "#999", textAlign: "center", marginTop: 20 },
  totalText: { fontSize: 20, fontWeight: "bold", marginVertical: 10, textAlign: "right" },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 12,
    marginVertical: 10,
    fontSize: 16,
  },
  errorText: { color: "red", marginBottom: 8 },
  micButton: {
    backgroundColor: "#2d2d2d",
    borderRadius: 30,
    paddingVertical: 16,
    alignItems: "center",
    marginBottom: 10,
  },
  micButtonActive: { backgroundColor: "#c0392b" },
  micButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  addButton: {
    backgroundColor: "#27ae60",
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 10,
  },
  addButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  nextButton: {
    backgroundColor: "#2980b9",
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
  },
  nextButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
