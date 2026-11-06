// Soro X Mobile: recognising your voice, so Soro X knows when you are the one
// speaking and when it is the interviewer.
//
// A voice print here is a small set of numbers, not a recording: the average
// shape of the voice's spectrum (MFCCs, mel-frequency cepstral coefficients,
// the standard compact description of a voice's timbre) and its spread, plus
// the typical pitch. You record a short sample once (Settings > Your voice);
// after that every utterance is compared with it. While listening, Soro X also
// builds a print of the other voice(s) from lines it is sure about, and from
// your corrections, and decides by which print an utterance is closer to.
//
// All of this runs on the phone; nothing is sent anywhere. It needs the audio
// of each utterance, so it works with Offline (Whisper), Deepgram, Groq and
// OpenAI listening, not with the phone's own speech recognition (which keeps
// the microphone to itself).

export const SAMPLE_RATE = 16_000;
const FRAME = 400; // 25 ms
const HOP = 160; // 10 ms
const NFFT = 512;
const MELS = 26;
const CEPS = 13; // c0..c12; c0 (loudness) is dropped from the print

/** One voice print: [12 MFCC means, 12 MFCC spreads, pitch (scaled)]. */
export type VoicePrint = number[];

// ── Signal processing ──

function fft(re: Float64Array, im: Float64Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang); const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1; let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k]; const ai = im[i + k];
        const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br; im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br; im[i + k + len / 2] = ai - bi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

const hz2mel = (f: number) => 2595 * Math.log10(1 + f / 700);
const mel2hz = (m: number) => 700 * (10 ** (m / 2595) - 1);

let FILTERS: Float64Array[] | null = null;
function melFilters(): Float64Array[] {
  if (FILTERS) return FILTERS;
  const lo = hz2mel(80); const hi = hz2mel(7600);
  const pts = Array.from({ length: MELS + 2 }, (_, i) => mel2hz(lo + ((hi - lo) * i) / (MELS + 1)));
  const bins = pts.map((f) => Math.floor(((NFFT + 1) * f) / SAMPLE_RATE));
  FILTERS = Array.from({ length: MELS }, (_, m) => {
    const f = new Float64Array(NFFT / 2 + 1);
    for (let k = bins[m]; k < bins[m + 1]; k++) f[k] = (k - bins[m]) / Math.max(1, bins[m + 1] - bins[m]);
    for (let k = bins[m + 1]; k < bins[m + 2]; k++) f[k] = (bins[m + 2] - k) / Math.max(1, bins[m + 2] - bins[m + 1]);
    return f;
  });
  return FILTERS;
}

const HAMMING = Float64Array.from({ length: FRAME }, (_, i) => 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (FRAME - 1)));

/** Pitch of one frame by autocorrelation (70-400 Hz), or 0 if unvoiced. */
function framePitch(x: Float32Array, start: number): number {
  const minLag = Math.floor(SAMPLE_RATE / 400); const maxLag = Math.floor(SAMPLE_RATE / 70);
  const n = Math.min(FRAME, x.length - start - maxLag);
  if (n < 200) return 0;
  let e = 0;
  for (let i = 0; i < n; i++) e += x[start + i] * x[start + i];
  if (e < 1e-4) return 0;
  // Normalised autocorrelation for every lag; then the SHORTEST lag that comes
  // close to the best one. Taking the best lag alone often lands on twice the
  // period (an octave too low), which made the same voice look different.
  const ac = new Float64Array(maxLag + 1);
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let c = 0;
    for (let i = 0; i < n; i++) c += x[start + i] * x[start + i + lag];
    ac[lag] = c / e;
    if (ac[lag] > best) best = ac[lag];
  }
  if (best < 0.4) return 0;
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (ac[lag] >= best * 0.85 && ac[lag] >= ac[lag - 1] && ac[lag] >= ac[lag + 1]) return SAMPLE_RATE / lag;
  }
  return 0;
}

