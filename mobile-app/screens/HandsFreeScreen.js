// HandsFreeScreen.js — Pure hands-free billing screen
// 1. App opens → mic starts automatically
// 2. Shopkeeper speaks items → appear on screen silently  
// 3. Shopkeeper says customer phone number → backend detects it (ready_to_send=true)
// 4. 3-second countdown → /api/finalize auto-called → bill sent
// 5. "Bill bhej diya!" → reset for next customer

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useContinuousListening } from '../services/useContinuousListening';
import { transcribeAudio, sendUtterance, finalizeBill } from '../services/api';

const COUNTDOWN_SEC = 3;

const S = {
  LISTENING: 'listening',
  COUNTDOWN: 'countdown',
  SENDING: 'sending',
  DONE: 'done',
  ERROR: 'error',
};

export default function HandsFreeScreen() {
  const [appState, setAppState] = useState(S.LISTENING);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [detectedPhone, setDetectedPhone] = useState(null);
  const [lastHeard, setLastHeard] = useState('');
  const [parseError, setParseError] = useState(null);
  const [sendResult, setSendResult] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SEC);

  const countdownRef = useRef(null);
  const countdownAnim = useRef(new Animated.Value(1)).current;
  const transactionIdRef = useRef(null);
  const appStateRef = useRef(S.LISTENING);
  const phoneRef = useRef(null);

  function setStateSafe(s) { appStateRef.current = s; setAppState(s); }
  function setPhoneSafe(p) { phoneRef.current = p; setDetectedPhone(p); }
  function setTxnId(id) { transactionIdRef.current = id; }

  // ── Segment handler ──────────────────────────────────────────────────────
  const onSegment = useCallback(async (uri) => {
    if ([S.COUNTDOWN, S.SENDING, S.DONE].includes(appStateRef.current)) return;

    let text;
    try {
      const r = await transcribeAudio(uri);
      text = r.text;
      if (!text?.trim()) return;
      setLastHeard(text);
    } catch { return; }

    try {
      const data = await sendUtterance(text, transactionIdRef.current);
      if (data.transaction) {
        setTxnId(data.transaction.transaction_id);
        setItems(data.transaction.items || []);
        setTotal(data.transaction.total_amount || 0);
      }
      setParseError(data.parse_error ?? null);
      if (data.detected_phone) setPhoneSafe(data.detected_phone);
      if (data.ready_to_send && appStateRef.current === S.LISTENING) {
        startCountdown(data.detected_phone, data.transaction?.transaction_id);
      }
    } catch { /* non-fatal */ }
  }, []);

  const {
    isListening, voiceActive, queueDepth, busy,
    meteringAvailable, error: listenError,
    start: startListening, stop: stopListening,
  } = useContinuousListening({ onSegment });

  useEffect(() => {
    startListening();
    return () => { stopListening(); clearCountdown(); };
  }, []);

  // ── Countdown ────────────────────────────────────────────────────────────
  function clearCountdown() {
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    countdownAnim.stopAnimation();
    countdownAnim.setValue(1);
  }

  function startCountdown(phone, txnId) {
    setStateSafe(S.COUNTDOWN);
    Animated.timing(countdownAnim, {
      toValue: 0, duration: COUNTDOWN_SEC * 1000, easing: Easing.linear, useNativeDriver: false,
    }).start();

    let sec = COUNTDOWN_SEC;
    setSecondsLeft(sec);
    countdownRef.current = setInterval(() => {
      sec -= 1;
      setSecondsLeft(sec);
      if (sec <= 0) { clearCountdown(); autoSend(phone ?? phoneRef.current, txnId ?? transactionIdRef.current); }
    }, 1000);
  }

  function handleCancel() {
    clearCountdown();
    setPhoneSafe(null);
    setStateSafe(S.LISTENING);
    setSecondsLeft(COUNTDOWN_SEC);
  }

  async function autoSend(phone, txnId) {
    if (!phone || !txnId) { setStateSafe(S.ERROR); return; }
    setStateSafe(S.SENDING);
    await stopListening();
    try {
      const result = await finalizeBill(txnId, phone);
      setSendResult(result.send_result);
      setStateSafe(S.DONE);
    } catch { setStateSafe(S.ERROR); }
  }

  function handleNewSale() {
    clearCountdown();
    setItems([]); setTotal(0); setTxnId(null); setPhoneSafe(null);
    setLastHeard(''); setParseError(null); setSendResult(null);
    setSecondsLeft(COUNTDOWN_SEC);
    setStateSafe(S.LISTENING);
    startListening();
  }

  // ── UI helpers ───────────────────────────────────────────────────────────
  const dotColor = voiceActive ? '#e74c3c' : isListening ? '#27ae60' : '#555';
  const dotLabel = voiceActive ? 'Awaaz aa rahi hai...' : isListening ? 'Sun raha hoon...' : 'Mic band hai';
  const ringSize = countdownAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  // ── Done ─────────────────────────────────────────────────────────────────
  if (appState === S.DONE) {
    const sim = sendResult?.status === 'simulated';
    return (
      <View style={st.centeredScreen}>
        <Text style={st.doneEmoji}>✅</Text>
        <Text style={st.doneTitle}>Bill Bhej Diya!</Text>
        <Text style={st.donePhone}>{detectedPhone}</Text>
        {sim && <Text style={st.simNote}>(Test mode — backend console mein dekho)</Text>}
        <TouchableOpacity style={st.newSaleBtn} onPress={handleNewSale}>
          <Text style={st.newSaleBtnText}>Agla Customer →</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (appState === S.ERROR) {
    return (
      <View style={st.centeredScreen}>
        <Text style={st.errorEmoji}>⚠️</Text>
        <Text style={st.errorTitle}>Kuch galat hua</Text>
        <TouchableOpacity style={st.newSaleBtn} onPress={handleNewSale}>
          <Text style={st.newSaleBtnText}>Dobara Try Karein</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Main ─────────────────────────────────────────────────────────────────
  return (
    <View style={st.container}>
      <Text style={st.title}>Hands-Free Bill</Text>
      <Text style={st.subtitle}>Bolo aur phone number bolo — automatic bhej dega</Text>

      {/* Mic status bar */}
      <View style={st.statusRow}>
        <View style={[st.dot, { backgroundColor: dotColor }]} />
        <Text style={st.statusText}>{dotLabel}</Text>
        {!meteringAvailable && <Text style={st.badge}> (Fixed chunks)</Text>}
        {busy && <ActivityIndicator size="small" color="#2980b9" style={{ marginLeft: 8 }} />}
        {queueDepth > 0 && <Text style={st.badge}> +{queueDepth}</Text>}
      </View>

      {listenError && <Text style={st.errorText}>{listenError}</Text>}

      {!!lastHeard && (
        <Text style={st.lastHeard} numberOfLines={2}>
          {'\uD83C\uDF99'} "{lastHeard}"
        </Text>
      )}
      {!!parseError && (
        <Text style={st.parseError} numberOfLines={1}>(Samjha nahi: {parseError})</Text>
      )}

      {/* Items list */}
      <FlatList
        data={items}
        keyExtractor={(_, i) => String(i)}
        style={st.list}
        ListEmptyComponent={
          <Text style={st.emptyText}>
            Abhi tak koi item nahi{'\n'}bolo jaise "2 Dettol sabun 10 rupay"
          </Text>
        }
        renderItem={({ item }) => (
          <View style={st.itemRow}>
            <View style={st.itemLeft}>
              <Text style={st.itemName}>{item.product_name}</Text>
              <Text style={st.itemQty}>
                {'\u00D7'} {item.quantity}{item.unit ? ' ' + item.unit : ''}
              </Text>
            </View>
            {item.price != null
              ? <Text style={st.itemTotal}>{'\u20B9'}{item.line_total}</Text>
              : <Text style={st.missingPrice}>Price?</Text>}
          </View>
        )}
      />

      {items.length > 0 && (
        <View style={st.totalRow}>
          <Text style={st.totalLabel}>Total</Text>
          <Text style={st.totalAmount}>{'\u20B9'}{total}</Text>
        </View>
      )}

      {/* Countdown overlay */}
      {appState === S.COUNTDOWN && (
        <View style={st.overlay}>
          <Text style={st.overlayPhone}>{'\uD83D\uDCF1'} {detectedPhone}</Text>
          <Text style={st.overlayLabel}>
            {secondsLeft} second{secondsLeft !== 1 ? 's' : ''} mein bhej raha hoon...
          </Text>
          <View style={st.ringWrap}>
            <Animated.View style={[st.ring, { width: ringSize, height: ringSize }]} />
            <Text style={st.ringNum}>{secondsLeft}</Text>
          </View>
          <TouchableOpacity style={st.cancelBtn} onPress={handleCancel}>
            <Text style={st.cancelText}>{'\u2715'} Ruko (galat number)</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Sending overlay */}
      {appState === S.SENDING && (
        <View style={st.overlay}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={st.sendingText}>Bill bhej raha hoon...</Text>
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f1117', padding: 20, paddingTop: 56 },
  title: { fontSize: 26, fontWeight: '800', color: '#fff', letterSpacing: 0.4 },
  subtitle: { fontSize: 13, color: '#7f8c8d', marginTop: 4, marginBottom: 18 },

  statusRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  dot: { width: 12, height: 12, borderRadius: 6, marginRight: 8 },
  statusText: { color: '#ecf0f1', fontSize: 14, fontWeight: '600' },
  badge: { color: '#3498db', fontSize: 12 },
  errorText: { color: '#e74c3c', fontSize: 13, marginBottom: 6 },

  lastHeard: {
    color: '#bdc3c7', fontSize: 13, fontStyle: 'italic',
    backgroundColor: '#1c2030', borderRadius: 6, padding: 8, marginBottom: 4,
  },
  parseError: { color: '#e67e22', fontSize: 12, marginBottom: 6 },

  list: { flex: 1, marginTop: 10 },
  emptyText: { color: '#4a5568', textAlign: 'center', marginTop: 40, fontSize: 14, lineHeight: 24 },
  itemRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1e2535',
  },
  itemLeft: { flex: 1 },
  itemName: { color: '#ecf0f1', fontSize: 16, fontWeight: '600' },
  itemQty: { color: '#7f8c8d', fontSize: 13, marginTop: 2 },
  itemTotal: { color: '#2ecc71', fontSize: 16, fontWeight: '700' },
  missingPrice: { color: '#e67e22', fontSize: 14 },

  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 14,
    borderTopWidth: 1, borderTopColor: '#2d3748', marginTop: 4,
  },
  totalLabel: { color: '#bdc3c7', fontSize: 18, fontWeight: '700' },
  totalAmount: { color: '#2ecc71', fontSize: 22, fontWeight: '800' },

  overlay: {
    ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(10,14,24,0.96)',
    justifyContent: 'center', alignItems: 'center', zIndex: 10, padding: 30,
  },
  overlayPhone: { color: '#ecf0f1', fontSize: 28, fontWeight: '800', letterSpacing: 2, marginBottom: 8 },
  overlayLabel: { color: '#bdc3c7', fontSize: 16, marginBottom: 32, textAlign: 'center' },
  ringWrap: { width: 120, height: 120, justifyContent: 'center', alignItems: 'center', marginBottom: 36 },
  ring: { position: 'absolute', borderRadius: 9999, backgroundColor: '#27ae60', opacity: 0.25 },
  ringNum: { color: '#fff', fontSize: 52, fontWeight: '800' },
  cancelBtn: {
    borderWidth: 1.5, borderColor: '#e74c3c', borderRadius: 30,
    paddingVertical: 14, paddingHorizontal: 32,
  },
  cancelText: { color: '#e74c3c', fontSize: 16, fontWeight: '700' },
  sendingText: { color: '#ecf0f1', fontSize: 18, marginTop: 20, fontWeight: '600' },

  centeredScreen: { flex: 1, backgroundColor: '#0f1117', justifyContent: 'center', alignItems: 'center', padding: 30 },
  doneEmoji: { fontSize: 72, marginBottom: 16 },
  doneTitle: { color: '#2ecc71', fontSize: 30, fontWeight: '800', marginBottom: 8 },
  donePhone: { color: '#bdc3c7', fontSize: 20, letterSpacing: 2, marginBottom: 8 },
  simNote: { color: '#7f8c8d', fontSize: 12, marginBottom: 24, textAlign: 'center' },
  errorEmoji: { fontSize: 64, marginBottom: 16 },
  errorTitle: { color: '#e74c3c', fontSize: 24, fontWeight: '800', marginBottom: 24 },
  newSaleBtn: {
    backgroundColor: '#2980b9', borderRadius: 10,
    paddingVertical: 16, paddingHorizontal: 40, marginTop: 12,
  },
  newSaleBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
