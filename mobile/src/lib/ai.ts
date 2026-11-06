// Soro X Mobile — one streaming call over the user's own AI provider.
//
// Claude goes through the official Anthropic SDK; OpenAI, Gemini and Groq through
// their HTTP APIs (all three allow browser requests). Keys live only on this
// device (see settings.ts) and are sent only to the provider they belong to.
import Anthropic from '@anthropic-ai/sdk';
import type { Settings, ProviderId } from './settings';

export type Effort = 'low' | 'medium' | 'high';

export interface CompleteRequest {
  system: string;
  /** Conversation turns, oldest first. */
  messages: { role: 'user' | 'assistant'; content: string }[];
  /** low for live answers (speed), medium/high for preparation documents. */
  effort?: Effort;
  maxTokens?: number;
  /** Called with each new piece of text as it streams in. */
  onText?: (delta: string, full: string) => void;
  signal?: AbortSignal;
}

export class AiError extends Error {
  constructor(message: string, readonly provider: ProviderId, readonly status?: number) {
    super(message);
    this.name = 'AiError';
  }
}

export const PROVIDERS: Record<ProviderId, { label: string; defaultModel: string; keyUrl: string; keyHint: string; models: string[] }> = {
  claude: {
    label: 'Claude (Anthropic)', defaultModel: 'claude-opus-5-5', keyUrl: 'https://console.anthropic.com/settings/keys', keyHint: 'sk-ant-…',
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
  },
  openai: {
    label: 'OpenAI', defaultModel: 'gpt-5.4', keyUrl: 'https://platform.openai.com/api-keys', keyHint: 'sk-…',
    models: ['gpt-5.4', 'gpt-5.4-mini', 'gpt-5.5'],
  },
  gemini: {
    label: 'Google Gemini', defaultModel: 'gemini-3.8-flash', keyUrl: 'https://aistudio.google.com/app/apikey', keyHint: 'AIza…',
    models: ['gemini-3.8-flash', 'gemini-3.1-pro-preview', 'gemini-3.1-flash-lite'],
  },
  groq: {
    label: 'Groq', defaultModel: 'openai/gpt-oss-120b', keyUrl: 'https://console.groq.com/keys', keyHint: 'gsk_…',
    models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'moonshotai/kimi-k2-instruct-0905'],
  },
};

// Claude models that accept server-side refusal fallbacks ("default" form).
const CLAUDE_FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-opus-5', 'claude-fable-5-1']);

export function modelFor(settings: Settings, provider: ProviderId = settings.provider): string {
  return settings.models[provider]?.trim() || PROVIDERS[provider].defaultModel;
}

/** Stream a reply from the configured provider; resolves with the full text. */
export async function complete(settings: Settings, req: CompleteRequest): Promise<string> {
  const provider = settings.provider;
  const key = settings.keys[provider]?.trim();
  if (!key) throw new AiError(`Add your ${PROVIDERS[provider].label} key in Settings first.`, provider);
  const model = modelFor(settings, provider);
  let full = '';
  const emit = (d: string) => { if (!d) return; full += d; req.onText?.(d, full); };
  switch (provider) {
    case 'claude': await streamClaude(key, model, req, emit); break;
    case 'openai': await streamOpenAiCompatible('https://api.openai.com/v1/chat/completions', key, model, req, emit, provider); break;
    case 'groq': await streamOpenAiCompatible('https://api.groq.com/openai/v1/chat/completions', key, model, req, emit, provider); break;
    case 'gemini': await streamGemini(key, model, req, emit); break;
  }
  return full;
}

// ─── Claude ─────────────────────────────────────────────────────────────────

async function streamClaude(key: string, model: string, req: CompleteRequest, emit: (d: string) => void) {
  // The key is the user's own and never leaves this device except to Anthropic.
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 1 });
  const useFallback = CLAUDE_FALLBACK_MODELS.has(model);
  try {
    const stream = client.beta.messages.stream({
      model,
      max_tokens: req.maxTokens ?? 16000,
      system: req.system,
      messages: req.messages,
      output_config: { effort: req.effort ?? 'medium' },
      ...(useFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
    }, { signal: req.signal });
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') emit(event.delta.text);
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') {
      throw new AiError('Claude declined this request. Try rephrasing it or switch provider in Settings.', 'claude');
    }
  } catch (e: any) {
    if (e instanceof AiError || e?.name === 'AbortError') throw e;
    if (e instanceof Anthropic.AuthenticationError) throw new AiError('Your Claude key was rejected. Check it in Settings.', 'claude', 401);
    if (e instanceof Anthropic.RateLimitError) throw new AiError('Claude is rate-limiting this key. Wait a moment and try again.', 'claude', 429);
    if (e instanceof Anthropic.NotFoundError) throw new AiError(`Claude does not know the model "${model}". Pick another in Settings.`, 'claude', 404);
    if (e instanceof Anthropic.APIError) throw new AiError(`Claude error ${e.status ?? ''}: ${e.message}`.trim(), 'claude', e.status ?? undefined);
    throw new AiError(`Could not reach Claude: ${e?.message ?? e}`, 'claude');
  }
}

