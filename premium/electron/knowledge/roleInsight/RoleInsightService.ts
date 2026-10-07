/**
 * Soro X — Role Insight: how well the résumé fits the job description.
 *
 * One AI call reads both documents and grades every job requirement against the
 * résumé (strong / partial / gap) with the résumé evidence, then adds talking
 * points and likely interview questions. Reports are kept so earlier analyses
 * stay viewable; a report is "outdated" once the résumé or JD it was built
 * from changes. Called through the roleInsight:* IPC handlers.
 */
import { randomUUID } from 'crypto';
import { KnowledgeDatabaseManager } from '../KnowledgeDatabaseManager';
import { parseJsonObject } from '../ProfileExtractor';
import { GenerateContentFn, JobFacts, ResumeFacts, StoredDocument } from '../types';

export type RequirementStatus = 'strong' | 'partial' | 'gap';

export interface RequirementMatch {
    id: string;
    requirement: string;
    priority: 'must' | 'nice';
    status: RequirementStatus;
    evidence: string;
    suggestion: string;
    corrected?: boolean;
}

export interface RoleInsightReport {
    id: string;
    created_at: string;
    resume_name: string;
    jd_title: string;
    jd_company: string;
    fit_score: number;
    verdict: string;
    summary: string;
    requirements: RequirementMatch[];
    strengths: string[];
    gaps: string[];
    talking_points: string[];
    likely_questions: { question: string; why: string; answer_hint: string }[];
    outdated?: boolean;
    outdatedReasons?: string[];
}

class NamedError extends Error {
    constructor(name: string, message: string, extra: Record<string, unknown> = {}) {
        super(message);
        this.name = name;
        Object.assign(this, extra);
    }
}

const PROMPT = `Compare this candidate's résumé with this job description, as an honest career coach.
Résumé (JSON):
{{RESUME}}
Job description (JSON):
{{JOB}}
Return ONLY one JSON object, no code fences:
{
  "fit_score": 0,
  "verdict": "one short sentence",
  "summary": "2-3 sentences",
  "requirements": [ { "requirement": "", "priority": "must | nice", "status": "strong | partial | gap", "evidence": "the résumé fact that supports it, or \\"\\"", "suggestion": "how to address it in the interview" } ],
  "strengths": [""],
  "gaps": [""],
  "talking_points": ["specific stories from the résumé to tell"],
  "likely_questions": [ { "question": "", "why": "", "answer_hint": "" } ]
}
Rules:
- Grade every stated requirement. "strong" needs clear résumé evidence; "partial" means related evidence; "gap" means none.
- Evidence must quote or closely paraphrase the résumé. Never invent experience.
- fit_score is 0-100 and must agree with the grades.
- 5-8 likely questions, focused on the gaps and the most important requirements.`;

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const strList = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const STATUSES = new Set(['strong', 'partial', 'gap']);

export class RoleInsightService {
    private stage: string | null = null;
    private cancelled = false;
    private lastError: { diagnosticId: string; message: string } | null = null;

    constructor(
        private readonly db: KnowledgeDatabaseManager,
        private readonly docs: () => { resume: StoredDocument<ResumeFacts> | null; jd: StoredDocument<JobFacts> | null },
        private readonly generate: () => GenerateContentFn | null,
    ) {}

    /** Identifies the résumé + JD pair a report was built from. */
    private sourceKey(): string {
        const { resume, jd } = this.docs();
        return `${resume?.id ?? 0}:${resume?.updated_at ?? ''}|${jd?.id ?? 0}:${jd?.updated_at ?? ''}`;
    }

    private withOutdated(report: RoleInsightReport | null, sourceKey: string | undefined): RoleInsightReport | null {
        if (!report) return null;
        const { resume, jd } = this.docs();
        const [r, j] = (sourceKey ?? '').split('|');
        const reasons: string[] = [];
        if (r !== `${resume?.id ?? 0}:${resume?.updated_at ?? ''}`) reasons.push('resume_changed');
        if (j !== `${jd?.id ?? 0}:${jd?.updated_at ?? ''}`) reasons.push('jd_changed');
        return { ...report, outdated: reasons.length > 0, outdatedReasons: reasons };
    }

    getStatus() {
        const { resume, jd } = this.docs();
        const latest = this.db.getInsight();
        const report = this.withOutdated(latest?.report ?? null, latest?.source_key);
        return {
            hasResume: !!resume,
            hasJobDescription: !!jd,
            hasAnalysis: !!report,
            analysing: this.stage !== null,
            stage: this.stage,
            outdated: !!report?.outdated,
            outdatedReasons: report?.outdatedReasons ?? [],
            resumeName: resume?.structured_data?.identity?.name ?? '',
            jdTitle: jd?.structured_data?.title ?? '',
            jdCompany: jd?.structured_data?.company ?? '',
        };
    }

    getReport(id?: string): RoleInsightReport | null {
        const row = this.db.getInsight(id);
        return this.withOutdated(row?.report ?? null, row?.source_key);
    }

    /** Re-analysing costs an AI call, so Soro X only does it when the user asks. */
    maybeAutoRefresh(): boolean {
        return false;
    }

    listHistory(limit = 20) {
        return this.db.listInsights(limit).map((row) => ({
            id: row.id,
            created_at: row.created_at,
            jdTitle: row.report?.jd_title ?? '',
            jdCompany: row.report?.jd_company ?? '',
            fitScore: row.report?.fit_score ?? 0,
        }));
    }

