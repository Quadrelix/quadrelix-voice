// Fixed-duration recording, for voice enrollment.
//
// useTapToTalk stops when the shopkeeper goes quiet — right for billing, wrong
// for enrollment, where every clip should be a comparable length and the owner
// is reading a sentence off the screen. This hook records for exactly N
// seconds (or until stopped) and hands back one file.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAudioRecorder, AudioModule, setAudioModeAsync } from 'expo-audio';
import { RECORDING_OPTIONS } from './recordingOptions';
import { errorMessage } from './errorMessage';

export function useFixedRecording({ seconds = 6 } = {}) {
  const recorder = useAudioRecorder(RECORDING_OPTIONS);

  const [recording, setRecording] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(seconds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const recordingRef = useRef(false);
  const timerRef = useRef(null);
  const resolveRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const status = await AudioModule.requestRecordingPermissionsAsync();
        if (!status.granted) {
          setError('Mic permission chahiye — Settings mein allow karein');
          return;
        }
        await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      } catch (e) {
        setError(errorMessage(e));
      }
    })();
  }, []);

  const stop = useCallback(async () => {
    if (!recordingRef.current) return null;
    recordingRef.current = false;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRecording(false);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (resolveRef.current) {
        resolveRef.current(uri || null);
        resolveRef.current = null;
      }
      return uri || null;
    } catch (e) {
      setError(errorMessage(e));
      if (resolveRef.current) {
        resolveRef.current(null);
        resolveRef.current = null;
      }
      return null;
    }
  }, [recorder]);

  /**
   * Record one clip. Resolves with the file URI (or null on failure).
   * The returned promise settles when the clip is FINISHED — the caller can
   * then upload it without guessing when recording stopped.
   */
  const record = useCallback(async () => {
    if (recordingRef.current) return null;
    setError(null);
    setBusy(true);
    setSecondsLeft(seconds);

    const done = new Promise((resolve) => {
      resolveRef.current = resolve;
    });

    try {
      await recorder.prepareToRecordAsync();
      recorder.record();
      recordingRef.current = true;
      setRecording(true);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
      resolveRef.current?.(null);
      resolveRef.current = null;
      return null;
    }

    let left = seconds;
    timerRef.current = setInterval(async () => {
      left -= 1;
      setSecondsLeft(Math.max(0, left));
      if (left <= 0) {
        await stop();
      }
    }, 1000);

    const uri = await done;
    setBusy(false);
    return uri;
  }, [recorder, seconds, stop]);

  useEffect(() => {
    return () => {
      recordingRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  return { recording, secondsLeft, busy, error, record, stop };
}