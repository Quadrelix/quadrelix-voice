// App.js — navigation shell.
//
// Two layers:
//  • Tabs  = the five places a shopkeeper lives: Home, Products, [mic],
//            Customers, Reports. The middle mic is not a tab — tapping it
//            pushes the voice-sale screen, the app's primary action.
//  • Stack = everything that opens ON TOP of a tab: the voice flow, bill
//            preview, and the typed fallback.
//
// The tab bar is custom (not the default component) so the mic can sit
// raised in the middle, the way the design calls for.

import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets, SafeAreaProvider } from 'react-native-safe-area-context';

import HomeScreen from './screens/HomeScreen';
import ProductsScreen from './screens/ProductsScreen';
import CustomersScreen from './screens/CustomersScreen';
import ReportsScreen from './screens/ReportsScreen';
import HandsFreeScreen from './screens/HandsFreeScreen';
import RecordSaleScreen from './screens/RecordSaleScreen';
import ConfirmContactScreen from './screens/ConfirmContactScreen';
import BillPreviewScreen from './screens/BillPreviewScreen';
import VoiceEnrollScreen from './screens/VoiceEnrollScreen';
import ShopSelectScreen from './screens/ShopSelectScreen';
import { ShopProvider, useShop } from './services/ShopContext';
import { colors, shadow } from './theme';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const TAB_ICONS = {
  Home: { on: 'home', off: 'home-outline' },
  Products: { on: 'cube', off: 'cube-outline' },
  Customers: { on: 'people', off: 'people-outline' },
  Reports: { on: 'bar-chart', off: 'bar-chart-outline' },
};

function TabBar({ state, navigation }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.bar, { paddingBottom: Math.max(insets.bottom, 6) }]}>
      {state.routes.map((route, index) => {
        const focused = state.index === index;

        // The middle slot is the mic — a raised circle that pushes the voice
        // screen instead of switching tabs.
        if (route.name === '__mic') {
          return (
            <View key={route.key} style={s.micSlot}>
              <TouchableOpacity
                style={s.mic}
                activeOpacity={0.85}
                onPress={() => navigation.navigate('HandsFree')}
              >
                <Ionicons name="mic" size={26} color="#fff" />
              </TouchableOpacity>
            </View>
          );
        }

        const icon = TAB_ICONS[route.name] || { on: 'ellipse', off: 'ellipse-outline' };
        const label = route.name === 'Reports' ? 'More' : route.name;
        return (
          <TouchableOpacity
            key={route.key}
            style={s.tab}
            activeOpacity={0.7}
            onPress={() => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
            }}
          >
            <Ionicons
              name={focused ? icon.on : icon.off}
              size={21}
              color={focused ? colors.primary : colors.faint}
            />
            <Text style={[s.tabLabel, focused && s.tabLabelOn]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function Tabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Products" component={ProductsScreen} />
      {/* Placeholder route so the bar has five slots; never rendered. */}
      <Tab.Screen name="__mic" component={HomeScreen} options={{ tabBarButton: () => null }} />
      <Tab.Screen name="Customers" component={CustomersScreen} />
      <Tab.Screen name="Reports" component={ReportsScreen} />
    </Tab.Navigator>
  );
}

function ShopGate() {
  const { shop, ready, chooseShop } = useShop();

  // Reading AsyncStorage takes a few milliseconds; showing the chooser first
  // would make an enrolled phone flash the code screen on every launch.
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (!shop) return <ShopSelectScreen onDone={chooseShop} />;

  return (
    <NavigationContainer>
      {/*
        RecordSale / ConfirmContact / BillPreview are the typed fallback flow —
        kept reachable from the stack if the voice path ever needs a manual
        escape hatch.
      */}
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        <Stack.Screen name="Tabs" component={Tabs} />
        <Stack.Screen name="HandsFree" component={HandsFreeScreen} />
        <Stack.Screen name="RecordSale" component={RecordSaleScreen} />
        <Stack.Screen name="ConfirmContact" component={ConfirmContactScreen} />
        <Stack.Screen name="BillPreview" component={BillPreviewScreen} />
        <Stack.Screen name="VoiceEnroll" component={VoiceEnrollScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ShopProvider>
        <ShopGate />
      </ShopProvider>
    </SafeAreaProvider>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'flex-end', backgroundColor: colors.card,
    paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.line,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 4 },
  tabLabel: { fontSize: 10, color: colors.faint, marginTop: 3, fontWeight: '600' },
  tabLabelOn: { color: colors.primary, fontWeight: '700' },
  micSlot: { flex: 1, alignItems: 'center' },
  mic: {
    width: 58, height: 58, borderRadius: 29, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center', marginTop: -30,
    borderWidth: 4, borderColor: colors.bg, ...shadow,
  },
});
