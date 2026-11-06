import { useCallback, useEffect, useRef, useState } from 'react';
import { createTranscriber, sttNeedsKey, type Transcriber } from './stt';
import type { Settings } from './settings';

/** Start/stop the microphone transcriber; calls onFinal for each finished utterance. */
export function useTranscriber(settings: Settings, onFinal: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState('');
  const ref = useRef<Transcriber | null>(null);
  const finalRef = useRef(onFinal);
  finalRef.current = onFinal;

  const stop = useCallback(async () => {
    const t = ref.current; ref.current = null;
    if (t) await t.stop().catch(() => {});
    setListening(false); setInterim('');
  }, []);

  const start = useCallback(async () => {
    setError('');
    const missing = sttNeedsKey(settings);
    if (missing) { setError(missing); return; }
    await stop();
    const t = createTranscriber(settings, {
      onInterim: setInterim,
      onFinal: (text) => finalRef.current(text),
      onError: setError,
      onState: setListening,
    });
    ref.current = t;
    try { await t.start(); } catch (e: any) { ref.current = null; setListening(false); setError(String(e?.message ?? e)); }
  }, [settings, stop]);

  useEffect(() => () => { void ref.current?.stop(); }, []);
  return { listening, interim, error, start, stop, setError };
}
