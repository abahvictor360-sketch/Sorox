/**
 * Soro X: live salary-negotiation tracking (shared with the desktop:
 * premium/electron/knowledge/NegotiationConversationTracker.ts; keep in step).
 *
 *   textHasCompEvidence()   spots pay talk (also used so salary questions are not
 *                           treated as plain résumé recall).
 *   parseMoney()            reads amounts like "$150k", "120,000 EUR", "18 LPA".
 *   NegotiationConversationTracker
 *                           follows what the interviewer says about pay during a
 *                           call: the phase of the negotiation, their latest
 *                           number and currency, and the recent pay-related lines.
 *                           The orchestrator hands this state to the live coach.
 *
 * No AI calls here: everything is deterministic so it is cheap to run on every
 * interviewer utterance.
 */

const COMP_PATTERNS: RegExp[] = [
    /\b(salary|salaries|compensation|comp package|pay range|pay band|base pay|base salary)\b/i,
    /\b(equity|stock options?|rsus?|signing bonus|sign-on bonus|bonus structure)\b/i,
    /\b(expected|expectations?|desired|current)\s+(ctc|salary|pay|compensation|package)\b/i,
    /\b(ctc|lpa|per annum|annual package)\b/i,
    /\bhow much (are you|do you) (looking for|expect|want|earn|make)\b/i,
    /\boffer\b.*\b(number|figure|amount)\b/i,
    /[$€£₹]\s?\d/,
    /\b\d{2,3}\s?k\b/i,
];

export function textHasCompEvidence(text: string): boolean {
    if (typeof text !== 'string' || !text.trim()) return false;
    return COMP_PATTERNS.some((re) => re.test(text));
}

// ─── Amounts ────────────────────────────────────────────────────────────────

export interface Money { amount: number; currency: string }

const SYMBOLS: Record<string, string> = { '$': 'USD', '€': 'EUR', '£': 'GBP', '₹': 'INR', '₦': 'NGN' };
const CODES = /\b(usd|eur|gbp|inr|ngn|cad|aud|chf|sgd|aed|zar|kes|ghs|jpy)\b/i;
const WORDS: Record<string, string> = { dollars: 'USD', euros: 'EUR', pounds: 'GBP', rupees: 'INR', naira: 'NGN' };

/**
 * Amounts mentioned in a line, in order. Plain small numbers ("5 years", "3
 * rounds") are ignored: a number counts only with a currency, a k/m/lakh/LPA
 * suffix, or when it is at least 1,000.
 */
export function parseMoney(text: string, fallbackCurrency = ''): Money[] {
    if (typeof text !== 'string') return [];
    const out: Money[] = [];
    const lineCode = text.match(CODES)?.[1]?.toUpperCase()
        || Object.entries(WORDS).find(([w]) => new RegExp(`\\b${w}\\b`, 'i').test(text))?.[1]
        || '';
    // "120-140k" / "120 to 140k": the second number's suffix applies to the first.
    text = text.replace(/(\d+(?:\.\d+)?)\s?(-|–|—|to)\s?([$€£₹₦]?)(\d+(?:\.\d+)?)\s?(k|m|lpa|lakhs?)\b/gi, '$1$5 $2 $3$4$5');
    const re = /([$€£₹₦])?\s?(\d{1,3}(?:[,\s]\d{3})+|\d+(?:\.\d+)?)\s?(k|m|mn|million|thousand|lakhs?|lpa|crores?|cr)?\b/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
        const [, sym, rawNum, rawSuffix] = m;
        const suffix = (rawSuffix || '').toLowerCase();
        let n = Number(rawNum.replace(/[,\s]/g, ''));
        if (!Number.isFinite(n)) continue;
        if (suffix === 'k' || suffix === 'thousand') n *= 1_000;
        else if (suffix === 'm' || suffix === 'mn' || suffix === 'million') n *= 1_000_000;
        else if (suffix.startsWith('lakh') || suffix === 'lpa') n *= 100_000;
        else if (suffix.startsWith('crore') || suffix === 'cr') n *= 10_000_000;
        if (!sym && !suffix && n < 1_000) continue;
        // "2024" / "2025" on their own are years, not pay.
        if (!sym && !suffix && /^(19|20)\d{2}$/.test(rawNum)) continue;
        const currency = (sym ? SYMBOLS[sym] : '') || lineCode || (suffix.startsWith('lakh') || suffix === 'lpa' || suffix.startsWith('cr') ? 'INR' : '') || fallbackCurrency;
        out.push({ amount: Math.round(n), currency });
    }
    // One currency per line: "$120k to 140k" is dollars at both ends.
    const first = out.find((a) => a.currency)?.currency ?? '';
    return out.map((a) => (a.currency ? a : { ...a, currency: first }));
}

