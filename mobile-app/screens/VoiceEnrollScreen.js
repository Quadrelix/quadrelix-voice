// VoiceEnrollScreen.js — register the shop owner's voice ("Voice Lock").
//
// Five short clips, each a different everyday sentence, recorded with the SAME
// mic pipeline the billing screen uses (see services/recordingOptions.js).
// That matters: verification compares live audio against these embeddings, so
// a profile recorded through a different pipeline would score everything wrong.
//
// Two of the five sentences ask the owner to record with the shop's normal
// background noise rather than a silent room — real billing happens in that
// noise, and a profile recorded in silence rejects the real thing.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useFixedRecording } from '../services/useFixedRecording';
import { enrollVoice, getVoiceStatus, resetVoice } from '../services/api';
import { errorMessage } from '../services/errorMessage';
import { useI18n } from '../services/i18n';
import { colors, shadow } from '../theme';

const CLIP_SECONDS = 6;

// Everyday Hinglish the owner is likely to say at the counter — plain words,
// varied sounds, nothing that needs reading ahead. This is speech content, so it
// is the same in both UI languages (not translated).
const SENTENCES = [
  'Aaj dukaan theek se chali, subah se shaam tak grahak aate rahe.',
  'Do kilo cheeni aur ek kilo chawal ka hisaab likh lo.',
  'Bill banane ke baad grahak ko WhatsApp par bhej dena.',
  'Stock kam ho to naya maal mangwana zaroori hai.',
  'Bhagwan ka shukar hai, roz ka kaam theek chal raha hai.',
];

// Which clips should be recorded in the shop's normal noise (T4.7).
const NOISY_CLIPS = new Set([2, 4]);

const TOTAL = SENTENCES.length;

