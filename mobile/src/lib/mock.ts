// Soro X Mobile: mock interviews. The AI plays the interviewer for your target
// job: it asks the main questions one at a time, reacts briefly, asks a
// follow-up when an answer is thin, and closes the interview. At the end it
// writes a report (overall and per-question scores, strengths, what to work
// on). Grounded in your CV and the job; company facts can come from the web.
import { completeJson } from './ai';
import { profileContext, type Profile } from './profile';
import type { Settings } from './settings';
import type { PracticeKind } from './interview';
import { completeWithWeb, webMode } from './web';

export type MockStyle = 'friendly' | 'standard' | 'tough';

export interface MockConfig {
  kind: PracticeKind;
  /** Main questions (follow-ups do not count). */
  length: number;
  style: MockStyle;
}

export interface MockTurn { who: 'interviewer' | 'you'; text: string; kind?: 'question' | 'followup' | 'end' | 'intro' }

export interface MockStep { say: string; kind: 'question' | 'followup' | 'end' }

export interface MockReport {
  overall: number;
  verdict: string;
  strengths: string[];
  improvements: string[];
  perQuestion: { question: string; score: number; note: string }[];
  nextSteps: string[];
}

const STYLE: Record<MockStyle, string> = {
  friendly: 'warm and encouraging, but still a real interviewer',
  standard: 'professional and neutral, like a typical hiring manager',
  tough: 'demanding: you press on vague answers and ask for specifics, numbers and trade-offs',
};

const KIND: Record<PracticeKind, string> = {
  mixed: 'a realistic mix of behavioural, role and motivation questions',
  behavioral: 'behavioural questions (tell me about a time...)',
  technical: 'technical questions for this role (approach, depth, trade-offs; one small design or coding-style question is fine)',
  'role-fit': 'questions on fit with this role and company, motivation and the job requirements',
};