/**
 * The voice print of a stretch of speech (16 kHz mono), or null when there is
 * too little voiced audio (under ~0.6 s) to say anything.
 */
export function voicePrint(pcm: Float32Array): VoicePrint | null {
  const filters = melFilters();
  const frames: number[][] = [];
  const pitches: number[] = [];
  const energies: number[] = [];
  const re = new Float64Array(NFFT); const im = new Float64Array(NFFT);
  const all: { c: number[]; e: number; start: number }[] = [];
  for (let start = 0; start + FRAME <= pcm.length; start += HOP) {
    re.fill(0); im.fill(0);
    let e = 0;
    for (let i = 0; i < FRAME; i++) {
      // pre-emphasis, then window
      const s = pcm[start + i] - 0.97 * (i > 0 ? pcm[start + i - 1] : 0);
      re[i] = s * HAMMING[i]; e += pcm[start + i] * pcm[start + i];
    }
    fft(re, im);
    const power = new Float64Array(NFFT / 2 + 1);
    for (let k = 0; k <= NFFT / 2; k++) power[k] = re[k] * re[k] + im[k] * im[k];
    const logMel = filters.map((f) => { let s = 0; for (let k = 0; k < f.length; k++) s += f[k] * power[k]; return Math.log(s + 1e-10); });
    const c: number[] = [];
    for (let n = 0; n < CEPS; n++) {
      let s = 0;
      for (let m = 0; m < MELS; m++) s += logMel[m] * Math.cos((Math.PI * n * (m + 0.5)) / MELS);
      c.push(s);
    }
    all.push({ c, e: e / FRAME, start });
    energies.push(e / FRAME);
  }
  if (!all.length) return null;
  // Keep the louder (voiced) frames: speech, not the pauses between words.
  const sorted = [...energies].sort((a, b) => a - b);
  const gate = Math.max(1e-6, sorted[Math.floor(sorted.length * 0.4)]);
  for (const f of all) {
    if (f.e < gate) continue;
    frames.push(f.c.slice(1));
    if (frames.length % 2 === 0) { const p = framePitch(pcm, f.start); if (p) pitches.push(p); }
  }
  if (frames.length < 60) return null;
  const dims = CEPS - 1;
  const mean = Array(dims).fill(0); const sd = Array(dims).fill(0);
  for (const f of frames) for (let d = 0; d < dims; d++) mean[d] += f[d] / frames.length;
  for (const f of frames) for (let d = 0; d < dims; d++) sd[d] += (f[d] - mean[d]) ** 2 / frames.length;
  for (let d = 0; d < dims; d++) sd[d] = Math.sqrt(sd[d]);
  pitches.sort((a, b) => a - b);
  const pitch = pitches.length >= 5 ? pitches[Math.floor(pitches.length / 2)] : 0;
  return [...mean, ...sd, pitch ? Math.log(pitch) : 0];
}

/** How alike two prints are: 1 = same voice, lower = more different. */
export function similarity(a: VoicePrint, b: VoicePrint): number {
  const dims = CEPS - 1;
  // Timbre: per-coefficient distance, scaled so the higher coefficients count too.
  let d = 0;
  for (let i = 0; i < dims; i++) d += ((a[i] - b[i]) / (1 + i * 0.15)) ** 2;
  for (let i = dims; i < 2 * dims; i++) d += 0.5 * ((a[i] - b[i]) / (1 + (i - dims) * 0.15)) ** 2;
  let sim = Math.exp(-Math.sqrt(d) / 25);
  // Pitch: a supporting clue (one octave apart takes off about 30 %); unknown pitch is ignored.
  const pa = a[2 * dims]; const pb = b[2 * dims];
  if (pa && pb) sim *= Math.exp((-Math.abs(pa - pb) / Math.LN2) * 0.7);
  return sim;
}

