import React, { useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { updateItem } from "../services/api";

export default function EditItemScreen({ route, navigation }) {
  const { transactionId, itemIndex, item } = route.params;
  const [productName, setProductName] = useState(item.product_name);
  const [quantity, setQuantity] = useState(String(item.quantity));
  const [price, setPrice] = useState(String(item.price));
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!productName.trim() || Number(quantity) <= 0 || Number(price) < 0) {
      Alert.alert("Sahi details likhein", "Product, quantity aur price check karein.");
      return;
    }

    setSaving(true);
    try {
      await updateItem(transactionId, itemIndex, {
        product_name: productName.trim(),
        quantity: Number(quantity),
        price: Number(price),
      });
      navigation.goBack();
    } catch (err) {
      Alert.alert("Item update nahi hua", err.response?.data?.error || "Dobara try karein");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Item Badlein</Text>
      <Text style={styles.label}>Product</Text>
      <TextInput style={styles.input} value={productName} onChangeText={setProductName} />
      <Text style={styles.label}>Quantity</Text>
      <TextInput style={styles.input} value={quantity} onChangeText={setQuantity} keyboardType="numeric" />
      <Text style={styles.label}>Ek piece ka price</Text>
      <TextInput style={styles.input} value={price} onChangeText={setPrice} keyboardType="numeric" />
      <TouchableOpacity style={styles.saveButton} onPress={handleSave} disabled={saving}>
        {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveText}>Save Karein ✓</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, paddingTop: 60, backgroundColor: "#fff" },
  title: { fontSize: 28, fontWeight: "700", marginBottom: 26 },
  label: { color: "#444", fontSize: 16, fontWeight: "600", marginBottom: 7 },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 12, fontSize: 18, marginBottom: 18 },
  saveButton: { backgroundColor: "#27ae60", borderRadius: 8, paddingVertical: 16, alignItems: "center", marginTop: 8 },
  saveText: { color: "#fff", fontSize: 17, fontWeight: "700" },
});
