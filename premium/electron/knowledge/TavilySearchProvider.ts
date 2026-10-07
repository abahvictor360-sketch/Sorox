/**
 * Soro X — web search through the user's own Tavily key (Settings → Profile
 * Intelligence → Tavily Search). Loaded by electron/services/resolveCompanySearchProvider.ts.
 *
 * API: https://docs.tavily.com — POST /search and POST /extract, key in the body.
 */

const API = 'https://api.tavily.com';
const TIMEOUT_MS = 20_000;

export interface SearchResult {
    title: string;
    url: string;
    content: string;
}

export class TavilySearchProvider {
    /** Set when Tavily answers 429/432 (plan limit), read by profile:research-company. */
    quotaExhausted = false;

    constructor(private readonly apiKey: string) {}

    private async post(endpoint: string, body: Record<string, unknown>): Promise<any> {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        try {
            const res = await fetch(`${API}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
                body: JSON.stringify({ api_key: this.apiKey, ...body }),
                signal: ctrl.signal,
            });
            if (res.status === 429 || res.status === 432) {
                this.quotaExhausted = true;
                throw new Error('Tavily search quota exhausted');
            }
            if (!res.ok) throw new Error(`Tavily ${endpoint} failed: HTTP ${res.status}`);
            return await res.json();
        } finally {
            clearTimeout(timer);
        }
    }

    async search(query: string, maxResults = 5): Promise<SearchResult[]> {
        const data = await this.post('/search', { query, max_results: maxResults, search_depth: 'basic' });
        const results = Array.isArray(data?.results) ? data.results : [];
        return results
            .map((r: any) => ({ title: String(r?.title ?? ''), url: String(r?.url ?? ''), content: String(r?.content ?? '') }))
            .filter((r: SearchResult) => r.url && r.content);
    }

    /** Readable text of one web page (used to import a job posting from its URL). */
    async extractUrl(url: string): Promise<string | null> {
        const data = await this.post('/extract', { urls: [url] });
        const first = Array.isArray(data?.results) ? data.results[0] : null;
        const text = typeof first?.raw_content === 'string' ? first.raw_content.trim() : '';
        return text || null;
    }
}
