// Upcoming interviews: Soro X reminds you and starts listening on time.
import { useState } from 'react';
import type { ModeId } from '../lib/settings';
import { MODES } from '../lib/interview';
import { addAppointment, loadSchedule, removeAppointment, upcoming, type Appointment } from '../lib/schedule';

const pad = (n: number) => String(n).padStart(2, '0');
const localInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function ScheduleScreen({ onStartNow }: { onStartNow: (mode: ModeId) => void }) {
  const [list, setList] = useState<Appointment[]>(loadSchedule);
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState(() => localInput(new Date(Date.now() + 3600_000)));
  const [mode, setMode] = useState<ModeId>('interview');
  const [remind, setRemind] = useState(15);
  const [err, setErr] = useState('');

  const add = async () => {
    const at = new Date(when).getTime();
    if (!title.trim()) { setErr('Give it a name, e.g. "Acme — final round".'); return; }
    if (!Number.isFinite(at) || at < Date.now() - 60_000) { setErr('Pick a time in the future.'); return; }
    setErr('');
    setList(await addAppointment({ title: title.trim(), at, mode, remindBefore: remind }));
    setTitle('');
  };

  const items = upcoming(list);
  return (
    <section>
      <div className="glass card">
        <h3>Add an interview or meeting</h3>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Acme — final round" />
        <div className="row">
          <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          <select value={remind} onChange={(e) => setRemind(Number(e.target.value))} aria-label="Reminder">
            <option value={0}>No early reminder</option><option value={10}>Remind 10 min before</option><option value={15}>Remind 15 min before</option><option value={30}>Remind 30 min before</option><option value={60}>Remind 1 h before</option>
          </select>
        </div>
        <div className="chips">{MODES.map((m) => <button key={m.id} className={mode === m.id ? 'chip on' : 'chip'} onClick={() => setMode(m.id)}>{m.icon} {m.label}</button>)}</div>
        <button className="primary" onClick={() => void add()}>Add</button>
        {err && <p className="error">{err}</p>}
        <p className="muted small">At the start time a notification appears; tap it and Soro X opens in Live, already listening, in the right mode.</p>
      </div>
      {items.map((a) => {
        const m = MODES.find((x) => x.id === a.mode);
        const soon = a.at - Date.now() < 15 * 60_000;
        return (
          <div key={a.id} className="glass card row">
            <div className="grow"><b>{a.title}</b><br /><span className="muted small">{m?.icon} {m?.label} · {new Date(a.at).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></div>
            {soon && <button className="primary small" onClick={() => onStartNow(a.mode)}>Start now</button>}
            <button className="ghost small" onClick={() => void removeAppointment(a.id).then(setList)}>Remove</button>
          </div>
        );
      })}
      {!items.length && <p className="muted">Nothing scheduled.</p>}
    </section>
  );
}
