// Soro X Mobile — settings and keys, stored on this device only (WebView storage
// is private to the app). Nothing is synced or sent anywhere.
export type ProviderId = 'claude' | 'openai' | 'gemini' | 'groq' | 'openrouter' | 'nvidia';
export type SttEngine = 'device' | 'whisper' | 'deepgram' | 'openai' | 'groq';
export type ModeId = 'interview' | 'technical' | 'sales' | 'meeting' | 'lecture' | 'general';

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
  /** On-device Whisper model (Listening → Offline). */
  whisperModel: string;
  /** What kind of conversation this is (like the desktop's Modes). */
  mode: ModeId;
  /** Extra instructions per mode, added to every answer. */
  modeNotes: Partial<Record<ModeId, string>>;
  /** Start listening as soon as the app opens. */
  autoListen: boolean;
  /** Keep the screen on while listening. */
  keepAwake: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  provider: 'claude',
  keys: {},
  models: {},
  stt: 'device',
  language: 'en-US',
  autoAnswer: true,
  answerStyle: 'concise',
  whisperModel: 'onnx-community/whisper-tiny.en',
  mode: 'interview',
  modeNotes: {},
  autoListen: false,
  keepAwake: true,
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
      modeNotes: { ...(raw.modeNotes ?? {}) },
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
