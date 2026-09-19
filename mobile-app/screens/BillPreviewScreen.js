import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from "react-native";
import { generateBill, sendBill, BASE_URL } from "../services/api";

export default function BillPreviewScreen({ route, navigation }) {
  const { transactionId } = route.params;
  const [billFilename, setBillFilename] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const result = await generateBill(transactionId);
        // Prefer the filename the backend hands us. The fallback splits on
        // BOTH separators — bill_image_path is a server filesystem path, so on
        // a Windows backend it arrives as "D:\...\bill_x.png" and splitting on
        // "/" alone would yield the whole path as the "filename".
        setBillFilename(
          result.bill_filename ?? result.bill_image_path?.split(/[\\/]/).pop()
        );
      } catch (err) {
        Alert.alert("Error", err.response?.data?.error || "Bill nahi bana");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleSend() {
    setSending(true);
    try {
      const result = await sendBill(transactionId);
      Alert.alert(
        "Ho gaya!",
        result.send_result.status === "simulated"
          ? "Bill generate ho gaya (WhatsApp abhi test mode mein hai — backend console mein dekho)"
          : "Bill WhatsApp par bhej diya gaya"
      );
      navigation.popToTop();
    } catch (err) {
      Alert.alert("Error", err.response?.data?.error || "Bhejne mein error aayi");
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" />
        <Text style={{ marginTop: 12 }}>Bill ban raha hai...</Text>
      </View>
    );
  }

  // The bill PNG lives on the backend, served by its /bills static route.
  if (!billFilename) {
    return (
      <View style={styles.centerContainer}>
        <Text>Bill nahi bana — wapas jaakar dobara koshish karein</Text>
      </View>
    );
  }

  const imageUrl = `${BASE_URL}/bills/${billFilename}`;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Bill Ready</Text>
      <Image source={{ uri: imageUrl }} style={styles.billImage} resizeMode="contain" />

      <TouchableOpacity style={styles.sendButton} onPress={handleSend} disabled={sending}>
        {sending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.sendButtonText}>WhatsApp par Bhejein</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, paddingTop: 60, backgroundColor: "#fff" },
  centerContainer: { flex: 1, justifyContent: "center", alignItems: "center" },
  title: { fontSize: 24, fontWeight: "bold", marginBottom: 16 },
  billImage: { width: "100%", height: 450, marginBottom: 20, borderWidth: 1, borderColor: "#eee" },
  sendButton: {
    backgroundColor: "#25D366",
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: "center",
  },
  sendButtonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
