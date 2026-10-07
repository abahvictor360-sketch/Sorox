/**
 * Soro X profile engine — turns résumé / job-description text into structured facts.
 *
 * Uses the app's own structured-generation ladder (the user's configured AI
 * provider) and falls back to a plain-text heuristic when no model answers, so an
 * upload never fails just because the AI call did.
 */
import { GenerateContentFn, JobFacts, ResumeFacts } from './types';

/** Long documents are cut so the prompt stays well inside every provider's context. */
const MAX_DOC_CHARS = 24_000;

const RESUME_PROMPT = `You extract facts from a résumé. Return ONLY one JSON object, no prose, no code fences, with exactly this shape:
{
  "identity": { "name": "", "email": "", "phone": "", "location": "", "linkedin": "", "summary": "" },
  "experience": [ { "role": "", "company": "", "start_date": "", "end_date": "", "bullets": [""] } ],
  "projects": [ { "name": "", "description": "", "technologies": [""], "highlights": [""] } ],
  "skills": { "<category>": [""] },
  "education": [ { "degree": "", "field": "", "institution": "", "end_date": "" } ],
  "certifications": [""]
}
Rules:
- Copy facts exactly as written. Never invent employers, dates, numbers or skills.
- Leave a field as "" or [] when the résumé does not state it.
- Most recent experience first. Dates as written (e.g. "Jan 2022", "Present").
- "summary" is the résumé's own summary/objective, or "" if it has none.
- Group skills under short category names such as "Languages", "Frameworks", "Tools".

Résumé:
"""
{{TEXT}}
"""`;

const JD_PROMPT = `You extract facts from a job description. Return ONLY one JSON object, no prose, no code fences, with exactly this shape:
{
  "title": "", "company": "", "location": "", "level": "", "employment_type": "",
  "description_summary": "",
  "requirements": [""], "nice_to_haves": [""], "responsibilities": [""],
  "technologies": [""], "keywords": [""],
  "min_years_experience": null, "compensation_hint": null
}
Rules:
- Copy facts exactly as written. Never invent anything the posting does not say.
- Leave a field as "", [] or null when the posting does not state it.
- "description_summary" is at most two sentences describing the role.
- "min_years_experience" is a number only when the posting states one.

Job description:
"""
{{TEXT}}
"""`;

// ─── JSON helpers ────────────────────────────────────────────────────────────

