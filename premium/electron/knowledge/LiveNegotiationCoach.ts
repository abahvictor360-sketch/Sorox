/**
 * Soro X profile engine — live salary-negotiation coaching.
 *
 * When the interviewer talks pay during a call, the orchestrator asks the user's
 * own AI provider (through the live-coaching function electron/main.ts wires in)
 * for a short tactical note and the exact words to say next, grounded in the
 * candidate's CV, the job, the prepared negotiation script and what the
 * interviewer has said so far. The renderer shows it as the negotiation card
 * (premium/src/NegotiationCoachingCard.tsx).
 */
import { parseJsonObject } from './ProfileExtractor';
import type { NegotiationScript } from './ProfileGenerators';
import { parseRange, type NegotiationPhase, type NegotiationState } from './NegotiationConversationTracker';
import type { GenerateContentFn, JobFacts, ResumeFacts } from './types';

/** What the renderer's negotiation card receives (NativelyInterface negotiationCoachingData). */
export interface LiveNegotiationPayload {
    tacticalNote: string;
    exactScript: string;
    showSilenceTimer: boolean;
    phase: Exclude<NegotiationPhase, 'inactive'>;
    theirOffer: number | null;
    yourTarget: number | null;
    currency: string;
}

const PHASES = new Set(['probing', 'anchoring', 'offer', 'pushback', 'closing']);

const COACH_PROMPT = `You are a salary-negotiation coach whispering to a job candidate during a live interview call.
The interviewer just said something about pay. Tell the candidate what to do and the exact words to say next.

Rules:
- Use only facts from <candidate>, <job>, <prepared_plan> and <conversation>. Never invent achievements, offers or numbers the candidate has not got.
- Never volunteer the candidate's current or past salary; redirect to the value of this role.
- Anchor with a confident range whose bottom is at or above the candidate's target. If no target is known, base it on the job's stated pay, or say to ask for the budget first.
- When they make an offer: thank them, show enthusiasm, then counter or ask for time — do not accept on the spot.
- When they push back: hold the number politely, then widen the conversation (sign-on bonus, equity, title, review date, remote days, start date) instead of dropping straight away.
- Keep it natural and warm. exactScript is what they will say out loud: 1–3 short sentences, first person, no brackets or placeholders.
- tacticalNote: at most 18 words, the one move to make now.
- showSilenceTimer: true when exactScript states a number or a counter-offer (they should then stay quiet and let the interviewer answer).

Reply with JSON only:
{"phase": "probing|anchoring|offer|pushback|closing", "tacticalNote": "", "exactScript": "", "showSilenceTimer": false, "yourTarget": number or null, "currency": "ISO code or empty"}

<candidate>
{{CANDIDATE}}
</candidate>

<job>
{{JOB}}
</job>

<prepared_plan>
{{PLAN}}
</prepared_plan>

<conversation>
Phase so far: {{PHASE}}
Their latest number: {{OFFER}}
Numbers they have put on the table: {{OFFERS}}
Recent lines from the interviewer (oldest first):
{{RECENT}}
</conversation>

Interviewer's latest line: "{{LINE}}"`;

function candidateBlock(r: ResumeFacts): string {
    const roles = (r.experience ?? []).slice(0, 4).map((e) => `- ${e.role} at ${e.company} (${[e.start_date, e.end_date].filter(Boolean).join(' – ')})${e.bullets?.length ? `: ${e.bullets.slice(0, 3).join('; ')}` : ''}`);
    const skills = Object.values(r.skills ?? {}).flat().slice(0, 20).join(', ');
    return [`Name: ${r.identity?.name ?? ''}`, r.identity?.location ? `Location: ${r.identity.location}` : '', r.identity?.summary ? `Summary: ${r.identity.summary}` : '', roles.length ? `Experience:\n${roles.join('\n')}` : '', skills ? `Skills: ${skills}` : '']
        .filter(Boolean).join('\n');
}

