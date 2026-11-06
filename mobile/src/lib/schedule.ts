// Soro X Mobile: upcoming interviews and meetings.
//
// At the start time Soro X turns itself on in two ways:
//   - while the app is open, it starts listening on its own (no notification needed);
//   - otherwise a notification appears; tapping it opens Soro X in Live, listening.
// Every step reports what happened, so a reminder that cannot fire (notifications
// turned off, exact alarms not allowed, running in a browser) is shown to the
// user instead of failing silently.
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

/**
 * Whether reminders will reach the user:
 *   on       notifications allowed, exact timing allowed
 *   late     notifications allowed, but Android may deliver them a few minutes late
 *   off      notifications are turned off for Soro X
 *   browser  not the installed app (no notifications); in-app start still works
 *   error    something else went wrong (message says what)
 */
export type ReminderState = 'on' | 'late' | 'off' | 'browser' | 'error';
export interface ReminderCheck { state: ReminderState; message: string }

const KEY = 'sorox.mobile.schedule.v1';
const STARTED_KEY = 'sorox.mobile.schedule.started.v1';
const CHANNEL = 'sorox-interviews';

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

// ── Starting on its own (once per appointment) ──

function startedIds(): number[] {
  try { const v = JSON.parse(localStorage.getItem(STARTED_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

/**
 * The appointment Soro X should start listening for now, if any: one that has
 * begun (or begins within 30 s) and was not started before. Marks it started,
 * so stopping Live during the interview does not make it start again.
 */
export function takeDueAppointment(now = Date.now()): Appointment | null {
  const done = startedIds();
  const due = loadSchedule().find((a) => now >= a.at - 30_000 && now <= a.at + 90 * 60_000 && !done.includes(a.id)) ?? null;
  if (due) {
    try { localStorage.setItem(STARTED_KEY, JSON.stringify([...done, due.id].slice(-50))); } catch { /* ignore */ }
  }
  return due;
}

// ── Notifications ──

async function plugin() {
  if (!Capacitor.isNativePlatform()) return null;
  return (await import('@capacitor/local-notifications')).LocalNotifications;
}

let channelReady: Promise<void> | null = null;
function ensureChannel(LN: any): Promise<void> {
  // A high-importance channel, so the "starting now" reminder pops up on screen.
  if (Capacitor.getPlatform() !== 'android') return Promise.resolve();
  channelReady ??= LN.createChannel({
    id: CHANNEL, name: 'Interview reminders', description: 'When a scheduled interview or meeting starts',
    importance: 5, visibility: 1, vibration: true,
  }).catch(() => {});
  return channelReady!;
}

/** What will happen at the start time, without asking for anything. */
export async function reminderStatus(): Promise<ReminderCheck> {
  const LN = await plugin();
  if (!LN) return { state: 'browser', message: 'Reminders only work in the installed app. While Soro X is open it still starts listening on time.' };
  try {
    const p = await LN.checkPermissions();
    if (p.display !== 'granted') return { state: 'off', message: 'Notifications are off for Soro X, so no reminder can appear. Tap "Allow reminders".' };
    if (Capacitor.getPlatform() === 'android') {
      const exact = await LN.checkExactNotificationSetting().catch(() => ({ exact_alarm: 'granted' as const }));
      if ((exact as any).exact_alarm !== 'granted') return { state: 'late', message: 'Reminders are on, but Android may show them a few minutes late. Tap "Exact timing" to allow alarms for Soro X.' };
    }
    return { state: 'on', message: 'Reminders are on. At the start time a notification opens Soro X, already listening.' };
  } catch (e: any) {
    return { state: 'error', message: `Could not check reminders: ${e?.message ?? e}` };
  }
}

/** Ask for notification permission (and, on Android, point to exact alarms). */
export async function allowReminders(): Promise<ReminderCheck> {
  const LN = await plugin();
  if (!LN) return reminderStatus();
  try {
    const p = await LN.requestPermissions();
    if (p.display !== 'granted') {
      return { state: 'off', message: 'Notifications are still off. Turn them on in Android Settings > Apps > Soro X > Notifications, then come back.' };
    }
    await rescheduleAll();
  } catch (e: any) {
    return { state: 'error', message: `Could not turn on reminders: ${e?.message ?? e}` };
  }
  return reminderStatus();
}

/** Opens Android's "Alarms & reminders" setting for Soro X. */
export async function allowExactTiming(): Promise<ReminderCheck> {
  const LN = await plugin();
  if (!LN) return reminderStatus();
  await LN.changeExactNotificationSetting().catch(() => {});
  await rescheduleAll();
  return reminderStatus();
}

function notificationsFor(item: Appointment, exact: boolean, now = Date.now()) {
  const common = { channelId: CHANNEL, foreground: true, isExactNotification: exact, smallIcon: 'ic_stat_sorox' };
  const notes: any[] = [];
  if (item.at > now) {
    notes.push({
      ...common, id: item.id, title: `${item.title} is starting`, body: 'Tap to open Soro X. It starts listening straight away.',
      schedule: { at: new Date(item.at), allowWhileIdle: true }, extra: { autoListen: true, mode: item.mode, appointment: item.id },
    });
  }
  if (item.remindBefore > 0 && item.at - item.remindBefore * 60_000 > now) {
    notes.push({
      ...common, id: item.id + 1, title: `${item.title} in ${item.remindBefore} min`, body: 'Open Soro X to look over your prep.',
      schedule: { at: new Date(item.at - item.remindBefore * 60_000), allowWhileIdle: true }, extra: { autoListen: false, mode: item.mode, appointment: item.id },
    });
  }
  return notes;
}

async function scheduleFor(LN: any, items: Appointment[]): Promise<ReminderCheck> {
  const status = await reminderStatus();
  if (status.state === 'off' || status.state === 'browser' || status.state === 'error') return status;
  await ensureChannel(LN);
  // Never jump to the settings screen in the middle of adding an interview:
  // without the exact-alarm permission, schedule an inexact reminder and say so.
  const notifications = items.flatMap((i) => notificationsFor(i, status.state === 'on'));
  if (!notifications.length) return status;
  try {
    await LN.cancel({ notifications: notifications.map((n) => ({ id: n.id })) }).catch(() => {});
    await LN.schedule({ notifications });
    return status;
  } catch (e: any) {
    return { state: 'error', message: `The reminder could not be set: ${e?.message ?? e}` };
  }
}

/** Set the reminders for every upcoming appointment again (after a permission change). */
export async function rescheduleAll(): Promise<ReminderCheck> {
  const LN = await plugin();
  if (!LN) return reminderStatus();
  return scheduleFor(LN, upcoming(loadSchedule()).filter((a) => a.at > Date.now()));
}

export async function addAppointment(a: Omit<Appointment, 'id'>): Promise<{ list: Appointment[]; reminder: ReminderCheck }> {
  const item: Appointment = { ...a, id: 2 * Math.floor((Date.now() % 1_000_000_000) / 2) };
  const list = [...loadSchedule(), item];
  save(list);
  const LN = await plugin();
  const reminder = LN ? await scheduleFor(LN, [item]) : await reminderStatus();
  return { list, reminder };
}

export async function removeAppointment(id: number): Promise<Appointment[]> {
  const list = loadSchedule().filter((a) => a.id !== id);
  save(list);
  const LN = await plugin();
  await LN?.cancel({ notifications: [{ id }, { id: id + 1 }] }).catch(() => {});
  return list;
}

/** A reminder in 10 seconds, to check notifications work on this phone. */
export async function testReminder(): Promise<ReminderCheck> {
  const LN = await plugin();
  if (!LN) return reminderStatus();
  const status = await reminderStatus();
  if (status.state === 'off' || status.state === 'error') return status;
  await ensureChannel(LN);
  try {
    await LN.schedule({ notifications: [{
      id: 999_999_001, channelId: CHANNEL, foreground: true, isExactNotification: status.state === 'on', smallIcon: 'ic_stat_sorox',
      title: 'Soro X reminder test', body: 'Reminders work on this phone.',
      schedule: { at: new Date(Date.now() + 10_000), allowWhileIdle: true }, extra: { autoListen: false, mode: 'interview', test: true },
    }] });
    return { state: status.state, message: 'A test reminder will appear in about 10 seconds. You can leave the app to see it.' };
  } catch (e: any) {
    return { state: 'error', message: `The test reminder could not be set: ${e?.message ?? e}` };
  }
}

/** Calls back when the user taps a reminder. */
export async function onAppointmentOpened(cb: (mode: ModeId, autoListen: boolean, appointmentId?: number) => void): Promise<() => void> {
  const LN = await plugin();
  if (!LN) return () => {};
  const h = await LN.addListener('localNotificationActionPerformed', (e: any) => {
    const extra = e?.notification?.extra ?? {};
    cb(extra.mode ?? 'interview', extra.autoListen === true, typeof extra.appointment === 'number' ? extra.appointment : undefined);
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
