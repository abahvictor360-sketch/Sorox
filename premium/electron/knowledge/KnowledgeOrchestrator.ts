/**
 * Soro X profile engine — the object electron/main.ts loads as `KnowledgeOrchestrator`.
 *
 * What it does:
 *   - ingestDocument(): parse a résumé / job description with the app's own safe
 *     document parser, extract structured facts with the user's AI provider, store them.
 *   - activeResume / activeJD: expose the stored documents in the shape the core
 *     answer path already reads (electron/llm/ActiveProfileContext.ts), so the
 *     app's existing profile grounding, raw-text index and delete flow all work.
 *   - processQuestion(): hand back a compact candidate-profile context block for
 *     the live answer when profile mode is on.
 *   - getStatus() / getProfileData(): feed the Profile Intelligence screen.
 *
 *   - Company research, cover letter, negotiation script and Role Insight, all
 *     generated with the user's own AI provider (and Tavily key, when set).
 *
 * Not implemented: live negotiation coaching during a call.
 */
import { extractSafeDocumentText } from '../../../electron/services/SafeDocumentTextExtractor';
import { isCandidateProfileQuestion } from '../../../electron/llm/manualProfileIntelligence';
import { KnowledgeDatabaseManager } from './KnowledgeDatabaseManager';
import { extractJob, extractResume } from './ProfileExtractor';
import { textHasCompEvidence } from './NegotiationConversationTracker';
import { CompanyResearchEngine } from './CompanyResearchEngine';
import { CoverLetter, generateCoverLetter, generateNegotiationScript, NegotiationScript } from './ProfileGenerators';
import { RoleInsightService } from './roleInsight/RoleInsightService';
import {
    DocType,
    GenerateContentFn,
    IngestResult,
    JobFacts,
    PromptAssemblyResult,
    ResumeFacts,
    StoredDocument,
} from './types';

/** Cap on the résumé text added to one answer prompt (the job block is already capped by list slices). */
const MAX_CONTEXT_CHARS = 6_000;

const UNREADABLE = 'Could not read any text from that file. If it is a scanned PDF, export it with selectable text.';

export class KnowledgeOrchestrator {
    private generateContentFn: GenerateContentFn | null = null;
    private knowledgeModeEnabled = false;
    private resume: StoredDocument<ResumeFacts> | null = null;
    private jd: StoredDocument<JobFacts> | null = null;
    private readonly ingesting = new Set<DocType>();
    private readonly research: CompanyResearchEngine;
    private readonly roleInsight: RoleInsightService;
    private searchProviderResolver: (() => unknown) | null = null;

    constructor(private readonly db: KnowledgeDatabaseManager) {
        this.refreshCache();
        this.research = new CompanyResearchEngine(db, () => this.generateContentFn);
        this.roleInsight = new RoleInsightService(db, () => ({ resume: this.resume, jd: this.jd }), () => this.generateContentFn);
    }

    // ─── Wiring called by electron/main.ts ──────────────────────────────────

    setGenerateContentFn(fn: GenerateContentFn): void {
        this.generateContentFn = fn;
    }

    /** Tavily (user key) → none; resolved per use so a key added mid-session counts. */
    setSearchProviderResolver(fn: () => unknown): void {
        this.searchProviderResolver = fn;
    }

    /** Embeddings are not needed: the core app indexes the raw text itself (v3ProfileSources). */
    setEmbedFn(_fn: (text: string) => Promise<number[]>): void {
        /* not used by the Soro X engine */
    }

    setKnowledgeMode(enabled: boolean): void {
        this.knowledgeModeEnabled = !!enabled;
    }

    /** Profile mode only takes effect once a résumé is loaded. */
    isKnowledgeMode(): boolean {
        return this.knowledgeModeEnabled && !!this.resume;
    }

    // ─── Documents ───────────────────────────────────────────────────────────

    get activeResume(): StoredDocument<ResumeFacts> | null {
        return this.resume;
    }

    get activeJD(): StoredDocument<JobFacts> | null {
        return this.jd;
    }

    isIngesting(type: DocType): boolean {
        return this.ingesting.has(type);
    }

