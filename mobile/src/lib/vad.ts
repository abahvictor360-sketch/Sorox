// Soro X Mobile: microphone audio cut into utterances at natural pauses.
//
// A simple energy voice-activity detector with an adaptive noise floor: speech
// starts when the level rises well above the room's background, and an
// utterance ends after a pause (or at a maximum length). Each utterance is
// handed over as 16 kHz mono PCM, ready for on-device Whisper, or encoded as a
// WAV file for a cloud transcription API.

export interface VadOptions {
  /** Silence that ends an utterance. */
  pauseMs?: number;
  /** Longest utterance before it is cut anyway. */
  maxMs?: number;
  /** Shorter bursts (a cough, a click) are dropped. */
  minSpeechMs?: number;
}

export interface VadHandlers {
  onUtterance: (pcm16k: Float32Array) => void;
  /** 0..1 input level, for the live meter. */
  onLevel?: (level: number) => void;
  onSpeaking?: (speaking: boolean) => void;
}

export const TARGET_RATE = 16_000;

/** Low-pass taps (windowed sinc, cut-off just under 8 kHz) for a given input rate. */
const lpCache = new Map<number, Float32Array>();
function lowPass(fromRate: number): Float32Array {
  let taps = lpCache.get(fromRate);
  if (taps) return taps;
  const N = 31; const fc = 7600 / fromRate; const mid = (N - 1) / 2;
  taps = new Float32Array(N); let sum = 0;
  for (let i = 0; i < N; i++) {
    const x = i - mid;
    const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
    taps[i] = sinc * (0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (N - 1)));
    sum += taps[i];
  }
  for (let i = 0; i < N; i++) taps[i] /= sum;
  lpCache.set(fromRate, taps);
  return taps;
}

/**
 * Resample to 16 kHz (the mic may run at 44.1/48 kHz). High frequencies are
 * filtered out first, so they do not fold back into the speech band (that
 * distorted transcription a little and voice prints a lot).
 */
export function resampleTo16k(input: Float32Array, fromRate: number): Float32Array {
  if (fromRate === TARGET_RATE) return input;
  if (fromRate > TARGET_RATE) {
    const taps = lowPass(fromRate); const half = (taps.length - 1) / 2;
    const f = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) {
      let s = 0;
      for (let k = 0; k < taps.length; k++) { const j = i + k - half; if (j >= 0 && j < input.length) s += input[j] * taps[k]; }
      f[i] = s;
    }
    input = f;
  }
  const ratio = fromRate / TARGET_RATE;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio;
    const i0 = Math.floor(x);
    const i1 = Math.min(i0 + 1, input.length - 1);
    out[i] = input[i0] + (input[i1] - input[i0]) * (x - i0);
  }
  return out;
}

export function rms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / Math.max(1, frame.length));
}

/**
 * The detector itself, independent of Web Audio so it can be unit-tested:
 * feed it frames (any rate) and it emits utterances.
 */
export class Segmenter {
  private noise = 0.004;
  private speaking = false;
  private chunks: Float32Array[] = [];
  private speechMs = 0;
  private silenceMs = 0;
  private totalMs = 0;
  private readonly pauseMs: number;
  private readonly maxMs: number;
  private readonly minSpeechMs: number;
  /** Audio kept from just before speech starts, so first syllables are not clipped. */
  private preroll: Float32Array[] = [];

  constructor(private readonly rate: number, private readonly h: VadHandlers, opts: VadOptions = {}) {
    this.pauseMs = opts.pauseMs ?? 650;
    this.maxMs = opts.maxMs ?? 20_000;
    this.minSpeechMs = opts.minSpeechMs ?? 300;
  }

  push(frame: Float32Array) {
    const ms = (frame.length / this.rate) * 1000;
    const level = rms(frame);
    this.h.onLevel?.(Math.min(1, level * 12));
    const threshold = Math.max(0.012, this.noise * 3.2);
    const loud = level > threshold;
    if (!this.speaking) {
      // Track the background only while nobody is talking.
      this.noise = this.noise * 0.97 + level * 0.03;
      this.preroll.push(frame);
      if (this.preroll.length > 6) this.preroll.shift();
      if (loud) {
        this.speaking = true;
        this.h.onSpeaking?.(true);
        this.chunks = [...this.preroll];
        this.preroll = [];
        this.speechMs = ms; this.silenceMs = 0; this.totalMs = ms;
      }
      return;
    }
    this.chunks.push(frame);
    this.totalMs += ms;
    if (loud) { this.speechMs += ms; this.silenceMs = 0; } else this.silenceMs += ms;
    if (this.silenceMs >= this.pauseMs || this.totalMs >= this.maxMs) this.flush();
  }