/** The average of several prints (same voice); pitch averages the prints that have one. */
export function average(prints: VoicePrint[]): VoicePrint {
  const len = prints[0].length;
  const out = Array(len).fill(0);
  for (let i = 0; i < len - 1; i++) out[i] = prints.reduce((s, p) => s + p[i], 0) / prints.length;
  const pitched = prints.map((p) => p[len - 1]).filter((v) => v !== 0);
  out[len - 1] = pitched.length ? pitched.reduce((s, v) => s + v, 0) / pitched.length : 0;
  return out;
}

// ── Your saved voice ──

export interface VoiceProfile {
  print: VoicePrint;
  /** Similarity your own speech reaches against the print (from the sample). */
  selfScore: number;
  createdAt: number;
}

const KEY = 'sorox.mobile.voice.v1';

export function loadVoice(): VoiceProfile | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    return v && Array.isArray(v.print) && v.print.length === 2 * (CEPS - 1) + 1 ? v : null;
  } catch { return null; }
}

export function saveVoice(v: VoiceProfile | null) {
  try { if (v) localStorage.setItem(KEY, JSON.stringify(v)); else localStorage.removeItem(KEY); } catch { /* ignore */ }
}

/**
 * Builds your voice profile from a sample recording (at least ~8 s of speech):
 * the print of the whole sample, and how closely 2.5 s pieces of it match that
 * print, which tells how high your own speech scores.
 */
export function enrol(pcm: Float32Array): VoiceProfile | { error: string } {
  const whole = voicePrint(pcm);
  if (!whole) return { error: 'Not enough speech was heard. Read the sentences out loud, close to the phone.' };
  const piece = Math.floor(2.5 * SAMPLE_RATE);
  const prints: VoicePrint[] = [];
  for (let s = 0; s + piece <= pcm.length; s += Math.floor(piece / 2)) {
    const p = voicePrint(pcm.subarray(s, s + piece));
    if (p) prints.push(p);
  }
  if (prints.length < 3) return { error: 'The sample was too short. Keep reading for about 15 seconds.' };
  const print = average(prints);
  const scores = prints.map((p) => similarity(p, print)).sort((a, b) => a - b);
  // A typical piece of your speech scores at least this much.
  const selfScore = scores[Math.floor(scores.length * 0.2)];
  return { print, selfScore, createdAt: Date.now() };
}

// ── Deciding who spoke ──

export type VoiceVerdict = { who: 'you' | 'them' | 'unsure'; you: number; them: number | null };

/**
 * Compares utterances with your print and with a print of the other voice(s)
 * that it builds while listening. With no other print yet, it decides from how
 * your own speech scored when you recorded the sample.
 */
export class VoiceMatcher {
  private others: VoicePrint[] = [];
  private mine: VoicePrint[] = [];

  constructor(private readonly profile: VoiceProfile | null) {}

  get enabled() { return !!this.profile; }

  classify(p: VoicePrint | null | undefined): VoiceVerdict {
    if (!this.profile || !p) return { who: 'unsure', you: 0, them: null };
    const youPrint = this.mine.length >= 3 ? average([this.profile.print, average(this.mine.slice(-8))]) : this.profile.print;
    const you = similarity(p, youPrint);
    const them = this.others.length ? Math.max(similarity(p, average(this.others.slice(-12))), ...this.others.slice(-6).map((o) => similarity(p, o))) : null;
    const self = this.profile.selfScore;
    let who: VoiceVerdict['who'] = 'unsure';
    if (them !== null) {
      if (you > them * 1.08 && you > self * 0.6) who = 'you';
      else if (them > you * 1.08) who = 'them';
    } else if (you >= self * 0.8) who = 'you';
    else if (you < self * 0.5) who = 'them';
    return { who, you, them };
  }

  /** Learn from a line whose speaker is known (a confident verdict, or your correction). */
  learn(p: VoicePrint | null | undefined, who: 'you' | 'them') {
    if (!p) return;
    if (who === 'them') this.others = [...this.others, p].slice(-20);
    else this.mine = [...this.mine, p].slice(-20);
  }
}
