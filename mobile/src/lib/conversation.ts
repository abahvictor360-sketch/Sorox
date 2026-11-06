// Soro X Mobile: who said what, and which question is waiting for an answer.
//
// The phone's microphone hears both sides of the conversation. Each finished
// utterance becomes a Segment with a role:
//   them     the interviewer (or anyone asking you questions)
//   you      the candidate / user
//   unknown  not sure yet
//
// With Deepgram, every utterance carries a speaker number (diarization); speaker
// numbers are mapped to roles as the conversation goes: whoever asks the
// questions is "them", whoever then gives long first-person answers is "you".
// Without speaker numbers, roles come from turn-taking and wording. You can tap
// any line to correct its role; with speaker numbers the correction sticks for
// everything that speaker says.
//
// The final word on whether a line is a question for you lies with the answer
// model (it may reply [[SKIP]]), so these rules can stay simple and cheap.
import { looksLikeQuestion } from './interview';

export type Role = 'them' | 'you' | 'unknown';

export interface Segment {
  id: number;
  text: string;
  at: number;
  speaker?: number;
  role: Role;
  question: boolean;
}

export interface PendingQuestion {
  question: string;
  context: string;
  /** The segments the question was built from (to avoid answering twice). */
  ids: number[];
}

// "We" / "our" are left out: interviewers say them all the time ("we'd like to offer…").
const FIRST_PERSON = /\b(i|i'm|i've|i'd|i'll|my|me|mine|myself)\b/gi;

/** Share of words that are first person ("I", "my", "we"); answers are full of them. */
export function firstPersonRatio(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (!words) return 0;
  return (text.match(FIRST_PERSON) ?? []).length / words;
}

const words = (t: string) => t.trim().split(/\s+/).filter(Boolean).length;

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9\s']/g, ' ').split(/\s+/).filter(Boolean);

/**
 * Is the final transcript the same question the live caption was answered
 * from? True when most of the caption's words are in it and it did not go on
 * much longer (a longer final means the question continued: answer it again).
 */
export function sameQuestion(caption: string, final: string): boolean {
  const a = norm(caption); const b = norm(final);
  if (!a.length || !b.length) return false;
  const inB = new Set(b);
  const overlap = a.filter((w) => inB.has(w)).length / a.length;
  return overlap >= 0.75 && b.length <= Math.ceil(a.length * 1.35) + 2;
}

export class Conversation {
  segments: Segment[] = [];
  private speakerRole = new Map<number, Role>();
  private nextId = 1;
  private answered = new Set<number>();

  constructor(private readonly max = 400) {}

  add(text: string, at = Date.now(), speaker?: number): Segment {
    const question = looksLikeQuestion(text);
    const prev = this.segments[this.segments.length - 1];
    const seg: Segment = { id: this.nextId++, text: text.trim(), at, speaker, question, role: 'unknown' };
    seg.role = speaker !== undefined ? this.roleForSpeaker(seg, prev) : this.roleByTurns(seg, prev);
    this.segments.push(seg);
    if (this.segments.length > this.max) this.segments.splice(0, this.segments.length - this.max);
    return seg;
  }

  private roleForSpeaker(seg: Segment, prev?: Segment): Role {
    const sp = seg.speaker!;
    const known = this.speakerRole.get(sp);
    if (known) return known;
    const youKnown = [...this.speakerRole.values()].includes('you');
    let role: Role = 'unknown';
    if (seg.question && firstPersonRatio(seg.text) < 0.12) role = 'them';
    else if (prev?.role === 'them' && prev.speaker !== sp && words(seg.text) >= 8 && !youKnown) role = 'you';
    else if (youKnown) role = 'them'; // a panel: every other voice is an interviewer
    if (role !== 'unknown') this.speakerRole.set(sp, role);
    return role;
  }

  private roleByTurns(seg: Segment, prev?: Segment): Role {
    const fp = firstPersonRatio(seg.text);
    if (seg.question) return fp >= 0.15 ? 'unknown' : 'them';
    if (fp >= 0.08 && words(seg.text) >= 5) return 'you';
    if (prev && (prev.role === 'them' || prev.role === 'you') && seg.at - prev.at < 10_000 && words(seg.text) >= 6) return 'you';
    return 'unknown';
  }

  /** Correct a line's role; with a speaker number, everything that speaker said follows. */
  setRole(id: number, role: Role) {
    const seg = this.segments.find((s) => s.id === id);
    if (!seg) return;
    if (seg.speaker !== undefined) {
      this.speakerRole.set(seg.speaker, role);
      if (role === 'you') {
        // Only one "you": other speakers who were "you" become interviewers.
        for (const [sp, r] of this.speakerRole) if (sp !== seg.speaker && r === 'you') this.speakerRole.set(sp, 'them');
      }
      for (const s of this.segments) if (s.speaker !== undefined) s.role = this.speakerRole.get(s.speaker) ?? s.role;
    } else {
      seg.role = role;
    }
  }

  /** Who is talking now: the last line's role, if it was recent. */
  state(now = Date.now()): Role | 'idle' {
    const last = this.segments[this.segments.length - 1];
    if (!last || now - last.at > 15_000) return 'idle';
    return last.role;
  }

  /**
   * The latest question for you that has not been answered: the trailing run of
   * interviewer (or unknown) lines that contains a question. A question split
   * over two utterances ("Tell me about a time…" / "…you disagreed with a
   * colleague") is joined back together.
   */
  pendingQuestion(isTrigger: (s: Segment) => boolean = (s) => s.question): PendingQuestion | null {
    const run: Segment[] = [];
    for (let i = this.segments.length - 1; i >= 0 && run.length < 4; i--) {
      const s = this.segments[i];
      if (this.answered.has(s.id)) break; // everything before was dealt with
      if (s.role === 'you') { if (run.length) break; continue; }
      if (run.length && run[0].at - s.at > 20_000) break;
      run.unshift(s);
    }
    const firstQ = run.findIndex(isTrigger);
    if (firstQ < 0) return null;
    // The line just before belongs to the question only when it did not end a
    // sentence ("So walk me through how you would design" / "a rate limiter?").
    const prev = run[firstQ - 1];
    const lead = run.slice(prev && !/[.!?]["”']?$/.test(prev.text) ? firstQ - 1 : firstQ);
    const ids = lead.map((s) => s.id);
    const contextSegs = this.segments.filter((s) => !ids.includes(s.id)).slice(-10);
    return { question: lead.map((s) => s.text).join(' '), context: this.transcript(contextSegs), ids };
  }

  markAnswered(ids: number[]) {
    for (const id of ids) this.answered.add(id);
  }

  /** Labelled transcript for prompts. */
  transcript(segs = this.segments.slice(-14)): string {
    const label: Record<Role, string> = { them: 'Interviewer', you: 'Candidate', unknown: 'Speaker (unsure)' };
    return segs.map((s) => `${label[s.role]}: ${s.text}`).join('\n');
  }

  clear() {
    this.segments = [];
    this.speakerRole.clear();
    this.answered.clear();
  }
}
