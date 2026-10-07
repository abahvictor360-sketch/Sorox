/**
 * Soro X — company research for the Company Intel screen.
 *
 * With a Tavily key: a few web searches (culture, interviews, pay, news) are
 * summarised by the user's AI provider, and the sources are kept so the screen
 * shows "live search". Without one: the AI model answers from what it knows, the
 * dossier carries no sources and is marked `degraded`, and the screen says so.
 */
import { parseJsonObject } from './ProfileExtractor';
import { GenerateContentFn } from './types';
import type { SearchResult } from './TavilySearchProvider';

const MAX_SNIPPET_CHARS = 1_200;
const DIFFICULTIES = new Set(['easy', 'medium', 'hard', 'very_hard']);

export interface SearchProviderLike {
    search(query: string): Promise<unknown>;
    quotaExhausted?: boolean;
}

/** Dossier cache. KnowledgeDatabaseManager implements it (same shape as Natively's engine used). */
export interface DossierStore {
    getDossier(company: string): { dossier: any } | null;
    isDossierStale(company: string): boolean;
    saveDossier(company: string, dossier: unknown, sources?: unknown): void;
}

export interface JobContext {
    title?: string;
    location?: string;
    level?: string;
    technologies?: string[];
    requirements?: string[];
    compensation_hint?: string | null;
}

const DOSSIER_PROMPT = `You are preparing a candidate for a job interview at {{COMPANY}}{{ROLE}}.
{{EVIDENCE}}
Return ONLY one JSON object, no prose, no code fences:
{
  "company": "",
  "hiring_strategy": "2-4 sentences: what they hire for and how",
  "interview_focus": "what their interviews test, 1-3 sentences",
  "interview_difficulty": "easy | medium | hard | very_hard",
  "culture_ratings": { "overall": 0, "work_life_balance": 0, "career_growth": 0, "compensation": 0, "management": 0 },
  "salary_estimates": [ { "title": "", "location": "", "min": 0, "max": 0, "currency": "USD", "confidence": "low | medium | high" } ],
  "core_values": [""],
  "benefits": [""],
  "critics": [ { "category": "", "complaint": "", "frequency": "common | occasional | rare" } ],
  "recent_news": "1-3 sentences, or \\"\\"",
  "competitors": [""]
}
Rules:
- Ratings are 1-5 (decimals allowed); use 0 when you have no basis.
- {{SOURCE_RULE}}
- Salary estimates are for the role above; use low confidence unless a source states figures.
- Do not invent specific events, people or numbers.`;

export class CompanyResearchEngine {
    searchProvider: SearchProviderLike | null = null;
    private generateFn: GenerateContentFn | null = null;

    constructor(
        private readonly db: DossierStore,
        private readonly generateSource?: () => GenerateContentFn | null,
    ) {}

    /** Direct wiring, for callers without an orchestrator. */
    setGenerateContentFn(fn: GenerateContentFn): void {
        this.generateFn = fn;
    }

    private generate(): GenerateContentFn | null {
        return this.generateSource?.() ?? this.generateFn;
    }

    setSearchProvider(provider: SearchProviderLike | null): void {
        this.searchProvider = provider;
    }

    /** Whatever is on disk for this company, regardless of age (rehydrates the screen). */
    getCachedDossier(company: string): any | null {
        if (!company?.trim()) return null;
        return this.db.getDossier(company)?.dossier ?? null;
    }

