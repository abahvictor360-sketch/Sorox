// Soro X Mobile: answers that use the web.
//
// Two ways, picked automatically:
//   1. Tavily (your Tavily key, Settings > Web search): Soro X searches, then
//      gives the results to whichever AI you use. Works with every provider.
//   2. The AI's own web search: Claude (web search tool), Gemini (Google Search)
//      and OpenRouter (web plugin) search by themselves with your key.
// Answers end with the pages they used.
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { complete, nativeWebSearch, type CompleteRequest, type Source } from './ai';
import type { Settings } from './settings';

export type WebMode = 'tavily' | 'native' | 'none';

export function webMode(settings: Settings): WebMode {
  if (settings.keys.tavily?.trim()) return 'tavily';
  if (nativeWebSearch(settings.provider)) return 'native';
  return 'none';
}

export function webModeLabel(settings: Settings): string {
  const m = webMode(settings);
  if (m === 'tavily') return 'Web search with your Tavily key.';
  if (m === 'native') return settings.provider === 'claude' ? "Web search with Claude's built-in search." : settings.provider === 'gemini' ? 'Web search with Google Search in Gemini.' : "Web search with OpenRouter's web plugin.";
  return 'Add a Tavily key below (free tier available), or use Claude, Gemini or OpenRouter, to search the web.';
}

export interface WebResult { title: string; url: string; content: string }

/** Tavily search. Browser requests first; the app's native HTTP if the browser path is blocked. */
export async function tavilySearch(key: string, query: string, max = 5, signal?: AbortSignal): Promise<WebResult[]> {
  const body = { query, max_results: max, search_depth: 'basic', include_answer: false };
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` };
  let data: any;
  try {
    const res = await fetch('https://api.tavily.com/search', { method: 'POST', headers, body: JSON.stringify(body), signal });
    if (res.status === 401 || res.status === 403) throw new Error('Your Tavily key was rejected. Check it in Settings.');
    if (!res.ok) throw new Error(`Web search failed (${res.status}).`);
    data = await res.json();
  } catch (e: any) {
    if (e?.name === 'AbortError' || /Tavily key|Web search failed/.test(String(e?.message))) throw e;
    if (!Capacitor.isNativePlatform()) throw new Error('Could not reach the web search service.');
    const r = await CapacitorHttp.post({ url: 'https://api.tavily.com/search', headers, data: body });
    if (r.status >= 400) throw new Error(r.status === 401 ? 'Your Tavily key was rejected. Check it in Settings.' : `Web search failed (${r.status}).`);
    data = typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
  }
  return (Array.isArray(data?.results) ? data.results : [])
    .map((x: any) => ({ title: String(x.title ?? ''), url: String(x.url ?? ''), content: String(x.content ?? '').slice(0, 1500) }))
    .filter((x: WebResult) => x.url);
}

const domain = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

/** "Sources" block appended to an answer. Markdown links render as tappable links. */
export function sourcesBlock(sources: Source[]): string {
  if (!sources.length) return '';
  return `\n\n#### Sources\n${sources.slice(0, 6).map((s, i) => `${i + 1}. [${(s.title || domain(s.url)).slice(0, 80)}](${s.url})`).join('\n')}`;
}

/**
 * Like complete(), but the answer may use the web. `query` is what to search
 * for (defaults to the last user message).
 */
export async function completeWithWeb(settings: Settings, req: CompleteRequest, query?: string): Promise<{ text: string; sources: Source[]; searched: boolean }> {
  const mode = webMode(settings);
  const q = (query ?? req.messages[req.messages.length - 1]?.content ?? '').slice(0, 380);
  if (mode === 'tavily') {
    const results = await tavilySearch(settings.keys.tavily!.trim(), q, 5, req.signal);
    const block = results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.content}`).join('\n\n');
    const last = req.messages[req.messages.length - 1];
    const messages = [
      ...req.messages.slice(0, -1),
      { ...last, content: `${last.content}\n\n<web_results searched="${q.replace(/"/g, "'")}">\n${block || '(no results)'}\n</web_results>\nUse these web results where they help and cite them as [1], [2]. If they do not answer it, say so.` },
    ];
    const sources = results.map((r) => ({ title: r.title, url: r.url }));
    const text = await complete(settings, { ...req, messages });
    const full = text + sourcesBlock(sources);
    req.onText?.(sourcesBlock(sources), full);
    return { text: full, sources, searched: true };
  }
  let sources: Source[] = [];
  const text = await complete(settings, { ...req, web: mode === 'native', onSources: (s) => { sources = s; } });
  const full = text + sourcesBlock(sources);
  if (sources.length) req.onText?.(sourcesBlock(sources), full);
  return { text: full, sources, searched: mode === 'native' };
}
