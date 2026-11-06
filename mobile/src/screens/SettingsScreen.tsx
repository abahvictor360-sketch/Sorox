import { useState } from 'react';
import type { ProviderId, Settings, SttEngine } from '../lib/settings';
import { PROVIDERS, complete, liveModelFor, modelFor } from '../lib/ai';
import { MODES } from '../lib/interview';
import { WHISPER_MODELS, downloadedModels, loadWhisper } from '../lib/whisper';
import { ConnectComputer } from '../components/ConnectComputer';
import { ModeIcon } from '../components/ModeIcon';
import { CircleCheck } from 'lucide-react';

const STT: { id: SttEngine; label: string; note: string }[] = [
  { id: 'device', label: 'Phone (free)', note: 'Your phone\'s own speech recognition. No key needed.' },
  { id: 'whisper', label: 'Offline (Whisper on this phone)', note: 'Works without internet after a one-time download. Audio never leaves the phone.' },
  { id: 'deepgram', label: 'Deepgram', note: 'Most accurate live captions, and it tells speakers apart (best for knowing who asked). Needs a Deepgram key.' },
  { id: 'groq', label: 'Groq Whisper', note: 'Cloud Whisper, cut at natural pauses. Needs a Groq key.' },
  { id: 'openai', label: 'OpenAI', note: 'OpenAI transcription, cut at natural pauses. Needs an OpenAI key.' },
];
const LANGS = ['en-US', 'en-GB', 'en-IN', 'en-NG', 'en-AU', 'fr-FR', 'de-DE', 'es-ES', 'pt-BR', 'it-IT', 'nl-NL', 'hi-IN', 'ja-JP', 'zh-CN'];

