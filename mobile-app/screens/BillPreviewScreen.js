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
import { generateBill, getBillImageUrl, sendBill } from "../services/api";

export default function BillPreviewScreen({ route, navigation }) {
  const { transactionId } = route.params;
  const [billImagePath, setBillImagePath] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [imageVersion, setImageVersion] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const result = await generateBill(transactionId);
        setBillImagePath(result.bill_image_path);
        // The server overwrites the same bill filename after an edit. A version
        // query prevents React Native from showing its cached previous image.
        setImageVersion(Date.now());
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
          : "Bill WhatsApp par bhej diya gaya",
        [{ text: "OK", onPress: () => navigation.reset({ index: 0, routes: [{ name: "RecordSale" }] }) }]
      );
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

  const imageUrl = getBillImageUrl(billImagePath, imageVersion);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Bill Ready</Text>
      {imageUrl && !imageFailed ? (
        <Image
          source={{ uri: imageUrl }}
          style={styles.billImage}
          resizeMode="contain"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <View style={styles.previewError}>
          <Text style={styles.previewErrorText}>Bill preview load nahi hua.</Text>
          <Text style={styles.previewHint}>Phone aur backend same Wi-Fi par hone chahiye.</Text>
        </View>
      )}

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
  previewError: {
    width: "100%", height: 450, marginBottom: 20, borderWidth: 1,
    borderColor: "#f1b5b5", backgroundColor: "#fff8f8", alignItems: "center",
    justifyContent: "center", padding: 24,
  },
  previewErrorText: { color: "#b42318", fontSize: 16, fontWeight: "700", marginBottom: 8 },
  previewHint: { color: "#666", textAlign: "center" },
  sendButton: {
    backgroundColor: "#25D366",
    borderRadius: 8,
    paddingVertical: 16,
    alignItems: "center",
  },
  sendButtonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