export default function VoiceEnrollScreen() {
  const navigation = useNavigation();
  const { t } = useI18n();
  const recorder = useFixedRecording({ seconds: CLIP_SECONDS });

  const [index, setIndex] = useState(0); // which sentence is next
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [samples, setSamples] = useState(0);
  const [mode, setMode] = useState(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [resetOpen, setResetOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [resetting, setResetting] = useState(false);

  const cancelled = useRef(false);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const s = await getVoiceStatus();
      setSamples(s.samples || 0);
      setMode(s.mode);
      setIndex((i) => Math.min(i, Math.max(0, TOTAL - (s.samples || 0))));
    } catch (e) {
      setError(errorMessage(e, t('common.serverError')));
    } finally {
      setStatusLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadStatus();
    return () => { cancelled.current = true; };
  }, [loadStatus]);

  async function recordAndUpload() {
    setError(null);
    const uri = await recorder.record();
    if (!uri || cancelled.current) return;

    setUploading(true);
    try {
      const result = await enrollVoice(uri);
      setSamples(result.samples ?? samples + 1);
      const next = index + 1;
      setIndex(next);
      if (next >= TOTAL) setDone(true);
    } catch (e) {
      setError(errorMessage(e, t('voiceEnroll.uploadFailed')));
    } finally {
      setUploading(false);
    }
  }

  async function doReset() {
    if (!pin.trim()) { setError(t('voiceEnroll.pinRequired')); return; }
    setResetting(true);
    setError(null);
    try {
      await resetVoice(pin.trim());
      setResetOpen(false);
      setPin('');
      setDone(false);
      setIndex(0);
      setSamples(0);
    } catch (e) {
      setError(errorMessage(e, t('voiceEnroll.resetFailed')));
    } finally {
      setResetting(false);
    }
  }

  // ── Already enrolled ─────────────────────────────────────────────────────
  if (!statusLoading && samples >= TOTAL && !done && !resetOpen) {
    return (
      <View style={s.screen}>
        <Header onBack={() => navigation.goBack()} title={t('voiceEnroll.title')} />
        <View style={s.centerCard}>
          <View style={s.iconCircle}>
            <Ionicons name="shield-checkmark" size={40} color={colors.green} />
          </View>
          <Text style={s.bigTitle}>{t('voiceEnroll.readyTitle')}</Text>
          <Text style={s.bigSub}>
            {t('voiceEnroll.readySub')}
            {mode === 'off' ? `\n\n${t('voiceEnroll.lockOff')}` : ''}
          </Text>
          <TouchableOpacity style={s.primaryBtn} onPress={() => navigation.goBack()}>
            <Text style={s.primaryBtnText}>{t('voiceEnroll.startBilling')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.linkBtn} onPress={() => setResetOpen(true)}>
            <Text style={s.linkBtnText}>{t('voiceEnroll.reRegister')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Reset (re-enroll) ────────────────────────────────────────────────────
  if (resetOpen) {
    return (
      <View style={s.screen}>
        <Header onBack={() => setResetOpen(false)} title={t('voiceEnroll.resetHeader')} />
        <View style={s.centerCard}>
          <Ionicons name="lock-closed" size={38} color={colors.orange} />
          <Text style={s.bigTitle}>{t('voiceEnroll.resetTitle')}</Text>
          <Text style={s.bigSub}>
            {t('voiceEnroll.resetSub')}
          </Text>
          <TextInput
            style={s.pinInput}
            value={pin}
            onChangeText={setPin}
            keyboardType="numeric"
            secureTextEntry
            placeholder={t('voiceEnroll.pinPlaceholder')}
            placeholderTextColor={colors.faint}
            maxLength={8}
          />
          {!!error && <Text style={s.errorText}>{error}</Text>}
          <TouchableOpacity
            style={[s.primaryBtn, resetting && { opacity: 0.6 }]}
            onPress={doReset}
            disabled={resetting}
          >
            <Text style={s.primaryBtnText}>{resetting ? t('voiceEnroll.deleting') : t('voiceEnroll.confirm')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Success ──────────────────────────────────────────────────────────────
  if (done) {
    return (
      <View style={s.screen}>
        <View style={s.centerCard}>
          <View style={s.iconCircle}>
            <Ionicons name="checkmark-circle" size={44} color={colors.green} />
          </View>
          <Text style={s.bigTitle}>{t('voiceEnroll.doneTitle')}</Text>
          <Text style={s.bigSub}>
            {t('voiceEnroll.doneSub')}
          </Text>
          <TouchableOpacity style={s.primaryBtn} onPress={() => navigation.goBack()}>
            <Text style={s.primaryBtnText}>{t('voiceEnroll.startBilling')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Recording ────────────────────────────────────────────────────────────
  const noisy = NOISY_CLIPS.has(index);

  return (
    <View style={s.screen}>
      <Header onBack={() => navigation.goBack()} title={t('voiceEnroll.recordTitle')} />

      <ScrollView contentContainerStyle={s.scroll}>
        <View style={s.progressRow}>
          {Array.from({ length: TOTAL }).map((_, i) => (
            <View
              key={i}
              style={[
                s.progressDot,
                i < samples && s.progressDone,
                i === index && s.progressCurrent,
              ]}
            />
          ))}
        </View>
        <Text style={s.progressText}>{Math.min(index + 1, TOTAL)} / {TOTAL}</Text>

        <View style={s.sentenceCard}>
          <Text style={s.sentenceLabel}>{t('voiceEnroll.readThis')}</Text>
          <Text style={s.sentence}>{SENTENCES[index]}</Text>
          {noisy && (
            <View style={s.noisyNote}>
              <Ionicons name="volume-high" size={15} color={colors.orange} />
              <Text style={s.noisyText}>
                {t('voiceEnroll.noisyNote')}
              </Text>
            </View>
          )}
        </View>

        <TouchableOpacity
          style={[s.micBtn, recorder.recording && s.micBtnRec, (uploading || recorder.busy) && { opacity: 0.7 }]}
          onPress={recordAndUpload}
          disabled={recorder.recording || uploading || recorder.busy}
        >
          {uploading || recorder.busy
            ? <ActivityIndicator color="#fff" />
            : <Ionicons name={recorder.recording ? 'stop' : 'mic'} size={38} color="#fff" />}
        </TouchableOpacity>

        <Text style={s.micHint}>
          {recorder.recording
            ? t('voiceEnroll.secondsLeft', { n: recorder.secondsLeft })
            : uploading
              ? t('voiceEnroll.saving')
              : t('voiceEnroll.tapToRecord', { n: CLIP_SECONDS })}
        </Text>

        {(!!error || !!recorder.error) && (
          <Text style={s.errorText}>{error || recorder.error}</Text>
        )}
      </ScrollView>
    </View>
  );
}

function Header({ onBack, title }) {
  const { t } = useI18n();
  return (
    <View style={s.header}>
      <TouchableOpacity style={s.backBtn} onPress={onBack} accessibilityLabel={t('common.back')}>
        <Ionicons name="arrow-back" size={24} color={colors.text} />
      </TouchableOpacity>
      <Text style={s.headerTitle}>{title}</Text>
      <View style={{ width: 44 }} />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 56, paddingBottom: 10,
  },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '800', color: colors.text },

  scroll: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 32, alignItems: 'center' },

  progressRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  progressDot: { width: 34, height: 6, borderRadius: 3, backgroundColor: colors.line },
  progressDone: { backgroundColor: colors.green },
  progressCurrent: { backgroundColor: colors.primary },
  progressText: { fontSize: 14, color: colors.sub, marginTop: 8, fontWeight: '700' },

  sentenceCard: {
    backgroundColor: colors.card, borderRadius: 18, padding: 18, marginTop: 18,
    width: '100%', ...shadow,
  },
  sentenceLabel: { fontSize: 13, color: colors.faint, fontWeight: '700', marginBottom: 8 },
  sentence: { fontSize: 17, lineHeight: 26, color: colors.text, fontWeight: '600' },
  noisyNote: {
    flexDirection: 'row', alignItems: 'flex-start', backgroundColor: colors.orangeSoft,
    borderRadius: 10, padding: 10, marginTop: 12,
  },
  noisyText: { color: '#92400E', fontSize: 13, marginLeft: 7, flex: 1, lineHeight: 19 },

  micBtn: {
    width: 96, height: 96, borderRadius: 48, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center', marginTop: 26, ...shadow,
  },
  micBtnRec: { backgroundColor: colors.red },
  micHint: { color: colors.sub, fontSize: 14, marginTop: 12, fontWeight: '600' },
  errorText: { color: colors.red, fontSize: 14, marginTop: 12, textAlign: 'center' },

  centerCard: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 30 },
  iconCircle: {
    width: 84, height: 84, borderRadius: 42, backgroundColor: colors.greenSoft,
    alignItems: 'center', justifyContent: 'center', marginBottom: 18,
  },
  bigTitle: { fontSize: 22, fontWeight: '800', color: colors.text, marginTop: 12, textAlign: 'center' },
  bigSub: { fontSize: 14, color: colors.sub, marginTop: 10, textAlign: 'center', lineHeight: 21 },
  primaryBtn: {
    backgroundColor: colors.primary, borderRadius: 14, minHeight: 48, justifyContent: 'center',
    paddingHorizontal: 36, marginTop: 24, ...shadow,
  },
  primaryBtnText: { color: '#fff', fontSize: 15.5, fontWeight: '700' },
  linkBtn: { marginTop: 16, minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  linkBtnText: { color: colors.sub, fontSize: 14, fontWeight: '600' },
  pinInput: {
    backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.line,
    paddingVertical: 12, paddingHorizontal: 16, fontSize: 20, letterSpacing: 6,
    textAlign: 'center', width: 170, marginTop: 20, color: colors.text,
  },
});