// Practice > Mock interview: a full interview with the AI as the interviewer.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Globe, Mic, Play, Send, Square, Volume2, VolumeX } from 'lucide-react';
import type { Settings } from '../lib/settings';
import { isReady } from '../lib/settings';
import type { Profile } from '../lib/profile';
import type { PracticeKind } from '../lib/interview';
import { asked, canSpeak, interviewerTurn, mockReport, reportMarkdown, researchCompany, speak, stopSpeaking, type MockConfig, type MockReport, type MockStyle, type MockTurn } from '../lib/mock';
import { webMode } from '../lib/web';
import { newSession, upsertSession } from '../lib/sessions';
import { useTranscriber } from '../lib/useTranscriber';
import { Markdown } from './Markdown';

const KINDS: { id: PracticeKind; label: string }[] = [
  { id: 'mixed', label: 'Mixed' }, { id: 'behavioral', label: 'Behavioural' }, { id: 'technical', label: 'Technical' }, { id: 'role-fit', label: 'Role fit' },
];
const STYLES: { id: MockStyle; label: string }[] = [{ id: 'friendly', label: 'Friendly' }, { id: 'standard', label: 'Standard' }, { id: 'tough', label: 'Tough' }];

export function MockInterview({ settings, profile, onSaved }: { settings: Settings; profile: Profile; onSaved?: () => void }) {
  const [cfg, setCfg] = useState<MockConfig>({ kind: 'mixed', length: 5, style: 'standard' });
  const [voice, setVoice] = useState(canSpeak());
  const [research, setResearch] = useState(true);
  const [phase, setPhase] = useState<'setup' | 'running' | 'report'>('setup');
  const [turns, setTurns] = useState<MockTurn[]>([]);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState<'' | 'interviewer' | 'research' | 'report'>('');
  const [err, setErr] = useState('');
  const [report, setReport] = useState<MockReport | null>(null);
  const brief = useRef('');
  const ctl = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const onFinal = useCallback((t: string) => setAnswer((a) => `${a} ${t}`.trim()), []);
  const mic = useTranscriber(settings, onFinal);

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }); }, [turns, busy]);
  useEffect(() => () => { ctl.current?.abort(); stopSpeaking(); }, []);

  const company = profile.job?.company?.trim();
  const canResearch = !!company && webMode(settings) !== 'none';

  const next = async (history: MockTurn[]) => {
    setBusy('interviewer'); setErr('');
    try {
      const step = await interviewerTurn(settings, profile, cfg, history, brief.current, ctl.current?.signal);
      const t: MockTurn = { who: 'interviewer', text: step.say, kind: step.kind };
      const all = [...history, t];
      setTurns(all);
      if (voice) speak(step.say, settings.language);
      if (step.kind === 'end') await finish(all);
    } catch (e: any) {
      if (e?.name !== 'AbortError') setErr(String(e?.message ?? e));
    } finally { setBusy(''); }
  };

  const start = async () => {
    ctl.current = new AbortController();
    setTurns([]); setReport(null); setAnswer(''); setPhase('running'); brief.current = '';
    if (research && canResearch) {
      setBusy('research');
      try { brief.current = await researchCompany(settings, profile, ctl.current.signal); } catch { /* interview goes on without it */ }
    }
    await next([]);
  };

  const send = async () => {
    await mic.stop();
    const text = answer.trim();
    if (!text) { setErr('Say or type your answer first.'); return; }
    stopSpeaking();
    const all = [...turns, { who: 'you' as const, text }];
    setTurns(all); setAnswer('');
    await next(all);
  };

  const finish = async (all: MockTurn[]) => {
    await mic.stop(); stopSpeaking();
    setPhase('report'); setBusy('report'); setErr('');
    try {
      const r = await mockReport(settings, profile, cfg, all);
      setReport(r);
      const s = newSession('interview', `Mock interview${company ? ` · ${company}` : ''}`);
      s.endedAt = Date.now();
      s.lines = all.map((t, i) => ({ text: t.text, role: t.who === 'interviewer' ? 'them' : 'you', at: s.startedAt + i * 1000 }));
      s.notes = reportMarkdown(r);
      upsertSession(s); onSaved?.();
    } catch (e: any) { setErr(String(e?.message ?? e)); }
    finally { setBusy(''); }
  };

  if (!isReady(settings)) return <p className="muted">Add an AI key in Settings (Me tab) to start a mock interview.</p>;

  if (phase === 'setup') {
    return (
      <div className="glass card">
        <h3>Mock interview</h3>
        <p className="muted small">A full interview with an AI interviewer for {profile.job?.title ? <b>{profile.job.title}{company ? ` at ${company}` : ''}</b> : 'your target job'}: it asks questions one at a time, follows up when an answer is thin, and gives you a report at the end (saved to Notes).</p>
        <div className="chips">{KINDS.map((k) => <button key={k.id} className={cfg.kind === k.id ? 'chip on' : 'chip'} onClick={() => setCfg({ ...cfg, kind: k.id })}>{k.label}</button>)}</div>
        <div className="row">
          <span className="muted small">Questions</span>
          {[3, 5, 8].map((n) => <button key={n} className={cfg.length === n ? 'chip on' : 'chip'} onClick={() => setCfg({ ...cfg, length: n })}>{n}</button>)}
          <span className="muted small">Interviewer</span>
          {STYLES.map((s) => <button key={s.id} className={cfg.style === s.id ? 'chip on' : 'chip'} onClick={() => setCfg({ ...cfg, style: s.id })}>{s.label}</button>)}
        </div>
        {canSpeak() && <label className="toggle"><input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} /> <span>Read the interviewer's questions aloud</span></label>}
        <label className="toggle"><input type="checkbox" checked={research && canResearch} disabled={!canResearch} onChange={(e) => setResearch(e.target.checked)} />
          <span><Globe size={14} aria-hidden /> Research {company ?? 'the company'} on the web first<br /><small>{canResearch ? 'The interviewer asks about the company\'s real products and news.' : company ? 'Needs web search (Settings: Web search).' : 'Add the job description in Profile to name the company.'}</small></span></label>
        <button className="primary big" onClick={() => void start()}><Play size={16} aria-hidden /> Start the interview</button>
      </div>
    );
  }

  const n = asked(turns);
  return (
    <div className="mock">
      <div className="row">
        <span className="pill">{phase === 'report' ? 'Finished' : `Question ${Math.max(1, n)} of ${cfg.length}`}</span>
        <span className="grow" />
        {phase === 'running' && canSpeak() && <button className="pill ghosty" aria-label={voice ? 'Stop reading aloud' : 'Read aloud'} onClick={() => { if (voice) stopSpeaking(); setVoice(!voice); }}>{voice ? <Volume2 size={15} /> : <VolumeX size={15} />}</button>}
        {phase === 'running' && <button className="pill ghosty" disabled={!!busy || turns.length < 2} onClick={() => void finish(turns)}>End and get report</button>}
        {phase === 'report' && <button className="pill" onClick={() => { setPhase('setup'); setTurns([]); setReport(null); }}>New mock interview</button>}
      </div>
      <div className="mock-turns" ref={listRef}>
        {busy === 'research' && <p className="muted small"><Globe size={13} aria-hidden /> Looking up {company}…</p>}
        {turns.map((t, i) => (
          <div key={i} className={t.who === 'interviewer' ? 'glass answer-card mock-q' : 'ask-bubble'}>
            {t.who === 'interviewer' && <span className="tag">{t.kind === 'followup' ? 'Follow-up' : t.kind === 'end' ? 'Interviewer' : 'Interviewer'}</span>}
            <span>{t.text}</span>
          </div>
        ))}
        {busy === 'interviewer' && <div className="glass answer-card"><div className="typing"><i /><i /><i /></div></div>}
      </div>
      {phase === 'running' && (
        <div className="glass dock">
          <textarea rows={4} value={answer + (mic.interim && mic.interim !== '…' ? ` ${mic.interim}` : '')} onChange={(e) => setAnswer(e.target.value)} placeholder="Answer out loud (tap Speak) or type here." disabled={busy === 'interviewer' || busy === 'research'} />
          {mic.error && <p className="error">{mic.error}</p>}
          <div className="row">
            {!mic.listening
              ? <button className="secondary" onClick={() => { stopSpeaking(); void mic.start(); }} disabled={!!busy}><Mic size={16} aria-hidden /> Speak</button>
              : <button className="danger" onClick={() => void mic.stop()}><Square size={14} fill="currentColor" aria-hidden /> Done speaking</button>}
            <span className="grow" />
            <button className="primary" disabled={!!busy || !(answer.trim() || mic.interim)} onClick={() => void send()}><Send size={15} aria-hidden /> Send answer</button>
          </div>
        </div>
      )}
      {phase === 'report' && (
        <div className="glass card">
          {busy === 'report' && <p className="muted">Writing your report…</p>}
          {report && <><div className="score"><b>{report.overall}</b>/10 <span>{report.verdict}</span></div><Markdown text={reportMarkdown(report).replace(/^## Overall.*\n\n.*\n?/, '')} /><p className="ok small">Saved to Notes with the full transcript.</p></>}
        </div>
      )}
      {err && <p className="error">{err}</p>}
    </div>
  );
}
