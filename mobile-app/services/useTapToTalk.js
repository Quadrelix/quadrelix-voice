// Tap-to-talk recording for noisy shops.
//
// The continuous loop assumes a quiet counter. A real shop has music, customers
// and street noise — the mic hears all of it, Sarvam transcribes all of it, and
// some of it lands on the bill as items nobody sold. This hook records ONLY
// between the shopkeeper's two taps (or until they fall quiet), so the audio
// that reaches the backend is audio they chose to speak, with the phone held
// where they're actually talking.
//
// Segments go to the same onSegment(uri) handler the continuous loop uses, so
// transcribe → parse → phone-detect → countdown all work unchanged.

import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "./errorMessage";
import {
  useAudioRecorder,
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
} from "expo-audio";

// HIGH_QUALITY alone does not enable metering, and metering is how we know the
// shopkeeper has stopped talking. Same shape as useContinuousListening.
//
// android.audioSource: 'voice_recognition' tells Android this mic stream feeds
// speech recognition, and phones apply their noise-suppression + beamforming
// stack to it — background music and shop chatter get attenuated by the device
// itself, before Sarvam ever hears the file. This is the real lever for noisy
// shops; the VAD thresholds above can't remove noise that's already recorded.
const RECORDING_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  isMeteringEnabled: true,
  android: {
    ...RecordingPresets.HIGH_QUALITY.android,
    audioSource: 'voice_recognition',
  },
};

const POLL_MS = 200;
const BASELINE_MS = 600; // learn the room's floor in the pause before speech
const SPEECH_OVER_FLOOR_DB = 9;
const SILENCE_STOP_MS = 2000; // quiet this long after speech = sentence done
const MAX_MS = 30000; // hard cap
const NO_SPEECH_ABORT_MS = 6000; // tapped by accident — drop it, send nothing
const MIN_SPEECH_MS = 400; // shorter than this isn't a sentence worth transcribing
const FLOOR_MIN_DB = -70;
const FLOOR_MAX_DB = -30;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * useTapToTalk({ onSegment })
 *
 * onSegment(uri) is awaited once per recorded segment. Throwing from it is
 * safe — the hook clears its busy flag and stays ready for the next tap.
 */
export function useTapToTalk({ onSegment }) {
  const recorder = useAudioRecorder(RECORDING_OPTIONS);

  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const recordingRef = useRef(false);
  const speechRef = useRef({ saw: false, ms: 0 });

  const onSegmentRef = useRef(onSegment);
  useEffect(() => {
    onSegmentRef.current = onSegment;
  }, [onSegment]);

  // Permission is shared with the continuous recorder on the same screen; ask
  // here too so this hook also works standalone.
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
        setError(errorMessage(e));
      }
    })();
  }, []);

  // Stop — from the second tap OR the monitor loop — and hand the file over if
  // anything worth transcribing was said.
  const stop = useCallback(async () => {
    if (!recordingRef.current) return;
    recordingRef.current = false; // breaks the monitor loop too
    setRecording(false);
    try {
      await recorder.stop();
      const { saw, ms } = speechRef.current;
      const uri = recorder.uri;
      if (uri && saw && ms >= MIN_SPEECH_MS) {
        setBusy(true);
        try {
          await onSegmentRef.current?.(uri);
        } catch {
          // Same policy as the continuous loop: one failed upload must not
          // break the screen — the shopkeeper just taps again.
        } finally {
          setBusy(false);
        }
      }
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      speechRef.current = { saw: false, ms: 0 };
    }
  }, []);

  // Watches the level and stops on the natural end of the sentence, so the
  // shopkeeper doesn't have to tap twice when their hands are full.
  async function monitor() {
    let elapsed = 0;
    let silenceMs = 0;
    let baselineMin = null;
    let floor = null;

    while (recordingRef.current) {
      await sleep(POLL_MS);
      let status = null;
      try {
        status = recorder.getStatus();
      } catch {
        break; // recorder went away (interruption, unmount)
      }

      elapsed = typeof status?.durationMillis === "number" ? status.durationMillis : elapsed + POLL_MS;
      const db = typeof status?.metering === "number" ? status.metering : null;
      if (db == null) continue; // no metering on this device — manual tap still works
      setLevel(db);

      if (floor == null) {
        baselineMin = baselineMin == null ? db : Math.min(baselineMin, db);
        if (elapsed >= BASELINE_MS) floor = clamp(baselineMin, FLOOR_MIN_DB, FLOOR_MAX_DB);
        continue;
      }

      if (db > floor + SPEECH_OVER_FLOOR_DB) {
        speechRef.current = { saw: true, ms: speechRef.current.ms + POLL_MS };
        silenceMs = 0;
      } else {
        silenceMs += POLL_MS;
        if (speechRef.current.saw && silenceMs >= SILENCE_STOP_MS) { stop(); return; }
      }

      if (speechRef.current.saw && elapsed >= MAX_MS) { stop(); return; }
      if (!speechRef.current.saw && elapsed >= NO_SPEECH_ABORT_MS) { stop(); return; }
    }
  }

  const start = useCallback(async () => {
    if (recordingRef.current) return;
    setError(null);
    speechRef.current = { saw: false, ms: 0 };
    try {
      await recorder.prepareToRecordAsync();
      recorder.record();
      recordingRef.current = true;
      setRecording(true);
      monitor();
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    return () => {
      recordingRef.current = false;
    };
  }, []);

  return {
    recording, // true between the two taps
    level, // raw dBFS, for a level meter if wanted
    busy, // the segment is being transcribed/parsed right now
    error,
    start,
    stop,
  };
}
