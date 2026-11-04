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
import { useNavigation } from '@react-navigation/native';
import { useContinuousListening } from '../services/useContinuousListening';
import { useTapToTalk } from '../services/useTapToTalk';
import { errorMessage } from '../services/errorMessage';
import { isVoiceAllowed } from '../services/voiceResponse';
import { BASE_URL, verifyAndTranscribeAudio, sendUtterance, finalizeBill, sendBill, getTransaction, getVoiceStatus } from '../services/api';
import { colors, shadow, shadowStrong } from '../theme';
import { Ionicons } from '@expo/vector-icons';
import { useI18n } from '../services/i18n';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import Share from 'react-native-share';

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
  const { t } = useI18n();
  const [appState, setAppState] = useState(S.LISTENING);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [detectedPhone, setDetectedPhone] = useState(null);
  const [lastHeard, setLastHeard] = useState('');
  const [parseError, setParseError] = useState(null);
  const [phoneHint, setPhoneHint] = useState(null); // garbled number — ask for a repeat
  const [voiceHint, setVoiceHint] = useState(null); // Voice Lock rejection — 2 s, non-blocking
  const [voiceStatus, setVoiceStatus] = useState(null); // { enrolled, mode, service_up }
  const [sendResult, setSendResult] = useState(null);
  // 'sent' | 'simulated' (no WhatsApp provider: the share sheet is the delivery
  // path) | 'failed'. Opening the share sheet is NOT proof of delivery, so the
  // app never says "bhej diya" for anything but 'sent'.
  const [deliveryStatus, setDeliveryStatus] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [billUrl, setBillUrl] = useState(null); // set when the bill PNG exists but the send failed
  const [credit, setCredit] = useState(false); // udaar toggle shown during the countdown
  const [sharing, setSharing] = useState(false); // bill image being handed to the share sheet
  const [secondsLeft, setSecondsLeft] = useState(COUNTDOWN_SEC);
  const navigation = useNavigation();

  const creditRef = useRef(false); // credit survives re-renders without resetting mid-countdown
  const countdownRef = useRef(null);
  const countdownAnim = useRef(new Animated.Value(1)).current;
  const transactionIdRef = useRef(null);
  const appStateRef = useRef(S.LISTENING);
  const phoneRef = useRef(null);
  const voiceHintTimer = useRef(null);

  // A rejected clip gets a short, quiet hint — never an error screen, never a
