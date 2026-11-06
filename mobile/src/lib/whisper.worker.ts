// Soro X Mobile: on-device Whisper (transformers.js + ONNX Runtime, WebAssembly).
// The model and runtime download once, then are read from the browser cache:
// transcription works offline and audio never leaves the phone.
import { env, pipeline } from '@huggingface/transformers';

env.allowLocalModels = false;
env.useBrowserCache = true;

type Asr = (audio: Float32Array, opts: Record<string, unknown>) => Promise<{ text?: string } | { text?: string }[]>;
let asr: Asr | null = null;
let loaded = '';

const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;
  try {
    if (msg.type === 'load') {
      if (asr && loaded === msg.model) { post({ type: 'ready', model: msg.model }); return; }
      const files = new Map<string, { loaded: number; total: number }>();
      asr = (await pipeline('automatic-speech-recognition', msg.model, {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: (p: any) => {
          if (p?.status === 'progress' && p.file) {
            files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
            let a = 0; let t = 0;
            for (const f of files.values()) { a += f.loaded; t += f.total; }
            post({ type: 'progress', loaded: a, total: t });
          }
        },
      })) as unknown as Asr;
      loaded = msg.model;
      post({ type: 'ready', model: msg.model });
      return;
    }
    if (msg.type === 'transcribe') {
      if (!asr) throw new Error('The offline voice model is not loaded.');
      const english = String(loaded).endsWith('.en');
      const out = await asr(msg.audio, english ? {} : { language: msg.language, task: 'transcribe' });
      const text = Array.isArray(out) ? out.map((o) => o.text ?? '').join(' ') : out.text ?? '';
      post({ type: 'result', id: msg.id, text: text.trim() });
    }
  } catch (err: any) {
    post({ type: 'error', id: msg.id, message: String(err?.message ?? err) });
  }
};
