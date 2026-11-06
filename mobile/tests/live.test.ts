import { describe, expect, it } from 'vitest';
import { Conversation, firstPersonRatio } from '../src/lib/conversation';
import { Segmenter, encodeWav, resampleTo16k } from '../src/lib/vad';
import { isHallucination } from '../src/lib/stt';
import { NegotiationConversationTracker, parseMoney } from '../src/lib/negotiationTracker';
import { loadSessions, newSession, upsertSession, sessionToText } from '../src/lib/sessions';
import { upcoming, current } from '../src/lib/schedule';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), clear: () => m.clear(), key: () => null, length: 0 } as unknown as Storage; };

describe('who is speaking (no diarization)', () => {
  it('labels questions as the interviewer and first-person answers as you', () => {
    const c = new Conversation();
    const q = c.add('Tell me about a time you handled a difficult stakeholder', 1000);
    expect(q.role).toBe('them');
    const a = c.add('Sure, so in my last role I was leading the payments migration and I', 5000);
    expect(a.role).toBe('you');
    expect(c.state(6000)).toBe('you');
  });
  it('joins a question split over two utterances, and does not answer it twice', () => {
    const c = new Conversation();
    c.add('Okay great.', 0);
    c.add('So walk me through how you would design', 1000);
    c.add('a rate limiter for our public API?', 2500);
    const pq = c.pendingQuestion()!;
    expect(pq.question).toContain('walk me through');
    expect(pq.question).toContain('rate limiter');
    c.markAnswered(pq.ids);
    expect(c.pendingQuestion()).toBeNull();
  });
  it('a question in your own words is not treated as the interviewer', () => {
    const c = new Conversation();
    const s = c.add('What would I be working on in my first month here?', 0);
    expect(s.role).toBe('unknown');
    expect(firstPersonRatio('I think my team and I did it')).toBeGreaterThan(0.3);
    expect(c.add("We'd like to offer you 95k base salary for this role.", 2000).role).not.toBe('you');
  });
  it('a correction sticks', () => {
    const c = new Conversation();
    const s = c.add('How did you measure success there?', 0);
    c.setRole(s.id, 'you');
    expect(c.segments[0].role).toBe('you');
    expect(c.pendingQuestion()).toBeNull();
  });
});

describe('who is speaking (Deepgram speakers)', () => {
  it('maps speakers to roles and keeps panels as interviewers', () => {
    const c = new Conversation();
    expect(c.add('Why do you want to work here at Globex?', 0, 0).role).toBe('them');
    expect(c.add('Honestly the mission really resonates with me, I have spent five years in logistics', 3000, 1).role).toBe('you');
    expect(c.add('Can you tell me about your Kubernetes experience?', 9000, 2).role).toBe('them');
    expect(c.add('Yes of course I ran our clusters', 12000, 1).role).toBe('you');
    // Correct speaker 1 → interviewer: all its lines follow, speaker 2 stays them.
    c.setRole(c.segments[1].id, 'them');
    expect(c.segments.filter((s) => s.speaker === 1).every((s) => s.role === 'them')).toBe(true);
    expect(c.transcript()).toContain('Interviewer: Why do you want');
  });
});

describe('voice activity', () => {
  it('cuts utterances at pauses and drops short clicks', () => {
    const got: Float32Array[] = [];
    const rate = 16000;
    const seg = new Segmenter(rate, { onUtterance: (p) => got.push(p) }, { pauseMs: 500 });
    const frame = (amp: number) => Float32Array.from({ length: 1600 }, (_, i) => amp * Math.sin(i / 3));
    for (let i = 0; i < 10; i++) seg.push(frame(0.001)); // room noise
    for (let i = 0; i < 10; i++) seg.push(frame(0.3)); // 1 s of speech
    for (let i = 0; i < 8; i++) seg.push(frame(0.001)); // pause
    expect(got.length).toBe(1);
    expect(got[0].length).toBeGreaterThan(16000);
    seg.push(frame(0.3)); // 100 ms click
    for (let i = 0; i < 8; i++) seg.push(frame(0.001));
    expect(got.length).toBe(1);
  });
  it('resamples and writes a valid WAV header', () => {
    expect(resampleTo16k(new Float32Array(48000), 48000).length).toBe(16000);
    const wav = encodeWav(new Float32Array(16000));
    expect(wav.size).toBe(44 + 32000);
  });
  it('filters Whisper hallucinations', () => {
    expect(isHallucination('Thank you.')).toBe(true);
    expect(isHallucination('Thank you for having me today.')).toBe(false);
  });
});

describe('negotiation on the phone', () => {
  it('tracks the offer', () => {
    const t = new NegotiationConversationTracker();
    t.feed('We would like to offer you 95k base.');
    expect(t.getState()?.phase).toBe('offer');
    expect(t.getState()?.theirOffer).toBe(95000);
    expect(parseMoney('£70,000')[0]).toEqual({ amount: 70000, currency: 'GBP' });
  });
});

describe('sessions and schedule', () => {
  it('saves sessions newest first and exports text', () => {
    const st = mem();
    const a = newSession('interview', 'A'); a.startedAt = 1;
    const b = newSession('meeting', 'B'); b.startedAt = 2;
    b.lines.push({ text: 'Hello', role: 'them', at: 2 });
    upsertSession(a, st); upsertSession(b, st);
    expect(loadSessions(st).map((s) => s.title)).toEqual(['B', 'A']);
    expect(sessionToText(b)).toContain('Interviewer: Hello');
  });
  it('knows which appointment is on now', () => {
    const now = Date.now();
    const list = [{ id: 1, title: 'X', at: now + 5 * 60_000, mode: 'interview' as const, remindBefore: 0 }, { id: 2, title: 'Old', at: now - 5 * 3600_000, mode: 'meeting' as const, remindBefore: 0 }];
    expect(current(list, now)?.id).toBe(1);
    expect(upcoming(list, now).map((a) => a.id)).toEqual([1]);
  });
});

describe('question boundaries', () => {
  it('does not glue a finished sentence or an answered line onto the next question', () => {
    const c = new Conversation();
    c.add('Thanks for joining us today, nice to meet you.', 0);
    c.add('Tell me about a time you led a project under pressure?', 1000);
    expect(c.pendingQuestion()!.question).toBe('Tell me about a time you led a project under pressure?');
    c.markAnswered(c.pendingQuestion()!.ids);
    c.add('What would I be working on in my first month here?', 9000);
    c.markAnswered(c.pendingQuestion()!.ids);
    c.add("We'd like to offer you 95k base salary for this role.", 12000);
    expect(c.pendingQuestion()).toBeNull();
    expect(c.pendingQuestion((s) => /offer/.test(s.text))!.question).toBe("We'd like to offer you 95k base salary for this role.");
  });
});
