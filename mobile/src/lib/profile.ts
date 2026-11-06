// Soro X Mobile: your CV and the target job, stored on this device.
import { completeJson } from './ai';
import type { Settings } from './settings';

export interface ResumeFacts {
  name: string;
  headline: string;
  summary: string;
  experience: { role: string; company: string; dates: string; highlights: string[] }[];
  projects: { name: string; description: string; tech: string[] }[];
  skills: string[];
  education: { degree: string; school: string; year: string }[];
}

export interface JobFacts {
  title: string;
  company: string;
  location: string;
  level: string;
  summary: string;
  requirements: string[];
  niceToHaves: string[];
  responsibilities: string[];
  salary: string;
}

export interface Profile {
  resumeText: string;
  resume: ResumeFacts | null;
  jobText: string;
  job: JobFacts | null;
  /** Free notes the user wants every answer to respect (e.g. "I'm relocating to Berlin"). */
  notes: string;
  updatedAt: string;
}

export const EMPTY_PROFILE: Profile = { resumeText: '', resume: null, jobText: '', job: null, notes: '', updatedAt: '' };

const KEY = 'sorox.mobile.profile.v1';

export function loadProfile(storage: Pick<Storage, 'getItem'> = localStorage): Profile {
  try {
    const raw = JSON.parse(storage.getItem(KEY) || 'null');
    return raw && typeof raw === 'object' ? { ...EMPTY_PROFILE, ...raw } : { ...EMPTY_PROFILE };
  } catch {
    return { ...EMPTY_PROFILE };
  }
}

export function saveProfile(p: Profile, storage: Pick<Storage, 'setItem'> = localStorage): void {
  storage.setItem(KEY, JSON.stringify({ ...p, updatedAt: new Date().toISOString() }));
}

// ─── Reading files ──────────────────────────────────────────────────────────

const MAX_CHARS = 40_000;

/** Plain text of a PDF, Word (.docx) or text file the user picked. */
export async function fileToText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return (await pdfToText(await file.arrayBuffer())).slice(0, MAX_CHARS);
  if (name.endsWith('.docx')) {
    const mammoth = await import('mammoth');
    const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return value.trim().slice(0, MAX_CHARS);
  }
  if (name.endsWith('.doc')) throw new Error('Old Word .doc files are not supported. Save it as .docx or PDF.');
  return (await file.text()).trim().slice(0, MAX_CHARS);
}

async function pdfToText(data: ArrayBuffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  // Copied to public/ at build time (scripts/copy-pdf-worker.mjs).
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./pdf.worker.min.js', document.baseURI).toString();
  const doc = await pdfjs.getDocument({ data }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let line = '';
    const lines: string[] = [];
    for (const item of content.items as any[]) {
      line += item.str ?? '';
      if (item.hasEOL) { lines.push(line); line = ''; } else line += ' ';
    }
    if (line.trim()) lines.push(line);
    pages.push(lines.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n'));
  }
  const text = pages.join('\n\n').trim();
  if (text.length < 40) throw new Error('No text found in that PDF. If it is a scan, export it with selectable text or paste the text instead.');
  return text;
}

// ─── Extracting facts ───────────────────────────────────────────────────────

const RESUME_SYSTEM = 'You extract facts from résumés accurately. Copy facts as written; never invent anything. Reply with JSON only.';
const RESUME_SHAPE = `{"name":"","headline":"current or target title","summary":"","experience":[{"role":"","company":"","dates":"","highlights":[""]}],"projects":[{"name":"","description":"","tech":[""]}],"skills":[""],"education":[{"degree":"","school":"","year":""}]}`;

const JOB_SYSTEM = 'You extract facts from job descriptions accurately. Copy facts as written; never invent anything. Reply with JSON only.';
const JOB_SHAPE = `{"title":"","company":"","location":"","level":"","summary":"two sentences","requirements":[""],"niceToHaves":[""],"responsibilities":[""],"salary":"as stated, or empty"}`;

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const list = (v: unknown) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const objs = (v: unknown) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []) as any[];

