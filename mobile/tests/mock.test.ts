import { beforeEach, describe, expect, it, vi } from 'vitest';

const completeJson = vi.fn();
const complete = vi.fn();
vi.mock('../src/lib/ai', async (orig) => ({ ...(await orig<typeof import('../src/lib/ai')>()), completeJson: (...a: unknown[]) => completeJson(...a), complete: (...a: unknown[]) => complete(...a) }));

import { DEFAULT_SETTINGS } from '../src/lib/settings';
import { EMPTY_PROFILE } from '../src/lib/profile';
import { asked, interviewerTurn, mockReport, reportMarkdown, type MockTurn } from '../src/lib/mock';
import { completeWithWeb, sourcesBlock, webMode } from '../src/lib/web';

const cfg = { kind: 'mixed' as const, length: 2, style: 'standard' as const };
const q = (text: string, kind: MockTurn['kind'] = 'question'): MockTurn => ({ who: 'interviewer', text, kind });
const a = (text: string): MockTurn => ({ who: 'you', text });

beforeEach(() => { completeJson.mockReset(); complete.mockReset(); });

describe('mock interview', () => {
  it('counts only main questions', () => {
    expect(asked([q('Q1'), a('A'), q('More?', 'followup'), a('B'), q('Q2')])).toBe(2);
  });

  it('never asks two follow-ups in a row', async () => {
    completeJson.mockResolvedValue({ say: 'Why?', kind: 'followup' });
    const s = await interviewerTurn(DEFAULT_SETTINGS, EMPTY_PROFILE, cfg, [q('Q1'), a('A'), q('Why?', 'followup'), a('B')], '');
    expect(s.kind).toBe('question');
  });

  it('ends once all main questions are asked', async () => {
    completeJson.mockResolvedValue({ say: 'Thanks, we will be in touch.', kind: 'question' });
    const s = await interviewerTurn(DEFAULT_SETTINGS, EMPTY_PROFILE, cfg, [q('Q1'), a('A'), q('Q2'), a('B')], '');
    expect(s.kind).toBe('end');
    expect(completeJson.mock.calls[0][1].system).toContain('All main questions are done');
  });

  it('puts the company brief in the prompt and fails on an empty reply', async () => {
    completeJson.mockResolvedValueOnce({ say: 'Hello, tell me about yourself.', kind: 'question' });
    await interviewerTurn(DEFAULT_SETTINGS, EMPTY_PROFILE, cfg, [], '- Acme makes rockets');
    expect(completeJson.mock.calls[0][1].messages[0].content).toContain('Acme makes rockets');
    completeJson.mockResolvedValueOnce({ say: '' });
    await expect(interviewerTurn(DEFAULT_SETTINGS, EMPTY_PROFILE, cfg, [], '')).rejects.toThrow(/did not reply/);
  });

  it('clamps report scores and writes markdown', async () => {
    completeJson.mockResolvedValue({ overall: 14, verdict: 'Likely next round.', strengths: ['Clear'], improvements: [], perQuestion: [{ question: 'Q1', score: 0, note: 'thin' }, { score: 5 }], nextSteps: ['Numbers'] });
    const r = await mockReport(DEFAULT_SETTINGS, EMPTY_PROFILE, cfg, [q('Q1'), a('A')]);
    expect(r.overall).toBe(10);
    expect(r.perQuestion).toEqual([{ question: 'Q1', score: 1, note: 'thin' }]);
    const md = reportMarkdown(r);
    expect(md).toContain('## Overall: 10/10');
    expect(md).not.toContain('What to improve');
  });
});

describe('web search', () => {
  it('picks Tavily, then the AI\'s own search, then none', () => {
    expect(webMode({ ...DEFAULT_SETTINGS, keys: { tavily: 'tv' } })).toBe('tavily');
    expect(webMode({ ...DEFAULT_SETTINGS, provider: 'claude' })).toBe('native');
    expect(webMode({ ...DEFAULT_SETTINGS, provider: 'groq' })).toBe('none');
  });

  it('lists sources as links', () => {
    expect(sourcesBlock([])).toBe('');
    expect(sourcesBlock([{ title: '', url: 'https://www.acme.com/news' }])).toBe('\n\n#### Sources\n1. [acme.com](https://www.acme.com/news)');
  });

  it('gives Tavily results to the AI and appends the sources', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [{ title: 'Acme news', url: 'https://acme.com/n', content: 'Acme raised money' }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    complete.mockResolvedValue('Acme raised money [1].');
    const r = await completeWithWeb({ ...DEFAULT_SETTINGS, keys: { claude: 'k', tavily: 'tv' } }, { system: 's', messages: [{ role: 'user', content: 'Acme news?' }] });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tv');
    expect(complete.mock.calls[0][1].messages[0].content).toContain('Acme raised money');
    expect(r.text).toContain('[Acme news](https://acme.com/n)');
    expect(r.searched).toBe(true);
    vi.unstubAllGlobals();
  });

  it('turns on the AI\'s own search when there is no Tavily key', async () => {
    complete.mockImplementation(async (_s, req) => { req.onSources?.([{ title: 'T', url: 'https://x.org' }]); return 'Answer'; });
    const r = await completeWithWeb({ ...DEFAULT_SETTINGS, keys: { claude: 'k' } }, { system: 's', messages: [{ role: 'user', content: 'q' }] });
    expect(complete.mock.calls[0][1].web).toBe(true);
    expect(r.text).toBe('Answer\n\n#### Sources\n1. [T](https://x.org)');
  });
});
