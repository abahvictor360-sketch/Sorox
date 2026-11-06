// Soro X Mobile — live transcription from the microphone.
//
//   device   the phone's own speech recognition (Android / iOS), free, no key
//   deepgram streaming over a WebSocket with the user's Deepgram key
//   openai / groq   short recorded clips sent for transcription with the user's key
import type { Settings } from './settings';

export interface TranscriptHandlers {
  /** Text heard so far in the current utterance (replaced on each call). */
  onInterim: (text: string) => void;
  /** A finished utterance. */
  onFinal: (text: string) => void;
  onError: (message: string) => void;
  onState?: (listening: boolean) => void;
}

export interface Transcriber {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createTranscriber(settings: Settings, h: TranscriptHandlers): Transcriber {
  switch (settings.stt) {
    case 'deepgram': return new DeepgramTranscriber(settings, h);
    case 'openai': return new ClipTranscriber(settings, h, 'openai');
    case 'groq': return new ClipTranscriber(settings, h, 'groq');
    default: return new DeviceTranscriber(settings, h);
  }
}

export function sttNeedsKey(settings: Settings): string | null {
  if (settings.stt === 'deepgram' && !settings.keys.deepgram?.trim()) return 'Add your Deepgram key in Settings, or switch transcription to "Phone".';
  if (settings.stt === 'openai' && !settings.keys.openai?.trim()) return 'Add your OpenAI key in Settings, or switch transcription to "Phone".';
  if (settings.stt === 'groq' && !settings.keys.groq?.trim()) return 'Add your Groq key in Settings, or switch transcription to "Phone".';
  return null;
}

async function micStream(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This device does not allow microphone recording here.');
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
  } catch {
    throw new Error('Microphone access was not allowed. Allow it for Soro X in your phone\'s settings.');
  }
}

function recorderMime(): string {
  for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return '';
}

// ─── Phone speech recognition (Capacitor plugin) ───────────────────────────

class DeviceTranscriber implements Transcriber {
  private running = false;
  private lastPartial = '';
  private listeners: { remove: () => Promise<void> }[] = [];
  constructor(private settings: Settings, private h: TranscriptHandlers) {}

  async start() {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) {
      throw new Error('Phone speech recognition only works in the installed app. Choose Deepgram, OpenAI or Groq transcription in Settings.');
    }
    const { SpeechRecognition } = await import('@capacitor-community/speech-recognition');
    const { available } = await SpeechRecognition.available().catch(() => {
      // The plugin ships no Swift package yet, so the iPhone / iPad build has no native part.
      throw new Error('Phone speech recognition is not built into this version of the app. Choose Deepgram, Groq or OpenAI listening in Settings.');
    });
    if (!available) throw new Error('Speech recognition is not available on this phone. Choose another transcription option in Settings.');
    const perm = await SpeechRecognition.requestPermissions();
    if (perm.speechRecognition !== 'granted') throw new Error('Microphone / speech permission was not allowed.');
    this.listeners.push(await SpeechRecognition.addListener('partialResults', (d: { matches?: string[] }) => {
      this.lastPartial = d.matches?.[0] ?? '';
      this.h.onInterim(this.lastPartial);
    }));
    this.listeners.push(await SpeechRecognition.addListener('listeningState', (d: { status: string }) => {
      if (d.status !== 'stopped') return;
      // The recogniser ends after each pause: commit what it heard, then listen again.
      this.commit();
      if (this.running) void this.listen(SpeechRecognition);
    }));
    this.running = true;
    this.h.onState?.(true);
    await this.listen(SpeechRecognition);
  }

  private commit() {
    const text = this.lastPartial.trim();
    this.lastPartial = '';
    this.h.onInterim('');
    if (text) this.h.onFinal(text);
  }

  private async listen(SR: any) {
    try {
      await SR.start({ language: this.settings.language, partialResults: true, popup: false, maxResults: 1 });
    } catch (e: any) {
      // "No match" / timeout after silence are normal; anything else is reported once.
      const msg = String(e?.message ?? e);
      if (this.running && !/no match|timeout|didn't understand|7|6/i.test(msg)) this.h.onError(`Speech recognition stopped: ${msg}`);
      if (this.running) setTimeout(() => { if (this.running) void this.listen(SR); }, 300);
    }
  }

  async stop() {
    this.running = false;
    const { SpeechRecognition } = await import('@capacitor-community/speech-recognition');
    try { await SpeechRecognition.stop(); } catch { /* already stopped */ }
    this.commit();
    for (const l of this.listeners.splice(0)) await l.remove().catch(() => {});
    this.h.onState?.(false);
  }
}

