// Notes: every listening session is saved here with AI-written notes (summary,
// questions asked, action items), your own notes, the suggested answers and the
// transcript. Like the desktop's meeting history.
import { useEffect, useState } from 'react';
import type { Settings } from '../lib/settings';
import { isReady } from '../lib/settings';
import type { Profile } from '../lib/profile';
import { MODES, writeNotes } from '../lib/interview';
import { deleteSession, loadSessions, sessionToText, sessionTranscript, upsertSession, type Session } from '../lib/sessions';
import { Markdown } from '../components/Markdown';
import { ModeIcon } from '../components/ModeIcon';
import { ArrowLeft, FileText, Share2, Trash2 } from 'lucide-react';

export function NotesScreen({ settings, profile, version }: { settings: Settings; profile: Profile; version: number }) {
  const [list, setList] = useState<Session[]>(() => loadSessions());
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'notes' | 'answers' | 'transcript'>('notes');

  // Reload when Live saves a session.
  useEffect(() => { setList(loadSessions()); }, [version]);

  const open = list.find((s) => s.id === openId) ?? null;
  const update = (s: Session) => { setList(upsertSession(s)); };

  const write = async (s: Session) => {
    setErr(''); setBusy(true);
    const target = { ...s };
    try {
      target.notes = await writeNotes(settings, profile, sessionTranscript(s), s.myNotes, (_d, full) => setList((l) => l.map((x) => (x.id === s.id ? { ...x, notes: full } : x))));
      update(target);
    } catch (e: any) { setErr(String(e?.message ?? e)); }
    finally { setBusy(false); }
  };

  const share = async (s: Session) => {
    const text = sessionToText(s);
    if (navigator.share) { await navigator.share({ title: s.title, text }).catch(() => {}); return; }
    await navigator.clipboard?.writeText(text);
  };

  if (open) {
    const mode = MODES.find((m) => m.id === open.mode);
    return (
      <section>
        <div className="row"><button className="ghost" onClick={() => setOpenId(null)}><ArrowLeft size={16} aria-hidden /> All notes</button><span className="grow" />
          <button className="ghost small" onClick={() => void share(open)}><Share2 size={14} aria-hidden /> Share</button>
          <button className="ghost small danger-text" onClick={() => { if (confirm('Delete this session?')) { setList(deleteSession(open.id)); setOpenId(null); } }}><Trash2 size={14} aria-hidden /> Delete</button>
        </div>
        <input className="title-input" value={open.title} onChange={(e) => update({ ...open, title: e.target.value })} aria-label="Title" />
        <p className="muted small">{mode && <ModeIcon id={mode.id} size={13} />} {mode?.label} · {new Date(open.startedAt).toLocaleString()} · {open.lines.length} lines · {open.answers.length} answers</p>
        <div className="seg-ctl">
          {(['notes', 'answers', 'transcript'] as const).map((t) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{t === 'notes' ? 'Notes' : t === 'answers' ? 'Answers' : 'Transcript'}</button>)}
        </div>
        {err && <p className="error">{err}</p>}
        {tab === 'notes' && (
          <>
            <div className="glass card">
              <div className="row"><h3>AI notes</h3><span className="grow" />
                <button className="secondary small" disabled={busy || !isReady(settings) || !open.lines.length} onClick={() => void write(open)}>{busy ? 'Writing…' : open.notes ? 'Rewrite' : 'Write notes'}</button>
              </div>
              {open.notes ? <Markdown text={open.notes} /> : <p className="muted">{open.lines.length ? 'Notes are written automatically when you stop listening, or tap "Write notes".' : 'Nothing was recorded in this session.'}</p>}
            </div>
            <div className="glass card">
              <h3>My notes</h3>
              <textarea rows={6} value={open.myNotes} onChange={(e) => update({ ...open, myNotes: e.target.value })} placeholder="Anything you want to remember…" />
            </div>
          </>
        )}
        {tab === 'answers' && (open.answers.length ? open.answers.map((a, i) => (
          <div key={i} className="glass card"><div className="q">“{a.question}”</div><Markdown text={a.text} /></div>
        )) : <p className="muted">No answers in this session.</p>)}
        {tab === 'transcript' && (
          <div className="glass card lines static">
            {open.lines.length ? open.lines.map((l, i) => <div key={i} className={`line r-${l.role}`}><span className="who">{l.role === 'them' ? 'Interviewer' : l.role === 'you' ? 'You' : '…'}</span><span className="txt">{l.text}</span></div>) : <p className="muted">Empty.</p>}
          </div>
        )}
      </section>
    );
  }

  const q = query.trim().toLowerCase();
  const shown = q ? list.filter((s) => `${s.title} ${s.notes} ${s.myNotes} ${s.lines.map((l) => l.text).join(' ')}`.toLowerCase().includes(q)) : list;
  return (
    <section>
      <input className="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search notes and transcripts" />
      {!list.length && (
        <div className="glass card center">
          <div className="wicon"><FileText size={24} aria-hidden /></div>
          <b>No notes yet</b>
          <p className="muted">Every time you listen in Live, the conversation is saved here with notes written for you. Add your own with Note while listening.</p>
        </div>
      )}
      <div className="grid">
        {shown.map((s) => {
          const mode = MODES.find((m) => m.id === s.mode);
          const preview = (s.notes || s.myNotes || s.lines.map((l) => l.text).join(' ')).replace(/[#*_>-]/g, '').replace(/\p{Extended_Pictographic}\uFE0F?/gu, '').slice(0, 140);
          return (
            <button key={s.id} className="glass card tile" onClick={() => { setOpenId(s.id); setTab('notes'); }}>
              <b>{s.title}</b>
              <span className="muted small">{mode && <ModeIcon id={mode.id} size={13} />} {mode?.label} · {s.answers.length} answers{s.notes ? ' · notes ready' : ''}</span>
              <span className="preview">{preview || 'Empty session'}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