// sound, never a retry loop (PDF T7.3). It clears itself so a busy counter
// doesn't accumulate stale messages.
  function showVoiceHint(reason) {
    const text =
      reason === 'too_short'
        ? t('handsfree.hintTooShort')
        : reason === 'service_down'
          ? t('handsfree.hintLockOff')
          : t('handsfree.hintNotRecognized');
    setVoiceHint(text);
    if (voiceHintTimer.current) clearTimeout(voiceHintTimer.current);
    voiceHintTimer.current = setTimeout(() => setVoiceHint(null), 2200);
  }

  function setStateSafe(s) { appStateRef.current = s; setAppState(s); }
  function setPhoneSafe(p) { phoneRef.current = p; setDetectedPhone(p); }
  function setTxnId(id) { transactionIdRef.current = id; }

  // ── Segment handler ──────────────────────────────────────────────────────
  const onSegment = useCallback(async (uri) => {
    if ([S.COUNTDOWN, S.SENDING, S.DONE, S.FAILED].includes(appStateRef.current)) return;

    let text;
    try {
      // Voice Lock gate: the backend verifies the speaker before it spends a
      // Sarvam call. A rejected clip comes back exactly like silence — no
      // text, no lastHeard update, no sendUtterance — so a customer's voice
      // cannot add an item. A rejection never touches bill state: items
      // already on the bill stay, the countdown is not reset.
      const r = await verifyAndTranscribeAudio(uri);
      if (!isVoiceAllowed(r)) {
        showVoiceHint(r.reason);
        return;
      }
      text = r.text;
      if (!text?.trim()) return;
      setParseError(null);
      setLastHeard(text);
    } catch (e) {
      // Only the backend knows whether verification failures may fail open.
      // A timeout must not bypass an enforced lock via /transcribe.
      setParseError(errorMessage(e, t('handsfree.errProcess')));
      return;
    }

    try {
      const data = await sendUtterance(text, transactionIdRef.current);
      if (data.transaction) {
        setTxnId(data.transaction.transaction_id);
        setItems(data.transaction.items || []);
        setTotal(data.transaction.total_amount || 0);
      }
      const parseErr = data.parse_error ?? null;
      setParseError(parseErr == null ? null : errorMessage(parseErr));
      if (data.detected_phone) setPhoneSafe(data.detected_phone);
      // Sarvam garbled the dictated number (only some digit-words came
      // through) — say so, otherwise the shopkeeper has no idea why nothing
      // happened after they clearly spoke a number.
      if (!data.detected_phone && data.partial_number) {
        setPhoneHint(t('handsfree.phonePartial', { n: data.partial_number.length }));
      } else {
        setPhoneHint(null);
      }
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
    return () => {
      stopListening();
      clearCountdown();
      if (voiceHintTimer.current) clearTimeout(voiceHintTimer.current);
    };
  }, [mode]);

  // Voice Lock state on mount: the "Voice Lock off" badge and the setup
  // banner both need it. Never blocking — a failed check just means no badge.
  useEffect(() => {
    getVoiceStatus()
      .then((v) => setVoiceStatus(v))
      .catch(() => setVoiceStatus(null));
  }, []);

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
    setCredit(false);
    creditRef.current = false;
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
      setErrorMsg(t('handsfree.errNoPhone'));
      setStateSafe(S.ERROR);
      return;
    }
    // Strip country code (91/+91) if present, keep last 10 digits
    const cleanPhone = phone.replace(/\D/g, '').replace(/^91(\d{10})$/, '$1');
    if (cleanPhone.length !== 10) {
      setErrorMsg(t('handsfree.errBadNumber', { phone, n: cleanPhone.length }));
      setStateSafe(S.ERROR);
      return;
    }
    setStateSafe(S.SENDING);
    await stopListening();
    if (tap.recording) await tap.stop();
    try {
      // credit = udaar: the bill still goes out on WhatsApp, but the day's
      // report counts it under outstanding instead of paid.
      const result = await finalizeBill(txnId, cleanPhone, creditRef.current ? 'credit' : 'paid');
      setSendResult(result.send_result);
      // Older backends only report send_result.status.
      const delivery = result.delivery_status
        ?? (result.send_result?.status === 'simulated' ? 'simulated' : 'sent');
      setDeliveryStatus(delivery);
      // The sale itself is saved either way; keep the bill on screen so it can
      // be shared even when the server could not message the customer.
      if (result.bill_filename) setBillUrl(`${BASE_URL}/bills/${result.bill_filename}`);
      if (result.send_error) setErrorMsg(errorMessage(result.send_error));
      setStateSafe(delivery === 'sent' ? S.DONE : S.FAILED);
    } catch (err) {
      const msg = errorMessage(err, t('common.serverError'));
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

  // Free delivery path: the app itself hands the bill image to WhatsApp. Costs
  // nothing — no Twilio, no sandbox, no provider — which makes it the default
  // until paid WhatsApp Business API is worth it.
  //
  // First choice: open the CUSTOMER's chat directly (the number the shopkeeper
  // just dictated) with the bill image attached, so nobody has to search for the
  // customer in WhatsApp. The shopkeeper only taps Send, and it goes out from
  // their own WhatsApp number. If that is not possible (no WhatsApp, number not
  // usable, intent refused) we fall back to the plain share sheet, where the
  // shopkeeper picks the chat themselves.
  async function shareBill() {
    if (!billUrl) return;
    setSharing(true);
    try {
      const fileName = billUrl.split('/').pop();
      const dest = `${FileSystem.cacheDirectory}${fileName}`;
      const download = await FileSystem.downloadAsync(billUrl, dest);
      if (download.status !== 200) throw new Error(t('handsfree.errDownload'));

      if (await shareToCustomerChat(download.uri, detectedPhone ?? phoneRef.current)) return;

      await Sharing.shareAsync(download.uri, {
        mimeType: 'image/png',
        dialogTitle: t('handsfree.shareDialog'),
      });
    } catch (e) {
      setErrorMsg(errorMessage(e, t('handsfree.errShare')));
    } finally {
      setSharing(false);
    }
  }

  // Try to open WhatsApp (or WhatsApp Business) straight on this customer's
  // chat with the bill attached. Returns true if it was opened, false to let the
  // caller fall back to the generic share sheet. Never throws.
  async function shareToCustomerChat(fileUri, rawPhone) {
    // react-native-share is a native module: it does not exist in Expo Go (only in the
    // built APK), so anything wrong here just means "use the plain share sheet".
    try {
      return await openWhatsAppChat(fileUri, rawPhone);
    } catch {
      return false;
    }
  }

  async function openWhatsAppChat(fileUri, rawPhone) {
    const digits = String(rawPhone || '').replace(/\D/g, '');
    // Indian numbers: 10 digits, or already with 91 / a leading 0.
    let number = null;
    if (digits.length === 10) number = `91${digits}`;
    else if (digits.length === 11 && digits.startsWith('0')) number = `91${digits.slice(1)}`;
    else if (digits.length === 12 && digits.startsWith('91')) number = digits;
    if (!number) return false;

    for (const social of [Share.Social.WHATSAPP, Share.Social.WHATSAPPBUSINESS]) {
      try {
        await Share.shareSingle({
          social,
          whatsAppNumber: number,
          url: fileUri,
          type: 'image/png',
          failOnCancel: false,
        });
        return true;
      } catch {
        // that WhatsApp variant is not installed or refused — try the next one
      }
    }
    return false;
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
      const delivery = result.delivery_status
        ?? (result.send_result?.status === 'simulated' ? 'simulated' : 'sent');
      setDeliveryStatus(delivery);
      setErrorMsg(null);
      setStateSafe(delivery === 'sent' ? S.DONE : S.FAILED);
    } catch (err) {
      setErrorMsg(errorMessage(err, t('common.serverError')));
      setStateSafe(S.FAILED);
    }
  }

  function handleNewSale() {
    clearCountdown();
    setItems([]); setTotal(0); setTxnId(null); setPhoneSafe(null);
    setLastHeard(''); setParseError(null); setSendResult(null); setErrorMsg(null);
    setDeliveryStatus(null);
    setPhoneHint(null);
    setBillUrl(null);
    setSecondsLeft(COUNTDOWN_SEC);
    setStateSafe(S.LISTENING);
    // Mode-gated on purpose: an unconditional start here silently re-armed
    // the always-on mic in tap mode, and background noise started adding
    // items the shopkeeper never approved. In tap mode the next recording
    // only starts when they press the mic button.
    if (mode === 'auto') startListening();
  }

  // ── UI helpers ───────────────────────────────────────────────────────────
  const dotColor = voiceActive ? '#e74c3c' : isListening ? '#27ae60' : '#555';
  const dotLabel = voiceActive ? t('handsfree.dotHearing') : isListening ? t('handsfree.dotListening') : t('handsfree.dotOff');
  const ringSize = countdownAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  // ── Done ─────────────────────────────────────────────────────────────────
  if (appState === S.DONE) {
    return (
      <View style={st.centeredScreen}>
        <Text style={st.doneEmoji}>✅</Text>
        <Text style={st.doneTitle}>{t('handsfree.doneTitle')}</Text>
        <Text style={st.donePhone}>{detectedPhone}</Text>
        <TouchableOpacity style={st.newSaleBtn} onPress={handleNewSale}>
          <Text style={st.newSaleBtnText}>{t('handsfree.next')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Send failed, bill survived ───────────────────────────────────────────
  if (appState === S.FAILED) {
    // 'simulated' = no server-side WhatsApp: this is the NORMAL success screen
    // for the free share-sheet flow, not an error.
    const shareOnly = deliveryStatus === 'simulated';
    return (
      <View style={st.centeredScreen}>
        <Text style={st.errorEmoji}>{shareOnly ? '✅' : '🚕'}</Text>
        <Text style={shareOnly ? st.readyTitle : st.failedTitle}>
          {shareOnly ? t('handsfree.readyShare') : t('handsfree.readyFailed')}
        </Text>
        {!shareOnly && !!errorMsg && <Text style={st.errorDetail}>{errorMsg}</Text>}
        {!!billUrl && <Image source={{ uri: billUrl }} style={st.billThumb} resizeMode="contain" />}
        {!!detectedPhone && <Text style={st.failedPhone}>{t('handsfree.sendTo', { phone: detectedPhone })}</Text>}
        <TouchableOpacity
          style={[st.shareBtn, sharing && { opacity: 0.6 }]}
          onPress={shareBill}
          disabled={sharing}
        >
          <Text style={st.shareBtnText}>
            {sharing ? t('handsfree.opening') : t('handsfree.shareBtn')}
          </Text>
        </TouchableOpacity>
        {!shareOnly && (
          <TouchableOpacity style={st.newSaleBtn} onPress={retrySend}>
            <Text style={st.newSaleBtnText}>{t('handsfree.sendServer')}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={shareOnly ? st.newSaleBtn : st.skipBtn} onPress={handleNewSale}>
          <Text style={shareOnly ? st.newSaleBtnText : st.skipBtnText}>
            {shareOnly ? t('handsfree.next') : t('handsfree.skipNext')}
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (appState === S.ERROR) {
    return (
      <View style={st.centeredScreen}>
        <Text style={st.errorEmoji}>⚠️</Text>
        <Text style={st.errorTitle}>{t('common.somethingWrong')}</Text>
        {!!errorMsg && (
          <Text style={st.errorDetail}>{errorMsg}</Text>
        )}
        <TouchableOpacity style={st.newSaleBtn} onPress={handleNewSale}>
          <Text style={st.newSaleBtnText}>{t('common.retry')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Main ─────────────────────────────────────────────────────────────────
  return (
    <View style={st.container}>
      <View style={st.topRow}>
        <TouchableOpacity style={st.backBtn} onPress={() => navigation.goBack()} accessibilityLabel={t('common.back')}>
          <Text style={st.backBtnText}>←</Text>
        </TouchableOpacity>
        <Text style={st.title}>{t('handsfree.title')}</Text>
        <TouchableOpacity style={st.modeBtn} onPress={toggleMode}>
          <Text style={st.modeBtnText}>
            {mode === 'tap' ? t('handsfree.modeTap') : t('handsfree.modeAuto')}
          </Text>
        </TouchableOpacity>
      </View>
      <Text style={st.subtitle}>
        {mode === 'tap' ? t('handsfree.subTap') : t('handsfree.subAuto')}
      </Text>

      {/* Voice Lock state: a badge when the lock is on but the service is
          down (failing open), and a one-line setup prompt when the shop has
          never enrolled. Neither blocks anything. */}
      {!!voiceStatus && voiceStatus.mode !== 'off' && !voiceStatus.service_up && (
        <TouchableOpacity style={st.lockOffBadge} onPress={() => navigation.navigate('VoiceEnroll')}>
          <Text style={st.lockOffText}>{t('handsfree.lockOffBadge')}</Text>
        </TouchableOpacity>
      )}
      {!!voiceStatus && !voiceStatus.enrolled && voiceStatus.mode !== 'off' && (
        <TouchableOpacity style={st.enrollBanner} onPress={() => navigation.navigate('VoiceEnroll')}>
          <Text style={st.enrollBannerText}>
            {t('handsfree.enrollBanner')}
          </Text>
          <Text style={st.enrollBannerArrow}>→</Text>
        </TouchableOpacity>
      )}

      {mode === 'tap' ? (
        <View style={st.tapWrap}>
          <TouchableOpacity
            style={[st.micBtn, tap.recording && st.micBtnRec]}
            onPress={() => (tap.recording ? tap.stop() : tap.start())}
          >
            <Ionicons name={tap.recording ? 'stop' : 'mic'} size={48} color="#fff" />
          </TouchableOpacity>
          <Text style={st.tapHint}>
            {tap.recording ? t('handsfree.tapRecording') : t('handsfree.tapIdle')}
          </Text>
          {tap.busy && <ActivityIndicator size="small" color="#2980b9" />}
          {tap.error && <Text style={st.errorText}>{tap.error}</Text>}
        </View>
      ) : (
        <View style={st.statusRow}>
          <View style={[st.dot, { backgroundColor: dotColor }]} />
          <Text style={st.statusText}>{dotLabel}</Text>
          {busy && <ActivityIndicator size="small" color="#2980b9" style={{ marginLeft: 8 }} />}
          {queueDepth > 0 && <Text style={st.badge}> +{queueDepth}</Text>}
        </View>
      )}

      {listenError && <Text style={st.errorText}>{listenError}</Text>}

      {!!lastHeard && (
        <Text style={st.lastHeard} numberOfLines={2}>
          "{lastHeard}"
        </Text>
      )}
      {!!parseError && (
        <Text style={st.parseError} numberOfLines={2}>{t('handsfree.parseError', { err: parseError })}</Text>
      )}
      {!!phoneHint && (
        <Text style={st.phoneHint} numberOfLines={2}>
          {phoneHint}
        </Text>
      )}
      {!!voiceHint && (
        <Text style={st.voiceHint} numberOfLines={1}>{voiceHint}</Text>
      )}

      {/* Items list */}
      <FlatList
        data={items}
        keyExtractor={(_, i) => String(i)}
        style={st.list}
        ListEmptyComponent={
          <Text style={st.emptyText}>
            {t('handsfree.empty')}
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
              : <Text style={st.missingPrice}>{t('handsfree.noPrice')}</Text>}
          </View>
        )}
      />

      {items.length > 0 && (
        <View style={st.totalRow}>
          <Text style={st.totalLabel}>{t('handsfree.total')}</Text>
          <Text style={st.totalAmount}>{'\u20B9'}{total}</Text>
        </View>
      )}

      {/* Countdown overlay */}
      {appState === S.COUNTDOWN && (
        <View style={st.overlay}>
          <Text style={st.overlayPhone}>{'\uD83D\uDCF1'} {detectedPhone}</Text>
          <Text style={st.overlayLabel}>
            {t('handsfree.countdown', { n: secondsLeft })}
          </Text>
          <View style={st.ringWrap}>
            <Animated.View style={[st.ring, { width: ringSize, height: ringSize }]} />
            <Text style={st.ringNum}>{secondsLeft}</Text>
          </View>
          <TouchableOpacity
            style={[st.creditBtn, credit && st.creditBtnOn]}
            onPress={() => { setCredit(!credit); creditRef.current = !credit; }}
          >
            <Text style={st.creditBtnText}>
              {credit ? t('handsfree.creditOn') : t('handsfree.creditOff')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={st.cancelBtn} onPress={handleCancel}>
            <Text style={st.cancelText}>{t('handsfree.cancelSend')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Sending overlay */}
      {appState === S.SENDING && (
        <View style={st.overlay}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={st.sendingText}>{t('handsfree.sending')}</Text>
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, padding: 20, paddingTop: 54 },
  title: { fontSize: 24, fontWeight: '800', color: colors.text, letterSpacing: -0.3, flex: 1, textAlign: 'left', marginLeft: 10 },
  subtitle: { fontSize: 14, color: colors.sub, marginTop: 2, marginBottom: 14, lineHeight: 20 },

  statusRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  dot: { width: 12, height: 12, borderRadius: 6, marginRight: 8 },
  statusText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  badge: { color: colors.primary, fontSize: 12 },
  errorText: { color: colors.red, fontSize: 13, marginBottom: 6 },
  topRow: { flexDirection: 'row', alignItems: 'center' },
  backBtn: { minWidth: 44, minHeight: 44, justifyContent: 'center' },
  backBtnText: { color: colors.text, fontSize: 24, fontWeight: '600' },

  lastHeard: {
    color: colors.sub, fontSize: 13, fontStyle: 'italic',
    backgroundColor: colors.card, borderRadius: 12, padding: 10, marginBottom: 4,
    borderWidth: 1, borderColor: colors.line,
  },
  parseError: { color: colors.orange, fontSize: 12, marginBottom: 6 },
  phoneHint: {
    color: '#B45309', fontSize: 13, fontWeight: '700', backgroundColor: colors.orangeSoft,
    borderRadius: 12, padding: 10, marginBottom: 6, lineHeight: 18,
  },
  voiceHint: {
    color: colors.sub, fontSize: 12.5, fontWeight: '600', fontStyle: 'italic',
    marginBottom: 6, paddingHorizontal: 2,
  },
  lockOffBadge: {
    alignSelf: 'flex-start', backgroundColor: colors.orangeSoft, borderRadius: 10,
    paddingVertical: 7, paddingHorizontal: 11, marginBottom: 8,
  },
  lockOffText: { color: '#92400E', fontSize: 13, fontWeight: '700' },
  enrollBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.primarySoft, borderRadius: 12,
    paddingVertical: 10, paddingHorizontal: 13, marginBottom: 8,
  },
  enrollBannerText: { color: colors.primary, fontSize: 13.5, fontWeight: '700', flex: 1 },
  enrollBannerArrow: { color: colors.primary, fontSize: 16, fontWeight: '800' },

  list: { flex: 1, marginTop: 10 },
  emptyText: { color: colors.faint, textAlign: 'center', marginTop: 40, fontSize: 14, lineHeight: 24 },
  itemRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.card, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14,
    marginBottom: 8, ...shadow,
  },
  itemLeft: { flex: 1 },
  itemName: { color: colors.text, fontSize: 16, fontWeight: '600' },
  itemQty: { color: colors.sub, fontSize: 13, marginTop: 2 },
  itemTotal: { color: colors.green, fontSize: 16, fontWeight: '700' },
  missingPrice: { color: colors.orange, fontSize: 14 },

  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 14,
    borderTopWidth: 1, borderTopColor: colors.line, marginTop: 4,
  },
  totalLabel: { color: colors.text, fontSize: 18, fontWeight: '700' },
  totalAmount: { color: colors.green, fontSize: 22, fontWeight: '800' },

  overlay: {
    ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.92)',
    justifyContent: 'center', alignItems: 'center', zIndex: 10, padding: 30,
  },
  overlayPhone: { color: '#fff', fontSize: 28, fontWeight: '800', letterSpacing: 2, marginBottom: 8 },
  overlayLabel: { color: '#CBD5E1', fontSize: 16, marginBottom: 32, textAlign: 'center' },
  ringWrap: { width: 120, height: 120, justifyContent: 'center', alignItems: 'center', marginBottom: 36 },
  ring: { position: 'absolute', borderRadius: 9999, backgroundColor: colors.green, opacity: 0.35 },
  ringNum: { color: '#fff', fontSize: 52, fontWeight: '800' },
  creditBtn: {
    borderWidth: 1.5, borderColor: colors.orange, borderRadius: 30,
    paddingVertical: 12, paddingHorizontal: 28, marginBottom: 14,
  },
  creditBtnOn: { backgroundColor: 'rgba(217,119,6,0.2)' },
  creditBtnText: { color: '#FBBF24', fontSize: 15, fontWeight: '700' },
  cancelBtn: {
    borderWidth: 1.5, borderColor: '#F87171', borderRadius: 30,
    paddingVertical: 14, paddingHorizontal: 32,
  },
  cancelText: { color: '#FCA5A5', fontSize: 16, fontWeight: '700' },
  sendingText: { color: '#fff', fontSize: 18, marginTop: 20, fontWeight: '600' },

  centeredScreen: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center', padding: 30 },
  doneEmoji: { fontSize: 72, marginBottom: 16 },
  doneTitle: { color: colors.green, fontSize: 30, fontWeight: '800', marginBottom: 8 },
  donePhone: { color: colors.sub, fontSize: 20, letterSpacing: 2, marginBottom: 8 },
  errorEmoji: { fontSize: 64, marginBottom: 16 },
  errorTitle: { color: colors.red, fontSize: 24, fontWeight: '800', marginBottom: 12 },
  errorDetail: { color: colors.sub, fontSize: 14, textAlign: 'center', marginBottom: 20, paddingHorizontal: 10 },

  modeBtn: { backgroundColor: colors.card, borderRadius: 20, minHeight: 40, justifyContent: 'center', paddingHorizontal: 14, borderWidth: 1, borderColor: colors.line },
  modeBtnText: { color: colors.text, fontSize: 13, fontWeight: '700' },
  tapWrap: { alignItems: 'center', marginBottom: 14 },
  micBtn: {
    width: 112, height: 112, borderRadius: 56, backgroundColor: colors.primary,
    justifyContent: 'center', alignItems: 'center', marginBottom: 10, ...shadowStrong,
  },
  micBtnRec: { backgroundColor: colors.red },
  micBtnIcon: { fontSize: 36 },
  tapHint: { color: colors.sub, fontSize: 14, textAlign: 'center' },

  failedTitle: { color: colors.orange, fontSize: 22, fontWeight: '800', marginBottom: 12 },
  readyTitle: { color: colors.green, fontSize: 22, fontWeight: '800', marginBottom: 12, textAlign: 'center' },
  shareBtn: {
    backgroundColor: colors.whatsapp, borderRadius: 14, ...shadow, // WhatsApp green
    paddingVertical: 16, paddingHorizontal: 40, marginTop: 8, marginBottom: 10,
  },
  shareBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  billThumb: { width: 190, height: 250, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: '#fff', marginBottom: 16 },
  failedPhone: { color: colors.sub, fontSize: 15, letterSpacing: 1, marginBottom: 20 },
  skipBtn: { marginTop: 14, paddingVertical: 10, paddingHorizontal: 20 },
  skipBtnText: { color: colors.faint, fontSize: 14, fontWeight: '600' },
  newSaleBtn: {
    backgroundColor: colors.primary, borderRadius: 14, ...shadow,
    paddingVertical: 16, paddingHorizontal: 40, marginTop: 12,
  },
  newSaleBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
});
