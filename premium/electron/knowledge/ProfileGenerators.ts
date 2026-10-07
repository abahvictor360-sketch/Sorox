/**
 * Soro X — documents written from the résumé + job description with the
 * user's own AI provider: a cover letter (Cover Letter screen) and a salary
 * negotiation script (profile:generate-negotiation).
 */
import { parseJsonObject } from './ProfileExtractor';
import { GenerateContentFn, JobFacts, ResumeFacts } from './types';

export interface CoverLetter {
    greeting: string;
    opening_hook: string;
    body_paragraphs: string[];
    closing: string;
    full_text: string;
}

export interface NegotiationScript {
    summary: string;
    target_range: string;
    opening_script: string;
    counter_scripts: { situation: string; say: string }[];
    leverage_points: string[];
    walk_away: string;
}

const facts = (r: ResumeFacts, j: JobFacts) => JSON.stringify({
    candidate: {
        name: r.identity?.name, summary: r.identity?.summary, location: r.identity?.location,
        experience: r.experience?.map((e) => ({ role: e.role, company: e.company, dates: [e.start_date, e.end_date].filter(Boolean).join(' – '), bullets: e.bullets?.slice(0, 5) })),
        projects: r.projects?.map((p) => ({ name: p.name, description: p.description, technologies: p.technologies })),
        skills: r.skills, education: r.education,
    },
    job: {
        title: j.title, company: j.company, location: j.location, level: j.level,
        summary: j.description_summary, requirements: j.requirements, responsibilities: j.responsibilities,
        technologies: j.technologies, compensation_hint: j.compensation_hint, min_years_experience: j.min_years_experience,
    },
});

const COVER_PROMPT = `Write a cover letter for this candidate applying to this job. Facts (JSON):
{{FACTS}}
{{COMPANY}}
Rules:
- First person, confident, specific, 250-350 words in total. No clichés ("I am writing to express…").
- Use only the candidate's real experience and skills; never invent employers, numbers or achievements.
- Tie 2-3 concrete experiences to the job's main requirements.
Return ONLY one JSON object, no code fences:
{ "greeting": "Dear … ,", "opening_hook": "", "body_paragraphs": ["", ""], "closing": "closing paragraph and sign-off with the candidate's name" }`;

const NEGOTIATION_PROMPT = `Prepare a salary negotiation script for this candidate and job. Facts (JSON):
{{FACTS}}
{{COMPANY}}
Rules:
- Ground the target range in the job's compensation hint or the company salary data when given; otherwise give a reasonable range for the role and location and say it is an estimate.
- Leverage points must come from the candidate's real experience.
- Scripts are short, polite, first person, ready to say aloud.
Return ONLY one JSON object, no code fences:
{ "summary": "", "target_range": "", "opening_script": "",
  "counter_scripts": [ { "situation": "they offer below range", "say": "" }, { "situation": "they ask for your current salary", "say": "" }, { "situation": "they say the budget is fixed", "say": "" } ],
  "leverage_points": [""], "walk_away": "" }`;

const companyLine = (dossier: any) => {
    if (!dossier) return '';
    const bits = [
        dossier.hiring_strategy && `Hiring: ${dossier.hiring_strategy}`,
        dossier.core_values?.length && `Values: ${dossier.core_values.join(', ')}`,
        dossier.salary_estimates?.length && `Salary data: ${JSON.stringify(dossier.salary_estimates)}`,
    ].filter(Boolean);
    return bits.length ? `Company research:\n${bits.join('\n')}` : '';
};

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const strList = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);

export async function generateCoverLetter(
    generate: GenerateContentFn, r: ResumeFacts, j: JobFacts, dossier: any,
): Promise<CoverLetter | null> {
    const raw = parseJsonObject(await generate([{ text: COVER_PROMPT.replace('{{FACTS}}', facts(r, j)).replace('{{COMPANY}}', companyLine(dossier)) }]));
    if (!raw) return null;
    const letter = {
        greeting: str(raw.greeting) || 'Dear Hiring Manager,',
        opening_hook: str(raw.opening_hook),
        body_paragraphs: strList(raw.body_paragraphs),
        closing: str(raw.closing),
    };
    if (!letter.opening_hook && !letter.body_paragraphs.length) return null;
    const full_text = [letter.greeting, letter.opening_hook, ...letter.body_paragraphs, letter.closing].filter(Boolean).join('\n\n');
    return { ...letter, full_text };
}

export async function generateNegotiationScript(
    generate: GenerateContentFn, r: ResumeFacts, j: JobFacts, dossier: any,
): Promise<NegotiationScript | null> {
    const raw = parseJsonObject(await generate([{ text: NEGOTIATION_PROMPT.replace('{{FACTS}}', facts(r, j)).replace('{{COMPANY}}', companyLine(dossier)) }]));
    if (!raw) return null;
    const script = {
        summary: str(raw.summary),
        target_range: str(raw.target_range),
        opening_script: str(raw.opening_script),
        counter_scripts: (Array.isArray(raw.counter_scripts) ? raw.counter_scripts : [])
            .map((c: any) => ({ situation: str(c?.situation), say: str(c?.say) }))
            .filter((c: { say: string }) => c.say),
        leverage_points: strList(raw.leverage_points),
        walk_away: str(raw.walk_away),
    };
    return script.opening_script || script.counter_scripts.length ? script : null;
}
