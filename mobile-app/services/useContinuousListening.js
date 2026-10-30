// Keeps the mic open and hands over one utterance at a time.
//
// expo-audio has no streaming API, so "continuous listening" here means a loop
// that records, watches the input level, cuts when the shopkeeper stops talking,
// and immediately starts recording again. Each cut segment goes onto a queue and
// is processed one at a time.
//
// The queue is the part that makes this usable rather than a demo. One utterance
// costs roughly 1-2s of Sarvam transcription plus 4-5s of Gemini parsing, and the
// shopkeeper is already saying the next item by then. Recording therefore never
// waits on the network: it drops the file and moves on. The worker stays
// sequential so items land on the bill in the order they were spoken, and so the
// first response's transaction_id is available to the ones behind it.
//
// Verified before relying on it: expo-audio names every recording file with a
// fresh UUID on both Android (AudioRecorder.kt) and iOS (AudioUtils.swift), so a
// queued URI can't be overwritten by the segment recorded after it.

import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "./errorMessage";
import {
  useAudioRecorder,
  AudioModule,
  setAudioModeAsync,
} from "expo-audio";
// Same options as tap mode and enrollment — Voice Lock compares live audio
// against a profile recorded with this exact pipeline.
import { RECORDING_OPTIONS } from "./recordingOptions";

// ---------------------------------------------------------------------------
// Tuning. Start here if the app cuts you off mid-sentence (raise SILENCE_CUT_MS)
// or never cuts at all (lower SPEECH_OVER_FLOOR_DB).
//
// Metering is dBFS: about -160 for true silence up to 0 for clipping. A quiet
// room usually reads -50 to -40 and speech at arm's length -25 to -15 — but that
// varies with the phone and the room, which is why the floor below is measured
// rather than hardcoded. These numbers are a starting point, not a calibration.
// ---------------------------------------------------------------------------
const POLL_MS = 150; // how often the level is sampled
const BASELINE_MS = 600; // opening window used to learn the room's noise floor
// Measured against the shop floor, not a studio booth. At 12 the shopkeeper had
// to be almost on top of the mic or the app "didn't hear" — a phone lying on the
// counter catches speech a good 6-9 dB above the room, not 12. Lowered, but not
// to nothing: the floor-tracking below is what stops a fan from reading as one
// endless sentence, and it needs some headroom to work with.
const SPEECH_OVER_FLOOR_DB = 9; // this far above the floor counts as a voice
// Hinglish is spoken with pauses inside a sentence — "Dettol ... sabun" is one
// item, not two. At 900ms the app cut on those pauses and sent half a sentence to
// the parser, which is why items came back with a name and no price. 1.2s is past
// the natural stop but well short of the wait between two items.
const SILENCE_CUT_MS = 1200; // quiet for this long after speech ends the segment
const MAX_SEGMENT_MS = 15000; // hard cap, so one long sentence still gets sent
const MIN_SPEECH_MS = 700; // below this it's a cough, a door, a coin on glass
const IDLE_RECYCLE_MS = 8000; // nothing said at all — restart, don't keep the file
const FIXED_CHUNK_MS = 6000; // fallback chunk length when metering is unavailable
const FLOOR_MIN_DB = -70;
const FLOOR_MAX_DB = -30;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * useContinuousListening({ onSegment })
 *
 * onSegment(uri) is awaited, one segment at a time. Throwing from it is safe —
 * the loop keeps listening — so it owns its own error reporting.
 */