    async researchCompany(company: string, job: JobContext = {}, forceRefresh = false): Promise<any> {
        const name = (company ?? '').trim();
        if (!name) throw new Error('No company name to research.');
        const cached = this.db.getDossier(name);
        const fresh = !!cached?.dossier && !this.db.isDossierStale(name);
        // A cached LLM-only dossier is not reused once live search is available.
        if (!forceRefresh && fresh && !(cached!.dossier.degraded && this.searchProvider)) return cached!.dossier;

        const generate = this.generate();
        if (!generate) throw new Error('No AI provider is configured. Add a key in Settings → AI Providers.');

        const evidence = await this.gatherEvidence(name, job);
        const prompt = DOSSIER_PROMPT
            .replace('{{COMPANY}}', name)
            .replace('{{ROLE}}', job.title ? ` for the role "${job.title}"${job.location ? ` (${job.location})` : ''}` : '')
            .replace('{{EVIDENCE}}', evidence.length
                ? `\nWeb search results:\n${evidence.map((r, i) => `[${i + 1}] ${r.title} (${r.url})\n${r.content.slice(0, MAX_SNIPPET_CHARS)}`).join('\n\n')}\n`
                : '\nNo web search is available. Answer from your general knowledge of the company.\n')
            .replace('{{SOURCE_RULE}}', evidence.length
                ? 'Base every field on the search results; leave a field empty when they do not support it.'
                : 'Only state what is widely known about the company; leave a field empty when unsure.');

        const raw = parseJsonObject(await generate([{ text: prompt }]));
        if (!raw) throw new Error('The AI provider did not return a usable answer. Try again.');

        const dossier = normalizeDossier(raw, name, evidence);
        this.db.saveDossier(name, dossier, dossier.sources);
        return dossier;
    }

    private async gatherEvidence(company: string, job: JobContext): Promise<SearchResult[]> {
        const provider = this.searchProvider;
        if (!provider) return [];
        const role = job.title ? ` ${job.title}` : '';
        const queries = [
            `${company} company culture employee reviews`,
            `${company}${role} interview process questions`,
            `${company}${role} salary range`,
            `${company} news this year`,
        ];
        const seen = new Set<string>();
        const out: SearchResult[] = [];
        for (const q of queries) {
            if (provider.quotaExhausted) break;
            try {
                const results = await provider.search(q);
                for (const r of (Array.isArray(results) ? results : []) as SearchResult[]) {
                    if (!r?.url || seen.has(r.url)) continue;
                    seen.add(r.url);
                    out.push({ title: String(r.title ?? ''), url: String(r.url), content: String(r.content ?? '') });
                }
            } catch (e: any) {
                console.warn('[SoroX/CompanyResearch] search failed:', e?.message || e);
            }
        }
        return out.slice(0, 16);
    }
}

// ─── Normalisation ───────────────────────────────────────────────────────────

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const strList = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const rating = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.min(5, Math.round(n * 10) / 10) : 0;
};

export function normalizeDossier(raw: Record<string, any>, company: string, evidence: SearchResult[]) {
    const cr = (raw.culture_ratings && typeof raw.culture_ratings === 'object') ? raw.culture_ratings : {};
    const difficulty = str(raw.interview_difficulty).toLowerCase().replace(/\s+/g, '_');
    return {
        company: str(raw.company) || company,
        hiring_strategy: str(raw.hiring_strategy),
        interview_focus: str(raw.interview_focus),
        interview_difficulty: DIFFICULTIES.has(difficulty) ? difficulty : '',
        culture_ratings: {
            overall: rating(cr.overall),
            work_life_balance: rating(cr.work_life_balance),
            career_growth: rating(cr.career_growth),
            compensation: rating(cr.compensation),
            management: rating(cr.management),
        },
        salary_estimates: (Array.isArray(raw.salary_estimates) ? raw.salary_estimates : [])
            .map((s: any) => ({
                title: str(s?.title),
                location: str(s?.location),
                min: Number(s?.min) || 0,
                max: Number(s?.max) || 0,
                currency: str(s?.currency) || 'USD',
                confidence: ['low', 'medium', 'high'].includes(str(s?.confidence)) ? str(s?.confidence) : 'low',
            }))
            .filter((s: any) => s.max > 0 || s.min > 0),
        core_values: strList(raw.core_values),
        benefits: strList(raw.benefits),
        critics: (Array.isArray(raw.critics) ? raw.critics : [])
            .map((c: any) => ({ category: str(c?.category), complaint: str(c?.complaint), frequency: str(c?.frequency) }))
            .filter((c: any) => c.complaint),
        recent_news: str(raw.recent_news),
        competitors: strList(raw.competitors),
        sources: evidence.map((r) => ({ title: r.title, url: r.url })),
        degraded: evidence.length === 0,
        researched_at: new Date().toISOString(),
    };
}
