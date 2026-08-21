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
import { generateBill, sendBill } from "../services/api";

// Must match services/api.js BASE_URL
const BASE_URL = "http://192.168.43.161:3000";

export default function BillPreviewScreen({ route, navigation }) {
  const { transactionId } = route.params;
  const [billImagePath, setBillImagePath] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const result = await generateBill(transactionId);
        setBillImagePath(result.bill_image_path);
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

  // billImagePath is a local file path on the backend server.
  // Fetch it via the /bills static route exposed by the backend.
  const filename = billImagePath?.split("/").pop();
  const imageUrl = `${BASE_URL}/bills/${filename}`;

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