    cancel(): void {
        if (this.stage !== null) this.cancelled = true;
    }

    getLastError() {
        return this.lastError;
    }

    async analyse(_opts: { jobUrl?: string; skipExternalVerification?: boolean } = {}): Promise<RoleInsightReport> {
        const { resume, jd } = this.docs();
        const missing = [!resume && 'resume', !jd && 'job_description'].filter(Boolean) as string[];
        if (missing.length) {
            throw new NamedError('MissingSourceError', `Upload your ${missing.map((m) => m.replace('_', ' ')).join(' and ')} first.`, { missing });
        }
        if (this.stage !== null) throw new Error('An analysis is already running.');
        const generate = this.generate();
        if (!generate) throw new Error('No AI provider is configured. Add a key in Settings → AI Providers.');

        this.cancelled = false;
        this.lastError = null;
        const sourceKey = this.sourceKey();
        try {
            this.stage = 'matching';
            const prompt = PROMPT
                .replace('{{RESUME}}', JSON.stringify(resume!.structured_data))
                .replace('{{JOB}}', JSON.stringify(jd!.structured_data));
            const reply = await generate([{ text: prompt }]);
            if (this.cancelled) throw new NamedError('AnalysisCancelledError', 'Analysis cancelled.');

            this.stage = 'writing';
            const raw = parseJsonObject(reply);
            if (!raw) throw new Error('The AI provider did not return a usable analysis. Try again.');
            const report = normalizeReport(raw, resume!.structured_data, jd!.structured_data);
            this.db.saveInsight(report.id, sourceKey, report);
            return { ...report, outdated: false, outdatedReasons: [] };
        } catch (e: any) {
            if (e?.name !== 'AnalysisCancelledError') {
                this.lastError = { diagnosticId: randomUUID().slice(0, 8), message: e?.message ?? String(e) };
            }
            throw e;
        } finally {
            this.stage = null;
            this.cancelled = false;
        }
    }

    /** "I do have this": the user corrects one requirement, with their evidence. */
    applyCorrection(args: { analysisId?: string; requirementId?: string; kind?: string; detail?: string; evidenceText?: string }) {
        const row = this.db.getInsight(args?.analysisId);
        if (!row?.report) throw new Error('Report not found.');
        const report: RoleInsightReport = row.report;
        const req = report.requirements.find((r) => r.id === args?.requirementId);
        if (!req) throw new Error('Requirement not found.');
        const evidence = str(args?.evidenceText) || str(args?.detail);
        req.status = args?.kind === 'not_relevant' ? req.status : 'strong';
        if (evidence) req.evidence = evidence;
        req.corrected = true;
        report.fit_score = scoreOf(report.requirements);
        this.db.saveInsight(report.id, row.source_key, report);
        return { success: true, report: this.withOutdated(report, row.source_key) };
    }

    /** The user answers "do you have X?" for a requirement: treated as a correction with that evidence. */
    answerClarification(args: { analysisId?: string; requirementId?: string; answer?: string; detail?: string }) {
        return this.applyCorrection({ analysisId: args?.analysisId, requirementId: args?.requirementId, kind: 'clarified', evidenceText: str(args?.answer) || str(args?.detail) });
    }

    saveToProfile(_args: unknown): never {
        throw new Error('Saving Role Insight answers into the résumé is not part of Soro X; upload an updated résumé instead.');
    }
}

/** Musts count double; strong = 1, partial = 0.5, gap = 0. */
export function scoreOf(reqs: RequirementMatch[]): number {
    let total = 0;
    let got = 0;
    for (const r of reqs) {
        const w = r.priority === 'must' ? 2 : 1;
        total += w;
        got += w * (r.status === 'strong' ? 1 : r.status === 'partial' ? 0.5 : 0);
    }
    return total ? Math.round((got / total) * 100) : 0;
}

export function normalizeReport(raw: Record<string, any>, resume: ResumeFacts, jd: JobFacts): RoleInsightReport {
    const requirements: RequirementMatch[] = (Array.isArray(raw.requirements) ? raw.requirements : [])
        .map((r: any, i: number) => ({
            id: `req_${i + 1}`,
            requirement: str(r?.requirement),
            priority: str(r?.priority) === 'nice' ? 'nice' as const : 'must' as const,
            status: (STATUSES.has(str(r?.status)) ? str(r?.status) : 'gap') as RequirementStatus,
            evidence: str(r?.evidence),
            suggestion: str(r?.suggestion),
        }))
        .filter((r: RequirementMatch) => r.requirement);
    const modelScore = Number(raw.fit_score);
    return {
        id: randomUUID(),
        created_at: new Date().toISOString(),
        resume_name: resume.identity?.name ?? '',
        jd_title: jd.title ?? '',
        jd_company: jd.company ?? '',
        // The model's score when it gave one in range, else computed from the grades.
        fit_score: Number.isFinite(modelScore) && modelScore >= 0 && modelScore <= 100 ? Math.round(modelScore) : scoreOf(requirements),
        verdict: str(raw.verdict),
        summary: str(raw.summary),
        requirements,
        strengths: strList(raw.strengths),
        gaps: strList(raw.gaps),
        talking_points: strList(raw.talking_points),
        likely_questions: (Array.isArray(raw.likely_questions) ? raw.likely_questions : [])
            .map((q: any) => ({ question: str(q?.question), why: str(q?.why), answer_hint: str(q?.answer_hint) }))
            .filter((q: { question: string }) => q.question),
    };
}
