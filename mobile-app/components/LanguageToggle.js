// A two-way pill ("हिं | EN") that switches the app language. Small on purpose
// (it sits in headers) but the touch target is padded to be easy to hit.
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useI18n } from '../services/i18n';
import { colors } from '../theme';

export default function LanguageToggle({ style }) {
  const { lang, setLang, t } = useI18n();
  return (
    <View style={[s.pill, style]} accessibilityLabel={t('lang.switchTo')}>
      {['hi', 'en'].map((code) => {
        const on = lang === code;
        return (
          <TouchableOpacity
            key={code}
            onPress={() => setLang(code)}
            style={[s.opt, on && s.optOn]}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
          >
            <Text style={[s.text, on && s.textOn]}>{t(`lang.${code}`)}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  pill: {
    flexDirection: 'row', backgroundColor: colors.card, borderRadius: 16,
    borderWidth: 1, borderColor: colors.line, padding: 2,
  },
  opt: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, minWidth: 36, alignItems: 'center' },
  optOn: { backgroundColor: colors.primary },
  text: { fontSize: 12, fontWeight: '700', color: colors.sub },
  textOn: { color: '#fff' },
});
