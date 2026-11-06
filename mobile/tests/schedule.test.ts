import { beforeEach, describe, expect, it } from 'vitest';

// A minimal localStorage for the node test environment.
const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };

const { addAppointment, takeDueAppointment, reminderStatus, loadSchedule } = await import('../src/lib/schedule');
const { relative } = await import('../src/screens/ScheduleScreen');

describe('schedule', () => {
  beforeEach(() => store.clear());

  it('outside the app shell it saves the interview and says reminders need the app', async () => {
    const r = await addAppointment({ title: 'Acme', at: Date.now() + 60_000, mode: 'interview', remindBefore: 10 });
    expect(loadSchedule()).toHaveLength(1);
    expect(r.reminder.state).toBe('browser');
    expect((await reminderStatus()).message).toMatch(/installed app/);
  });

  it('starts an interview once, at its time, and not again after you stop', async () => {
    const t0 = Date.now();
    const { list } = await addAppointment({ title: 'Acme', at: t0 + 5 * 60_000, mode: 'technical', remindBefore: 0 });
    expect(list[0].id % 2).toBe(0); // the early reminder uses id + 1
    expect(takeDueAppointment(t0)).toBeNull(); // 5 min early: not yet
    expect(takeDueAppointment(t0 + 5 * 60_000 - 20_000)?.mode).toBe('technical'); // within 30 s of the start
    expect(takeDueAppointment(t0 + 6 * 60_000)).toBeNull(); // already started once
  });

  it('opening the app during an interview that was not started starts it', async () => {
    const t0 = Date.now();
    await addAppointment({ title: 'Late', at: t0 - 20 * 60_000 + 120_000, mode: 'meeting', remindBefore: 0 });
    expect(takeDueAppointment(t0)?.title).toBe('Late');
    expect(takeDueAppointment(t0 + 100 * 60_000)).toBeNull();
  });

  it('says how far away it is', () => {
    expect(relative(Date.now() + 25 * 60_000)).toBe('in 25 min');
    expect(relative(Date.now() + 125 * 60_000)).toBe('in 2 h 5 min');
    expect(relative(Date.now() - 3 * 60_000)).toBe('started 3 min ago');
  });
});
