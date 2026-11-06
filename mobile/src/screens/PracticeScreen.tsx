import { useCallback, useState } from 'react';
import type { Settings } from '../lib/settings';
import type { Profile } from '../lib/profile';
import { gradeAnswer, nextPracticeQuestion, type Feedback, type PracticeKind } from '../lib/interview';
import { useTranscriber } from '../lib/useTranscriber';
import { Markdown } from '../components/Markdown';
import { Mic, Square } from 'lucide-react';
import { MockInterview } from '../components/MockInterview';

const KINDS: { id: PracticeKind; label: string }[] = [
  { id: 'mixed', label: 'Mixed' }, { id: 'behavioral', label: 'Behavioural' }, { id: 'technical', label: 'Technical' }, { id: 'role-fit', label: 'Role fit' },
];

interface Round { question: string; answer: string; feedback: Feedback }

export function PracticeScreen({ settings, profile, onSaved }: { settings: Settings; profile: Profile; onSaved?: () => void }) {
  const [view, setView] = useState<'mock' | 'quick'>('mock');
  return (
    <section>
      <div className="chips" role="tablist">
        <button role="tab" aria-selected={view === 'mock'} className={view === 'mock' ? 'chip on' : 'chip'} onClick={() => setView('mock')}>Mock interview</button>
        <button role="tab" aria-selected={view === 'quick'} className={view === 'quick' ? 'chip on' : 'chip'} onClick={() => setView('quick')}>Quick practice</button>
      </div>
      {view === 'mock' ? <MockInterview settings={settings} profile={profile} onSaved={onSaved} /> : <QuickPractice settings={settings} profile={profile} />}
    </section>
  );
}

function QuickPractice({ settings, profile }: { settings: Settings; profile: Profile }) {
  const [kind, setKind] = useState<PracticeKind>('mixed');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState<'' | 'question' | 'grading'>('');
  const [err, setErr] = useState('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [rounds, setRounds] = useState<Round[]>([]);

  const onFinal = useCallback((t: string) => setAnswer((a) => `${a} ${t}`.trim()), []);
  const mic = useTranscriber(settings, onFinal);

  const next = async () => {
    setErr(''); setFeedback(null); setAnswer(''); setBusy('question');
    await mic.stop();
    try { setQuestion(await nextPracticeQuestion(settings, profile, kind, rounds.map((r) => r.question))); }
    catch (e: any) { setErr(String(e?.message ?? e)); }
    finally { setBusy(''); }
  };

  const grade = async () => {
    await mic.stop();
    if (!answer.trim()) { setErr('Say or type your answer first.'); return; }
    setErr(''); setBusy('grading');
    try {
      const f = await gradeAnswer(settings, profile, question, answer);
      setFeedback(f);
      setRounds((r) => [...r, { question, answer, feedback: f }]);
    } catch (e: any) { setErr(String(e?.message ?? e)); }
    finally { setBusy(''); }
  };

  const avg = rounds.length ? (rounds.reduce((s, r) => s + r.feedback.score, 0) / rounds.length).toFixed(1) : null;
  return (
    <section>
      <div className="chips">
        {KINDS.map((k) => <button key={k.id} className={kind === k.id ? 'chip on' : 'chip'} onClick={() => setKind(k.id)}>{k.label}</button>)}
      </div>
      {avg && <p className="muted">{rounds.length} answered · average {avg}/10</p>}
      {!question ? (
        <div className="card center">
          <p>A mock interviewer asks you questions for your target job. Answer out loud; you get a score, what to fix and a stronger answer.</p>
          <button className="primary big" disabled={!!busy} onClick={() => void next()}>{busy ? 'Preparing…' : 'Start practice'}</button>
        </div>
      ) : (
        <>
          <div className="card"><div className="q big">{busy === 'question' ? 'Next question…' : question}</div></div>
          {!feedback && (
            <>
              <textarea rows={6} value={answer + (mic.interim ? ` ${mic.interim}` : '')} onChange={(e) => setAnswer(e.target.value)} placeholder="Tap Speak and answer out loud, or type here." />
              {mic.error && <p className="error">{mic.error}</p>}
              <div className="row">
                {!mic.listening
                  ? <button className="secondary" onClick={() => void mic.start()}><Mic size={16} aria-hidden /> Speak</button>
                  : <button className="danger" onClick={() => void mic.stop()}><Square size={14} fill="currentColor" aria-hidden /> Done speaking</button>}
                <button className="primary" disabled={!!busy} onClick={() => void grade()}>{busy === 'grading' ? 'Grading…' : 'Get feedback'}</button>
              </div>
            </>
          )}
          {feedback && (
            <div className="card">
              <div className="score"><b>{feedback.score}</b>/10 <span>{feedback.verdict}</span></div>
              {!!feedback.strengths.length && <><h4>What worked</h4><ul>{feedback.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul></>}
              {!!feedback.improvements.length && <><h4>Improve</h4><ul>{feedback.improvements.map((s, i) => <li key={i}>{s}</li>)}</ul></>}
              {feedback.betterAnswer && <><h4>Stronger answer</h4><Markdown text={feedback.betterAnswer} /></>}
              <div className="row"><button className="ghost" onClick={() => { setFeedback(null); setAnswer(''); }}>Try again</button><button className="primary" onClick={() => void next()}>Next question</button></div>
            </div>
          )}
        </>
      )}
      {err && <p className="error">{err}</p>}
    </section>
  );
}
