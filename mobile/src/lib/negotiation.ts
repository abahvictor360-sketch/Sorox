// Soro X Mobile — live negotiation coaching (the desktop's coach, on the phone).
import { completeJson } from './ai';
import { profileContext, type Profile } from './profile';
import type { Settings } from './settings';
import { parseRange, type NegotiationState } from './negotiationTracker';

export interface Coaching {
  tacticalNote: string;
  exactScript: string;
  showSilenceTimer: boolean;
  phase: string;
  theirOffer: number | null;
  yourTarget: number | null;
  currency: string;
}

const SYSTEM = `You are a salary-negotiation coach whispering to a job candidate during a live call. The other side just said something about pay.
Rules: use only facts from the profile and conversation; never volunteer current salary; anchor with a confident range whose bottom is at or above the candidate's target; on an offer, thank them, show enthusiasm, then counter or ask for time; on push-back, hold politely and widen to sign-on bonus, equity, title, review date, remote days, start date. exactScript: 1–3 natural first-person sentences, no placeholders. tacticalNote: at most 18 words. showSilenceTimer: true when exactScript states a number or a counter-offer.
Reply with JSON only: {"phase":"probing|anchoring|offer|pushback|closing","tacticalNote":"","exactScript":"","showSilenceTimer":false,"yourTarget":null,"currency":""}`;

export async function coach(settings: Settings, profile: Profile, line: string, state: NegotiationState, transcript: string, salaryPlan: string): Promise<Coaching | null> {
  const raw = await completeJson<any>(settings, {
    system: SYSTEM,
    messages: [{ role: 'user', content: `${profileContext(profile)}

Prepared salary plan (may be empty):
${salaryPlan.slice(0, 3000) || '(none)'}

Negotiation so far: phase ${state.phase}; their latest number ${state.theirOffer ?? 'none'} ${state.currency}; numbers on the table: ${state.offers.join(' → ') || 'none'}.

Conversation:
${transcript}

Their latest line: "${line}"` }],
    effort: 'low',
    maxTokens: 1200,
  });
  const tacticalNote = String(raw?.tacticalNote ?? '').trim();
  const exactScript = String(raw?.exactScript ?? '').trim();
  if (!tacticalNote && !exactScript) return null;
  const planTarget = parseRange(salaryPlan.match(/[^\n]*(target|range)[^\n]*/i)?.[0] ?? '', state.currency)?.high ?? null;
  const modelTarget = typeof raw?.yourTarget === 'number' && raw.yourTarget > 0 ? Math.round(raw.yourTarget) : null;
  return {
    tacticalNote, exactScript,
    showSilenceTimer: raw?.showSilenceTimer === true,
    phase: ['probing', 'anchoring', 'offer', 'pushback', 'closing'].includes(raw?.phase) ? raw.phase : state.phase,
    theirOffer: state.theirOffer,
    yourTarget: planTarget ?? modelTarget,
    currency: state.currency || (/^[A-Z]{3}$/.test(String(raw?.currency ?? '')) ? raw.currency : ''),
  };
}
