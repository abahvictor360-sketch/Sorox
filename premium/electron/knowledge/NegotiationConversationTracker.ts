/**
 * Soro X profile engine — compensation-talk detector.
 *
 * electron/main.ts loads `textHasCompEvidence` with the knowledge modules and
 * uses it to tell the orchestrator when the interviewer has just raised pay.
 * Soro X has no negotiation coaching; the detector only stops salary questions
 * being treated as plain résumé recall.
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
