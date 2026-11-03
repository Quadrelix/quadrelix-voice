// CalibrateScreen.js — the team's voice test.
//
// To choose the Voice Lock threshold from real recordings we need scores that
// are LABELLED: who was speaking. Here the tester picks the label (owner / owner
// in noise / owner far away / someone else / TV), taps the mic with the same
// recorder the billing screen uses, and the backend scores the clip against the
// shop's enrolled voice and logs score + label. No transcript, no bill, and no
// audio is kept. voice-service/analyze_log.py turns those rows into a threshold.
//
// Opened by tapping the logo on Home five times, so shopkeepers never see it.

import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTapToTalk } from '../services/useTapToTalk';
import { calibrateVoice } from '../services/api';
import { errorMessage } from '../services/errorMessage';
import { useI18n } from '../services/i18n';
import { colors, shadow, shadowStrong } from '../theme';

// `own` = the clip SHOULD be accepted (the enrolled voice speaking).
const LABELS = [
  { key: 'owner', text: 'calibrate.labelOwner', own: true },
  { key: 'owner_noisy', text: 'calibrate.labelOwnerNoisy', own: true },
  { key: 'owner_far', text: 'calibrate.labelOwnerFar', own: true },
  { key: 'other', text: 'calibrate.labelOther', own: false },
  { key: 'tv', text: 'calibrate.labelTv', own: false },
];

