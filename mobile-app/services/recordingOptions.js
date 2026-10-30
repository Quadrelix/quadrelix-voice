// The one set of recording options the whole app uses.
//
// Voice Lock compares a live clip against a profile built from enrollment
// clips. If enrollment used a different mic pipeline than live billing, the two
// sets of embeddings would sit in slightly different acoustic conditions and
// every score would be off. Sharing this object is what guarantees they match —
// so enrollment (useFixedRecording) and both live modes (useTapToTalk,
// useContinuousListening) all import it from here.
//
// android.audioSource: 'voice_recognition' tells Android this mic stream feeds
// speech recognition, so the phone applies its noise-suppression + beamforming
// stack before anything reaches Sarvam. This is the real lever for noisy shops.

import { RecordingPresets } from 'expo-audio';

export const RECORDING_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  isMeteringEnabled: true,
  android: {
    ...RecordingPresets.HIGH_QUALITY.android,
    audioSource: 'voice_recognition',
  },
};