    async ingestDocument(filePath: string, type: DocType): Promise<IngestResult> {
        if (type !== DocType.RESUME && type !== DocType.JD) {
            return { success: false, error: `Unknown document type: ${String(type)}` };
        }
        if (this.ingesting.has(type)) {
            return { success: false, error: 'That document is still being processed.' };
        }
        this.ingesting.add(type);
        try {
            let text = '';
            try {
                text = (await extractSafeDocumentText(filePath)).content?.trim() ?? '';
            } catch (e: any) {
                // The parser reports an empty document as an error; anything else is a real failure.
                if (!/empty text/i.test(String(e?.message))) throw e;
            }
            if (text.length < 40) {
                return { success: false, error: UNREADABLE };
            }
            if (type === DocType.RESUME) {
                const facts = await extractResume(text, this.generateContentFn);
                this.resume = this.db.saveDocument(type, filePath, text, facts);
                console.log(`[SoroX/Knowledge] Résumé stored (${facts._extraction_mode}): ${facts.experience.length} roles, ${facts.projects.length} projects`);
                return { success: true, docType: type, extractionMode: facts._extraction_mode };
            }
            const facts = await extractJob(text, this.generateContentFn);
            this.jd = this.db.saveDocument(type, filePath, text, facts);
            console.log(`[SoroX/Knowledge] Job description stored (${facts._extraction_mode}): ${facts.title || 'untitled'} @ ${facts.company || 'unknown'}`);
            return { success: true, docType: type, extractionMode: facts._extraction_mode };
        } catch (e: any) {
            console.error('[SoroX/Knowledge] ingestDocument failed:', e);
            return { success: false, error: e?.message || 'Could not process that file.' };
        } finally {
            this.ingesting.delete(type);
        }
    }

    /** Synchronous: profile:delete runs it inside a SQLite transaction. */
    deleteDocumentsByType(type: DocType): void {
        this.db.deleteByType(type);
        // Cover letter, negotiation script and Role Insight reports are built from both documents.
        this.db.clearDerived();
        if (type === DocType.RESUME) this.resume = null;
        if (type === DocType.JD) this.jd = null;
    }

    refreshCache(): void {
        try {
            this.resume = this.db.getDocument<ResumeFacts>(DocType.RESUME);
            this.jd = this.db.getDocument<JobFacts>(DocType.JD);
        } catch (e) {
            console.warn('[SoroX/Knowledge] Could not load stored profile:', e);
        }
    }

    // ─── Profile screen ─────────────────────────────────────────────────────

    getStatus() {
        const r = this.resume?.structured_data;
        const latest = r?.experience?.[0];
        return {
            hasResume: !!this.resume,
            activeMode: this.isKnowledgeMode(),
            hasActiveJD: !!this.jd,
            resumeSummary: r
                ? { name: r.identity?.name || '', role: latest?.role || '', totalExperienceYears: estimateYears(r) }
                : undefined,
        };
    }

    getProfileData() {
        const r = this.resume?.structured_data;
        const j = this.jd?.structured_data;
        const skillsFlat = r ? [...new Set(Object.values(r.skills ?? {}).flat())] : [];
        return {
            identity: r?.identity ?? null,
            experience: r?.experience ?? [],
            experienceCount: r?.experience?.length ?? 0,
            projects: r?.projects ?? [],
            skills: r?.skills ?? {},
            skillsFlat,
            education: r?.education ?? [],
            hasActiveJD: !!j,
            activeJD: j
                ? {
                    title: j.title,
                    company: j.company,
                    location: j.location,
                    level: j.level,
                    technologies: j.technologies,
                    requirements: j.requirements,
                    keywords: j.keywords,
                    compensation_hint: j.compensation_hint,
                    min_years_experience: j.min_years_experience,
                }
                : null,
            companyDossier: j?.company ? this.research.getCachedDossier(j.company) : null,
            coverLetter: this.getCoverLetter(),
            aotStatus: { companyResearch: 'idle' },
        };
    }

    // ─── Live answers ───────────────────────────────────────────────────────

    async processQuestion(question: string): Promise<PromptAssemblyResult | null> {
        if (!this.isKnowledgeMode() || !this.resume) return null;
        const q = typeof question === 'string' ? question : '';
        const contextBlock = buildContextBlock(this.resume.structured_data, this.jd?.structured_data ?? null);
        return {
            contextBlock,
            // "About me" questions are plain recall of the user's own facts; pay talk is not.
            factualRecall: isCandidateProfileQuestion(q) && !textHasCompEvidence(q),
            isIntroQuestion: false,
        };
    }

    /** Hooks the core app calls on every turn; the Soro X engine keeps no per-turn state. */
    feedForDepthScoring(_message: string): void { /* no-op */ }
    feedInterviewerUtterance(_text: string): void { /* no-op */ }

    // ─── Company research, cover letter, negotiation script, Role Insight ───

    getCompanyResearchEngine(): CompanyResearchEngine {
        // profile:research-company sets the provider itself; this covers other callers.
        if (!this.research.searchProvider && this.searchProviderResolver) {
            try { this.research.setSearchProvider((this.searchProviderResolver() as any) ?? null); } catch { /* LLM-only */ }
        }
        return this.research;
    }

    getRoleInsightService(): RoleInsightService {
        return this.roleInsight;
    }

    /** Identifies the résumé + JD pair a generated document was written from. */
    private sourceKey(): string {
        return `${this.resume?.id ?? 0}:${this.resume?.updated_at ?? ''}|${this.jd?.id ?? 0}:${this.jd?.updated_at ?? ''}`;
    }

    private stored<T>(kind: string): T | null {
        const row = this.db.getGenerated(kind);
        return row && row.source_key === this.sourceKey() ? (row.content as T) : null;
    }

