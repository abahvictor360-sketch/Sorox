// Soro X Mobile: live transcription from the microphone.
//
//   device   the phone's own speech recognition (Android / iOS), free, no key
//   whisper  Whisper running on the phone itself: offline after a one-time download
//   deepgram streaming over a WebSocket with the user's Deepgram key; also tells
//            speakers apart (diarization), so questions and answers are attributed
//   openai / groq   each utterance (cut at natural pauses) sent for transcription
import type { Settings } from './settings';
import { VadRecorder, encodeWav } from './vad';
import { loadWhisper, transcribeLocal } from './whisper';

export interface FinalMeta {
  /** Speaker number from diarization (Deepgram), when known. */
  speaker?: number;
}

export interface TranscriptHandlers {
  /** Text heard so far in the current utterance (replaced on each call). */
  onInterim: (text: string) => void;
  /** A finished utterance. */
  onFinal: (text: string, meta?: FinalMeta) => void;
  /** 0..1 microphone level, for engines that measure it. */
  onLevel?: (level: number) => void;
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
    case 'whisper': return new WhisperTranscriber(settings, h);
    default: return new DeviceTranscriber(settings, h);
  }
}

export function sttNeedsKey(settings: Settings): string | null {
  if (settings.stt === 'deepgram' && !settings.keys.deepgram?.trim()) return 'Add your Deepgram key in Settings, or switch transcription to "Phone".';
  if (settings.stt === 'openai' && !settings.keys.openai?.trim()) return 'Add your OpenAI key in Settings, or switch transcription to "Phone".';
  if (settings.stt === 'groq' && !settings.keys.groq?.trim()) return 'Add your Groq key in Settings, or switch transcription to "Phone".';
  if (settings.stt === 'whisper' && !settings.whisperModel) return 'Choose an offline voice model in Settings.';
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

/** Whisper's well-known hallucinations on silence / noise. */
export function isHallucination(text: string): boolean {
  return /^(thank you\.?|thanks for watching[.!]?|you|\.+|bye\.?|\[.*\]|\(.*\)|♪.*)$/i.test(text.trim());
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
  /** Words per speaker in the current utterance, to name its main speaker. */
  private speakerWords = new Map<number, number>();
  constructor(private settings: Settings, private h: TranscriptHandlers) {}

  async start() {
    const key = this.settings.keys.deepgram?.trim();
    if (!key) throw new Error('Add your Deepgram key in Settings.');
    this.stream = await micStream();
    const params = new URLSearchParams({
      model: 'nova-3', language: this.settings.language, smart_format: 'true', punctuate: 'true',
      interim_results: 'true', endpointing: '300', utterance_end_ms: '1000', vad_events: 'true', diarize: 'true',
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
        for (const w of msg.channel?.alternatives?.[0]?.words ?? []) {
          if (typeof w?.speaker === 'number') this.speakerWords.set(w.speaker, (this.speakerWords.get(w.speaker) ?? 0) + 1);
        }
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
    let speaker: number | undefined; let best = 0;
    for (const [sp, n] of this.speakerWords) if (n > best) { best = n; speaker = sp; }
    this.speakerWords.clear();
    this.h.onInterim('');
    if (text) this.h.onFinal(text, { speaker });
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

// ─── OpenAI / Groq: transcribe each utterance ──────────────────────────────

class ClipTranscriber implements Transcriber {
  private stream: MediaStream | null = null;
  private vad: VadRecorder | null = null;
  constructor(private settings: Settings, private h: TranscriptHandlers, private provider: 'openai' | 'groq') {}

  async start() {
    this.stream = await micStream();
    this.vad = new VadRecorder({
      onUtterance: (pcm) => void this.transcribe(encodeWav(pcm)),
      onLevel: this.h.onLevel,
      onSpeaking: (on) => this.h.onInterim(on ? '…' : ''),
    });
    await this.vad.start(this.stream);
    this.h.onState?.(true);
  }

  private async transcribe(blob: Blob) {
    const isOpenAi = this.provider === 'openai';
    const key = this.settings.keys[this.provider]?.trim();
    const form = new FormData();
    form.append('file', blob, 'utterance.wav');
    form.append('model', isOpenAi ? 'gpt-4o-mini-transcribe' : 'whisper-large-v3-turbo');
    form.append('language', this.settings.language.split('-')[0]);
    try {
      const res = await fetch(isOpenAi ? 'https://api.openai.com/v1/audio/transcriptions' : 'https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form,
      });
      if (!res.ok) { this.h.onError(`${isOpenAi ? 'OpenAI' : 'Groq'} transcription failed (${res.status}).`); return; }
      const text = String((await res.json())?.text ?? '').trim();
      if (text && !isHallucination(text)) this.h.onFinal(text);
    } catch {
      this.h.onError('Could not reach the transcription service. No internet? Switch Listening to "Offline (Whisper)".');
    }
  }

  async stop() {
    await this.vad?.stop();
    this.vad = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.h.onInterim('');
    this.h.onState?.(false);
  }
}

// ─── Whisper on the phone (offline) ─────────────────────────────────────────

class WhisperTranscriber implements Transcriber {
  private stream: MediaStream | null = null;
  private vad: VadRecorder | null = null;
  private queue: Promise<void> = Promise.resolve();
  private running = false;
  constructor(private settings: Settings, private h: TranscriptHandlers) {}

  async start() {
    this.h.onInterim('Loading the offline voice model…');
    await loadWhisper(this.settings.whisperModel, (l, t) => this.h.onInterim(t ? `Downloading the offline voice model… ${Math.round((l / t) * 100)}%` : 'Downloading the offline voice model…'));
    this.h.onInterim('');
    this.stream = await micStream();
    this.running = true;
    this.vad = new VadRecorder({
      onUtterance: (pcm) => {
        // One at a time, in order: transcription is slower than real time on some phones.
        this.queue = this.queue.then(async () => {
          if (!this.running && !pcm.length) return;
          this.h.onInterim('…');
          try {
            const text = await transcribeLocal(pcm, this.settings.language);
            if (text && !isHallucination(text)) this.h.onFinal(text);
          } catch (e: any) {
            this.h.onError(String(e?.message ?? e));
          } finally { this.h.onInterim(''); }
        });
      },
      onLevel: this.h.onLevel,
    });
    await this.vad.start(this.stream);
    this.h.onState?.(true);
  }

  async stop() {
    this.running = false;
    await this.vad?.stop();
    this.vad = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.h.onState?.(false);
  }
}
