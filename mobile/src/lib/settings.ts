// Soro X Mobile — settings and keys, stored on this device only (WebView storage
// is private to the app). Nothing is synced or sent anywhere.
export type ProviderId = 'claude' | 'openai' | 'gemini' | 'groq';
export type SttEngine = 'device' | 'deepgram' | 'openai' | 'groq';

export interface Settings {
  provider: ProviderId;
  keys: Partial<Record<ProviderId | 'deepgram' | 'tavily', string>>;
  models: Partial<Record<ProviderId, string>>;
  stt: SttEngine;
  /** Spoken language for transcription, BCP-47 (e.g. en-US). */
  language: string;
  /** Answer automatically when a question is detected, or only on tap. */
  autoAnswer: boolean;
  /** Answer length: short spoken bullets, or a fuller script. */
  answerStyle: 'concise' | 'detailed';
}

export const DEFAULT_SETTINGS: Settings = {
  provider: 'claude',
  keys: {},
  models: {},
  stt: 'device',
  language: 'en-US',
  autoAnswer: true,
  answerStyle: 'concise',
};

const KEY = 'sorox.mobile.settings.v1';

export function loadSettings(storage: Pick<Storage, 'getItem'> = localStorage): Settings {
  try {
    const raw = JSON.parse(storage.getItem(KEY) || 'null');
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
    return {
      ...DEFAULT_SETTINGS,
      ...raw,
      keys: { ...(raw.keys ?? {}) },
      models: { ...(raw.models ?? {}) },
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings, storage: Pick<Storage, 'setItem'> = localStorage): void {
  storage.setItem(KEY, JSON.stringify(s));
}

/** True when the selected provider has a key. */
export function isReady(s: Settings): boolean {
  return !!s.keys[s.provider]?.trim();
}
