/**
 * Soro X — read a job posting from its URL (roleInsight:import-jd-url).
 * The provider is the Tavily search provider; its extract call returns the page text.
 */
export interface UrlExtractor {
    extractUrl(url: string): Promise<string | null>;
}

/** Below this, the page is a login wall or an error page, not a job description. */
const MIN_JD_CHARS = 200;

export async function resolveFromUrl(url: string, provider: UrlExtractor, _hint: string): Promise<{ text: string; sourceUrl: string } | null> {
    const text = (await provider.extractUrl(url))?.trim() ?? '';
    return text.length >= MIN_JD_CHARS ? { text, sourceUrl: url } : null;
}