export function normalizeResume(raw: any): ResumeFacts {
  return {
    name: str(raw?.name), headline: str(raw?.headline), summary: str(raw?.summary),
    experience: objs(raw?.experience).map((e) => ({ role: str(e.role), company: str(e.company), dates: str(e.dates), highlights: list(e.highlights) })).filter((e) => e.role || e.company),
    projects: objs(raw?.projects).map((p) => ({ name: str(p.name), description: str(p.description), tech: list(p.tech) })).filter((p) => p.name || p.description),
    skills: [...new Set(list(raw?.skills))],
    education: objs(raw?.education).map((e) => ({ degree: str(e.degree), school: str(e.school), year: str(e.year) })).filter((e) => e.degree || e.school),
  };
}

export function normalizeJob(raw: any): JobFacts {
  return {
    title: str(raw?.title), company: str(raw?.company), location: str(raw?.location), level: str(raw?.level), summary: str(raw?.summary),
    requirements: list(raw?.requirements), niceToHaves: list(raw?.niceToHaves), responsibilities: list(raw?.responsibilities), salary: str(raw?.salary),
  };
}

export async function extractResume(settings: Settings, text: string): Promise<ResumeFacts> {
  const raw = await completeJson<any>(settings, {
    system: RESUME_SYSTEM, effort: 'low', maxTokens: 6000,
    messages: [{ role: 'user', content: `Résumé:\n"""\n${text.slice(0, MAX_CHARS)}\n"""\n\nReturn this JSON shape:\n${RESUME_SHAPE}` }],
  });
  return normalizeResume(raw);
}

export async function extractJob(settings: Settings, text: string): Promise<JobFacts> {
  const raw = await completeJson<any>(settings, {
    system: JOB_SYSTEM, effort: 'low', maxTokens: 4000,
    messages: [{ role: 'user', content: `Job description:\n"""\n${text.slice(0, MAX_CHARS)}\n"""\n\nReturn this JSON shape:\n${JOB_SHAPE}` }],
  });
  return normalizeJob(raw);
}

/** The compact profile text every interview prompt is grounded in. */
export function profileContext(p: Profile): string {
  const parts: string[] = [];
  const r = p.resume;
  if (r) {
    parts.push(`<candidate>\nName: ${r.name}\nHeadline: ${r.headline}\nSummary: ${r.summary}`);
    if (r.experience.length) parts.push('Experience:\n' + r.experience.map((e) => `- ${e.role} at ${e.company} (${e.dates})${e.highlights.length ? '\n  ' + e.highlights.slice(0, 5).map((h) => `• ${h}`).join('\n  ') : ''}`).join('\n'));
    if (r.projects.length) parts.push('Projects:\n' + r.projects.map((x) => `- ${x.name}: ${x.description}${x.tech.length ? ` [${x.tech.join(', ')}]` : ''}`).join('\n'));
    if (r.skills.length) parts.push(`Skills: ${r.skills.join(', ')}`);
    if (r.education.length) parts.push('Education:\n' + r.education.map((e) => `- ${e.degree}, ${e.school} ${e.year}`).join('\n'));
    parts.push('</candidate>');
  } else if (p.resumeText) {
    parts.push(`<candidate_cv>\n${p.resumeText.slice(0, 12000)}\n</candidate_cv>`);
  }
  const j = p.job;
  if (j) {
    parts.push(`<target_job>\nRole: ${j.title} at ${j.company} (${j.location}${j.level ? `, ${j.level}` : ''})\nSummary: ${j.summary}\nRequirements: ${j.requirements.join('; ')}\nResponsibilities: ${j.responsibilities.join('; ')}\n</target_job>`);
  } else if (p.jobText) {
    parts.push(`<target_job_text>\n${p.jobText.slice(0, 8000)}\n</target_job_text>`);
  }
  if (p.notes.trim()) parts.push(`<candidate_notes>\n${p.notes.trim()}\n</candidate_notes>`);
  return parts.join('\n');
}

export const hasProfile = (p: Profile) => !!(p.resume || p.resumeText.trim());
