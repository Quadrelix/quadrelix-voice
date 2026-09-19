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
import { useAudioRecording } from "../services/useAudioRecording";
import { parseItem, transcribeAudio, updateItemPrice as apiUpdateItemPrice } from "../services/api";

export default function RecordSaleScreen({ navigation }) {
  const { isRecording, error: recError, start, stop } = useAudioRecording();
  const [text, setText] = useState("");
  const [transactionId, setTransactionId] = useState(null);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [priceInputs, setPriceInputs] = useState({}); // { itemIndex: "typed price" }

  async function handleMicPress() {
    if (isRecording) {
      setLoading(true);
      const fileUri = await stop();
      if (fileUri) {
        try {
          const { text: transcribed } = await transcribeAudio(fileUri);
          setText(transcribed);
          await submitText(transcribed);
        } catch (err) {
          Alert.alert(
            "Sun nahi paya",
            err.response?.data?.error || "Voice samajh nahi aaya, neeche type kar lein"
          );
        }
      }
      setLoading(false);
    } else {
      await start();
    }
  }

  async function submitText(spokenText) {
    if (!spokenText.trim()) return;
    setLoading(true);
    try {
      const result = await parseItem(spokenText, transactionId);
      setTransactionId(result.transaction.transaction_id);
      setItems(result.transaction.items);
      setTotal(result.transaction.total_amount);
      setText("");
      if (result.missing_price_count > 0) {
        Alert.alert(
          "Price batana baaki hai",
          `${result.missing_price_count} item(s) ka price nahi mila — neeche daal dein`
        );
      }
    } catch (err) {
      Alert.alert(
        "Samajh nahi aaya",
        err.response?.data?.error || "Please try again, e.g. '5 shirt 500 aur 2 pant 800'"
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleAddItem() {
    await submitText(text);
  }

  async function handleSavePrice(index) {
    const price = priceInputs[index];
    if (!price || isNaN(Number(price))) {
      Alert.alert("Sahi price daalein");
      return;
    }
    setLoading(true);
    try {
      const result = await apiUpdateItemPrice(transactionId, index, Number(price));
      setItems(result.transaction.items);
      setTotal(result.transaction.total_amount);
      setPriceInputs((prev) => ({ ...prev, [index]: "" }));
    } catch (err) {
      Alert.alert("Error", err.response?.data?.error || "Price save nahi hua");
    } finally {
      setLoading(false);
    }
  }

  function handleNext() {
    if (!transactionId || items.length === 0) {
      Alert.alert("Pehle kam se kam ek item add karein");
      return;
    }
    const stillMissing = items.some((i) => i.price == null);
    if (stillMissing) {
      Alert.alert("Kuch items ka price abhi bhi baaki hai — pehle wo bharein");
      return;
    }
    navigation.navigate("ConfirmContact", { transactionId, total });
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Naya Bill</Text>
      <Text style={styles.hint}>
        Kisi bhi tarah bolo: "2 kilo aam ₹60" ya "aam 2 kilo ₹60" ya "₹2 ki mirch" — ek
        se zyada items ek saath bol sakte ho
      </Text>

      <FlatList
        data={items}
        keyExtractor={(_, i) => String(i)}
        style={styles.list}
        renderItem={({ item, index }) => (
          <View style={styles.itemRow}>
            <Text style={styles.itemText}>
              {item.product_name} × {item.quantity}
              {item.unit ? ` ${item.unit}` : ""}
            </Text>
            {item.price != null ? (
              <Text style={styles.itemPrice}>₹{item.line_total}</Text>
            ) : (
              <View style={styles.priceInputRow}>
                <TextInput
                  style={styles.priceInput}
                  placeholder="Price?"
                  keyboardType="numeric"
                  value={priceInputs[index] || ""}
                  onChangeText={(v) => setPriceInputs((prev) => ({ ...prev, [index]: v }))}
                />
                <TouchableOpacity style={styles.priceSaveBtn} onPress={() => handleSavePrice(index)}>
                  <Text style={styles.priceSaveBtnText}>Save</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
        ListEmptyComponent={
          <Text style={styles.emptyText}>Abhi tak koi item add nahi hua</Text>
        }
      />

      {items.length > 0 && <Text style={styles.totalText}>Total: ₹{total}</Text>}

      <TextInput
        style={styles.input}
        placeholder="e.g. 5 white shirt 500 aur 2 pant 800"
        value={text}
        onChangeText={setText}
      />

      {recError && <Text style={styles.errorText}>{recError}</Text>}

      <TouchableOpacity
        style={[styles.micButton, isRecording && styles.micButtonActive]}
        onPress={handleMicPress}
        disabled={loading}
      >
        {loading && !isRecording ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.micButtonText}>
            {isRecording ? "🎙 Sun raha hoon... (dabao rokne ke liye)" : "🎙 Bolo"}
          </Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={styles.addButton} onPress={handleAddItem} disabled={loading || !text.trim()}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.addButtonText}>+ Item Add Karein</Text>}
      </TouchableOpacity>

      <TouchableOpacity style={styles.nextButton} onPress={handleNext}>
        <Text style={styles.nextButtonText}>Aage Badhein →</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, paddingTop: 60, backgroundColor: "#fff" },
  title: { fontSize: 24, fontWeight: "bold", marginBottom: 4 },
  hint: { fontSize: 12, color: "#888", marginBottom: 14 },
  list: { flexGrow: 0, maxHeight: 220, marginBottom: 8 },
  itemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  itemText: { fontSize: 16 },
  itemPrice: { fontSize: 16, fontWeight: "600" },
  priceInputRow: { flexDirection: "row", alignItems: "center" },
  priceInput: {
    borderWidth: 1,
    borderColor: "#e67e22",
    borderRadius: 6,
    padding: 6,
    width: 70,
    marginRight: 6,
  },
  priceSaveBtn: { backgroundColor: "#e67e22", borderRadius: 6, paddingVertical: 6, paddingHorizontal: 10 },
  priceSaveBtnText: { color: "#fff", fontWeight: "600", fontSize: 12 },
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
  micButtonText: { color: "#fff", fontSize: 15, fontWeight: "600" },
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
