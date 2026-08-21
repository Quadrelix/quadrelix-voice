import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useVoice } from "../services/useVoice";
import { confirmContact } from "../services/api";

export default function ConfirmContactScreen({ route, navigation }) {
  const { transactionId, total } = route.params;
  const { text, isListening, start, stop, setText } = useVoice();
  const [loading, setLoading] = useState(false);

  async function handleMicPress() {
    isListening ? await stop() : await start();
  }

  async function handleConfirm() {
    const phone = text.replace(/\D/g, "");
    if (phone.length < 10) {
      Alert.alert("Sahi number bolo/likho", "Kam se kam 10 digit ka number chahiye");
      return;
    }
    setLoading(true);
    try {
      await confirmContact(transactionId, phone);
      navigation.navigate("BillPreview", { transactionId });
    } catch (err) {
      Alert.alert("Error", err.response?.data?.error || "Kuch गलत hua");
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Customer ka Number</Text>
      <Text style={styles.subtitle}>Total: ₹{total}</Text>

      <TextInput
        style={styles.input}
        placeholder="e.g. 9876543210"
        value={text}
        onChangeText={setText}
        keyboardType="phone-pad"
      />

      <TouchableOpacity
        style={[styles.micButton, isListening && styles.micButtonActive]}
        onPress={handleMicPress}
      >
        <Text style={styles.micButtonText}>
          {isListening ? "🎙 Sun raha hoon..." : "🎙 Number Bolo"}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.confirmButton} onPress={handleConfirm} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmButtonText}>Confirm ✓</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, paddingTop: 60, backgroundColor: "#fff" },
  title: { fontSize: 24, fontWeight: "bold", marginBottom: 6 },
  subtitle: { fontSize: 18, color: "#555", marginBottom: 30 },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    fontSize: 18,
  },
  micButton: {
    backgroundColor: "#2d2d2d",
    borderRadius: 30,
    paddingVertical: 16,
    alignItems: "center",
    marginBottom: 16,
  },
  micButtonActive: { backgroundColor: "#c0392b" },
  micButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  confirmButton: {
    backgroundColor: "#27ae60",
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
  },
  confirmButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
