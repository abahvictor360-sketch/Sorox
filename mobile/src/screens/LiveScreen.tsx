// Live: listens, tells the interviewer from you, spots questions and answers them
// on the spot. Laid out like the desktop overlay: status bar, transcript,
// answer feed, quick actions and an "Ask anything" box. Phones stack the panes;
// tablets show transcript and answers side by side.
import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import type { ModeId, Settings } from '../lib/settings';
import { isReady } from '../lib/settings';
import type { Profile } from '../lib/profile';
import { MODES, QUICK_ACTIONS, SKIP, looksLikeQuestion, answerFromImage, answerQuestion, chat, modeOf, quickAction, writeNotes, type QuickAction } from '../lib/interview';
import { Conversation, firstPersonRatio, type Role, type Segment } from '../lib/conversation';
import { NegotiationConversationTracker, detectPhase, textHasCompEvidence } from '../lib/negotiationTracker';
import { coach, type Coaching } from '../lib/negotiation';
import { VoiceMatcher, loadVoice, type VoicePrint } from '../lib/voice';
import { useTranscriber } from '../lib/useTranscriber';
import { fileToImagePart } from '../lib/image';
import { newSession, upsertSession, sessionTranscript, type Session } from '../lib/sessions';
import { keepAwake } from '../lib/schedule';
import { warmUp, type ChatMessage } from '../lib/ai';
import { webMode } from '../lib/web';
import { sameQuestion } from '../lib/conversation';
import { Markdown } from '../components/Markdown';
import { ModeIcon } from '../components/ModeIcon';
import { AArrowDown, AArrowUp, ArrowUp, AudioLines, Globe, Camera, Check, ChevronDown, ChevronLeft, ChevronRight, Mic, Sparkles, Square, StickyNote } from 'lucide-react';
import { CoachCard } from '../components/CoachCard';

type ItemKind = 'answer' | 'action' | 'image' | 'chat' | 'coach' | 'note';
interface Item {
  id: number;
  kind: ItemKind;
  /** What it answers (question, action label, your message, or the note). */
  prompt: string;
  text: string;
  done: boolean;
  error?: string;
  preview?: string;
  coaching?: Coaching;
  auto?: boolean;
}

export interface LiveHandle {
  /** Start listening (from a notification, the schedule or "listen on open"). */
  startListening: (mode?: ModeId, opts?: { standby?: boolean }) => void;
}

interface Props {
  settings: Settings;
  profile: Profile;
  active: boolean;
  onSettings: (s: Settings) => void;
  onSessionSaved: () => void;
}

const ROLE_LABEL: Record<Role, string> = { them: 'Interviewer', you: 'You', unknown: '…' };
const PREP_KEY = 'sorox.mobile.prep.v1';
const salaryPlan = () => { try { return JSON.parse(localStorage.getItem(PREP_KEY) || '{}')?.negotiation?.text ?? ''; } catch { return ''; } };