export default function CalibrateScreen() {
  const navigation = useNavigation();
  const { t } = useI18n();

  const [label, setLabel] = useState('owner');
  const labelRef = useRef('owner'); // the label that was selected when the clip was recorded
  const [scoring, setScoring] = useState(false);
  const [message, setMessage] = useState(null); // { kind, text? }
  const [last, setLast] = useState(null);
  const [results, setResults] = useState([]);

  function pick(key) {
    labelRef.current = key;
    setLabel(key);
  }

  async function onSegment(uri) {
    const key = labelRef.current;
    const own = LABELS.find((l) => l.key === key)?.own ?? false;
    setScoring(true);
    setMessage(null);
    try {
      const r = await calibrateVoice(uri, key);
      if (r.status === 'not_enrolled') {
        setMessage({ kind: 'notEnrolled' });
        return;
      }
      if (r.reason === 'too_short') {
        setMessage({ kind: 'tooShort' });
        return;
      }
      const entry = {
        key,
        own,
        score: r.score,
        threshold: r.threshold,
        // right = the lock did what it should: accept the owner, refuse everyone else
        correct: own === Boolean(r.is_speaker),
      };
      setLast(entry);
      setResults((prev) => [entry, ...prev].slice(0, 200));
    } catch (e) {
      setMessage({ kind: 'error', text: errorMessage(e, t('calibrate.error')) });
    } finally {
      setScoring(false);
    }
  }

  const tap = useTapToTalk({ onSegment });

  const summary = LABELS.map((l) => {
    const rows = results.filter((r) => r.key === l.key);
    return { ...l, n: rows.length, right: rows.filter((r) => r.correct).length };
  }).filter((l) => l.n > 0);

  return (
    <View style={s.screen}>
      <View style={s.topRow}>
        <TouchableOpacity style={s.back} onPress={() => navigation.goBack()} accessibilityLabel={t('common.back')}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={s.title}>{t('calibrate.title')}</Text>
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <Text style={s.intro}>{t('calibrate.intro')}</Text>

        <View style={s.chips}>
          {LABELS.map((l) => {
            const on = label === l.key;
            return (
              <TouchableOpacity
                key={l.key}
                style={[s.chip, l.own ? s.chipOwn : s.chipOther, on && (l.own ? s.chipOwnOn : s.chipOtherOn)]}
                onPress={() => pick(l.key)}
                disabled={tap.recording || scoring}
                accessibilityState={{ selected: on }}
              >
                <Text style={[s.chipText, on && s.chipTextOn]}>{t(l.text)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={s.micWrap}>
          <TouchableOpacity
            style={[s.mic, tap.recording && s.micRec, scoring && { opacity: 0.5 }]}
            onPress={() => (tap.recording ? tap.stop() : tap.start())}
            disabled={scoring}
            activeOpacity={0.85}
          >
            <Ionicons name={tap.recording ? 'stop' : 'mic'} size={46} color="#fff" />
          </TouchableOpacity>
          <Text style={s.hint}>
            {scoring ? t('calibrate.scoring') : tap.recording ? t('calibrate.tapRecording') : t('calibrate.tapIdle')}
          </Text>
          {(scoring || tap.busy) && <ActivityIndicator color={colors.primary} style={{ marginTop: 6 }} />}
          {!!tap.error && <Text style={s.errorText}>{tap.error}</Text>}
        </View>

        {message?.kind === 'tooShort' && <Text style={s.warn}>{t('calibrate.tooShort')}</Text>}
        {message?.kind === 'error' && <Text style={s.errorText}>{message.text}</Text>}
        {message?.kind === 'notEnrolled' && (
          <View style={s.warnCard}>
            <Text style={s.warnCardText}>{t('calibrate.notEnrolled')}</Text>
            <TouchableOpacity style={s.warnBtn} onPress={() => navigation.navigate('VoiceEnroll')}>
              <Text style={s.warnBtnText}>{t('calibrate.register')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {!!last && !message && (
          <View style={[s.result, last.correct ? s.resultOk : s.resultBad]}>
            <Text style={[s.resultVerdict, { color: last.correct ? colors.green : colors.red }]}>
              {last.correct ? t('calibrate.correct') : t('calibrate.wrong')}
            </Text>
            <Text style={s.resultScore}>
              {t('calibrate.score', { score: Number(last.score).toFixed(2), threshold: Number(last.threshold).toFixed(2) })}
            </Text>
          </View>
        )}

        {summary.length > 0 && (
          <View style={s.summary}>
            <Text style={s.summaryTitle}>{t('calibrate.summaryTitle')}</Text>
            {summary.map((l) => (
              <View key={l.key} style={s.summaryRow}>
                <Text style={s.summaryLabel}>{t(l.text)}</Text>
                <Text style={s.summaryValue}>{t('calibrate.summaryRow', { n: l.n, right: l.right })}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={s.note}>{t('calibrate.note')}</Text>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingTop: 52 },
  topRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 22, fontWeight: '800', color: colors.text, marginLeft: 4 },
  scroll: { padding: 20, paddingBottom: 40 },
  intro: { fontSize: 14, color: colors.sub, lineHeight: 20, marginBottom: 14 },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: 22, minHeight: 44, paddingHorizontal: 16, justifyContent: 'center', borderWidth: 1.5 },
  chipOwn: { borderColor: colors.green, backgroundColor: colors.card },
  chipOther: { borderColor: colors.orange, backgroundColor: colors.card },
  chipOwnOn: { backgroundColor: colors.green },
  chipOtherOn: { backgroundColor: colors.orange },
  chipText: { fontSize: 14, fontWeight: '700', color: colors.text },
  chipTextOn: { color: '#fff' },

  micWrap: { alignItems: 'center', marginTop: 26, marginBottom: 12 },
  mic: {
    width: 112, height: 112, borderRadius: 56, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center', ...shadowStrong,
  },
  micRec: { backgroundColor: colors.red },
  hint: { color: colors.sub, fontSize: 14, marginTop: 12, textAlign: 'center' },

  result: { borderRadius: 16, padding: 16, marginTop: 8, alignItems: 'center', borderWidth: 1.5, backgroundColor: colors.card },
  resultOk: { borderColor: colors.green },
  resultBad: { borderColor: colors.red },
  resultVerdict: { fontSize: 24, fontWeight: '800' },
  resultScore: { fontSize: 15, color: colors.text, marginTop: 4, fontWeight: '600' },

  warn: { color: colors.orange, fontSize: 14, fontWeight: '600', textAlign: 'center', marginTop: 8 },
  errorText: { color: colors.red, fontSize: 13, textAlign: 'center', marginTop: 8 },
  warnCard: { backgroundColor: colors.orangeSoft, borderRadius: 14, padding: 14, marginTop: 8, alignItems: 'center' },
  warnCardText: { color: '#92400E', fontSize: 14, fontWeight: '700' },
  warnBtn: { marginTop: 10, minHeight: 44, paddingHorizontal: 20, justifyContent: 'center', borderRadius: 12, backgroundColor: colors.primary },
  warnBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  summary: { backgroundColor: colors.card, borderRadius: 16, padding: 14, marginTop: 20, ...shadow },
  summaryTitle: { fontSize: 14, fontWeight: '800', color: colors.text, marginBottom: 6 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7 },
  summaryLabel: { fontSize: 14, color: colors.text },
  summaryValue: { fontSize: 14, color: colors.sub, fontWeight: '600' },

  note: { color: colors.faint, fontSize: 12, textAlign: 'center', marginTop: 22 },
});