export function SettingsScreen({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  const [test, setTest] = useState('');
  const [show, setShow] = useState(false);
  const [dl, setDl] = useState<{ model: string; pct: number | null; error?: string } | null>(null);
  const [have, setHave] = useState<string[]>(downloadedModels);
  const [notesMode, setNotesMode] = useState(settings.mode);
  const download = async (model: string) => {
    setDl({ model, pct: null });
    try {
      await loadWhisper(model, (l, t) => setDl({ model, pct: t ? Math.round((l / t) * 100) : null }));
      setHave(downloadedModels()); setDl(null);
    } catch (e: any) { setDl({ model, pct: null, error: String(e?.message ?? e) }); }
  };
  const p = settings.provider;
  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });
  const setKey = (k: keyof Settings['keys'], v: string) => onChange({ ...settings, keys: { ...settings.keys, [k]: v.trim() } });

  const testKey = async () => {
    setTest('Testing…');
    try {
      const out = await complete(settings, { system: 'Reply with exactly: OK', messages: [{ role: 'user', content: 'Say OK.' }], effort: 'low', maxTokens: 300 });
      setTest(out.trim() ? `Works (${modelFor(settings)})` : 'Connected, but the reply was empty.');
    } catch (e: any) { setTest(`Failed: ${e?.message ?? e}`); }
  };

  return (
    <section>
      <div className="card">
        <h3>AI for answers</h3>
        <div className="chips">
          {(Object.keys(PROVIDERS) as ProviderId[]).map((id) => (
            <button key={id} className={p === id ? 'chip on' : 'chip'} onClick={() => { set({ provider: id }); setTest(''); }}>{PROVIDERS[id].label}</button>
          ))}
        </div>
        <label>{PROVIDERS[p].label} API key
          <div className="row">
            <input type={show ? 'text' : 'password'} autoComplete="off" spellCheck={false} value={settings.keys[p] ?? ''} placeholder={PROVIDERS[p].keyHint} onChange={(e) => setKey(p, e.target.value)} />
            <button className="ghost small" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>
          </div>
        </label>
        <a href={PROVIDERS[p].keyUrl} target="_blank" rel="noreferrer" className="link">Get a key →</a>
        <label>Model
          <input list={`models-${p}`} value={settings.models[p] ?? ''} placeholder={PROVIDERS[p].defaultModel} spellCheck={false} autoCapitalize="off"
            onChange={(e) => onChange({ ...settings, models: { ...settings.models, [p]: e.target.value } })} />
          <datalist id={`models-${p}`}>{PROVIDERS[p].models.map((m) => <option key={m} value={m} />)}</datalist>
        </label>
        {(p === 'openrouter' || p === 'nvidia') && <p className="muted small">Type any model id from {p === 'openrouter' ? 'openrouter.ai/models' : 'build.nvidia.com'}. To read questions from photos, pick a model that accepts images.</p>}
        <div className="row"><button className="secondary" disabled={!settings.keys[p]} onClick={() => void testKey()}>Test key</button><span className={test.startsWith('Failed') ? 'error' : test.startsWith('Works') ? 'ok' : 'muted'}>{test.startsWith('Works') && <CircleCheck size={14} aria-hidden />} {test}</span></div>
        <p className="muted small">Keys stay on this phone and are only sent to the provider they belong to.</p>
      </div>

      <div className="card">
        <h3>Listening</h3>
        {STT.map((s) => (
          <label key={s.id} className="radio"><input type="radio" checked={settings.stt === s.id} onChange={() => set({ stt: s.id })} /><span><b>{s.label}</b><br /><small>{s.note}</small></span></label>
        ))}
        {settings.stt === 'whisper' && (
          <div className="sub-card">
            {WHISPER_MODELS.map((m) => (
              <label key={m.id} className="radio"><input type="radio" checked={settings.whisperModel === m.id} onChange={() => set({ whisperModel: m.id })} />
                <span><b>{m.label}</b> <small>{m.size}{have.includes(m.id) ? ' · downloaded' : ''}</small><br /><small>{m.note}</small></span></label>
            ))}
            {have.includes(settings.whisperModel)
              ? <p className="ok small"><CircleCheck size={14} aria-hidden /> Ready offline.</p>
              : <button className="secondary" disabled={!!dl && !dl.error} onClick={() => void download(settings.whisperModel)}>{dl && !dl.error ? `Downloading… ${dl.pct ?? ''}${dl.pct !== null ? '%' : ''}` : 'Download now (Wi-Fi recommended)'}</button>}
            {dl?.error && <p className="error">{dl.error}</p>}
          </div>
        )}
        {settings.stt === 'deepgram' && <label>Deepgram key<input type="password" value={settings.keys.deepgram ?? ''} onChange={(e) => setKey('deepgram', e.target.value)} /></label>}
        {(settings.stt === 'groq' || settings.stt === 'openai') && settings.stt !== p && (
          <label>{settings.stt === 'groq' ? 'Groq' : 'OpenAI'} key<input type="password" value={settings.keys[settings.stt] ?? ''} onChange={(e) => setKey(settings.stt as 'groq' | 'openai', e.target.value)} /></label>
        )}
        <label>Language
          <select value={settings.language} onChange={(e) => set({ language: e.target.value })}>{[...new Set([settings.language, ...LANGS])].map((l) => <option key={l}>{l}</option>)}</select>
        </label>
      </div>

      <div className="card">
        <h3>Answers</h3>
        <label className="toggle"><input type="checkbox" checked={settings.fastAnswers} onChange={(e) => set({ fastAnswers: e.target.checked })} /> <span>Fast answers<br /><small>Live answers, quick actions and the coach use a quicker model. Prep, Practice grading and notes keep {modelFor(settings)}.</small></span></label>
        {settings.fastAnswers && (
          <label>Fast model for {PROVIDERS[p].label}
            <input list={`fast-${p}`} value={settings.fastModels[p] ?? ''} placeholder={PROVIDERS[p].fastModel} spellCheck={false} autoCapitalize="off"
              onChange={(e) => onChange({ ...settings, fastModels: { ...settings.fastModels, [p]: e.target.value } })} />
            <datalist id={`fast-${p}`}>{[PROVIDERS[p].fastModel, ...PROVIDERS[p].models].map((m) => <option key={m} value={m} />)}</datalist>
            <small className="muted">Now using {liveModelFor(settings)}.</small>
          </label>
        )}
        <label className="toggle"><input type="checkbox" checked={settings.autoAnswer} onChange={(e) => set({ autoAnswer: e.target.checked })} /> <span>Answer automatically when the interviewer asks a question<br /><small>Your own words and questions you ask them are skipped.</small></span></label>
        <div className="chips">
          <button className={settings.answerStyle === 'concise' ? 'chip on' : 'chip'} onClick={() => set({ answerStyle: 'concise' })}>Short bullets</button>
          <button className={settings.answerStyle === 'detailed' ? 'chip on' : 'chip'} onClick={() => set({ answerStyle: 'detailed' })}>Bullets + script</button>
        </div>
      </div>

      <div className="card">
        <h3>Automatic start</h3>
        <label className="toggle"><input type="checkbox" checked={settings.autoListen} onChange={(e) => set({ autoListen: e.target.checked })} /> <span>Start listening as soon as Soro X opens</span></label>
        <label className="toggle"><input type="checkbox" checked={settings.standby} onChange={(e) => set({ standby: e.target.checked })} /> <span>…on standby: wait quietly and turn on by itself when the first question is heard<br /><small>Nothing is saved or sent for answers until then. Also available as the Standby button in Live.</small></span></label>
        <label className="toggle"><input type="checkbox" checked={settings.keepAwake} onChange={(e) => set({ keepAwake: e.target.checked })} /> <span>Keep the screen on while listening</span></label>
        <p className="muted small">Add your interviews under Me → Schedule: at the start time a notification opens Soro X and starts listening.</p>
      </div>

      <div className="card">
        <h3>Mode instructions</h3>
        <p className="muted small">Added to every answer in that mode, like the desktop's mode instructions.</p>
        <div className="chips">{MODES.map((m) => <button key={m.id} className={notesMode === m.id ? 'chip on' : 'chip'} onClick={() => setNotesMode(m.id)}><ModeIcon id={m.id} size={14} /> {m.label}</button>)}</div>
        <textarea rows={4} value={settings.modeNotes[notesMode] ?? ''} onChange={(e) => onChange({ ...settings, modeNotes: { ...settings.modeNotes, [notesMode]: e.target.value } })}
          placeholder={notesMode === 'technical' ? 'e.g. I code in Python; mention Big-O; keep answers short.' : 'e.g. Keep answers under 60 seconds; mention my leadership experience.'} />
      </div>

      <ConnectComputer />

      <div className="card about">
        <h3>About</h3>
        <p>Soro X Mobile, for personal and non-commercial use.</p>
        <p className="small">This project is based on Natively, originally developed by Natively AI Private Limited. Licensed under the Natively Personal Use Source License v1.0.</p>
      </div>
    </section>
  );
}
