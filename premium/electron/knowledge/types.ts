/**
 * Soro X profile engine — shared types.
 *
 * This is Soro X's own implementation of the optional `premium/` package the
 * core app loads at runtime (see electron/main.ts "Premium: Knowledge modules
 * loaded conditionally"). It is not Natively's private premium code.
 */

/** The two document kinds the profile handlers ingest. Values are stored in SQLite. */
export enum DocType {
    RESUME = 'resume',
    JD = 'jd',
}

export interface ProfileExperience {
    role: string;
    company: string;
    start_date?: string;
    end_date?: string;
    bullets: string[];
}

export interface ProfileProject {
    name: string;
    description: string;
    technologies: string[];
    highlights?: string[];
}

export interface ProfileEducation {
    degree: string;
    field?: string;
    institution: string;
    end_date?: string;
}

/** Résumé facts. Field names match StructuredProfileFacts (electron/llm/manualProfileIntelligence.ts). */
export interface ResumeFacts {
    identity: {
        name: string;
        email?: string;
        phone?: string;
        location?: string;
        linkedin?: string;
        summary?: string;
    };
    experience: ProfileExperience[];
    projects: ProfileProject[];
    /** Skills grouped by category, e.g. { Languages: ['TypeScript'], Tools: ['Docker'] }. */
    skills: Record<string, string[]>;
    education: ProfileEducation[];
    certifications?: string[];
    _extraction_mode: 'llm' | 'heuristic';
}

/** Job-description facts. Field names match StructuredJobFacts. */
export interface JobFacts {
    title: string;
    company: string;
    location?: string;
    level?: string;
    employment_type?: string;
    description_summary?: string;
    requirements: string[];
    nice_to_haves: string[];
    responsibilities: string[];
    technologies: string[];
    keywords: string[];
    min_years_experience?: number | null;
    compensation_hint?: string | null;
    _extraction_mode: 'llm' | 'heuristic';
}

/** A stored document row, shaped the way the core app reads `activeResume` / `activeJD`. */
export interface StoredDocument<T> {
    id: number;
    type: DocType;
    source_uri: string;
    raw_text: string;
    structured_data: T;
    created_at: string;
    updated_at: string;
}

export interface IngestResult {
    success: boolean;
    error?: string;
    docType?: DocType;
    extractionMode?: 'llm' | 'heuristic';
}

/** Mirrors electron/premium/contracts.ts PromptAssemblyResult (plus the field LLMHelper also reads). */
export interface PromptAssemblyResult {
    factualRecall?: boolean;
    liveNegotiationResponse?: unknown;
    contextBlock?: string;
    systemPromptInjection?: string;
    isIntroQuestion?: boolean;
    introResponse?: string;
}

export type GenerateContentFn = (contents: any[]) => Promise<string>;
