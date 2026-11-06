import { useState } from 'react';
import type { Settings } from '../lib/settings';
import { isReady } from '../lib/settings';
import { extractJob, extractResume, fileToText, type Profile } from '../lib/profile';

export function ProfileScreen({ settings, profile, onChange }: { settings: Settings; profile: Profile; onChange: (p: Profile) => void }) {
  const [busy, setBusy] = useState<'' | 'cv' | 'job'>('');
  const [err, setErr] = useState('');
  const [cvDraft, setCvDraft] = useState(profile.resumeText);
  const [jobDraft, setJobDraft] = useState(profile.jobText);

  const readFile = async (f: File | undefined, set: (t: string) => void) => {
    if (!f) return;
    setErr('');
    try { set(await fileToText(f)); } catch (e: any) { setErr(String(e?.message ?? e)); }
  };

  const saveCv = async () => {
    setErr('');
    const text = cvDraft.trim();
    if (!text) { onChange({ ...profile, resumeText: '', resume: null }); return; }
    if (!isReady(settings)) { onChange({ ...profile, resumeText: text, resume: null }); setErr('Saved the text. Add an AI key in Settings so Soro X can read it properly.'); return; }
    setBusy('cv');
    try { onChange({ ...profile, resumeText: text, resume: await extractResume(settings, text) }); }
    catch (e: any) { onChange({ ...profile, resumeText: text, resume: null }); setErr(`Saved the text, but reading it failed: ${e?.message ?? e}`); }
    finally { setBusy(''); }
  };

  const saveJob = async () => {
    setErr('');
    const text = jobDraft.trim();
    if (!text) { onChange({ ...profile, jobText: '', job: null }); return; }
    if (!isReady(settings)) { onChange({ ...profile, jobText: text, job: null }); return; }
    setBusy('job');
    try { onChange({ ...profile, jobText: text, job: await extractJob(settings, text) }); }
    catch (e: any) { onChange({ ...profile, jobText: text, job: null }); setErr(`Saved the text, but reading it failed: ${e?.message ?? e}`); }
    finally { setBusy(''); }
  };

  const r = profile.resume; const j = profile.job;
  return (
    <section>
      {err && <p className="error">{err}</p>}
      <div className="card">
        <h3>Your CV</h3>
        {r && <p className="ok">✓ {r.name || 'CV'} — {r.headline} · {r.experience.length} roles · {r.skills.length} skills</p>}
        <label className="file">Choose PDF / Word / text<input type="file" accept=".pdf,.docx,.txt,.md,application/pdf" onChange={(e) => void readFile(e.target.files?.[0], setCvDraft)} /></label>
        <textarea rows={6} value={cvDraft} onChange={(e) => setCvDraft(e.target.value)} placeholder="…or paste your CV here" />
        <button className="primary" disabled={!!busy || cvDraft.trim() === profile.resumeText.trim() && !!r} onClick={() => void saveCv()}>{busy === 'cv' ? 'Reading your CV…' : 'Save CV'}</button>
      </div>
      <div className="card">
        <h3>The job</h3>
        {j && <p className="ok">✓ {j.title}{j.company ? ` at ${j.company}` : ''} · {j.requirements.length} requirements</p>}
        <label className="file">Choose file<input type="file" accept=".pdf,.docx,.txt,.md,application/pdf" onChange={(e) => void readFile(e.target.files?.[0], setJobDraft)} /></label>
        <textarea rows={6} value={jobDraft} onChange={(e) => setJobDraft(e.target.value)} placeholder="Paste the job description" />
        <button className="primary" disabled={!!busy} onClick={() => void saveJob()}>{busy === 'job' ? 'Reading the job…' : 'Save job'}</button>
      </div>
      <div className="card">
        <h3>Notes for every answer</h3>
        <textarea rows={3} value={profile.notes} onChange={(e) => onChange({ ...profile, notes: e.target.value })} placeholder="e.g. I'm relocating to Berlin in March; target salary €75k; prefer hybrid." />
      </div>
      <button className="ghost danger-text" onClick={() => { if (confirm('Remove your CV, job and notes from this phone?')) { setCvDraft(''); setJobDraft(''); onChange({ resumeText: '', resume: null, jobText: '', job: null, notes: '', updatedAt: '' }); } }}>Remove profile from this phone</button>
    </section>
  );
}
