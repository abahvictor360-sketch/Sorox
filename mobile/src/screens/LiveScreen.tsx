import { useCallback, useEffect, useRef, useState } from 'react';
import type { Settings } from '../lib/settings';
import { isReady } from '../lib/settings';
import type { Profile } from '../lib/profile';
import { answerQuestion, looksLikeQuestion } from '../lib/interview';
import { useTranscriber } from '../lib/useTranscriber';
import { Markdown } from '../components/Markdown';

interface Answer { id: number; question: string; text: string; done: boolean; error?: string }

export function LiveScreen({ settings, profile, active }: { settings: Settings; profile: Profile; active: boolean }) {
  const [segments, setSegments] = useState<string[]>([]);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [typed, setTyped] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const segRef = useRef<string[]>([]);
  segRef.current = segments;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const ask = useCallback(async (question: string) => {
    const q = question.trim();
    if (!q) return;
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    const id = Date.now();
    const context = segRef.current.slice(-8).filter((s) => s !== q).join('\n');
    setAnswers((a) => [{ id, question: q, text: '', done: false }, ...a].slice(0, 20));
    const patch = (p: Partial<Answer>) => setAnswers((a) => a.map((x) => (x.id === id ? { ...x, ...p } : x)));
    try {
      await answerQuestion(settingsRef.current, profile, q, context, (_d, full) => patch({ text: full }), ctl.signal);
      patch({ done: true });
    } catch (e: any) {
      if (e?.name === 'AbortError' || ctl.signal.aborted) patch({ done: true });
      else patch({ done: true, error: String(e?.message ?? e) });
    }
  }, [profile]);

  const onFinal = useCallback((text: string) => {
    setSegments((s) => [...s, text].slice(-60));
    if (settingsRef.current.autoAnswer && isReady(settingsRef.current) && looksLikeQuestion(text)) void ask(text);
  }, [ask]);

  const { listening, interim, error, start, stop } = useTranscriber(settings, onFinal);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [segments, interim]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const current = answers[0];
  return (
    <section className="live">
      <div className="row">
        {!listening
          ? <button className="primary big" onClick={() => void start()}>● Start listening</button>
          : <button className="danger big" onClick={() => void stop()}>■ Stop</button>}
        <button className="ghost" onClick={() => { setSegments([]); setAnswers([]); abortRef.current?.abort(); }}>Clear</button>
      </div>
      {error && <p className="error">{error}</p>}
      {!listening && !segments.length && active && (
        <p className="hint">Put the phone near the speaker (or on speakerphone). Soro X writes down what it hears, spots the interviewer's questions{settings.autoAnswer ? ' and drafts an answer from your CV' : ' — tap one to get an answer'}.</p>
      )}

      {current && (
        <div className="card answer">
          <div className="q">“{current.question}”</div>
          {current.error ? <p className="error">{current.error}</p> : current.text ? <Markdown text={current.text} /> : <p className="muted">Thinking…</p>}
          {!current.done && <button className="ghost small" onClick={() => abortRef.current?.abort()}>Stop answer</button>}
        </div>
      )}

      <div className="transcript" ref={listRef}>
        {segments.map((s, i) => {
          const q = looksLikeQuestion(s);
          return (
            <button key={i} className={`seg ${q ? 'question' : ''}`} onClick={() => void ask(s)} title="Answer this">
              {q && <span className="tag">Q</span>}{s}
            </button>
          );
        })}
        {interim && <div className="seg interim">{interim}</div>}
        {listening && !interim && !segments.length && <div className="seg interim">Listening…</div>}
      </div>

      <form className="row ask" onSubmit={(e) => { e.preventDefault(); void ask(typed); setTyped(''); }}>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type or paste a question…" />
        <button className="primary" disabled={!typed.trim()}>Answer</button>
      </form>

      {answers.length > 1 && (
        <details className="history">
          <summary>Earlier answers ({answers.length - 1})</summary>
          {answers.slice(1).map((a) => (
            <div key={a.id} className="card">
              <div className="q">“{a.question}”</div>
              {a.error ? <p className="error">{a.error}</p> : <Markdown text={a.text} />}
            </div>
          ))}
        </details>
      )}
    </section>
  );
}
