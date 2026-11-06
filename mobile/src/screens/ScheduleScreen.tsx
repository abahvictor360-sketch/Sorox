// Upcoming interviews: Soro X reminds you and starts listening on time.
import { useEffect, useState } from 'react';
import { Bell, BellOff, CircleCheck, Clock, Mic, TriangleAlert } from 'lucide-react';
import type { ModeId } from '../lib/settings';
import { MODES } from '../lib/interview';
import { ModeIcon } from '../components/ModeIcon';
import {
  addAppointment, allowExactTiming, allowReminders, loadSchedule, reminderStatus, removeAppointment, testReminder, upcoming,
  type Appointment, type ReminderCheck,
} from '../lib/schedule';

const pad = (n: number) => String(n).padStart(2, '0');
const localInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** "in 25 min", "in 2 h 5 min", "started 3 min ago" */
export function relative(at: number, now = Date.now()): string {
  const m = Math.round((at - now) / 60_000);
  if (Math.abs(m) < 1) return 'now';
  const abs = Math.abs(m);
  const text = abs < 60 ? `${abs} min` : `${Math.floor(abs / 60)} h${abs % 60 ? ` ${abs % 60} min` : ''}`;
  return m > 0 ? `in ${text}` : `started ${text} ago`;
}

export function ScheduleScreen({ onStartNow }: { onStartNow: (mode: ModeId) => void }) {
  const [list, setList] = useState<Appointment[]>(loadSchedule);
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState(() => localInput(new Date(Date.now() + 3600_000)));
  const [mode, setMode] = useState<ModeId>('interview');
  const [remind, setRemind] = useState(15);
  const [err, setErr] = useState('');
  const [status, setStatus] = useState<ReminderCheck | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => { void reminderStatus().then(setStatus); }, []);
  // Re-check when coming back from Android settings, and keep "in 5 min" fresh.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') void reminderStatus().then(setStatus); };
    document.addEventListener('visibilitychange', onVis);
    const t = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => { document.removeEventListener('visibilitychange', onVis); window.clearInterval(t); };
  }, []);

  const add = async () => {
    const at = new Date(when).getTime();
    if (!title.trim()) { setErr('Give it a name, for example "Acme final round".'); return; }
    if (!Number.isFinite(at)) { setErr('Pick a date and time.'); return; }
    if (at < Date.now() - 60_000) { setErr('That time has passed. Pick a time in the future.'); return; }
    setErr(''); setBusy(true);
    const r = await addAppointment({ title: title.trim(), at, mode, remindBefore: remind });
    setBusy(false);
    setList(r.list); setStatus(r.reminder);
    setNote(r.reminder.state === 'on' || r.reminder.state === 'late'
      ? `Added. Reminder set for ${new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}${remind ? `, plus one ${remind} min before` : ''}.`
      : 'Added. Soro X will start listening at that time if the app is open.');
    setTitle('');
  };

  const run = async (f: () => Promise<ReminderCheck>) => { setBusy(true); const s = await f(); setStatus(s); setNote(s.message); setBusy(false); };

  const items = upcoming(list);
  const StateIcon = !status ? Clock : status.state === 'on' ? CircleCheck : status.state === 'off' ? BellOff : TriangleAlert;
  return (
    <section>
      {status && (
        <div className={`glass card status-card s-${status.state}`}>
          <div className="row"><StateIcon size={18} aria-hidden /><b className="grow">{
            { on: 'Reminders are on', late: 'Reminders may be late', off: 'Reminders are off', browser: 'Reminders need the app', error: 'Reminders have a problem' }[status.state]
          }</b></div>
          <p className="muted small">{status.message}</p>
          <div className="row">
            {status.state === 'off' && <button className="primary small" disabled={busy} onClick={() => void run(allowReminders)}><Bell size={14} aria-hidden /> Allow reminders</button>}
            {status.state === 'late' && <button className="secondary small" disabled={busy} onClick={() => void run(allowExactTiming)}><Clock size={14} aria-hidden /> Exact timing</button>}
            {status.state !== 'browser' && <button className="ghost small" disabled={busy} onClick={() => void run(testReminder)}>Send a test reminder</button>}
          </div>
        </div>
      )}

      <div className="glass card">
        <h3>Add an interview or meeting</h3>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Acme final round" aria-label="Name" />
        <div className="row">
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Date and time" />
          <select value={remind} onChange={(e) => setRemind(Number(e.target.value))} aria-label="Early reminder">
            <option value={0}>No early reminder</option><option value={10}>Remind 10 min before</option><option value={15}>Remind 15 min before</option><option value={30}>Remind 30 min before</option><option value={60}>Remind 1 h before</option>
          </select>
        </div>
        <div className="chips">{MODES.map((m) => <button key={m.id} className={mode === m.id ? 'chip on' : 'chip'} onClick={() => setMode(m.id)}><ModeIcon id={m.id} size={14} /> {m.label}</button>)}</div>
        <button className="primary" disabled={busy} onClick={() => void add()}>Add</button>
        {err && <p className="error">{err}</p>}
        {note && !err && <p className="ok small">{note}</p>}
        <p className="muted small">At the start time Soro X starts listening by itself if it is open. If it is not, the reminder opens it, already listening, in the right mode.</p>
      </div>

      {items.map((a) => {
        const m = MODES.find((x) => x.id === a.mode);
        const soon = a.at - Date.now() < 15 * 60_000;
        return (
          <div key={a.id} className="glass card row">
            <div className="grow"><b>{a.title}</b><br /><span className="muted small">{m && <ModeIcon id={m.id} size={13} />} {m?.label} · {new Date(a.at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {relative(a.at)}</span></div>
            {soon && <button className="primary small" onClick={() => onStartNow(a.mode)}><Mic size={14} aria-hidden /> Start now</button>}
            <button className="ghost small" onClick={() => void removeAppointment(a.id).then(setList)}>Remove</button>
          </div>
        );
      })}
      {!items.length && <p className="muted">Nothing scheduled.</p>}
    </section>
  );
}
