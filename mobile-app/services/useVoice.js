// Wraps @react-native-voice/voice into a simple hook: { text, isListening, start, stop }
//
// IMPORTANT: @react-native-voice/voice needs native code, so it does NOT work
// inside plain "Expo Go" — and importing it there can crash the app. This file
// safely detects that case and falls back to text-only mode (voiceAvailable=false)
// instead of crashing, so you can test everything else first.
//
// To get the real mic working: build a development build —
//   npx expo prebuild
//   npx expo run:android
// See mobile-app/README.md for full steps.

import { useEffect, useState } from "react";

let Voice = null;
let voiceAvailable = true;

try {
  Voice = require("@react-native-voice/voice").default;
  if (!Voice) voiceAvailable = false;
} catch (e) {
  voiceAvailable = false;
}

export function useVoice() {
  const [text, setText] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState(
    voiceAvailable ? null : "Voice mic Expo Go mein kaam nahi karta — neeche text box use karein"
  );

  useEffect(() => {
    if (!voiceAvailable) return;

    try {
      Voice.onSpeechStart = () => setIsListening(true);
      Voice.onSpeechEnd = () => setIsListening(false);
      Voice.onSpeechResults = (e) => {
        if (e.value && e.value.length > 0) setText(e.value[0]);
      };
      Voice.onSpeechError = (e) => setError(e.error);
    } catch (e) {
      voiceAvailable = false;
    }

    return () => {
      if (voiceAvailable && Voice) {
        Voice.destroy().then(Voice.removeAllListeners).catch(() => {});
      }
    };
  }, []);

  async function start() {
    if (!voiceAvailable) {
      setError("Voice mic Expo Go mein kaam nahi karta — neeche text box use karein");
      return;
    }
    setError(null);
    setText("");
    try {
      // "hi-IN" works well for Hindi/Hinglish speech on most Android devices.
      // Switch to "en-IN" if your users speak mostly English.
      await Voice.start("hi-IN");
    } catch (e) {
      setError(e.message);
    }
  }

  async function stop() {
    if (!voiceAvailable) return;
    try {
      await Voice.stop();
    } catch (e) {
      setError(e.message);
    }
  }

  return { text, isListening, error, start, stop, setText, voiceAvailable };
}
