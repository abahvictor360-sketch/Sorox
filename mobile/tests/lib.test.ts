import { describe, expect, it } from 'vitest';
import { looksLikeQuestion, latestQuestion } from '../src/lib/interview';
import { parseSseChunk, parseJsonObject, modelFor } from '../src/lib/ai';
import { loadSettings, saveSettings, DEFAULT_SETTINGS, isReady } from '../src/lib/settings';
import { normalizeResume, normalizeJob, profileContext, EMPTY_PROFILE, loadProfile } from '../src/lib/profile';
import { parsePairingLink, isLocalNetworkHost, rememberComputer } from '../src/lib/pairing';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };

describe('question detection', () => {
  it('spots interviewer questions', () => {
    expect(looksLikeQuestion('Tell me about a time you led a project')).toBe(true);
    expect(looksLikeQuestion('So what made you apply for this role?')).toBe(true);
    expect(looksLikeQuestion('Thanks for coming in today. Can you walk me through your CV')).toBe(true);
    expect(looksLikeQuestion('How are you?')).toBe(false); // too short
    expect(looksLikeQuestion('I worked at Acme for three years as an engineer.')).toBe(false);
  });
  it('returns the latest question with context', () => {
    const r = latestQuestion(['Hello and welcome to the interview.', 'Why do you want to join our team here?', 'I think because']);
    expect(r?.question).toBe('Why do you want to join our team here?');
    expect(r?.context).toContain('welcome');
    expect(latestQuestion(['nothing to see here at all'])).toBeNull();
  });
});

describe('AI helpers', () => {
  it('parses SSE events, joining multi-line data', () => {
    const got: string[] = [];
    parseSseChunk('data: {"a":1}\n\nevent: x\ndata: line1\ndata: line2\n\n: comment\n\n', (d) => got.push(d));
    expect(got).toEqual(['{"a":1}', 'line1\nline2']);
  });
  it('pulls JSON out of chatty or fenced replies', () => {
    expect(parseJsonObject('Sure! ```json\n{"score": 7}\n```')).toEqual({ score: 7 });
    expect(parseJsonObject('no json')).toBeNull();
  });
  it('uses the default model unless one is set', () => {
    expect(modelFor(DEFAULT_SETTINGS)).toBe('claude-opus-5-5');
    expect(modelFor({ ...DEFAULT_SETTINGS, provider: 'groq', models: { groq: 'x' } })).toBe('x');
  });
});

describe('settings & profile storage', () => {
  it('round-trips settings and survives garbage', () => {
    const s = mem();
    expect(loadSettings(s)).toEqual(DEFAULT_SETTINGS);
    saveSettings({ ...DEFAULT_SETTINGS, keys: { claude: 'sk-ant-1' } }, s);
    expect(isReady(loadSettings(s))).toBe(true);
    s.setItem('sorox.mobile.settings.v1', '{bad');
    expect(loadSettings(s)).toEqual(DEFAULT_SETTINGS);
    expect(loadProfile(s)).toEqual(EMPTY_PROFILE);
  });
  it('normalises extracted facts and builds grounded context', () => {
    const resume = normalizeResume({ name: ' Ada ', experience: [{ role: 'Engineer', company: 'Acme', highlights: ['Cut costs 20%', 3] }, {}], skills: ['TS', 'TS', ''] });
    expect(resume.experience).toHaveLength(1);
    expect(resume.skills).toEqual(['TS']);
    const job = normalizeJob({ title: 'Lead', company: 'Globex', requirements: ['5y TS'] });
    const ctx = profileContext({ ...EMPTY_PROFILE, resume, job, notes: 'Relocating' });
    expect(ctx).toContain('<candidate>');
    expect(ctx).toContain('Engineer at Acme');
    expect(ctx).toContain('Role: Lead at Globex');
    expect(ctx).toContain('<candidate_notes>');
  });
});

describe('pairing', () => {
  it('accepts only LAN links with a token', () => {
    expect(isLocalNetworkHost('192.168.1.5')).toBe(true);
    expect(isLocalNetworkHost('8.8.8.8')).toBe(false);
    const ok = parsePairingLink('192.168.1.20:8787/?t=abcdefghijklmnopqrst');
    expect(ok.ok && ok.url).toBe('http://192.168.1.20:8787/?t=abcdefghijklmnopqrst');
    expect(parsePairingLink('https://evil.com/?t=abcdefghijklmnopqrst').ok).toBe(false);
    expect(parsePairingLink('http://127.0.0.1:1/?t=abcdefghijklmnopqrst').ok).toBe(false);
    expect(parsePairingLink('http://10.0.0.2/?t=short').ok).toBe(false);
  });
  it('remembers computers, most recent first', () => {
    const a = { url: 'u1', origin: 'o1', host: 'h1' }; const b = { url: 'u2', origin: 'o2', host: 'h2' };
    const list = rememberComputer(rememberComputer([], a), b);
    expect(rememberComputer(list, a).map((c) => c.origin)).toEqual(['o1', 'o2']);
  });
});