  /** End the current utterance now (e.g. when listening stops). */
  flush() {
    if (!this.speaking) return;
    this.speaking = false;
    this.h.onSpeaking?.(false);
    const chunks = this.chunks;
    this.chunks = [];
    if (this.speechMs < this.minSpeechMs) return;
    const len = chunks.reduce((n, c) => n + c.length, 0);
    const all = new Float32Array(len);
    let o = 0;
    for (const c of chunks) { all.set(c, o); o += c.length; }
    this.h.onUtterance(resampleTo16k(all, this.rate));
  }
}

/** Microphone → Segmenter, via Web Audio. */
export class VadRecorder {
  private ctx: AudioContext | null = null;
  private node: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private seg: Segmenter | null = null;

  constructor(private readonly h: VadHandlers, private readonly opts: VadOptions = {}) {}

  async start(stream: MediaStream) {
    const Ctx: typeof AudioContext = (window as any).AudioContext ?? (window as any).webkitAudioContext;
    this.ctx = new Ctx();
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
    this.seg = new Segmenter(this.ctx.sampleRate, this.h, this.opts);
    this.source = this.ctx.createMediaStreamSource(stream);
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    this.node.onaudioprocess = (e) => this.seg?.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    this.source.connect(this.node);
    // ScriptProcessor only runs while connected to the output; it writes silence.
    this.node.connect(this.ctx.destination);
  }

  async stop() {
    this.seg?.flush();
    this.node?.disconnect();
    this.source?.disconnect();
    if (this.node) this.node.onaudioprocess = null;
    await this.ctx?.close().catch(() => {});
    this.ctx = null; this.node = null; this.source = null; this.seg = null;
  }
}

/** 16-bit PCM WAV, for the cloud transcription APIs. */
export function encodeWav(pcm: Float32Array, rate = TARGET_RATE): Blob {
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/**
 * Keeps the last minute of microphone audio so a stretch of it can be taken
 * out later by time (seconds since start), e.g. one utterance Deepgram has
 * transcribed, to match the speaker's voice. Also used to record a voice sample.
 */
export class AudioTap {
  private ctx: AudioContext | null = null;
  private node: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private chunks: Float32Array[] = [];
  private startSample = 0; // index of chunks[0][0] since start
  private total = 0;
  private rate = 48_000;

  constructor(private readonly keepSeconds = 60, private readonly onLevel?: (level: number) => void) {}

  async start(stream: MediaStream) {
    const Ctx: typeof AudioContext = (window as any).AudioContext ?? (window as any).webkitAudioContext;
    this.ctx = new Ctx();
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
    this.rate = this.ctx.sampleRate;
    this.source = this.ctx.createMediaStreamSource(stream);
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    this.node.onaudioprocess = (e) => {
      const c = new Float32Array(e.inputBuffer.getChannelData(0));
      this.chunks.push(c); this.total += c.length;
      this.onLevel?.(Math.min(1, rms(c) * 12));
      while (this.total - this.startSample > this.keepSeconds * this.rate && this.chunks.length > 1) {
        this.startSample += this.chunks.shift()!.length;
      }
    };
    this.source.connect(this.node);
    this.node.connect(this.ctx.destination);
  }

  /** Audio between two times (seconds since start) at 16 kHz; empty if gone. */
  slice(fromSec: number, toSec: number): Float32Array {
    const a = Math.max(this.startSample, Math.floor(fromSec * this.rate));
    const b = Math.min(this.total, Math.ceil(toSec * this.rate));
    if (b <= a) return new Float32Array(0);
    const out = new Float32Array(b - a);
    let pos = this.startSample; let o = 0;
    for (const c of this.chunks) {
      const s = Math.max(a, pos); const e = Math.min(b, pos + c.length);
      if (e > s) { out.set(c.subarray(s - pos, e - pos), o); o += e - s; }
      pos += c.length;
      if (pos >= b) break;
    }
    return resampleTo16k(out, this.rate);
  }

  /** Everything kept so far, at 16 kHz. */
  all(): Float32Array { return this.slice(this.startSample / this.rate, this.total / this.rate); }

  async stop() {
    this.node?.disconnect(); this.source?.disconnect();
    if (this.node) this.node.onaudioprocess = null;
    await this.ctx?.close().catch(() => {});
    this.ctx = null; this.node = null; this.source = null;
  }
}