export const LiveScreen = forwardRef<LiveHandle, Props>(function LiveScreen({ settings, profile, active, onSettings, onSessionSaved }, ref) {
  const conv = useRef(new Conversation()).current;
  const tracker = useRef(new NegotiationConversationTracker()).current;
  const [segments, setSegments] = useState<Segment[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [typed, setTyped] = useState('');
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [showTranscript, setShowTranscript] = useState(true);
  const [modePicker, setModePicker] = useState(false);
  const [noteDraft, setNoteDraft] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  // "Ask anything" can search the web (remembered).
  const [webOn, setWebOn] = useState(() => { try { return localStorage.getItem('sorox.mobile.askWeb') === '1'; } catch { return false; } });
  const setWebOnSaved = (on: boolean) => { setWebOn(on); try { localStorage.setItem('sorox.mobile.askWeb', on ? '1' : '0'); } catch { /* ignore */ } };
  // Glass view: big, translucent question + answer, for a tablet on a stand or split screen.
  const [glass, setGlass] = useState(() => { try { return localStorage.getItem('sorox.mobile.glass') === '1'; } catch { return false; } });
  const [glassIdx, setGlassIdx] = useState<number | null>(null);
  const [glassSize, setGlassSize] = useState(() => { try { return Number(localStorage.getItem('sorox.mobile.glassSize')) || 22; } catch { return 22; } });
  const setGlassMode = (on: boolean) => { setGlass(on); setGlassIdx(null); try { localStorage.setItem('sorox.mobile.glass', on ? '1' : '0'); } catch { /* ignore */ } };
  useEffect(() => { try { localStorage.setItem('sorox.mobile.glassSize', String(glassSize)); } catch { /* ignore */ } }, [glassSize]);
  const session = useRef<Session | null>(null);
  const controllers = useRef(new Map<number, AbortController>());
  const debounce = useRef<number | null>(null);
  const chatHistory = useRef<ChatMessage[]>([]);
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const profileRef = useRef(profile); profileRef.current = profile;
  const feedRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 2000); return () => window.clearInterval(t); }, []);

  // ── Session (saved to Notes) ──
  const saveSession = useCallback(() => {
    if (!session.current) return;
    upsertSession(session.current);
    onSessionSaved();
  }, [onSessionSaved]);
  const ensureSession = useCallback(() => {
    if (!session.current) session.current = newSession(settingsRef.current.mode);
    return session.current;
  }, []);

  // ── Feed helpers ──
  const addItem = useCallback((it: Omit<Item, 'id' | 'done' | 'text'> & Partial<Item>) => {
    const id = Date.now() + Math.random();
    setItems((list) => [...list, { text: '', done: false, ...it, id }].slice(-40));
    return id;
  }, []);
  const patch = useCallback((id: number, p: Partial<Item>) => setItems((list) => list.map((x) => (x.id === id ? { ...x, ...p } : x))), []);
  const remove = useCallback((id: number) => setItems((list) => list.filter((x) => x.id !== id)), []);

  const run = useCallback(async (id: number, prompt: string, kind: string, task: (onText: (d: string, full: string) => void, signal: AbortSignal) => Promise<string>) => {
    const ctl = new AbortController();
    controllers.current.set(id, ctl);
    try {
      const out = await task((_d, full) => patch(id, { text: full }), ctl.signal);
      if (out === SKIP) { remove(id); return; }
      patch(id, { text: out, done: true });
      const s = ensureSession();
      s.answers.push({ question: prompt, text: out, at: Date.now(), kind });
      saveSession();
    } catch (e: any) {
      if (ctl.signal.aborted || e?.name === 'AbortError') patch(id, { done: true });
      else patch(id, { done: true, error: String(e?.message ?? e) });
    } finally {
      controllers.current.delete(id);
    }
  }, [patch, remove, ensureSession, saveSession]);

  // ── Answering ──
  const answer = useCallback((question: string, context: string, opts: { auto: boolean }): number => {
    const s = settingsRef.current; const p = profileRef.current;
    const pay = (s.mode === 'interview' || s.mode === 'technical') && (textHasCompEvidence(question) || (tracker.isActive() && !!detectPhase(question)));
    if (pay) {
      tracker.feed(question);
      const id = addItem({ kind: 'coach', prompt: question, auto: opts.auto });
      const state = tracker.getState() ?? NegotiationConversationTracker.empty();
      void (async () => {
        try {
          const c = await coach(s, p, question, state, conv.transcript(), salaryPlan());
          if (c) { patch(id, { coaching: c, done: true }); ensureSession().answers.push({ question, text: `${c.tacticalNote}\n“${c.exactScript}”`, at: Date.now(), kind: 'coach' }); saveSession(); return; }
        } catch { /* fall back to a normal answer */ }
        remove(id);
        const aid = addItem({ kind: 'answer', prompt: question, auto: opts.auto });
        void run(aid, question, 'answer', (on, sig) => answerQuestion(s, p, question, context, on, sig, { allowSkip: opts.auto }));
      })();
      return id;
    }
    const id = addItem({ kind: 'answer', prompt: question, auto: opts.auto });
    void run(id, question, 'answer', (on, sig) => answerQuestion(s, p, question, context, on, sig, { allowSkip: opts.auto }));
    return id;
  }, [addItem, patch, remove, run, conv, tracker, ensureSession, saveSession]);

  const answerPending = useCallback(() => {
    const pq = conv.pendingQuestion((seg) => seg.question || (tracker.isActive() && !!detectPhase(seg.text)));
    if (!pq) return;
    conv.markAnswered(pq.ids);
    answer(pq.question, pq.context, { auto: true });
  }, [conv, tracker, answer]);

  // ── Transcript in ──
  // Early answers: started from the live caption before the final transcript.
  const early = useRef<{ text: string; at: number; itemId: number } | null>(null);

  // Your voice (Settings > Your voice): the matcher compares each line with it
  // and learns the other voices as the interview goes. Prints are kept per line
  // so a correction can teach it.
  const voiceRef = useRef<VoiceMatcher>(new VoiceMatcher(loadVoice()));
  const prints = useRef(new Map<number, VoicePrint>());
  const [voiceOn, setVoiceOn] = useState(() => !!loadVoice());

  const process = useCallback((text: string, speaker?: number, at = Date.now(), print?: VoicePrint | null) => {
    const verdict = voiceRef.current.classify(print);
    if ((window as any).__SOROX_TEST__) ((window as any).__voiceLog ??= []).push({ text, verdict, hasPrint: !!print });
    const seg = conv.add(text, at, speaker, verdict.who === 'unsure' ? undefined : verdict.who);
    if (print) {
      prints.current.set(seg.id, print);
      // Learn from lines it is sure about. Before it has heard the interviewer,
      // a plain question (no "I"/"my") that does not sound like you counts too.
      if (verdict.who !== 'unsure') voiceRef.current.learn(print, verdict.who);
      else if (seg.question && firstPersonRatio(seg.text) < 0.08 && verdict.you < (loadVoice()?.selfScore ?? 1) * 0.4) voiceRef.current.learn(print, 'them');
    }
    // Already being answered from the live caption: do not answer it twice,
    // and take the answer back if it was you speaking after all.
    const e = early.current;
    const earlyCovered = !!e && at - e.at < 20_000 && sameQuestion(e.text, seg.text);
    if (earlyCovered) {
      conv.markAnswered([seg.id]); early.current = null;
      if (seg.role === 'you') { controllers.current.get(e!.itemId)?.abort(); remove(e!.itemId); }
    }
    setSegments([...conv.segments]);
    const s = ensureSession();
    s.lines.push({ text: seg.text, role: seg.role, at: seg.at });
    if (s.lines.length % 5 === 0) saveSession();
    if (seg.role !== 'you') tracker.feed(seg.text);
    const st = settingsRef.current;
    const trigger = !earlyCovered && seg.role !== 'you' && (seg.question || (tracker.isActive() && !!detectPhase(seg.text)));
    if (st.autoAnswer && isReady(st) && trigger) {
      // A question that clearly ended ("…?") is answered at once; otherwise
      // wait a moment in case it continues in the next utterance.
      if (debounce.current) window.clearTimeout(debounce.current);
      debounce.current = window.setTimeout(() => { debounce.current = null; answerPending(); }, /\?\s*$/.test(seg.text) ? 150 : 600);
    }
  }, [conv, tracker, ensureSession, saveSession, answerPending, remove]);

  // Standby: the mic is on but nothing is kept until the first question is
  // heard; then Soro X turns itself on (session, transcript, answers) with the
  // last few lines as context.
  const [standby, setStandby] = useState(false);
  const standbyRef = useRef(false);
  const standbyBuf = useRef<{ text: string; speaker?: number; at: number; voice?: VoicePrint | null }[]>([]);
  const onFinal = useCallback((text: string, meta?: { speaker?: number; voice?: VoicePrint | null }) => {
    if (standbyRef.current) {
      const now = Date.now();
      standbyBuf.current = [...standbyBuf.current, { text, speaker: meta?.speaker, at: now, voice: meta?.voice }].filter((l) => now - l.at < 60_000).slice(-4);
      // Wake on a question, unless it is your own voice asking it.
      if (!(looksLikeQuestion(text) && firstPersonRatio(text) < 0.15)) return;
      if (voiceRef.current.classify(meta?.voice).who === 'you') return;
      standbyRef.current = false; setStandby(false);
      const buf = standbyBuf.current; standbyBuf.current = [];
      for (const l of buf) process(l.text, l.speaker, l.at, l.voice);
      return;
    }
    process(text, meta?.speaker, Date.now(), meta?.voice);
  }, [process]);

  const mic = useTranscriber(settings, onFinal);

  // Answer from the live caption as soon as a question is complete: when it
  // ends with "?" (Deepgram punctuates), or when the speaker has paused on a
  // question for a moment, without waiting for the final transcript.
  useEffect(() => {
    const t = mic.interim.trim();
    const st = settingsRef.current;
    if (!t || t === '…' || standbyRef.current || !st.autoAnswer || !isReady(st)) return;
    if (!looksLikeQuestion(t) || firstPersonRatio(t) >= 0.15) return;
    const wait = /\?\s*$/.test(t) ? 200 : 700;
    const id = window.setTimeout(() => {
      if (early.current && Date.now() - early.current.at < 20_000 && sameQuestion(early.current.text, t)) return;
      const itemId = answer(t, conv.transcript(), { auto: true });
      early.current = { text: t, at: Date.now(), itemId };
    }, wait);
    return () => window.clearTimeout(id);
  }, [mic.interim, answer, conv]);

  // Automated UI tests feed speech here (only when a test page sets the flag).
  useEffect(() => {
    const w = window as any;
    if (!w.__SOROX_TEST__) return;
    w.__soroxHear = (text: string, speaker?: number) => onFinal(text, { speaker });
    w.__soroxStop = () => stopRef.current?.();
    return () => { delete w.__soroxHear; delete w.__soroxStop; };
  }, [onFinal]);
  const stopRef = useRef<(() => Promise<void>) | null>(null);

  const start = useCallback(async (opts: { standby?: boolean } = {}) => {
    const profile = loadVoice();
    voiceRef.current = new VoiceMatcher(profile); prints.current.clear(); setVoiceOn(!!profile);
    standbyRef.current = !!opts.standby; setStandby(!!opts.standby); standbyBuf.current = [];
    if (!opts.standby) ensureSession();
    warmUp(settingsRef.current);
    await mic.start();
    if (settingsRef.current.keepAwake) void keepAwake(true);
  }, [mic, ensureSession]);

  const stop = useCallback(async () => {
    standbyRef.current = false; setStandby(false);
    await mic.stop();
    void keepAwake(false);
    const s = session.current;
    if (!s) return;
    s.endedAt = Date.now();
    s.lines = conv.segments.map((x) => ({ text: x.text, role: x.role, at: x.at }));
    saveSession();
    // Notes write themselves when there is enough to summarise.
    if (isReady(settingsRef.current) && s.lines.length >= 4 && !s.notes) {
      const target = s;
      writeNotes(settingsRef.current, profileRef.current, sessionTranscript(target), target.myNotes)
        .then((notes) => { target.notes = notes; upsertSession(target); onSessionSaved(); })
        .catch(() => {});
    }
  }, [mic, conv, saveSession, onSessionSaved]);

  stopRef.current = stop;

  const newConversation = useCallback(async () => {
    if (mic.listening) await stop();
    for (const c of controllers.current.values()) c.abort();
    conv.clear(); tracker.reset();
    session.current = null; chatHistory.current = [];
    setSegments([]); setItems([]);
  }, [mic.listening, stop, conv, tracker]);

  useImperativeHandle(ref, () => ({
    startListening: (mode, opts) => {
      if (mode && mode !== settingsRef.current.mode) onSettings({ ...settingsRef.current, mode });
      if (!mic.listening) void start(opts);
      else if (!opts?.standby && standbyRef.current) { standbyRef.current = false; setStandby(false); }
    },
  }), [mic.listening, start, onSettings]);

  // ── Actions ──
  const lastAnswer = () => [...items].reverse().find((i) => i.text && (i.kind === 'answer' || i.kind === 'action'))?.text ?? '';
  const doAction = (a: QuickAction) => {
    const label = QUICK_ACTIONS.find((q) => q.id === a)!.label;
    if (a === 'what_to_say') {
      const pq = conv.pendingQuestion() ?? (segments.length ? { question: segments[segments.length - 1].text, context: conv.transcript(), ids: [] } : null);
      if (pq) { conv.markAnswered(pq.ids); answer(pq.question, pq.context, { auto: false }); return; }
    }
    const id = addItem({ kind: 'action', prompt: label });
    const transcript = conv.transcript(); const last = lastAnswer();
    void run(id, label, a, (on, sig) => quickAction(settingsRef.current, profileRef.current, a, transcript, last, on, sig));
  };

  const ask = (text: string) => {
    const q = text.trim(); if (!q) return;
    const id = addItem({ kind: 'chat', prompt: webOn && webMode(settingsRef.current) !== 'none' ? `${q}  (web search)` : q });
    const history = [...chatHistory.current, { role: 'user' as const, content: q }];
    const web = webOn && webMode(settingsRef.current) !== 'none';
    void run(id, q, 'chat', async (on, sig) => {
      const out = await chat(settingsRef.current, profileRef.current, history, conv.transcript(), on, sig, { web });
      chatHistory.current = [...history, { role: 'assistant' as const, content: out }].slice(-12);
      return out;
    });
  };

  const readScreen = async (file: File | undefined) => {
    if (!file) return;
    try {
      const { part, preview } = await fileToImagePart(file);
      const id = addItem({ kind: 'image', prompt: 'Question on screen', preview });
      void run(id, 'Question on screen', 'image', (on, sig) => answerFromImage(settingsRef.current, profileRef.current, part, conv.transcript(), on, sig));
    } catch (e: any) {
      addItem({ kind: 'note', prompt: 'Photo', error: String(e?.message ?? e), done: true });
    }
  };

  const saveNote = (text: string) => {
    const t = text.trim(); if (!t) return;
    const s = ensureSession();
    s.myNotes = `${s.myNotes ? `${s.myNotes}\n` : ''}• ${t}`;
    saveSession();
    addItem({ kind: 'note', prompt: t, done: true });
  };

  const setRole = (seg: Segment, role: Role) => {
    conv.setRole(seg.id, role);
    if (role !== 'unknown') voiceRef.current.learn(prints.current.get(seg.id), role);
    setSegments([...conv.segments]);
    setMenuFor(null);
  };

  // Keep the newest in view.
  useEffect(() => { feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' }); }, [items]);
  useEffect(() => { transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight }); }, [segments, mic.interim]);
  useEffect(() => () => { for (const c of controllers.current.values()) c.abort(); }, []);

  const who = mic.listening ? conv.state(now) : 'idle';
  const status = !mic.listening ? 'Ready' : standby ? 'Standby · waiting for a question' : who === 'them' ? 'Interviewer speaking' : who === 'you' ? "You're answering" : 'Listening';
  const mode = modeOf(settings);
  const noKey = !isReady(settings);

  if (glass) {
    const shown = items.filter((i) => i.kind !== 'note');
    const idx = glassIdx === null ? shown.length - 1 : Math.min(glassIdx, shown.length - 1);
    const cur = shown[idx];
    const lastLine = mic.interim || segments[segments.length - 1]?.text || '';
    return (
      <section className="glass-view" style={{ ['--gv-size' as any]: `${glassSize}px` }}>
        <div className="gv-top">
          <button className={`pill status ${mic.listening ? `on ${standby ? 'standby' : who}` : ''}`} onClick={() => (mic.listening ? void stop() : void start())}>
            <span className="dot" />{status}
          </button>
          <span className="grow" />
          <button className="pill ghosty" aria-label="Smaller text" onClick={() => setGlassSize((n) => Math.max(14, n - 2))}><AArrowDown size={17} /></button>
          <button className="pill ghosty" aria-label="Larger text" onClick={() => setGlassSize((n) => Math.min(34, n + 2))}><AArrowUp size={17} /></button>
          <button className="pill" onClick={() => setGlassMode(false)}>Exit glass</button>
        </div>
        <div className="gv-main">
          {cur ? (
            <>
              <div className="gv-q">{cur.kind === 'answer' ? (cur.auto ? 'Heard: ' : 'Asked: ') : ''}{cur.prompt}</div>
              <div className="gv-a">
                {cur.error ? <p className="error">{cur.error}</p>
                  : cur.kind === 'coach' && cur.coaching ? <CoachCard c={cur.coaching} />
                  : cur.text ? <Markdown text={cur.text} /> : <div className="typing"><i /><i /><i /></div>}
              </div>
            </>
          ) : (
            <div className="gv-empty">{mic.listening ? (standby ? 'On standby. Turns on at the first question.' : 'Listening. Questions and answers appear here, large.') : 'Tap the status to start listening.'}</div>
          )}
        </div>
        {shown.length > 1 && (
          <div className="gv-nav">
            <button className="pill ghosty" disabled={idx <= 0} onClick={() => setGlassIdx(Math.max(0, idx - 1))}><ChevronLeft size={15} aria-hidden /> Earlier</button>
            <span className="muted small">{idx + 1} / {shown.length}</span>
            <button className="pill ghosty" disabled={idx >= shown.length - 1} onClick={() => setGlassIdx(idx + 1 >= shown.length - 1 ? null : idx + 1)}>Later <ChevronRight size={15} aria-hidden /></button>
          </div>
        )}
        {lastLine && <div className="gv-ticker">{lastLine}</div>}
        {noteDraft !== null && (
          <form className="askbar" onSubmit={(e) => { e.preventDefault(); saveNote(noteDraft); setNoteDraft(null); }}>
            <input autoFocus value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="Write a note (saved to Notes)…" />
            <button className="send" disabled={!noteDraft.trim()} aria-label="Save note"><Check size={18} aria-hidden /></button>
          </form>
        )}
        <div className="gv-controls">
          <button className="pill" onClick={() => setNoteDraft(noteDraft === null ? '' : null)}><StickyNote size={14} aria-hidden /> Take note</button>
          <button className="pill" disabled={noKey} onClick={() => doAction('what_to_say')}>What should I say?</button>
          <button className="pill" disabled={noKey} onClick={() => doAction('shorten')}>Shorten</button>
          <button className="pill" disabled={noKey} onClick={() => fileRef.current?.click()}><Camera size={15} aria-hidden /> Read screen</button>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void readScreen(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      </section>
    );
  }

  return (
    <section className="live">
      {/* Status bar */}
      <div className="glass bar">
        <button className={`pill status ${mic.listening ? `on ${standby ? 'standby' : who}` : ''}`} onClick={() => (mic.listening ? void stop() : void start())} aria-label={mic.listening ? 'Stop listening' : 'Start listening'}>
          <span className="dot" />{status}
        </button>
        <button className="pill" onClick={() => setModePicker(!modePicker)} aria-expanded={modePicker}><ModeIcon id={mode.id} /> {mode.label} <ChevronDown size={14} aria-hidden /></button>
        <span className="grow" />
        {mic.listening && <span className="meter" aria-hidden><i style={{ transform: `scaleX(${Math.max(0.06, mic.level)})` }} /></span>}
        {!mic.listening && <button className="pill ghosty" onClick={() => void start({ standby: true })} title="Listen quietly and turn on by itself at the first question">Standby</button>}
        <button className="pill take-note" onClick={() => setNoteDraft(noteDraft === null ? '' : null)} title="Take a note (saved to Notes)"><StickyNote size={14} aria-hidden /> Take note</button>
        <button className="pill ghosty" onClick={() => setGlassMode(true)} title="Big translucent question and answer view">Glass</button>
        <button className="pill ghosty" onClick={() => void newConversation()} title="Start a new conversation">New</button>
        <button className={`mic ${mic.listening ? 'on' : ''}`} onClick={() => (mic.listening ? void stop() : void start())} aria-label={mic.listening ? 'Stop listening' : 'Start listening'}>
          {mic.listening ? <Square size={16} fill="currentColor" aria-hidden /> : <Mic size={19} aria-hidden />}
        </button>
      </div>

      {modePicker && (
        <div className="glass modes">
          {MODES.map((m) => (
            <button key={m.id} className={`mode ${m.id === settings.mode ? 'on' : ''}`} onClick={() => { onSettings({ ...settings, mode: m.id }); setModePicker(false); }}>
              <span className="mi"><ModeIcon id={m.id} size={20} /></span><b>{m.label}</b><small>{m.blurb}</small>
            </button>
          ))}
        </div>
      )}

      {mic.error && <p className="error banner-in">{mic.error}</p>}
      {noKey && <p className="hint banner-in">Add an AI key in Settings (Me tab) to get answers. Listening and notes work without one.</p>}

      <div className="live-body">
        {/* Transcript */}
        <div className={`glass pane transcript-pane ${showTranscript ? '' : 'collapsed'}`}>
          <button className="pane-head" onClick={() => setShowTranscript(!showTranscript)}>
            <span>Transcript</span>
            <span className="legend"><i className="r-them" />Interviewer <i className="r-you" />You</span>
            <span className={`voice-badge ${voiceOn && settings.stt !== 'device' ? 'on' : ''}`} title={voiceOn ? (settings.stt === 'device' ? 'Voice match needs Offline, Deepgram, Groq or OpenAI listening' : 'Recognising your voice') : 'Record your voice in Me > Settings so Soro X always knows when it is you'}><AudioLines size={12} aria-hidden />{voiceOn ? (settings.stt === 'device' ? 'Voice: n/a' : 'Voice match') : 'No voice sample'}</span>
            <span className="chev">{showTranscript ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}</span>
          </button>
          <div className="lines" ref={transcriptRef}>
            {!segments.length && !mic.interim && (
              <p className="empty">{mic.listening ? 'Listening… questions appear here as they are asked.' : 'Tap the mic. Soro X writes down the conversation, tells the interviewer from you, and answers questions the moment they are asked.'}</p>
            )}
            {segments.map((s) => (
              <div key={s.id} className={`line r-${s.role} ${s.question ? 'q' : ''}`}>
                <button className="who" onClick={() => setMenuFor(menuFor === s.id ? null : s.id)}>{ROLE_LABEL[s.role]}</button>
                <span className="txt" onClick={() => setMenuFor(menuFor === s.id ? null : s.id)}>{s.text}</span>
                {menuFor === s.id && (
                  <div className="menu">
                    <button onClick={() => setRole(s, 'them')}>Interviewer said this</button>
                    <button onClick={() => setRole(s, 'you')}>I said this</button>
                    <button className="accent" onClick={() => { setMenuFor(null); answer(s.text, conv.transcript(), { auto: false }); }}>Answer this</button>
                  </div>
                )}
              </div>
            ))}
            {mic.interim && <div className="line interim"><span className="who">…</span><span className="txt">{mic.interim}</span></div>}
          </div>
        </div>

        {/* Answers */}
        <div className="feed" ref={feedRef}>
          {!items.length && (
            <div className="glass welcome">
              <div className="wicon"><Sparkles size={24} aria-hidden /></div>
              <b>Answers appear here</b>
              <p>When the interviewer asks a question, a suggested answer appears straight away{settings.autoAnswer ? '' : ' (auto-answer is off: tap a question or "What should I say?")'}. Use Read screen to answer a question shown on a screen.</p>
            </div>
          )}
          {items.map((it) => (
            <div key={it.id} className={`turn k-${it.kind}`}>
              {it.kind !== 'note' && (
                <div className="ask-bubble">
                  {it.kind === 'answer' && <span className="tag">{it.auto ? 'Heard' : 'Asked'}</span>}
                  {it.kind === 'coach' && <span className="tag">Pay talk</span>}
                  {it.preview && <img src={it.preview} alt="" className="thumb" />}
                  <span>{it.prompt}</span>
                </div>
              )}
              {it.kind === 'note' ? (
                <div className="note-card"><StickyNote size={14} aria-hidden /> {it.error ?? it.prompt}</div>
              ) : it.kind === 'coach' && it.coaching ? (
                <CoachCard c={it.coaching} />
              ) : (
                <div className={`glass answer-card ${it.done ? '' : 'streaming'}`}>
                  {it.error ? <p className="error">{it.error}</p> : it.text ? <Markdown text={it.text} /> : <div className="typing"><i /><i /><i /></div>}
                  {!it.done && it.text && <button className="stop" onClick={() => controllers.current.get(it.id)?.abort()}>Stop</button>}
                  {it.done && it.text && <button className="copy" onClick={() => void navigator.clipboard?.writeText(it.text)}>Copy</button>}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Dock: quick actions + ask */}
      <div className="glass dock">
        <div className="actions">
          {QUICK_ACTIONS.map((a) => <button key={a.id} className="pill" disabled={noKey} onClick={() => doAction(a.id)}>{a.label}</button>)}
          <button className="pill" disabled={noKey} onClick={() => fileRef.current?.click()}><Camera size={15} aria-hidden /> Read screen</button>
          <button className="pill" onClick={() => setNoteDraft(noteDraft === null ? '' : null)}><StickyNote size={15} aria-hidden /> Note</button>
        </div>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void readScreen(e.target.files?.[0]); e.target.value = ''; }} />
        {noteDraft !== null ? (
          <form className="askbar" onSubmit={(e) => { e.preventDefault(); saveNote(noteDraft); setNoteDraft(null); }}>
            <input autoFocus value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder="Write a note (saved to Notes)…" />
            <button className="send" disabled={!noteDraft.trim()} aria-label="Save note"><Check size={18} aria-hidden /></button>
          </form>
        ) : (
          <form className="askbar" onSubmit={(e) => { e.preventDefault(); ask(typed); setTyped(''); }}>
            <button type="button" className={`web-toggle ${webOn ? 'on' : ''}`} aria-label="Web search" aria-pressed={webOn} disabled={noKey}
              title={webMode(settings) === 'none' ? 'Add a Tavily key in Settings to search the web' : webOn ? 'Web search on for questions you type' : 'Search the web for questions you type'}
              onClick={() => setWebOnSaved(!webOn)}><Globe size={18} aria-hidden /></button>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={noKey ? 'Add an AI key to ask' : webOn ? 'Ask anything, searched on the web…' : 'Ask anything, or paste a question…'} disabled={noKey} />
            <button className="send" disabled={!typed.trim() || noKey} aria-label="Send"><ArrowUp size={18} aria-hidden /></button>
          </form>
        )}
      </div>
      {!active && null}
    </section>
  );
});
