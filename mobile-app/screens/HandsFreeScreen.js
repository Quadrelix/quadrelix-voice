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
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useContinuousListening } from '../services/useContinuousListening';
import { useTapToTalk } from '../services/useTapToTalk';
import { BASE_URL, transcribeAudio, sendUtterance, finalizeBill, sendBill, getTransaction } from '../services/api';

const COUNTDOWN_SEC = 3;

const S = {
  LISTENING: 'listening',
  COUNTDOWN: 'countdown',
  SENDING: 'sending',
  DONE: 'done',
  ERROR: 'error',
  FAILED: 'failed', // bill generated but WhatsApp send failed — bill is safe, retry possible
};

export default function HandsFreeScreen() {
  const [appState, setAppState] = useState(S.LISTENING);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [detectedPhone, setDetectedPhone] = useState(null);
  const [lastHeard, setLastHeard] = useState('');
  const [parseError, setParseError] = useState(null);
  const [sendResult, setSendResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [billUrl, setBillUrl] = useState(null); // set when the bill PNG exists but the send failed
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
    if ([S.COUNTDOWN, S.SENDING, S.DONE, S.FAILED].includes(appStateRef.current)) return;

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

  // Noise-safe capture, default ON: records only between two taps, so music
  // and street noise can never reach Sarvam. 'auto' keeps the original
  // always-on listening for a quiet counter.
  const [mode, setMode] = useState('tap');
  const tap = useTapToTalk({ onSegment });

  useEffect(() => {
    if (mode === 'auto') startListening();
    return () => { stopListening(); clearCountdown(); };
  }, [mode]);

  async function toggleMode() {
    if (mode === 'tap' && tap.recording) await tap.stop();
    setMode((m) => (m === 'tap' ? 'auto' : 'tap'));
  }

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
    if (!phone || !txnId) {
      setErrorMsg('Phone ya transaction ID nahi mila');
      setStateSafe(S.ERROR);
      return;
    }
    // Strip country code (91/+91) if present, keep last 10 digits
    const cleanPhone = phone.replace(/\D/g, '').replace(/^91(\d{10})$/, '$1');
    if (cleanPhone.length !== 10) {
      setErrorMsg(`Number sahi nahi hai: ${phone} (${cleanPhone.length} digits mila)`);
      setStateSafe(S.ERROR);
      return;
    }
    setStateSafe(S.SENDING);
    await stopListening();
    if (tap.recording) await tap.stop();
    try {
      const result = await finalizeBill(txnId, cleanPhone);
      setSendResult(result.send_result);
      setStateSafe(S.DONE);
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Server se connect nahi hua';
      console.error('autoSend error:', msg, err);
      setErrorMsg(msg);
      // A failed send is not a failed sale: /finalize saves the phone and renders
      // the bill BEFORE it sends. Ask the backend what survived — if the bill
      // image exists, show it with a retry button instead of a dead-end error,
      // because the likeliest cause (expired credit, sandbox window) is fixed
      // outside the app and then the shopkeeper wants to send the SAME bill,
      // not re-speak the whole sale.
      try {
        const data = await getTransaction(txnId);
        const billPath = data?.transaction?.bill_image_path;
        if (billPath) {
          const filename = billPath.split(/[\\/]/).pop();
          setBillUrl(`${BASE_URL}/bills/${filename}`);
          setStateSafe(S.FAILED);
          return;
        }
      } catch { /* fall through to the generic error screen */ }
      setStateSafe(S.ERROR);
    }
  }

  // Retry just the send for a bill that already exists. /api/send-bill picks up
  // the phone and image saved by the failed /finalize — nothing is re-parsed.
  async function retrySend() {
    const txnId = transactionIdRef.current;
    if (!txnId) { setStateSafe(S.ERROR); return; }
    setStateSafe(S.SENDING);
    try {
      const result = await sendBill(txnId);
      setSendResult(result.send_result);
      setStateSafe(S.DONE);
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Server se connect nahi hua';
      setErrorMsg(msg);
      setStateSafe(S.FAILED);
    }
  }

  function handleNewSale() {
    clearCountdown();
    setItems([]); setTotal(0); setTxnId(null); setPhoneSafe(null);
    setLastHeard(''); setParseError(null); setSendResult(null); setErrorMsg(null);
    setBillUrl(null);
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

  // ── Send failed, bill survived ───────────────────────────────────────────
  if (appState === S.FAILED) {
    return (
      <View style={st.centeredScreen}>
        <Text style={st.errorEmoji}>{'🚕'}</Text>
        <Text style={st.failedTitle}>Bill ban gayi — bhej nahi paye</Text>
        {!!errorMsg && <Text style={st.errorDetail}>{errorMsg}</Text>}
        {!!billUrl && <Image source={{ uri: billUrl }} style={st.billThumb} resizeMode="contain" />}
        {!!detectedPhone && <Text style={st.failedPhone}>{detectedPhone} pe bhejni hai</Text>}
        <TouchableOpacity style={st.newSaleBtn} onPress={retrySend}>
          <Text style={st.newSaleBtnText}>Dobara Bhejein</Text>
        </TouchableOpacity>
        <TouchableOpacity style={st.skipBtn} onPress={handleNewSale}>
          <Text style={st.skipBtnText}>Chhod do — Agla Customer →</Text>
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
        {!!errorMsg && (
          <Text style={st.errorDetail}>{errorMsg}</Text>
        )}
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

      {/* Mode switch — shor-safe by default, auto for a quiet counter */}
      <TouchableOpacity style={st.modeBtn} onPress={toggleMode}>
        <Text style={st.modeBtnText}>
          {mode === 'tap' ? 'Shor-safe mode — Auto sunne ke liye dabao' : 'Auto mode — Shor-safe ke liye dabao'}
        </Text>
      </TouchableOpacity>

      {mode === 'tap' ? (
        <View style={st.tapWrap}>
          <TouchableOpacity
            style={[st.micBtn, tap.recording && st.micBtnRec]}
            onPress={() => (tap.recording ? tap.stop() : tap.start())}
          >
            <Text style={st.micBtnIcon}>{tap.recording ? '⏹' : '🎙'}</Text>
          </TouchableOpacity>
          <Text style={st.tapHint}>
            {tap.recording ? 'Sun raha hoon — bolna khatam ho to dabao' : 'Bolne ke liye mic dabao'}
          </Text>
          {tap.busy && <ActivityIndicator size="small" color="#2980b9" />}
          {tap.error && <Text style={st.errorText}>{tap.error}</Text>}
        </View>
      ) : (
        <View style={st.statusRow}>
          <View style={[st.dot, { backgroundColor: dotColor }]} />
          <Text style={st.statusText}>{dotLabel}</Text>
          {!meteringAvailable && <Text style={st.badge}> (Fixed chunks)</Text>}
          {busy && <ActivityIndicator size="small" color="#2980b9" style={{ marginLeft: 8 }} />}
          {queueDepth > 0 && <Text style={st.badge}> +{queueDepth}</Text>}
        </View>
      )}

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
  errorTitle: { color: '#e74c3c', fontSize: 24, fontWeight: '800', marginBottom: 12 },
  errorDetail: { color: '#bdc3c7', fontSize: 14, textAlign: 'center', marginBottom: 20, paddingHorizontal: 10 },

  modeBtn: { alignSelf: 'flex-start', backgroundColor: '#1c2030', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, marginBottom: 10 },
  modeBtnText: { color: '#7f8c8d', fontSize: 11, fontWeight: '600' },
  tapWrap: { alignItems: 'center', marginBottom: 14 },
  micBtn: { width: 88, height: 88, borderRadius: 44, backgroundColor: '#27ae60', justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  micBtnRec: { backgroundColor: '#e74c3c' },
  micBtnIcon: { fontSize: 36 },
  tapHint: { color: '#bdc3c7', fontSize: 13 },

  failedTitle: { color: '#e67e22', fontSize: 22, fontWeight: '800', marginBottom: 12 },
  billThumb: { width: 190, height: 250, borderRadius: 8, borderWidth: 1, borderColor: '#2d3748', backgroundColor: '#fff', marginBottom: 16 },
  failedPhone: { color: '#bdc3c7', fontSize: 15, letterSpacing: 1, marginBottom: 20 },
  skipBtn: { marginTop: 14, paddingVertical: 10, paddingHorizontal: 20 },
  skipBtnText: { color: '#7f8c8d', fontSize: 14, fontWeight: '600' },
  newSaleBtn: {
    backgroundColor: '#2980b9', borderRadius: 10,
    paddingVertical: 16, paddingHorizontal: 40, marginTop: 12,
  },
  newSaleBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