/** "$140k – $160k", "£80,000-£95,000" → the range's ends (midpoint for a single number). */
export function parseRange(text: string, fallbackCurrency = ''): { low: number; high: number; currency: string } | null {
    const amounts = parseMoney(text, fallbackCurrency);
    if (!amounts.length) return null;
    const vals = amounts.slice(0, 2).map((a) => a.amount);
    return { low: Math.min(...vals), high: Math.max(...vals), currency: amounts[0].currency || fallbackCurrency };
}

// ─── Phases ─────────────────────────────────────────────────────────────────

export type NegotiationPhase = 'inactive' | 'probing' | 'anchoring' | 'offer' | 'pushback' | 'closing';

const PHASE_RULES: { phase: NegotiationPhase; re: RegExp }[] = [
    { phase: 'closing', re: /\b(accept(ed)?|sign(ing)? the offer|offer letter|start date|when can you start|send (it|the offer) over|in writing|deadline|by (monday|tuesday|wednesday|thursday|friday|end of (the )?week))\b/i },
    { phase: 'pushback', re: /\b(best (we|i) can (do|offer)|budget is (fixed|capped|tight)|top of (the|our) (range|band)|can'?t go (any )?higher|non-?negotiable|that'?s (our|the) (max|maximum|ceiling)|above (our|the) (range|band|budget)|too high|out of (our )?range|final offer)\b/i },
    { phase: 'offer', re: /\b(we('d| would)? (like to )?(offer|propose)|(our|the) offer( is)?|we can (offer|do|pay)|offering you|base (salary )?of|package of|we'?re thinking)\b/i },
    { phase: 'anchoring', re: /\b(range (for|is)|band (for|is)|budgeted|the role pays|pays (between|around|up to)|range we have)\b/i },
    { phase: 'probing', re: /\b(expect(ing|ations?)?|looking for|current (salary|ctc|pay|package)|what (are you|do you) (earn|make)|how much|desired|what number|ballpark|range in mind)\b/i },
];

export function detectPhase(text: string): NegotiationPhase | null {
    for (const rule of PHASE_RULES) if (rule.re.test(text)) return rule.phase;
    return null;
}

// ─── Tracker ────────────────────────────────────────────────────────────────

export interface NegotiationState {
    phase: NegotiationPhase;
    theirOffer: number | null;
    /** Every number the interviewer has put on the table, oldest first. */
    offers: number[];
    currency: string;
    /** Recent pay-related lines from the interviewer (most recent last). */
    recent: string[];
    startedAt: number | null;
    lastActivityAt: number | null;
}

/** Pay talk older than this ends the negotiation (the interview moved on). */
export const NEGOTIATION_IDLE_MS = 8 * 60_000;
const MAX_RECENT = 8;

export class NegotiationConversationTracker {
    private state: NegotiationState = NegotiationConversationTracker.empty();

    constructor(private readonly now: () => number = Date.now) {}

    static empty(): NegotiationState {
        return { phase: 'inactive', theirOffer: null, offers: [], currency: '', recent: [], startedAt: null, lastActivityAt: null };
    }

    isActive(): boolean {
        const s = this.state;
        if (s.phase === 'inactive' || s.lastActivityAt === null) return false;
        if (this.now() - s.lastActivityAt > NEGOTIATION_IDLE_MS) { this.reset(); return false; }
        return true;
    }

    getState(): NegotiationState | null {
        return this.isActive() ? { ...this.state, offers: [...this.state.offers], recent: [...this.state.recent] } : null;
    }

    reset(): void {
        this.state = NegotiationConversationTracker.empty();
    }

    /**
     * Feed one interviewer line. Pay talk starts or advances the negotiation;
     * once it is active, short follow-ups ("is that flexible?") are kept too.
     * Returns true when the line was taken as part of the negotiation.
     */
    feed(text: string): boolean {
        const t = typeof text === 'string' ? text.trim() : '';
        if (!t) return false;
        const active = this.isActive();
        const comp = textHasCompEvidence(t);
        const phase = detectPhase(t);
        if (!comp && !(active && phase)) return false;

        const s = this.state;
        const now = this.now();
        if (!active) { s.startedAt = now; s.phase = 'probing'; }
        s.lastActivityAt = now;
        if (s.recent[s.recent.length - 1] !== t) s.recent = [...s.recent, t].slice(-MAX_RECENT);

        const amounts = parseMoney(t, s.currency);
        if (amounts.length) {
            if (!s.currency && amounts[0].currency) s.currency = amounts[0].currency;
            // A range they quote ("120 to 140k") counts as an offer at its top only
            // when they are making the offer; otherwise remember the first number.
            const value = phase === 'anchoring' && amounts.length > 1 ? Math.max(...amounts.map((a) => a.amount)) : amounts[0].amount;
            if (phase !== 'probing') {
                s.theirOffer = value;
                if (s.offers[s.offers.length - 1] !== value) s.offers = [...s.offers, value];
            }
        }
        if (phase) s.phase = phase;
        else if (amounts.length && s.phase === 'probing') s.phase = 'anchoring';
        return true;
    }
}
