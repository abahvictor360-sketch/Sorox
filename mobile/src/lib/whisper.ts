// Soro X Mobile: client for the on-device Whisper worker.

export const WHISPER_MODELS: { id: string; label: string; size: string; note: string }[] = [
  { id: 'onnx-community/whisper-tiny.en', label: 'Tiny (English)', size: '≈ 45 MB', note: 'Fastest. Good for clear English.' },
  { id: 'onnx-community/whisper-base.en', label: 'Base (English)', size: '≈ 80 MB', note: 'More accurate English, a little slower.' },
  { id: 'onnx-community/whisper-tiny', label: 'Tiny (any language)', size: '≈ 45 MB', note: 'Other languages; uses your Listening language.' },
  { id: 'onnx-community/whisper-base', label: 'Base (any language)', size: '≈ 80 MB', note: 'Other languages, more accurate.' },
];

const READY_KEY = 'sorox.mobile.whisper.ready.v1';

/** Models downloaded before (they then load from the cache, offline). */
export function downloadedModels(): string[] {
  try { const v = JSON.parse(localStorage.getItem(READY_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

function markDownloaded(model: string) {
  const list = [...new Set([...downloadedModels(), model])];
  try { localStorage.setItem(READY_KEY, JSON.stringify(list)); } catch { /* ignore */ }
}

let worker: Worker | null = null;
let ready: Promise<void> | null = null;
let readyModel = '';
let nextId = 1;
const pending = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void }>();
let progressCb: ((loaded: number, total: number) => void) | null = null;

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'progress') progressCb?.(m.loaded, m.total);
    else if (m.type === 'result') { pending.get(m.id)?.resolve(m.text); pending.delete(m.id); }
    else if (m.type === 'error' && m.id) { pending.get(m.id)?.reject(new Error(m.message)); pending.delete(m.id); }
  };
  return worker;
}

/** Download (first time) or load (from cache) a model. */
export function loadWhisper(model: string, onProgress?: (loaded: number, total: number) => void): Promise<void> {
  if (ready && readyModel === model) return ready;
  progressCb = onProgress ?? null;
  const w = getWorker();
  readyModel = model;
  ready = new Promise<void>((resolve, reject) => {
    const onMsg = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === 'ready' && m.model === model) { w.removeEventListener('message', onMsg); markDownloaded(model); resolve(); }
      else if (m.type === 'error' && !m.id) {
        w.removeEventListener('message', onMsg);
        ready = null;
        reject(new Error(/fetch|network|Failed to/i.test(m.message)
          ? 'Could not download the offline voice model. Connect to the internet once to download it.'
          : `Offline voice model failed: ${m.message}`));
      }
    };
    w.addEventListener('message', onMsg);
    w.postMessage({ type: 'load', model });
  });
  return ready;
}

export function transcribeLocal(audio: Float32Array, language: string): Promise<string> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ type: 'transcribe', id, audio, language: language.split('-')[0] }, [audio.buffer]);
  });
}
