// Records audio using expo-audio (the current Expo SDK 54+ audio API —
// expo-av is deprecated and was removed for SDK 54). Works in plain Expo
// Go, no native dev build needed.
//
// Flow: start() begins recording -> stop() finishes and returns a local
// file URI -> that file gets uploaded to our backend's /api/transcribe
// endpoint, which sends it to Sarvam AI and returns text.

import { useState, useEffect } from "react";
import { useAudioRecorder, AudioModule, RecordingPresets, setAudioModeAsync } from "expo-audio";

export function useAudioRecording() {
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const status = await AudioModule.requestRecordingPermissionsAsync();
        if (!status.granted) {
          setError("Mic permission chahiye — Settings mein allow karein");
          return;
        }
        await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      } catch (e) {
        setError(e.message);
      }
    })();
  }, []);

  async function start() {
    setError(null);
    try {
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      setIsRecording(true);
    } catch (e) {
      setError(e.message);
    }
  }

  async function stop() {
    try {
      await audioRecorder.stop();
      setIsRecording(false);
      return audioRecorder.uri; // local file URI, ready to upload
    } catch (e) {
      setError(e.message);
      setIsRecording(false);
      return null;
    }
  }

  return { isRecording, error, start, stop };
}