/** Pull the first JSON object out of a model reply (tolerates fences and chatter). */
export function parseJsonObject(reply: string): Record<string, unknown> | null {
    if (typeof reply !== 'string') return null;
    const cleaned = reply.replace(/```(?:json)?/gi, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
        const parsed = JSON.parse(cleaned.slice(start, end + 1));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const strList = (v: unknown): string[] =>
    Array.isArray(v) ? v.map(str).filter(Boolean) : typeof v === 'string' && v.trim() ? [v.trim()] : [];
const objList = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : [];
const optional = (v: unknown): string | undefined => str(v) || undefined;

export function normalizeResume(raw: Record<string, unknown>, mode: 'llm' | 'heuristic'): ResumeFacts {
    const id = (raw.identity && typeof raw.identity === 'object' ? raw.identity : {}) as Record<string, unknown>;
    const skills: Record<string, string[]> = {};
    if (Array.isArray(raw.skills)) {
        const flat = strList(raw.skills);
        if (flat.length) skills.Skills = flat;
    } else if (raw.skills && typeof raw.skills === 'object') {
        for (const [cat, items] of Object.entries(raw.skills as Record<string, unknown>)) {
            const list = strList(items);
            if (list.length) skills[str(cat) || 'Skills'] = list;
        }
    }
    return {
        identity: {
            name: str(id.name ?? raw.name),
            email: optional(id.email),
            phone: optional(id.phone),
            location: optional(id.location),
            linkedin: optional(id.linkedin),
            summary: optional(id.summary),
        },
        experience: objList(raw.experience)
            .map((e) => ({
                role: str(e.role ?? e.title ?? e.position),
                company: str(e.company ?? e.organization ?? e.employer),
                start_date: optional(e.start_date),
                end_date: optional(e.end_date),
                bullets: strList(e.bullets ?? e.highlights ?? e.responsibilities),
            }))
            .filter((e) => e.role || e.company),
        projects: objList(raw.projects)
            .map((p) => ({
                name: str(p.name ?? p.title),
                description: str(p.description ?? p.summary),
                technologies: strList(p.technologies ?? p.tech_stack ?? p.tools),
                highlights: strList(p.highlights),
            }))
            .filter((p) => p.name || p.description),
        skills,
        education: objList(raw.education)
            .map((e) => ({
                degree: str(e.degree),
                field: optional(e.field ?? e.major),
                institution: str(e.institution ?? e.school ?? e.university),
                end_date: optional(e.end_date),
            }))
            .filter((e) => e.degree || e.institution),
        certifications: strList(raw.certifications),
        _extraction_mode: mode,
    };
}

export function normalizeJob(raw: Record<string, unknown>, mode: 'llm' | 'heuristic'): JobFacts {
    const years = Number(raw.min_years_experience);
    return {
        title: str(raw.title ?? raw.role ?? raw.position ?? raw.jobTitle),
        company: str(raw.company),
        location: optional(raw.location),
        level: optional(raw.level),
        employment_type: optional(raw.employment_type),
        description_summary: optional(raw.description_summary),
        requirements: strList(raw.requirements),
        nice_to_haves: strList(raw.nice_to_haves),
        responsibilities: strList(raw.responsibilities),
        technologies: strList(raw.technologies),
        keywords: strList(raw.keywords),
        min_years_experience: Number.isFinite(years) && years > 0 ? years : null,
        compensation_hint: str(raw.compensation_hint) || null,
        _extraction_mode: mode,
    };
}

// ─── Heuristic fallback (no AI available) ────────────────────────────────────

const lines = (text: string) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

/** Lines under a heading such as "Skills" until the next ALL-CAPS / short heading. */
function section(text: string, heading: RegExp): string[] {
    const all = lines(text);
    const at = all.findIndex((l) => heading.test(l) && l.length < 40);
    if (at < 0) return [];
    const out: string[] = [];
    for (const l of all.slice(at + 1)) {
        const looksLikeHeading = l.length < 40 && (/^[A-Z][A-Z &/]+$/.test(l) || /:$/.test(l));
        if (looksLikeHeading) break;
        out.push(l.replace(/^[•\-*–]\s*/, ''));
    }
    return out;
}

export function heuristicResume(text: string): ResumeFacts {
    const first = lines(text)[0] ?? '';
    const email = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0];
    const phone = text.match(/\+?\d[\d\s().-]{7,}\d/)?.[0];
    const linkedin = text.match(/linkedin\.com\/[\w/-]+/i)?.[0];
    const skills = section(text, /^(technical\s+)?skills\b/i)
        .flatMap((l) => l.replace(/^[^:]{1,25}:\s*/, '').split(/[,|•;]/))
        .map((s) => s.trim())
        .filter((s) => s && s.length < 40);
    return normalizeResume(
        {
            identity: {
                name: first.length < 60 && !/@/.test(first) ? first : '',
                email,
                phone,
                linkedin,
                summary: section(text, /^(summary|profile|objective|about)\b/i).join(' ').slice(0, 600),
            },
            skills: skills.length ? { Skills: [...new Set(skills)] } : {},
        },
        'heuristic',
    );
}

export function heuristicJob(text: string): JobFacts {
    const first = lines(text)[0] ?? '';
    const years = text.match(/(\d{1,2})\+?\s*(?:years|yrs)/i)?.[1];
    return normalizeJob(
        {
            title: first.length < 80 ? first : '',
            requirements: section(text, /^(requirements|qualifications|what you('|’)ll need|must have)/i),
            responsibilities: section(text, /^(responsibilities|what you('|’)ll do|the role)/i),
            nice_to_haves: section(text, /^(nice to have|bonus|preferred)/i),
            min_years_experience: years ? Number(years) : null,
        },
        'heuristic',
    );
}

// ─── Public API ──────────────────────────────────────────────────────────────

async function askModel(generate: GenerateContentFn | null, prompt: string, text: string) {
    if (!generate) return null;
    try {
        const reply = await generate([{ text: prompt.replace('{{TEXT}}', text.slice(0, MAX_DOC_CHARS)) }]);
        return parseJsonObject(reply);
    } catch (e: any) {
        console.warn('[SoroX/ProfileExtractor] AI extraction failed, using heuristic:', e?.message || e);
        return null;
    }
}

export async function extractResume(text: string, generate: GenerateContentFn | null): Promise<ResumeFacts> {
    const raw = await askModel(generate, RESUME_PROMPT, text);
    const facts = raw ? normalizeResume(raw, 'llm') : null;
    // A reply that parsed but carried nothing usable is treated like no reply.
    if (facts && (facts.identity.name || facts.experience.length || Object.keys(facts.skills).length)) return facts;
    return heuristicResume(text);
}

export async function extractJob(text: string, generate: GenerateContentFn | null): Promise<JobFacts> {
    const raw = await askModel(generate, JD_PROMPT, text);
    const facts = raw ? normalizeJob(raw, 'llm') : null;
    if (facts && (facts.title || facts.requirements.length || facts.responsibilities.length)) return facts;
    return heuristicJob(text);
}