    private async writeDocument<T>(kind: string, write: (g: GenerateContentFn, r: ResumeFacts, j: JobFacts, dossier: any) => Promise<T | null>): Promise<T | null> {
        if (!this.resume || !this.jd) return null;
        const generate = this.generateContentFn;
        if (!generate) throw new Error('No AI provider is configured. Add a key in Settings → AI Providers.');
        const dossier = this.jd.structured_data.company ? this.research.getCachedDossier(this.jd.structured_data.company) : null;
        const doc = await write(generate, this.resume.structured_data, this.jd.structured_data, dossier);
        if (doc) this.db.saveGenerated(kind, this.sourceKey(), doc);
        return doc;
    }

    getCoverLetter(): CoverLetter | null {
        return this.stored<CoverLetter>('cover_letter');
    }

    generateCoverLetterOnDemand(): Promise<CoverLetter | null> {
        return this.writeDocument('cover_letter', generateCoverLetter);
    }

    getNegotiationScript(): NegotiationScript | null {
        return this.stored<NegotiationScript>('negotiation_script');
    }

    generateNegotiationScriptOnDemand(): Promise<NegotiationScript | null> {
        return this.writeDocument('negotiation_script', generateNegotiationScript);
    }

    // Live negotiation coaching during a call is not part of Soro X.
    getNegotiationTracker() {
        return { getState: (): null => null, isActive: (): boolean => false };
    }

    resetNegotiationSession(): void { /* no-op */ }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Rough total years from experience dates ("2019", "Jan 2021", "Present"). */
export function estimateYears(r: ResumeFacts): number | undefined {
    const now = new Date().getFullYear();
    let earliest = Infinity;
    for (const e of r.experience ?? []) {
        const y = Number(String(e.start_date ?? '').match(/(19|20)\d{2}/)?.[0]);
        if (Number.isFinite(y) && y > 1950) earliest = Math.min(earliest, y);
    }
    return Number.isFinite(earliest) ? Math.max(0, now - earliest) : undefined;
}

const line = (label: string, value: unknown) => {
    const v = Array.isArray(value) ? value.filter(Boolean).join(', ') : typeof value === 'string' ? value.trim() : '';
    return v ? `${label}: ${v}` : '';
};

export function buildContextBlock(r: ResumeFacts, j: JobFacts | null): string {
    const parts: string[] = [];
    const id = r.identity ?? ({} as ResumeFacts['identity']);
    parts.push([line('Name', id.name), line('Location', id.location), line('Summary', id.summary)].filter(Boolean).join('\n'));

    if (r.experience?.length) {
        parts.push('Experience:\n' + r.experience.map((e) => {
            const dates = [e.start_date, e.end_date].filter(Boolean).join(' – ');
            const head = `- ${e.role || 'Role'}${e.company ? ` at ${e.company}` : ''}${dates ? ` (${dates})` : ''}`;
            return [head, ...(e.bullets ?? []).slice(0, 4).map((b) => `    • ${b}`)].join('\n');
        }).join('\n'));
    }
    if (r.projects?.length) {
        parts.push('Projects:\n' + r.projects.map((p) =>
            `- ${p.name}${p.description ? `: ${p.description}` : ''}${p.technologies?.length ? ` [${p.technologies.join(', ')}]` : ''}`,
        ).join('\n'));
    }
    const skills = Object.entries(r.skills ?? {}).map(([cat, list]) => `${cat}: ${list.join(', ')}`);
    if (skills.length) parts.push('Skills:\n' + skills.map((s) => `- ${s}`).join('\n'));
    if (r.education?.length) {
        parts.push('Education:\n' + r.education.map((e) =>
            `- ${[e.degree, e.field].filter(Boolean).join(' in ')}${e.institution ? `, ${e.institution}` : ''}${e.end_date ? ` (${e.end_date})` : ''}`,
        ).join('\n'));
    }

    let profileText = parts.filter(Boolean).join('\n\n');
    if (profileText.length > MAX_CONTEXT_CHARS) profileText = `${profileText.slice(0, MAX_CONTEXT_CHARS)}\n…`;
    let block = `<candidate_profile source="resume">\n${profileText}\n</candidate_profile>`;

    if (j) {
        const jdLines = [
            line('Role', j.title), line('Company', j.company), line('Level', j.level), line('Location', j.location),
            line('Summary', j.description_summary),
            line('Requirements', j.requirements.slice(0, 10)),
            line('Responsibilities', j.responsibilities.slice(0, 8)),
            line('Technologies', j.technologies),
        ].filter(Boolean);
        block += `\n<target_job source="job_description">\n${jdLines.join('\n')}\n</target_job>`;
    }

    block += '\n<profile_use_rule>The user is the candidate described above. When a question is about them, answer in the first person using only these facts; where the target job is known, connect the answer to it. Never invent employers, dates, numbers or skills that are not listed.</profile_use_rule>';
    return block;
}
