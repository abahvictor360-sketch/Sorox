// Soro X Mobile: upcoming interviews and meetings. At the start time a
// notification appears; tapping it opens Soro X straight into Live and starts
// listening, so the first question is never missed.
import { Capacitor } from '@capacitor/core';
import type { ModeId } from './settings';

export interface Appointment {
  id: number;
  title: string;
  at: number;
  mode: ModeId;
  /** Minutes before the start for an extra heads-up (0 = none). */
  remindBefore: number;
}

const KEY = 'sorox.mobile.schedule.v1';

export function loadSchedule(): Appointment[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

function save(list: Appointment[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* full */ }
}

/** Upcoming (and up to 2 h past) appointments, soonest first. */
export function upcoming(list: Appointment[], now = Date.now()): Appointment[] {
  return list.filter((a) => a.at > now - 2 * 3600_000).sort((a, b) => a.at - b.at);
}

/** The appointment happening now (from 10 min before to 90 min after its start). */
export function current(list: Appointment[], now = Date.now()): Appointment | null {
  return list.find((a) => now >= a.at - 10 * 60_000 && now <= a.at + 90 * 60_000) ?? null;
}

async function plugin() {
  if (!Capacitor.isNativePlatform()) return null;
  return (await import('@capacitor/local-notifications')).LocalNotifications;
}

export async function addAppointment(a: Omit<Appointment, 'id'>): Promise<Appointment[]> {
  const item: Appointment = { ...a, id: Math.floor(Date.now() % 1_000_000_000) };
  const list = [...loadSchedule(), item];
  save(list);
  const LN = await plugin();
  if (LN) {
    const perm = await LN.requestPermissions().catch(() => ({ display: 'denied' }));
    if (perm.display === 'granted') {
      const notes = [{
        id: item.id, title: `${item.title} is starting`, body: 'Tap to open Soro X and start listening.',
        schedule: { at: new Date(item.at), allowWhileIdle: true }, extra: { autoListen: true, mode: item.mode },
      }];
      if (item.remindBefore > 0 && item.at - item.remindBefore * 60_000 > Date.now()) {
        notes.push({
          id: item.id + 1, title: `${item.title} in ${item.remindBefore} min`, body: 'Open Soro X to review your prep.',
          schedule: { at: new Date(item.at - item.remindBefore * 60_000), allowWhileIdle: true }, extra: { autoListen: false, mode: item.mode },
        });
      }
      await LN.schedule({ notifications: notes }).catch(() => {});
    }
  }
  return list;
}

export async function removeAppointment(id: number): Promise<Appointment[]> {
  const list = loadSchedule().filter((a) => a.id !== id);
  save(list);
  const LN = await plugin();
  await LN?.cancel({ notifications: [{ id }, { id: id + 1 }] }).catch(() => {});
  return list;
}

/** Calls back when the user taps a "starting now" notification. */
export async function onAppointmentOpened(cb: (mode: ModeId, autoListen: boolean) => void): Promise<() => void> {
  const LN = await plugin();
  if (!LN) return () => {};
  const h = await LN.addListener('localNotificationActionPerformed', (e: any) => {
    const extra = e?.notification?.extra ?? {};
    cb(extra.mode ?? 'interview', extra.autoListen !== false);
  });
  return () => { void h.remove(); };
}

/** Keep the screen on while listening (no-op on the web). */
export async function keepAwake(on: boolean) {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { KeepAwake } = await import('@capacitor-community/keep-awake');
    await (on ? KeepAwake.keepAwake() : KeepAwake.allowSleep());
  } catch { /* plugin missing */ }
}
