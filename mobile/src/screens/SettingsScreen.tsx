import { useState } from 'react';
import type { ProviderId, Settings, SttEngine } from '../lib/settings';
import { PROVIDERS, complete, modelFor } from '../lib/ai';
import { ConnectComputer } from '../components/ConnectComputer';

const STT: { id: SttEngine; label: string; note: string }[] = [
  { id: 'device', label: 'Phone (free)', note: 'Uses your phone\'s own speech recognition. No key needed.' },
  { id: 'deepgram', label: 'Deepgram', note: 'Most accurate live captions. Needs a Deepgram key.' },
  { id: 'groq', label: 'Groq Whisper', note: 'Whisper in 6-second clips. Needs a Groq key.' },
  { id: 'openai', label: 'OpenAI', note: 'OpenAI transcription in 6-second clips. Needs an OpenAI key.' },
];
const LANGS = ['en-US', 'en-GB', 'en-IN', 'en-NG', 'en-AU', 'fr-FR', 'de-DE', 'es-ES', 'pt-BR', 'it-IT', 'nl-NL', 'hi-IN', 'ja-JP', 'zh-CN'];

export function SettingsScreen({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  const [test, setTest] = useState('');
  const [show, setShow] = useState(false);
  const p = settings.provider;
  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch });
  const setKey = (k: keyof Settings['keys'], v: string) => onChange({ ...settings, keys: { ...settings.keys, [k]: v.trim() } });

  const testKey = async () => {
    setTest('Testing…');
    try {
      const out = await complete(settings, { system: 'Reply with exactly: OK', messages: [{ role: 'user', content: 'Say OK.' }], effort: 'low', maxTokens: 300 });
      setTest(out.trim() ? `✓ Works (${modelFor(settings)})` : '✓ Connected, but the reply was empty.');
    } catch (e: any) { setTest(`✗ ${e?.message ?? e}`); }
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
          <select value={modelFor(settings)} onChange={(e) => onChange({ ...settings, models: { ...settings.models, [p]: e.target.value } })}>
            {[...new Set([modelFor(settings), ...PROVIDERS[p].models])].map((m) => <option key={m}>{m}</option>)}
          </select>
        </label>
        <div className="row"><button className="secondary" disabled={!settings.keys[p]} onClick={() => void testKey()}>Test key</button><span className={test.startsWith('✗') ? 'error' : 'muted'}>{test}</span></div>
        <p className="muted small">Keys stay on this phone and are only sent to the provider they belong to.</p>
      </div>

      <div className="card">
        <h3>Listening</h3>
        {STT.map((s) => (
          <label key={s.id} className="radio"><input type="radio" checked={settings.stt === s.id} onChange={() => set({ stt: s.id })} /><span><b>{s.label}</b><br /><small>{s.note}</small></span></label>
        ))}
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
        <label className="toggle"><input type="checkbox" checked={settings.autoAnswer} onChange={(e) => set({ autoAnswer: e.target.checked })} /> Answer automatically when a question is heard</label>
        <div className="chips">
          <button className={settings.answerStyle === 'concise' ? 'chip on' : 'chip'} onClick={() => set({ answerStyle: 'concise' })}>Short bullets</button>
          <button className={settings.answerStyle === 'detailed' ? 'chip on' : 'chip'} onClick={() => set({ answerStyle: 'detailed' })}>Bullets + script</button>
        </div>
      </div>

      <ConnectComputer />

      <div className="card about">
        <h3>About</h3>
        <p>Soro X Mobile — for personal, non-commercial use.</p>
        <p className="small">This project is based on Natively, originally developed by Natively AI Private Limited. Licensed under the Natively Personal Use Source License v1.0.</p>
      </div>
    </section>
  );
}
