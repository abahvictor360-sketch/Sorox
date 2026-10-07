/**
 * Soro X profile engine — storage for the active résumé and job description.
 *
 * Constructed by electron/main.ts with the app's better-sqlite3 handle (the same
 * connection DatabaseManager uses), so profile:delete's runInTransaction() covers
 * these writes too. One row per DocType: uploading a new résumé replaces the old.
 */
import { DocType, StoredDocument } from './types';

const TABLE = 'sorox_profile_documents';
const DOSSIERS = 'sorox_company_dossiers';
const GENERATED = 'sorox_generated';
const INSIGHTS = 'sorox_role_insight_reports';
const DOSSIER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface CachedDossier {
    company: string;
    dossier: any;
    created_at: string;
}

export interface GeneratedRow {
    kind: string;
    source_key: string;
    content: any;
    created_at: string;
}

export interface InsightRow {
    id: string;
    source_key: string;
    report: any;
    created_at: string;
}

interface Row {
    id: number;
    type: string;
    source_uri: string;
    raw_text: string;
    structured_data: string;
    created_at: string;
    updated_at: string;
}

export class KnowledgeDatabaseManager {
    constructor(private readonly db: any) {
        this.initializeSchema();
    }

    /** Idempotent; the constructor already runs it. Kept for callers that call it explicitly. */
    initializeSchema(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS ${TABLE} (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL,
                source_uri TEXT NOT NULL DEFAULT '',
                raw_text TEXT NOT NULL DEFAULT '',
                structured_data TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_${TABLE}_type ON ${TABLE}(type);
            CREATE TABLE IF NOT EXISTS ${DOSSIERS} (
                company_key TEXT PRIMARY KEY,
                company TEXT NOT NULL,
                dossier TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ${GENERATED} (
                kind TEXT PRIMARY KEY,
                source_key TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ${INSIGHTS} (
                id TEXT PRIMARY KEY,
                source_key TEXT NOT NULL,
                report TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
        `);
    }

    /** The current document of this type, or null. */
    getDocument<T>(type: DocType): StoredDocument<T> | null {
        const row = this.db
            .prepare(`SELECT * FROM ${TABLE} WHERE type = ? ORDER BY id DESC LIMIT 1`)
            .get(type) as Row | undefined;
        if (!row) return null;
        let structured: T;
        try {
            structured = JSON.parse(row.structured_data) as T;
        } catch {
            return null;
        }
        return {
            id: row.id,
            type: row.type as DocType,
            source_uri: row.source_uri,
            raw_text: row.raw_text,
            structured_data: structured,
            created_at: row.created_at,
            updated_at: row.updated_at,
        };
    }

    /** Replace the document of this type. Returns the stored row. */
    saveDocument<T>(type: DocType, sourceUri: string, rawText: string, structured: T): StoredDocument<T> {
        const now = new Date().toISOString();
        const insert = this.db.transaction(() => {
            this.db.prepare(`DELETE FROM ${TABLE} WHERE type = ?`).run(type);
            return this.db
                .prepare(`INSERT INTO ${TABLE} (type, source_uri, raw_text, structured_data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
                .run(type, sourceUri, rawText, JSON.stringify(structured), now, now);
        });
        const info = insert();
        return {
            id: Number(info.lastInsertRowid),
            type,
            source_uri: sourceUri,
            raw_text: rawText,
            structured_data: structured,
            created_at: now,
            updated_at: now,
        };
    }

    /** Synchronous on purpose: deleteProfileTransactional calls it inside a transaction. */
    deleteByType(type: DocType): void {
        this.db.prepare(`DELETE FROM ${TABLE} WHERE type = ?`).run(type);
    }

    // ─── Company dossiers ────────────────────────────────────────────────────

    getDossier(company: string): CachedDossier | null {
        const row = this.db.prepare(`SELECT * FROM ${DOSSIERS} WHERE company_key = ?`).get(companyKey(company)) as any;
        return row ? { company: row.company, dossier: parse(row.dossier), created_at: row.created_at } : null;
    }

    /** Older than a week: research again on the next request. */
    isDossierStale(company: string): boolean {
        const row = this.getDossier(company);
        return !row || Date.now() - Date.parse(row.created_at) > DOSSIER_TTL_MS;
    }

    saveDossier(company: string, dossier: unknown, _sources?: unknown): void {
        this.db.prepare(`INSERT OR REPLACE INTO ${DOSSIERS} (company_key, company, dossier, created_at) VALUES (?, ?, ?, ?)`)
            .run(companyKey(company), company, JSON.stringify(dossier), new Date().toISOString());
    }

    // ─── Generated documents (cover letter, negotiation script) ─────────────

    getGenerated(kind: string): GeneratedRow | null {
        const row = this.db.prepare(`SELECT * FROM ${GENERATED} WHERE kind = ?`).get(kind) as any;
        return row ? { kind: row.kind, source_key: row.source_key, content: parse(row.content), created_at: row.created_at } : null;
    }

    saveGenerated(kind: string, sourceKey: string, content: unknown): void {
        this.db.prepare(`INSERT OR REPLACE INTO ${GENERATED} (kind, source_key, content, created_at) VALUES (?, ?, ?, ?)`)
            .run(kind, sourceKey, JSON.stringify(content), new Date().toISOString());
    }

    // ─── Role Insight reports ────────────────────────────────────────────────

    saveInsight(id: string, sourceKey: string, report: unknown): void {
        this.db.prepare(`INSERT OR REPLACE INTO ${INSIGHTS} (id, source_key, report, created_at) VALUES (?, ?, ?, ?)`)
            .run(id, sourceKey, JSON.stringify(report), new Date().toISOString());
    }

    getInsight(id?: string): InsightRow | null {
        const row = (id
            ? this.db.prepare(`SELECT * FROM ${INSIGHTS} WHERE id = ?`).get(id)
            : this.db.prepare(`SELECT * FROM ${INSIGHTS} ORDER BY created_at DESC, rowid DESC LIMIT 1`).get()) as any;
        return row ? { id: row.id, source_key: row.source_key, report: parse(row.report), created_at: row.created_at } : null;
    }

    listInsights(limit: number): InsightRow[] {
        const rows = this.db.prepare(`SELECT * FROM ${INSIGHTS} ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(limit) as any[];
        return rows.map((row) => ({ id: row.id, source_key: row.source_key, report: parse(row.report), created_at: row.created_at }));
    }

    /** Everything derived from the résumé/JD goes when either is deleted. */
    clearDerived(): void {
        this.db.prepare(`DELETE FROM ${GENERATED}`).run();
        this.db.prepare(`DELETE FROM ${INSIGHTS}`).run();
    }
}

const companyKey = (company: string) => company.trim().toLowerCase().replace(/\s+/g, ' ');

function parse(text: string): any {
    try { return JSON.parse(text); } catch { return null; }
}
