import { describe, expect, it } from 'vitest';
import { voicePrint, similarity, enrol, VoiceMatcher, type VoiceProfile } from '../src/lib/voice';
import { Conversation } from '../src/lib/conversation';

// A synthetic voice: a pitch pulse train with vibrato, shaped by three moving
// formant resonances, in syllable-like bursts, with background noise.
function voice(seconds: number, f0: number, formants: number[], seed: number, noise = 0.01, gain = 0.3) {
  let s = seed; const rnd = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const n = Math.floor(seconds * 16000);
  const src = new Float32Array(n); let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / 16000;
    phase += (f0 * (1 + 0.08 * Math.sin(2 * Math.PI * 3 * t) + 0.05 * Math.sin(2 * Math.PI * 0.7 * t + seed))) / 16000;
    if (phase >= 1) { phase -= 1; src[i] = Math.max(0, Math.sin(2 * Math.PI * 2.1 * t + seed)) ** 0.5; }
  }
  let x = src;
  formants.forEach((F, k) => {
    const y = new Float32Array(n); let y1 = 0; let y2 = 0;
    for (let i = 0; i < n; i++) {
      const th = (2 * Math.PI * F * (1 + 0.12 * Math.sin((2 * Math.PI * (1.3 + k * 0.4) * i) / 16000 + seed * k))) / 16000;
      const r = Math.exp((-Math.PI * 90) / 16000);
      const v = x[i] + 2 * r * Math.cos(th) * y1 - r * r * y2; y2 = y1; y1 = v; y[i] = v;
    }
    x = y;
  });
  let max = 0; for (const v of x) max = Math.max(max, Math.abs(v));
  return Float32Array.from(x, (v) => (v / max) * gain + (rnd() - 0.5) * noise);
}
const YOU = (sec: number, seed: number) => voice(sec, 120, [650, 1200, 2600], seed);
const INTERVIEWER = (sec: number, seed: number) => voice(sec, 210, [800, 1500, 2900], seed, 0.02, 0.5);
const SIMILAR = (sec: number, seed: number) => voice(sec, 135, [600, 1100, 2450], seed, 0.02, 0.4);

describe('your voice', () => {
  const profile = enrol(YOU(15, 1)) as VoiceProfile;

  it('records a voice print from a 15 s sample, and refuses silence', () => {
    expect(profile.print).toHaveLength(25);
    expect(profile.selfScore).toBeGreaterThan(0.6);
    expect('error' in (enrol(new Float32Array(16000 * 15)) as any)).toBe(true);
    expect(voicePrint(new Float32Array(1600))).toBeNull();
  });

  it('tells you from a clearly different voice straight away', () => {
    const m = new VoiceMatcher(profile);
    for (const seed of [11, 12, 13]) {
      expect(m.classify(voicePrint(YOU(2.5, seed))).who).toBe('you');
      expect(m.classify(voicePrint(INTERVIEWER(2.5, seed))).who).toBe('them');
    }
    expect(similarity(voicePrint(YOU(3, 5))!, profile.print)).toBeGreaterThan(similarity(voicePrint(INTERVIEWER(3, 5))!, profile.print) + 0.3);
  });

  it('a voice close to yours is "unsure" until it has heard it, then told apart', () => {
    const m = new VoiceMatcher(profile);
    expect(m.classify(voicePrint(SIMILAR(2.5, 21))).who).not.toBe('you');
    m.learn(voicePrint(SIMILAR(2.5, 50)), 'them');
    m.learn(voicePrint(INTERVIEWER(2.5, 51)), 'them');
    for (const seed of [25, 26, 27]) {
      expect(m.classify(voicePrint(SIMILAR(2, seed))).who).toBe('them');
      expect(m.classify(voicePrint(YOU(2, seed))).who).toBe('you');
    }
  });

  it('without a sample it stays out of the way', () => {
    expect(new VoiceMatcher(null).classify(voicePrint(YOU(2, 3))).who).toBe('unsure');
  });

  it('the conversation takes the voice verdict over wording', () => {
    const c = new Conversation();
    // Sounds like a question, but it is your voice: not answered.
    expect(c.add('So what does the team work on day to day?', 0, undefined, 'you').role).toBe('you');
    expect(c.pendingQuestion()).toBeNull();
    // First-person wording, but the interviewer's voice.
    expect(c.add('I see. And how did you handle that deadline?', 3000, undefined, 'them').role).toBe('them');
    expect(c.pendingQuestion()?.question).toContain('deadline');
  });
});