// ─── Deepgram streaming ─────────────────────────────────────────────────────

class DeepgramTranscriber implements Transcriber {
  private ws: WebSocket | null = null;
  private rec: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private utterance = '';
  constructor(private settings: Settings, private h: TranscriptHandlers) {}

  async start() {
    const key = this.settings.keys.deepgram?.trim();
    if (!key) throw new Error('Add your Deepgram key in Settings.');
    this.stream = await micStream();
    const params = new URLSearchParams({
      model: 'nova-3', language: this.settings.language, smart_format: 'true', punctuate: 'true',
      interim_results: 'true', endpointing: '400', utterance_end_ms: '1200', vad_events: 'true',
    });
    const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, ['token', key]);
    this.ws = ws;
    ws.onmessage = (ev) => {
      let msg: any;
      try { msg = JSON.parse(String(ev.data)); } catch { return; }
      if (msg.type === 'UtteranceEnd') { this.flush(); return; }
      if (msg.type !== 'Results') return;
      const text: string = msg.channel?.alternatives?.[0]?.transcript ?? '';
      if (msg.is_final) {
        if (text) this.utterance = `${this.utterance} ${text}`.trim();
        this.h.onInterim(this.utterance);
        if (msg.speech_final) this.flush();
      } else if (text) {
        this.h.onInterim(`${this.utterance} ${text}`.trim());
      }
    };
    ws.onerror = () => this.h.onError('Deepgram connection failed. Check your key and internet connection.');
    ws.onclose = (ev) => { if (ev.code === 1008 || ev.code === 4001) this.h.onError('Deepgram rejected the key.'); };
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      setTimeout(() => reject(new Error('Could not connect to Deepgram.')), 10000);
    });
    const mimeType = recorderMime();
    this.rec = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.rec.ondataavailable = (e) => { if (e.data.size && ws.readyState === WebSocket.OPEN) ws.send(e.data); };
    this.rec.start(250);
    this.h.onState?.(true);
  }

  private flush() {
    const text = this.utterance.trim();
    this.utterance = '';
    this.h.onInterim('');
    if (text) this.h.onFinal(text);
  }

  async stop() {
    try { this.rec?.stop(); } catch { /* not started */ }
    this.stream?.getTracks().forEach((t) => t.stop());
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'CloseStream' }));
      setTimeout(() => this.ws?.close(), 500);
    }
    this.flush();
    this.h.onState?.(false);
  }
}

// ─── OpenAI / Groq: transcribe short clips ─────────────────────────────────

const CLIP_MS = 6000;

class ClipTranscriber implements Transcriber {
  private stream: MediaStream | null = null;
  private rec: MediaRecorder | null = null;
  private running = false;
  constructor(private settings: Settings, private h: TranscriptHandlers, private provider: 'openai' | 'groq') {}

  async start() {
    this.stream = await micStream();
    this.running = true;
    this.h.onState?.(true);
    this.recordClip();
  }

  /** Each clip is its own complete file, so it can be sent on its own. */
  private recordClip() {
    if (!this.running || !this.stream) return;
    const mimeType = recorderMime();
    const rec = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.rec = rec;
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      if (blob.size > 2000) void this.transcribe(blob);
      this.recordClip();
    };
    rec.start();
    this.h.onInterim('…listening');
    setTimeout(() => { if (rec.state === 'recording') rec.stop(); }, CLIP_MS);
  }

  private async transcribe(blob: Blob) {
    const isOpenAi = this.provider === 'openai';
    const key = this.settings.keys[this.provider]?.trim();
    const form = new FormData();
    const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
    form.append('file', blob, `clip.${ext}`);
    form.append('model', isOpenAi ? 'gpt-4o-mini-transcribe' : 'whisper-large-v3-turbo');
    form.append('language', this.settings.language.split('-')[0]);
    try {
      const res = await fetch(isOpenAi ? 'https://api.openai.com/v1/audio/transcriptions' : 'https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form,
      });
      if (!res.ok) { this.h.onError(`${isOpenAi ? 'OpenAI' : 'Groq'} transcription failed (${res.status}).`); return; }
      const text = String((await res.json())?.text ?? '').trim();
      if (text && !/^(thank you\.?|thanks for watching\.?|you)$/i.test(text)) this.h.onFinal(text);
    } catch {
      this.h.onError('Could not reach the transcription service.');
    }
  }

  async stop() {
    this.running = false;
    try { if (this.rec?.state === 'recording') this.rec.stop(); } catch { /* ignore */ }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.h.onInterim('');
    this.h.onState?.(false);
  }
}