// ─── OpenAI / Groq (OpenAI-compatible chat completions) ────────────────────

async function streamOpenAiCompatible(
  url: string, key: string, model: string, req: CompleteRequest, emit: (d: string) => void, provider: ProviderId,
) {
  const isOpenAi = provider === 'openai';
  const body: Record<string, unknown> = {
    model,
    stream: true,
    messages: [{ role: isOpenAi ? 'developer' : 'system', content: req.system }, ...req.messages],
  };
  if (isOpenAi) {
    body.max_completion_tokens = req.maxTokens ?? 16000;
    // Only reasoning models (GPT-5 family, o-series) accept reasoning_effort.
    if (/^(gpt-5|o\d)/i.test(model)) body.reasoning_effort = req.effort === 'high' ? 'medium' : 'low';
  } else {
    body.max_tokens = Math.min(req.maxTokens ?? 8000, 8000);
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: req.signal,
  }).catch((e) => { throw e?.name === 'AbortError' ? e : new AiError(`Could not reach ${PROVIDERS[provider].label}.`, provider); });
  if (!res.ok) throw new AiError(await httpErrorMessage(res, provider, model), provider, res.status);
  await readSse(res, (data) => {
    if (data === '[DONE]') return;
    const json = safeJson(data);
    emit(json?.choices?.[0]?.delta?.content ?? '');
  });
}

// ─── Gemini ─────────────────────────────────────────────────────────────────

async function streamGemini(key: string, model: string, req: CompleteRequest, emit: (d: string) => void) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: req.messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: req.maxTokens ?? 16000 },
    }),
    signal: req.signal,
  }).catch((e) => { throw e?.name === 'AbortError' ? e : new AiError('Could not reach Gemini.', 'gemini'); });
  if (!res.ok) throw new AiError(await httpErrorMessage(res, 'gemini', model), 'gemini', res.status);
  await readSse(res, (data) => {
    const json = safeJson(data);
    const parts = json?.candidates?.[0]?.content?.parts ?? [];
    emit(parts.map((p: any) => (typeof p?.text === 'string' && !p.thought ? p.text : '')).join(''));
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Calls onData with each SSE `data:` payload (multi-line data joined). */
export async function readSse(res: Response, onData: (data: string) => void): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) { parseSseChunk(await res.text(), onData); return; }
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const cut = buffer.lastIndexOf('\n\n');
    if (cut >= 0) {
      parseSseChunk(buffer.slice(0, cut), onData);
      buffer = buffer.slice(cut + 2);
    }
  }
  if (buffer.trim()) parseSseChunk(buffer, onData);
}

export function parseSseChunk(text: string, onData: (data: string) => void): void {
  for (const event of text.replace(/\r\n/g, '\n').split('\n\n')) {
    const data = event.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
    if (data) onData(data);
  }
}

function safeJson(text: string): any {
  try { return JSON.parse(text); } catch { return null; }
}

async function httpErrorMessage(res: Response, provider: ProviderId, model: string): Promise<string> {
  const label = PROVIDERS[provider].label;
  if (res.status === 401 || res.status === 403) return `Your ${label} key was rejected. Check it in Settings.`;
  if (res.status === 404) return `${label} does not know the model "${model}". Pick another in Settings.`;
  if (res.status === 429) return `${label} is rate-limiting this key (or it is out of credit). Wait and try again.`;
  const detail = safeJson(await res.text().catch(() => ''))?.error?.message;
  return `${label} error ${res.status}${detail ? `: ${detail}` : ''}`;
}

/** First JSON object in a model reply (tolerates code fences and chatter). */
export function parseJsonObject<T = any>(reply: string): T | null {
  const cleaned = String(reply ?? '').replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)) as T; } catch { return null; }
}

/** One call that must return JSON; retries once with a stricter reminder. */
export async function completeJson<T>(settings: Settings, req: Omit<CompleteRequest, 'onText'>): Promise<T> {
  const first = parseJsonObject<T>(await complete(settings, req));
  if (first) return first;
  const second = parseJsonObject<T>(await complete(settings, {
    ...req,
    messages: [...req.messages, { role: 'user', content: 'Reply again with ONLY the JSON object, no other text.' }],
  }));
  if (second) return second;
  throw new AiError('The AI reply was not in the expected format. Try again.', settings.provider);
}
