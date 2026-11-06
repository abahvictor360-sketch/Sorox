import { describe, expect, it } from 'vitest';
import { liveModelFor, modelFor } from '../src/lib/ai';
import { DEFAULT_SETTINGS } from '../src/lib/settings';
import { sameQuestion } from '../src/lib/conversation';
import { Segmenter } from '../src/lib/vad';

describe('fast answers', () => {
  it('uses each provider\'s fast model for live answers, the main model otherwise', () => {
    expect(liveModelFor(DEFAULT_SETTINGS)).toBe('claude-haiku-5-5');
    expect(modelFor(DEFAULT_SETTINGS)).toBe('claude-opus-5-5');
    expect(liveModelFor({ ...DEFAULT_SETTINGS, provider: 'openai' })).toBe('gpt-5.4-mini');
    expect(liveModelFor({ ...DEFAULT_SETTINGS, provider: 'gemini' })).toBe('gemini-3.1-flash-lite');
    expect(liveModelFor({ ...DEFAULT_SETTINGS, fastModels: { claude: 'claude-sonnet-5-5' } })).toBe('claude-sonnet-5-5');
    expect(liveModelFor({ ...DEFAULT_SETTINGS, fastAnswers: false })).toBe('claude-opus-5-5');
  });

  it('recognises the final transcript of a question answered from the live caption', () => {
    expect(sameQuestion('Tell me about a time you led a project?', 'Tell me about a time you led a project.')).toBe(true);
    expect(sameQuestion('tell me about a time you led', 'Tell me about a time you led a project')).toBe(true);
    // The question went on much longer: answer the full one too.
    expect(sameQuestion('Tell me about a time', 'Tell me about a time you led a cross-functional project under a hard deadline and what you learned')).toBe(false);
    expect(sameQuestion('Why this company?', 'What are your salary expectations?')).toBe(false);
  });

  it('ends an utterance after a shorter pause (650 ms)', () => {
    const got: Float32Array[] = [];
    const seg = new Segmenter(16000, { onUtterance: (p) => got.push(p) });
    const frame = (amp: number) => Float32Array.from({ length: 1600 }, (_, i) => amp * Math.sin(i / 3));
    for (let i = 0; i < 10; i++) seg.push(frame(0.001));
    for (let i = 0; i < 8; i++) seg.push(frame(0.3));
    for (let i = 0; i < 6; i++) seg.push(frame(0.001)); // 600 ms: not yet
    expect(got.length).toBe(0);
    seg.push(frame(0.001)); // 700 ms
    expect(got.length).toBe(1);
  });
});
