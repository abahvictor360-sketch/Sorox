// Settings > Your voice: record a short sample so Soro X recognises you.
import { useEffect, useRef, useState } from 'react';
import { AudioLines, CircleCheck, Mic, Square, Trash2 } from 'lucide-react';
import type { Settings } from '../lib/settings';
import { AudioTap } from '../lib/vad';
import { VoiceMatcher, enrol, loadVoice, saveVoice, voicePrint, type VoiceProfile } from '../lib/voice';

const SAMPLE_SECONDS = 15;
const TEST_SECONDS = 4;
const READ_ALOUD = 'In my last role I led a small team that rebuilt our payments system. We cut failures by half and shipped two weeks early. I enjoy solving hard problems with people who care about the details, and I am looking for a role where I can keep learning.';

async function mic(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This device does not allow microphone recording here.');
  // The same plain sound Live uses when a voice sample is saved (see micConstraints in lib/stt.ts).
  try { return await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 }, video: false }); }
  catch { throw new Error('Microphone access was not allowed. Allow it for Soro X in your phone\'s settings.'); }
}

export function VoiceSetup({ settings }: { settings: Settings }) {
  const [profile, setProfile] = useState<VoiceProfile | null>(loadVoice);
  const [mode, setMode] = useState<'idle' | 'sample' | 'test'>('idle');
  const [left, setLeft] = useState(0);
  const [level, setLevel] = useState(0);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const run = useRef<{ tap: AudioTap; stream: MediaStream; timer: number; finish: () => void } | null>(null);

  useEffect(() => () => { void stopAll(); }, []);

  const stopAll = async () => {
    const r = run.current; run.current = null;
    if (!r) return;
    window.clearInterval(r.timer);
    await r.tap.stop();
    r.stream.getTracks().forEach((t) => t.stop());
  };

  const record = async (kind: 'sample' | 'test') => {
    setMsg(null);
    let stream: MediaStream;
    try { stream = await mic(); } catch (e: any) { setMsg({ text: String(e?.message ?? e), bad: true }); return; }
    const tap = new AudioTap(30, (l) => setLevel((p) => (Math.abs(p - l) > 0.04 ? l : p)));
    await tap.start(stream);
    const seconds = kind === 'sample' ? SAMPLE_SECONDS : TEST_SECONDS;
    const t0 = Date.now();
    setMode(kind); setLeft(seconds);
    const finish = async () => {
      const pcm = tap.all();
      await stopAll();
      setMode('idle'); setLevel(0);
      if (kind === 'sample') {
        const r = enrol(pcm);
        if ('error' in r) { setMsg({ text: r.error, bad: true }); return; }
        saveVoice(r); setProfile(r);
        setMsg({ text: 'Voice saved. Soro X will now recognise when you are the one speaking.' });
      } else {
        const p = voicePrint(pcm);
        if (!p || !profile) { setMsg({ text: 'Not enough speech was heard. Try again, a little louder.', bad: true }); return; }
        const v = new VoiceMatcher(profile).classify(p);
        const pct = Math.round(Math.min(1, v.you / profile.selfScore) * 100);
        setMsg(v.who === 'you'
          ? { text: `That sounds like you (${pct}% match).` }
          : { text: `That did not sound like you (${pct}% match). If it was you, record the sample again in a quieter place.`, bad: true });
      }
    };
    const timer = window.setInterval(() => {
      const l = seconds - Math.floor((Date.now() - t0) / 1000);
      setLeft(Math.max(0, l));
      if (l <= 0) void finish();
    }, 250);
    run.current = { tap, stream, timer, finish: () => void finish() };
  };

  const deviceOnly = settings.stt === 'device';
  return (
    <div className="card">
      <h3><AudioLines size={16} aria-hidden /> Your voice</h3>
      <p className="muted small">Record about {SAMPLE_SECONDS} seconds of your voice once. Soro X then knows when you are the one speaking, so it never answers your own words, and it learns the interviewer's voice as the interview goes. Only a short voice print (numbers) is kept on this phone; the recording is not saved or sent anywhere.</p>
      {deviceOnly && <p className="error small">Voice match needs Offline (Whisper), Deepgram, Groq or OpenAI listening. The phone's own speech recognition does not share the audio.</p>}
      {mode === 'sample' && <blockquote className="read-aloud"><small>Read this out loud, in your normal voice</small>{READ_ALOUD}</blockquote>}
      {mode !== 'idle' ? (
        <div className="row">
          <span className="meter wide" aria-hidden><i style={{ transform: `scaleX(${Math.max(0.04, level)})` }} /></span>
          <span className="muted small">{left}s</span>
          <button className="danger small" onClick={() => run.current?.finish()}><Square size={12} fill="currentColor" aria-hidden /> Done</button>
        </div>
      ) : (
        <div className="row">
          <button className={profile ? 'secondary small' : 'primary'} onClick={() => void record('sample')}><Mic size={15} aria-hidden /> {profile ? 'Record again' : 'Record my voice'}</button>
          {profile && <button className="ghost small" onClick={() => void record('test')}>Test it</button>}
          {profile && <button className="ghost small danger-text" onClick={() => { saveVoice(null); setProfile(null); setMsg({ text: 'Voice sample deleted.' }); }}><Trash2 size={14} aria-hidden /> Delete</button>}
        </div>
      )}
      {profile && mode === 'idle' && !msg && <p className="ok small"><CircleCheck size={14} aria-hidden /> Voice sample saved {new Date(profile.createdAt).toLocaleDateString()}.</p>}
      {msg && <p className={msg.bad ? 'error small' : 'ok small'}>{msg.text}</p>}
    </div>
  );
}
