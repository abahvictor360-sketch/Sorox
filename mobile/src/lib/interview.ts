// Soro X Mobile — interview logic: spotting questions in a transcript, and the
// prompts behind live answers, practice feedback and preparation documents.
// Every prompt is grounded in the user's own CV and target job (profile.ts).
import { complete, completeJson, type Effort } from './ai';
import { profileContext, type Profile } from './profile';
import type { Settings } from './settings';

// ─── Question detection ─────────────────────────────────────────────────────

const QUESTION_START = /^(what|why|how|when|where|who|which|can|could|would|will|do|does|did|are|is|have|has|should|tell me|walk me|describe|explain|give me|talk me|share|imagine|suppose|let'?s say|in your)\b/i;
const QUESTION_INSIDE = /\b(tell me about|walk me through|can you (describe|explain|tell|share|give)|could you|what would you|how would you|why do you|why did you|what is your|what are your|describe a time|give (me )?an example)\b/i;

/** Does this transcript segment read like an interviewer's question? */
export function looksLikeQuestion(text: string): boolean {
  const t = text.trim();
  if (t.split(/\s+/).length < 4) return false;
  if (/\?\s*$/.test(t)) return true;
  const lastSentence = t.split(/(?<=[.!?])\s+/).filter(Boolean).pop() ?? t;
  return QUESTION_START.test(lastSentence) || QUESTION_INSIDE.test(lastSentence);
}

/** The most recent question in the transcript, with the context before it. */
export function latestQuestion(segments: string[]): { question: string; context: string } | null {
  for (let i = segments.length - 1; i >= 0; i--) {
    if (looksLikeQuestion(segments[i])) {
      return { question: segments[i].trim(), context: segments.slice(Math.max(0, i - 6), i).join('\n') };
    }
  }
  return null;
}

// ─── Live answers ───────────────────────────────────────────────────────────

const ANSWER_SYSTEM = (style: Settings['answerStyle']) => `You help a job candidate answer interview questions in real time. They glance at your text and say it in their own words.

Rules:
- Answer as the candidate, in the first person, using ONLY facts from <candidate> / <candidate_cv>, <target_job> and <candidate_notes>. Never invent employers, numbers, dates or skills. If the profile does not cover something, give an honest, general answer and say what to emphasise instead.
- Behavioural questions ("tell me about a time…"): pick the single best real story and structure it as Situation → Task → Action → Result.
- Technical questions: give the approach first, then key points, trade-offs, and a one-line summary. Include short code only if asked to write code.
- Salary questions: give a range anchored on the role and market, deflect "current salary", and keep it polite.
- Connect answers to the target job's requirements when relevant.
- ${style === 'concise'
    ? 'Format: a bold one-line headline answer, then 3-5 short bullet points they can speak from. No preamble, under 120 words.'
    : 'Format: a bold one-line headline, 3-5 bullets, then a short ready-to-say script (4-6 sentences). Under 250 words.'}
- Plain markdown only (bold and bullets). No headings, no "Sure!".`;

export async function answerQuestion(
  settings: Settings, profile: Profile, question: string, context: string,
  onText: (delta: string, full: string) => void, signal?: AbortSignal,
): Promise<string> {
  const content = `${profileContext(profile) || '(No CV added yet — answer generally and remind them to add their CV in Profile.)'}

Recent conversation (for context; may include the candidate's own words):
${context || '(none)'}

Interviewer's question: "${question}"`;
  return complete(settings, {
    system: ANSWER_SYSTEM(settings.answerStyle),
    messages: [{ role: 'user', content }],
    effort: 'low',
    maxTokens: 2000,
    onText,
    signal,
  });
}

// ─── Practice (mock interview) ──────────────────────────────────────────────

export type PracticeKind = 'behavioral' | 'technical' | 'role-fit' | 'mixed';

export interface Feedback {
  score: number;
  verdict: string;
  strengths: string[];
  improvements: string[];
  betterAnswer: string;
}

export async function nextPracticeQuestion(settings: Settings, profile: Profile, kind: PracticeKind, asked: string[]): Promise<string> {
  const out = await complete(settings, {
    system: 'You are an experienced interviewer for the target role. Ask exactly one realistic interview question. Reply with the question only.',
    messages: [{ role: 'user', content: `${profileContext(profile)}

Question type: ${kind}. Base it on the target job's requirements and the candidate's background; probe weak spots too.
Do not repeat any of these:\n${asked.map((q) => `- ${q}`).join('\n') || '(none yet)'}` }],
    effort: 'low',
    maxTokens: 400,
  });
  return out.trim().replace(/^["“]|["”]$/g, '');
}

export async function gradeAnswer(settings: Settings, profile: Profile, question: string, answer: string): Promise<Feedback> {
  const raw = await completeJson<any>(settings, {
    system: 'You are a tough but fair interview coach. Grade the candidate\'s spoken answer (it is a transcript, so ignore filler words and small transcription errors). Reply with JSON only.',
    messages: [{ role: 'user', content: `${profileContext(profile)}

Question: "${question}"
Candidate's answer: "${answer}"

Return {"score": 1-10, "verdict": "one sentence", "strengths": [""], "improvements": ["specific, actionable"], "betterAnswer": "a stronger answer in the candidate's voice, using only their real experience, under 150 words"}` }],
    effort: 'medium',
    maxTokens: 3000,
  });
  const n = Number(raw?.score);
  return {
    score: Number.isFinite(n) ? Math.max(1, Math.min(10, Math.round(n))) : 5,
    verdict: String(raw?.verdict ?? ''),
    strengths: Array.isArray(raw?.strengths) ? raw.strengths.map(String) : [],
    improvements: Array.isArray(raw?.improvements) ? raw.improvements.map(String) : [],
    betterAnswer: String(raw?.betterAnswer ?? ''),
  };
}

// ─── Preparation documents ──────────────────────────────────────────────────

export type PrepKind = 'pitch' | 'questions' | 'fit' | 'company' | 'stories' | 'ask' | 'negotiation' | 'cover';

export const PREP_KINDS: { id: PrepKind; title: string; blurb: string; effort: Effort; needsJob?: boolean }[] = [
  { id: 'pitch', title: 'Tell me about yourself', blurb: 'A 60–90 second pitch from your CV, tuned to this job.', effort: 'medium' },
  { id: 'questions', title: 'Likely questions & answers', blurb: 'The 10 questions you are most likely to get, with answer outlines.', effort: 'medium', needsJob: true },
  { id: 'fit', title: 'Role fit', blurb: 'Requirement by requirement: where you are strong, partial, or have a gap — and how to handle it.', effort: 'high', needsJob: true },
  { id: 'stories', title: 'STAR stories', blurb: 'Your best experiences as ready-to-tell Situation-Task-Action-Result stories.', effort: 'medium' },
  { id: 'company', title: 'Company brief', blurb: 'What to know about the company before you walk in (from the AI\'s knowledge; check recent news).', effort: 'medium', needsJob: true },
  { id: 'ask', title: 'Questions to ask them', blurb: 'Smart, specific questions for the end of the interview.', effort: 'low', needsJob: true },
  { id: 'negotiation', title: 'Salary negotiation script', blurb: 'Your range, an opening line and replies to common push-backs.', effort: 'medium', needsJob: true },
  { id: 'cover', title: 'Cover letter', blurb: 'A short, specific cover letter from your real experience.', effort: 'medium', needsJob: true },
];

const PREP_PROMPTS: Record<PrepKind, string> = {
  pitch: 'Write a 60–90 second "Tell me about yourself" answer in the first person: present role, 2 most relevant achievements with results, why this role/company now. Then 3 bullet tips for delivering it.',
  questions: 'List the 10 questions this candidate is most likely to be asked for this job (mix of behavioural, technical/role and motivation). For each: the question in bold, why they will ask it, and a 3-bullet answer outline from the candidate\'s real experience.',
  fit: 'Go through every requirement of the target job. For each give a status (✅ strong / 🟡 partial / ❌ gap), the CV evidence, and how to address it in the interview. End with an overall fit score out of 100 and the 3 things to emphasise.',
  stories: 'Turn the candidate\'s 5 strongest experiences into STAR stories (Situation, Task, Action, Result) of 4–6 sentences each, with numbers only where the CV gives them. Label each with the competencies it proves (leadership, conflict, failure, impact…).',
  company: 'Write a pre-interview brief on the target company: what it does, business model, products, culture and values, recent strategy, competitors, and what interviews there tend to focus on. Say clearly which points the candidate should verify against recent news, since your knowledge may be dated. End with 3 ways to connect their background to the company.',
  ask: 'Suggest 8 specific, thoughtful questions the candidate can ask the interviewers, grouped by audience (hiring manager, team, HR), each with one line on why it lands well.',
  negotiation: 'Prepare a salary negotiation plan: a target range (use the job\'s stated salary if any, otherwise a reasonable market estimate and say it is an estimate), an opening script, replies for "what is your current salary?", "this is our best offer", and "the budget is fixed", the candidate\'s leverage points from their CV, and a walk-away point. Short, polite, ready to say aloud.',
  cover: 'Write a cover letter (250–350 words) in the first person, tying 2–3 concrete experiences to the job\'s main requirements. No clichés. Sign with the candidate\'s name.',
};

export async function generatePrep(
  settings: Settings, profile: Profile, kind: PrepKind, onText: (delta: string, full: string) => void, signal?: AbortSignal,
): Promise<string> {
  const spec = PREP_KINDS.find((k) => k.id === kind)!;
  return complete(settings, {
    system: 'You are an expert career coach preparing a candidate for a job interview. Use only facts from the candidate\'s profile; never invent experience, employers or numbers. Write in clear markdown (headings, bold, bullets).',
    messages: [{ role: 'user', content: `${profileContext(profile)}\n\nTask: ${PREP_PROMPTS[kind]}` }],
    effort: spec.effort,
    maxTokens: 8000,
    onText,
    signal,
  });
}