export function useContinuousListening({ onSegment }) {
  const recorder = useAudioRecorder(RECORDING_OPTIONS);

  const [isListening, setIsListening] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);
  const [level, setLevel] = useState(null);
  const [queueDepth, setQueueDepth] = useState(0);
  const [busy, setBusy] = useState(false);
  const [meteringAvailable, setMeteringAvailable] = useState(true);
  const [error, setError] = useState(null);

  const runningRef = useRef(false); // listening at all
  const suspendRef = useRef(false); // paused while the app itself is speaking
  const segmentActiveRef = useRef(false);
  const floorRef = useRef(null); // learned once, then tracked across segments
  const fixedChunkRef = useRef(false);
  const meteringSeenRef = useRef(false);

  const queueRef = useRef([]);
  const workingRef = useRef(false);

  // Kept in a ref so a re-rendered callback doesn't leave the loop calling a
  // stale version with an old transaction_id closed over.
  const onSegmentRef = useRef(onSegment);
  useEffect(() => {
    onSegmentRef.current = onSegment;
  }, [onSegment]);

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

  async function drain() {
    if (workingRef.current) return;
    workingRef.current = true;
    setBusy(true);
    try {
      while (queueRef.current.length) {
        const uri = queueRef.current.shift();
        setQueueDepth(queueRef.current.length);
        try {
          await onSegmentRef.current?.(uri);
        } catch {
          // Swallowed on purpose. One failed upload must not end the session —
          // the shopkeeper can't see the screen and would keep talking to an app
          // that stopped listening.
        }
      }
    } finally {
      workingRef.current = false;
      setBusy(false);
    }
  }

  function enqueue(uri) {
    queueRef.current.push(uri);
    setQueueDepth(queueRef.current.length);
    drain(); // deliberately not awaited — recording must never wait on the network
  }

  async function recordSegment() {
    await recorder.prepareToRecordAsync();
    recorder.record();
    segmentActiveRef.current = true;

    let sawSpeech = false;
    let speechMs = 0;
    let silenceMs = 0;
    let elapsed = 0;
    let baselineMin = null;

    try {
      while (runningRef.current && !suspendRef.current) {
        await sleep(POLL_MS);

        let status = null;
        try {
          status = recorder.getStatus();
        } catch {
          // Recorder went away underneath us (interruption, unmount).
          break;
        }

        elapsed = typeof status?.durationMillis === "number" ? status.durationMillis : elapsed + POLL_MS;
        const db = typeof status?.metering === "number" ? status.metering : null;

        if (db == null) {
          // Some devices simply don't report metering. Rather than listen
          // forever and never cut, fall back to fixed chunks: the shopkeeper
          // keeps their hands free, we just can't skip the silence.
          if (!meteringSeenRef.current && elapsed >= 1500 && !fixedChunkRef.current) {
            fixedChunkRef.current = true;
            setMeteringAvailable(false);
          }
          if (fixedChunkRef.current && elapsed >= FIXED_CHUNK_MS) {
            sawSpeech = true;
            speechMs = FIXED_CHUNK_MS;
            break;
          }
          continue;
        }

        meteringSeenRef.current = true;
        setLevel(db);

        // First segment of the session: measure the room before judging it. The
        // MINIMUM of the window, not the average, because if the shopkeeper
        // starts talking straight away the average would be a speech level and
        // nothing would ever cross the threshold afterwards.
        if (floorRef.current == null) {
          baselineMin = baselineMin == null ? db : Math.min(baselineMin, db);
          if (elapsed >= BASELINE_MS) {
            floorRef.current = clamp(baselineMin, FLOOR_MIN_DB, FLOOR_MAX_DB);
          }
          continue;
        }

        if (db > floorRef.current + SPEECH_OVER_FLOOR_DB) {
          sawSpeech = true;
          speechMs += POLL_MS;
          silenceMs = 0;
          setVoiceActive(true);
        } else {
          silenceMs += POLL_MS;
          setVoiceActive(false);
          // Track the room slowly. A fan or a generator starting up would
          // otherwise sit above the old floor and read as one endless sentence.
          // This also self-heals a floor learned too high, since every sample
          // then counts as silence and pulls it back down.
          floorRef.current = clamp(floorRef.current * 0.9 + db * 0.1, FLOOR_MIN_DB, FLOOR_MAX_DB);
          if (sawSpeech && silenceMs >= SILENCE_CUT_MS) break;
        }

        if (sawSpeech && elapsed >= MAX_SEGMENT_MS) break;
        if (!sawSpeech && elapsed >= IDLE_RECYCLE_MS) break;
      }
    } finally {
      segmentActiveRef.current = false;
      setVoiceActive(false);
    }

    let uri = null;
    try {
      await recorder.stop();
      uri = recorder.uri;
    } catch (e) {
      setError(errorMessage(e));
    }

    // The opposite failure of a too-high floor: a floor below the real room
    // noise makes everything look like speech, so segments only ever end at the
    // hard cap. Nudge it up when that happens.
    if (speechMs >= elapsed * 0.95 && elapsed >= MAX_SEGMENT_MS) {
      floorRef.current = clamp((floorRef.current ?? FLOOR_MIN_DB) + 6, FLOOR_MIN_DB, FLOOR_MAX_DB);
    }

    if (uri && sawSpeech && speechMs >= MIN_SPEECH_MS) enqueue(uri);
  }

  async function loop() {
    while (runningRef.current) {
      if (suspendRef.current) {
        await sleep(120);
        continue;
      }
      try {
        await recordSegment();
      } catch (e) {
        // A failure to even start recording would otherwise spin this loop at
        // full speed, so it ends the session and says why.
        setError(errorMessage(e));
        runningRef.current = false;
        setIsListening(false);
        return;
      }
    }
  }

  const start = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    suspendRef.current = false;
    setError(null);
    setIsListening(true);
    loop();
  }, []);

  const stop = useCallback(async () => {
    runningRef.current = false;
    setIsListening(false);
    // The queue is deliberately left to finish. The last thing said is often the
    // customer's phone number, and dropping it would mean asking for all ten
    // digits again.
    const deadline = Date.now() + 2000;
    while (segmentActiveRef.current && Date.now() < deadline) await sleep(50);
  }, []);

  // Used around text-to-speech. Without it the app transcribes its own voice
  // reading the number back and treats that as the shopkeeper talking.
  const suspend = useCallback(async () => {
    suspendRef.current = true;
    const deadline = Date.now() + 1500;
    while (segmentActiveRef.current && Date.now() < deadline) await sleep(50);
  }, []);

  const resume = useCallback(() => {
    suspendRef.current = false;
  }, []);

  useEffect(() => {
    return () => {
      runningRef.current = false;
      suspendRef.current = true;
    };
  }, []);

  return {
    isListening,
    voiceActive, // true while a voice is being heard right now
    level, // raw dBFS, handy for a level meter or for tuning
    queueDepth, // utterances waiting on the network
    busy, // an utterance is being transcribed/parsed right now
    meteringAvailable, // false = degraded to fixed-length chunks
    error,
    start,
    stop,
    suspend,
    resume,
  };
}
