import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import HandsFreeScreen from "./screens/HandsFreeScreen";
import RecordSaleScreen from "./screens/RecordSaleScreen";
import ConfirmContactScreen from "./screens/ConfirmContactScreen";
import BillPreviewScreen from "./screens/BillPreviewScreen";
import ProductsScreen from "./screens/ProductsScreen";

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      {/*
        HandsFreeScreen is first = it is the default screen that opens.
        RecordSale / ConfirmContact / BillPreview are kept as the typed fallback
        flow — navigate to "RecordSale" from HandsFree if you want to switch.
      */}
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="HandsFree" component={HandsFreeScreen} />
        <Stack.Screen name="RecordSale" component={RecordSaleScreen} />
        <Stack.Screen name="ConfirmContact" component={ConfirmContactScreen} />
        <Stack.Screen name="BillPreview" component={BillPreviewScreen} />
        <Stack.Screen name="Products" component={ProductsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
