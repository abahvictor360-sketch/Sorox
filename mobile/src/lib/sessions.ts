// Soro X Mobile — saved sessions (transcript, answers, your notes, AI notes),
// stored on this phone. Like the desktop's meeting history.
import type { ModeId } from './settings';
import type { Role } from './conversation';

export interface SessionLine { text: string; role: Role; at: number }
export interface SessionAnswer { question: string; text: string; at: number; kind?: string }

export interface Session {
  id: string;
  title: string;
  mode: ModeId;
  startedAt: number;
  endedAt: number | null;
  lines: SessionLine[];
  answers: SessionAnswer[];
  /** What you typed during or after the session. */
  myNotes: string;
  /** AI-written notes (summary, questions asked, action items). */
  notes: string;
}

const KEY = 'sorox.mobile.sessions.v1';
const MAX_SESSIONS = 60;

export function loadSessions(storage: Pick<Storage, 'getItem'> = localStorage): Session[] {
  try {
    const v = JSON.parse(storage.getItem(KEY) || '[]');
    return Array.isArray(v) ? v.filter((s) => s && typeof s.id === 'string') : [];
  } catch { return []; }
}

export function saveSessions(list: Session[], storage: Pick<Storage, 'setItem'> = localStorage) {
  let keep = list.slice(0, MAX_SESSIONS);
  // Storage is limited (~5 MB): drop the oldest sessions until it fits.
  for (;;) {
    try { storage.setItem(KEY, JSON.stringify(keep)); return; } catch {
      if (keep.length <= 1) return;
      keep = keep.slice(0, -1);
    }
  }
}

export function upsertSession(s: Session, storage: Storage = localStorage): Session[] {
  const list = [s, ...loadSessions(storage).filter((x) => x.id !== s.id)].sort((a, b) => b.startedAt - a.startedAt);
  saveSessions(list, storage);
  return list;
}

export function deleteSession(id: string, storage: Storage = localStorage): Session[] {
  const list = loadSessions(storage).filter((x) => x.id !== id);
  saveSessions(list, storage);
  return list;
}

export function newSession(mode: ModeId, title = ''): Session {
  const now = Date.now();
  return {
    id: `s${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    title: title || `${new Date(now).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · ${new Date(now).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`,
    mode, startedAt: now, endedAt: null, lines: [], answers: [], myNotes: '', notes: '',
  };
}

export function sessionTranscript(s: Session): string {
  const label: Record<Role, string> = { them: 'Interviewer', you: 'Candidate', unknown: 'Speaker' };
  return s.lines.map((l) => `${label[l.role]}: ${l.text}`).join('\n');
}

/** Plain-text export for sharing / copying. */
export function sessionToText(s: Session): string {
  return [
    `# ${s.title}`,
    s.notes ? `\n${s.notes}` : '',
    s.myNotes ? `\n## My notes\n${s.myNotes}` : '',
    s.answers.length ? `\n## Suggested answers\n${s.answers.map((a) => `Q: ${a.question}\n${a.text}`).join('\n\n')}` : '',
    s.lines.length ? `\n## Transcript\n${sessionTranscript(s)}` : '',
  ].filter(Boolean).join('\n');
}
