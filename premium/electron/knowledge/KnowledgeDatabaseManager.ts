/**
 * Soro X profile engine — storage for the active résumé and job description.
 *
 * Constructed by electron/main.ts with the app's better-sqlite3 handle (the same
 * connection DatabaseManager uses), so profile:delete's runInTransaction() covers
 * these writes too. One row per DocType: uploading a new résumé replaces the old.
 */
import { DocType, StoredDocument } from './types';

const TABLE = 'sorox_profile_documents';

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
}