/** A short brief on the company from the web, for the interviewer to draw on. */
export async function researchCompany(settings: Settings, profile: Profile, signal?: AbortSignal): Promise<string> {
  const company = profile.job?.company?.trim();
  if (!company || webMode(settings) === 'none') return '';
  const { text } = await completeWithWeb(settings, {
    system: 'You brief an interviewer before an interview. Facts only, from the web results or search. Plain bullets, no preamble.',
    messages: [{ role: 'user', content: `Five short bullets about ${company}: what it does, recent news, priorities, culture, and what its interviews tend to focus on${profile.job?.title ? ` for a ${profile.job.title}` : ''}.` }],
    effort: 'low', maxTokens: 900, fast: true, signal,
  }, `${company} company news culture interview`);
  return text.replace(/\n#### Sources[\s\S]*$/, '').trim();
}

export function asked(turns: MockTurn[]): number {
  return turns.filter((t) => t.who === 'interviewer' && t.kind === 'question').length;
}

/** The interviewer's next line, given the interview so far. */
export async function interviewerTurn(settings: Settings, profile: Profile, cfg: MockConfig, turns: MockTurn[], brief: string, signal?: AbortSignal): Promise<MockStep> {
  const n = asked(turns);
  const lastWasFollowUp = turns.filter((t) => t.who === 'interviewer').slice(-1)[0]?.kind === 'followup';
  const job = profile.job;
  const raw = await completeJson<any>(settings, {
    system: `You are the interviewer${job?.title ? ` for the ${job.title} role` : ''}${job?.company ? ` at ${job.company}` : ''}. Your manner: ${STYLE[cfg.style]}.
Run a realistic spoken interview of ${cfg.length} main questions: ${KIND[cfg.kind]}. Base questions on the job's requirements and the candidate's real background; probe their weak spots too.
Rules:
- One thing at a time. Before each new question, react to the last answer in one short, natural sentence (no feedback, no praise inflation, no coaching).
- A follow-up digs into the last answer (missing result, vague claim, "why"). Ask at most one follow-up per main question${lastWasFollowUp ? '; the last line was already a follow-up, so move on' : ''}.
- Never repeat a question. Keep each line under 60 words, as you would say it out loud.
- Main questions asked so far: ${n} of ${cfg.length}.${n >= cfg.length ? ' All main questions are done: thank the candidate, say what happens next, and end.' : ''}
Reply with JSON only: {"say": "what you say", "kind": "question" | "followup" | "end"}.`,
    messages: [{ role: 'user', content: `${profileContext(profile)}
${brief ? `\n<company_brief>\n${brief}\n</company_brief>\n` : ''}
Interview so far:
${turns.map((t) => `${t.who === 'interviewer' ? 'Interviewer' : 'Candidate'}: ${t.text}`).join('\n') || '(not started: greet the candidate in one sentence and ask the first question)'}` }],
    effort: 'low',
    maxTokens: 700,
    fast: true,
    signal,
  });
  const say = String(raw?.say ?? '').trim();
  let kind: MockStep['kind'] = raw?.kind === 'followup' || raw?.kind === 'end' ? raw.kind : 'question';
  if (kind === 'followup' && lastWasFollowUp) kind = 'question';
  if (n >= cfg.length && kind !== 'followup') kind = 'end';
  if (!say) throw new Error('The interviewer did not reply. Try again.');
  return { say, kind };
}

export async function mockReport(settings: Settings, profile: Profile, cfg: MockConfig, turns: MockTurn[]): Promise<MockReport> {
  const raw = await completeJson<any>(settings, {
    system: 'You are a tough but fair interview coach reviewing a full mock interview transcript (the candidate spoke; ignore filler words and small transcription errors). Use only what was said and the candidate\'s real background. Reply with JSON only.',
    messages: [{ role: 'user', content: `${profileContext(profile)}

Interview (${cfg.kind}, ${cfg.style} interviewer):
${turns.map((t) => `${t.who === 'interviewer' ? 'Interviewer' : 'Candidate'}: ${t.text}`).join('\n')}

Return {"overall": 1-10, "verdict": "one sentence: would this get to the next round and why", "strengths": ["specific"], "improvements": ["specific and actionable"], "perQuestion": [{"question": "the main question", "score": 1-10, "note": "one line"}], "nextSteps": ["what to practise before the real interview"]}` }],
    effort: 'medium',
    maxTokens: 4000,
  });
  const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? Math.max(1, Math.min(10, Math.round(x))) : 5; };
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
  return {
    overall: n(raw?.overall),
    verdict: String(raw?.verdict ?? ''),
    strengths: list(raw?.strengths),
    improvements: list(raw?.improvements),
    perQuestion: (Array.isArray(raw?.perQuestion) ? raw.perQuestion : []).map((q: any) => ({ question: String(q?.question ?? ''), score: n(q?.score), note: String(q?.note ?? '') })).filter((q: { question: string }) => q.question),
    nextSteps: list(raw?.nextSteps),
  };
}

export function reportMarkdown(r: MockReport): string {
  return [
    `## Overall: ${r.overall}/10`,
    r.verdict,
    r.strengths.length ? `## Strengths\n${r.strengths.map((s) => `- ${s}`).join('\n')}` : '',
    r.improvements.length ? `## What to improve\n${r.improvements.map((s) => `- ${s}`).join('\n')}` : '',
    r.perQuestion.length ? `## Question by question\n${r.perQuestion.map((q) => `- **${q.score}/10** ${q.question}: ${q.note}`).join('\n')}` : '',
    r.nextSteps.length ? `## Before the real interview\n${r.nextSteps.map((s) => `- ${s}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

/** Read a line aloud with the device's voice, when it has one. */
export function speak(text: string, lang: string) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang; u.rate = 1;
    synth.speak(u);
  } catch { /* no speech on this device */ }
}

export function stopSpeaking() {
  try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
}

export const canSpeak = () => typeof window !== 'undefined' && 'speechSynthesis' in window;
