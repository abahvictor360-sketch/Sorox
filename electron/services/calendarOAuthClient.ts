// electron/services/calendarOAuthClient.ts
//
// Soro X: which Google OAuth client Calendar sync signs in with.
//
// Natively's builds bake in Natively's own "Desktop app" client secret; Soro X
// builds do not have it, so with Natively's client ID alone every token request
// failed ("client_secret is missing") and Calendar could never connect. Soro X
// therefore uses, in order:
//   1. GOOGLE_CALENDAR_CLIENT_ID + _SECRET from the environment (development),
//   2. the client the user saved in Settings → Calendar (stored encrypted),
//   3. a client baked in at build time (GitHub secrets GOOGLE_CALENDAR_CLIENT_ID
//      / _SECRET, see scripts/build-electron.js) — only when it has a secret.
// Pure functions, so every branch is unit-tested without Electron.

export type CalendarClientSource = 'env' | 'user' | 'built-in';

export interface CalendarOAuthClient {
  id: string;
  secret: string;
  source: CalendarClientSource;
}

export interface CalendarClientInputs {
  env?: Record<string, string | undefined>;
  user?: { id?: string; secret?: string } | null;
  bakedId?: string;
  bakedSecret?: string;
  /** The client ID used when a secret is baked without an ID (Natively's own builds). */
  fallbackId?: string;
}

const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

export function resolveCalendarClient(inputs: CalendarClientInputs): CalendarOAuthClient | null {
  const envId = clean(inputs.env?.GOOGLE_CALENDAR_CLIENT_ID);
  const envSecret = clean(inputs.env?.GOOGLE_CALENDAR_CLIENT_SECRET);
  if (envId && envSecret) return { id: envId, secret: envSecret, source: 'env' };

  const userId = clean(inputs.user?.id);
  const userSecret = clean(inputs.user?.secret);
  if (userId && userSecret) return { id: userId, secret: userSecret, source: 'user' };

  const bakedSecret = clean(inputs.bakedSecret);
  const bakedId = clean(inputs.bakedId) || clean(inputs.fallbackId);
  if (bakedSecret && bakedId) return { id: bakedId, secret: bakedSecret, source: 'built-in' };

  return null;
}

/** null when the pair looks like a Google "Desktop app" OAuth client, else a message for the user. */
export function validateCalendarClient(id: unknown, secret: unknown): string | null {
  const cid = clean(id);
  const sec = clean(secret);
  if (!cid || !sec) return 'Enter both the Client ID and the Client secret.';
  if (!/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(cid)) {
    return 'The Client ID should end in ".apps.googleusercontent.com". Copy it from Google Cloud → APIs & Services → Credentials.';
  }
  if (/\s/.test(sec) || sec.length < 10) {
    return 'That Client secret does not look right. Copy it again from the same OAuth client (it usually starts with "GOCSPX-").';
  }
  return null;
}

/** "1234…apps.googleusercontent.com" — enough to recognise, without echoing the whole ID. */
export function maskClientId(id: string): string {
  const [prefix, ...rest] = id.split('-');
  return rest.length ? `${prefix.slice(0, 4)}…-${rest.join('-').slice(-28)}` : `${id.slice(0, 8)}…`;
}