function jobBlock(j: JobFacts | null): string {
    if (!j) return '(no job description uploaded)';
    return [`Role: ${j.title}${j.company ? ` at ${j.company}` : ''}${j.location ? ` (${j.location})` : ''}`, j.level ? `Level: ${j.level}` : '',
        j.compensation_hint ? `Stated pay: ${j.compensation_hint}` : 'Stated pay: not given', j.requirements?.length ? `Key requirements: ${j.requirements.slice(0, 6).join('; ')}` : '']
        .filter(Boolean).join('\n');
}

function planBlock(s: NegotiationScript | null): string {
    if (!s) return '(none prepared)';
    return [`Target range: ${s.target_range}`, `Opening line: ${s.opening_script}`, s.leverage_points.length ? `Leverage: ${s.leverage_points.slice(0, 5).join('; ')}` : '', s.walk_away ? `Walk-away: ${s.walk_away}` : '']
        .filter(Boolean).join('\n');
}

/** The candidate's target: the top of the prepared range, else the top of the job's stated pay. */
export function targetFrom(script: NegotiationScript | null, job: JobFacts | null, currency = ''): { amount: number | null; currency: string } {
    const r = (script?.target_range && parseRange(script.target_range, currency)) || (job?.compensation_hint && parseRange(job.compensation_hint, currency)) || null;
    return r ? { amount: r.high, currency: r.currency || currency } : { amount: null, currency };
}

export function buildCoachPrompt(line: string, state: NegotiationState, r: ResumeFacts, j: JobFacts | null, script: NegotiationScript | null): string {
    const fmt = (n: number | null) => (n === null ? 'none yet' : `${n.toLocaleString('en-US')}${state.currency ? ` ${state.currency}` : ''}`);
    return COACH_PROMPT
        .replace('{{CANDIDATE}}', candidateBlock(r))
        .replace('{{JOB}}', jobBlock(j))
        .replace('{{PLAN}}', planBlock(script))
        .replace('{{PHASE}}', state.phase)
        .replace('{{OFFER}}', fmt(state.theirOffer))
        .replace('{{OFFERS}}', state.offers.length ? state.offers.map((o) => fmt(o)).join(' → ') : 'none')
        .replace('{{RECENT}}', state.recent.map((l) => `- ${l}`).join('\n') || '(none)')
        .replace('{{LINE}}', line.replace(/"/g, "'"));
}

/** Shape a model reply into the card payload; null when it has nothing usable to say. */
export function normalizeCoaching(raw: any, state: NegotiationState, fallbackTarget: { amount: number | null; currency: string }): LiveNegotiationPayload | null {
    if (!raw || typeof raw !== 'object') return null;
    const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    const exactScript = s(raw.exactScript);
    const tacticalNote = s(raw.tacticalNote);
    if (!exactScript && !tacticalNote) return null;
    const phase = PHASES.has(raw.phase) ? raw.phase : (state.phase === 'inactive' ? 'probing' : state.phase);
    const modelTarget = typeof raw.yourTarget === 'number' && Number.isFinite(raw.yourTarget) && raw.yourTarget > 0 ? Math.round(raw.yourTarget) : null;
    return {
        tacticalNote,
        exactScript,
        showSilenceTimer: raw.showSilenceTimer === true,
        phase,
        theirOffer: state.theirOffer,
        // The prepared plan wins over a number the model came up with on the spot.
        yourTarget: fallbackTarget.amount ?? modelTarget,
        currency: state.currency || fallbackTarget.currency || (/^[A-Z]{3}$/.test(s(raw.currency)) ? s(raw.currency) : ''),
    };
}

export async function coachLive(
    generate: GenerateContentFn, line: string, state: NegotiationState, r: ResumeFacts, j: JobFacts | null, script: NegotiationScript | null,
): Promise<LiveNegotiationPayload | null> {
    const reply = await generate([{ text: buildCoachPrompt(line, state, r, j, script) }]);
    return normalizeCoaching(parseJsonObject(reply), state, targetFrom(script, j, state.currency));
}
