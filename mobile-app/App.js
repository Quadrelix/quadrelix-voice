import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import RecordSaleScreen from "./screens/RecordSaleScreen";
import ConfirmContactScreen from "./screens/ConfirmContactScreen";
import BillPreviewScreen from "./screens/BillPreviewScreen";

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="RecordSale" component={RecordSaleScreen} />
        <Stack.Screen name="ConfirmContact" component={ConfirmContactScreen} />
        <Stack.Screen name="BillPreview" component={BillPreviewScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
