import { useCallback, useEffect, useRef, useState } from 'react';
import { createTranscriber, sttNeedsKey, type FinalMeta, type Transcriber } from './stt';
import type { Settings } from './settings';

/** Start/stop the microphone transcriber; calls onFinal for each finished utterance. */
export function useTranscriber(settings: Settings, onFinal: (text: string, meta?: FinalMeta) => void) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState('');
  const [level, setLevel] = useState(0);
  const ref = useRef<Transcriber | null>(null);
  const finalRef = useRef(onFinal);
  finalRef.current = onFinal;

  const stop = useCallback(async () => {
    const t = ref.current; ref.current = null;
    if (t) await t.stop().catch(() => {});
    setListening(false); setInterim(''); setLevel(0);
  }, []);

  const start = useCallback(async () => {
    setError('');
    const missing = sttNeedsKey(settings);
    if (missing) { setError(missing); return; }
    await stop();
    const t = createTranscriber(settings, {
      onInterim: setInterim,
      onFinal: (text, meta) => finalRef.current(text, meta),
      onLevel: (l) => setLevel((prev) => (Math.abs(prev - l) > 0.04 ? l : prev)),
      onError: setError,
      onState: setListening,
    });
    ref.current = t;
    try { await t.start(); } catch (e: any) { ref.current = null; setListening(false); setError(String(e?.message ?? e)); }
  }, [settings, stop]);

  useEffect(() => () => { void ref.current?.stop(); }, []);
  // Automated UI tests set the live caption here (only when a test page sets the flag).
  useEffect(() => {
    const w = window as any;
    if (!w.__SOROX_TEST__) return;
    w.__soroxInterim = setInterim;
    return () => { delete w.__soroxInterim; };
  }, []);
  return { listening, interim, error, level, start, stop, setError };
}
