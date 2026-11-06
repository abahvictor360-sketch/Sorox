import { useEffect, useRef, useState } from 'react';
import type { Settings } from '../lib/settings';
import type { Profile } from '../lib/profile';
import { PREP_KINDS, generatePrep, type PrepKind } from '../lib/interview';
import { Markdown } from '../components/Markdown';

const KEY = 'sorox.mobile.prep.v1';
type Saved = Partial<Record<PrepKind, { text: string; at: string }>>;
const load = (): Saved => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } };

export function PrepScreen({ settings, profile }: { settings: Settings; profile: Profile }) {
  const [saved, setSaved] = useState<Saved>(load);
  const [open, setOpen] = useState<PrepKind | null>(null);
  const [live, setLive] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);
  const ctl = useRef<AbortController | null>(null);
  useEffect(() => () => ctl.current?.abort(), []);

  const hasJob = !!(profile.job || profile.jobText.trim());
  const run = async (kind: PrepKind) => {
    ctl.current?.abort();
    const c = new AbortController(); ctl.current = c;
    setOpen(kind); setErr(''); setLive(''); setBusy(true);
    try {
      const text = await generatePrep(settings, profile, kind, (_d, full) => setLive(full), c.signal);
      const next = { ...load(), [kind]: { text, at: new Date().toISOString() } };
      localStorage.setItem(KEY, JSON.stringify(next));
      setSaved(next);
    } catch (e: any) {
      if (!c.signal.aborted) setErr(String(e?.message ?? e));
    } finally { if (ctl.current === c) setBusy(false); }
  };

  if (open) {
    const spec = PREP_KINDS.find((k) => k.id === open)!;
    const text = busy ? live : saved[open]?.text ?? live;
    return (
      <section>
        <div className="row"><button className="ghost" onClick={() => { ctl.current?.abort(); setBusy(false); setOpen(null); }}>← Back</button>
          <span className="grow" />
          {!busy && text && <button className="ghost" onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>{copied ? 'Copied' : 'Copy'}</button>}
          {!busy && <button className="secondary" onClick={() => void run(open)}>Regenerate</button>}
        </div>
        <h3>{spec.title}</h3>
        {err && <p className="error">{err}</p>}
        <div className="card">{text ? <Markdown text={text} /> : <p className="muted">Writing…</p>}</div>
      </section>
    );
  }

  return (
    <section>
      <p className="muted">Everything is written from your CV{hasJob ? ' and the job' : ''}. Documents are saved on this phone.</p>
      <div className="grid">
        {PREP_KINDS.map((k) => {
          const blocked = k.needsJob && !hasJob;
          return (
            <button key={k.id} className="card tile" disabled={blocked} onClick={() => (saved[k.id] ? setOpen(k.id) : void run(k.id))}>
              <b>{k.title}</b>
              <span>{blocked ? 'Add the job description in Profile first.' : k.blurb}</span>
              {saved[k.id] && <em>Ready · {new Date(saved[k.id]!.at).toLocaleDateString()}</em>}
            </button>
          );
        })}
      </div>
    </section>
  );
}
