// Soro X: "Use your own Google sign-in" for Calendar sync.
//
// Calendar signs in with a Google OAuth "Desktop app" client. Natively's builds
// carry Natively's client; Soro X builds do not, so the user creates their own
// (free, about five minutes) and pastes its Client ID and secret here. They are
// stored encrypted on this computer (electron/services/CalendarManager.ts).
import React, { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, Check, KeyRound, Loader2 } from 'lucide-react';

type ClientInfo = { configured: boolean; source: 'env' | 'user' | 'built-in' | null; clientId: string | null };

const STEPS: { text: string; link?: { label: string; url: string } }[] = [
  { text: 'Create a Google Cloud project (any name, e.g. "Soro X").', link: { label: 'New project', url: 'https://console.cloud.google.com/projectcreate' } },
  { text: 'Turn on the Google Calendar API for it.', link: { label: 'Calendar API', url: 'https://console.cloud.google.com/apis/library/calendar-json.googleapis.com' } },
  { text: 'Set up the sign-in screen: choose "External", fill in the app name and your email, then under Audience add your own Google account as a test user.', link: { label: 'Sign-in screen', url: 'https://console.cloud.google.com/auth/overview' } },
  { text: 'Create an OAuth client with application type "Desktop app", then copy its Client ID and Client secret.', link: { label: 'Create client', url: 'https://console.cloud.google.com/auth/clients/create' } },
  { text: 'Paste both below, save, then press Connect Google Calendar above.' },
];

const open = (url: string) => { void window.electronAPI?.openExternal?.(url); };

export function CalendarOAuthClientSetup({ onChanged }: { onChanged?: () => void }) {
  const [info, setInfo] = useState<ClientInfo | null>(null);
  const [editing, setEditing] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    const next = await window.electronAPI?.calendarGetOAuthClient?.().catch(() => null);
    setInfo(next ?? { configured: false, source: null, clientId: null });
  }, []);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setBusy(true); setError(null); setSaved(false);
    try {
      const res = await window.electronAPI.calendarSetOAuthClient({ clientId, clientSecret });
      if (!res.success) { setError(res.error ?? 'Could not save the client.'); return; }
      setClientId(''); setClientSecret(''); setEditing(false); setSaved(true);
      await load(); onChanged?.();
    } finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true); setError(null); setSaved(false);
    try { await window.electronAPI.calendarClearOAuthClient(); await load(); onChanged?.(); }
    finally { setBusy(false); }
  };

  if (!info) return null;
  const showForm = !info.configured || editing;
  const sourceLabel = info.source === 'user' ? 'your Google sign-in client'
    : info.source === 'built-in' ? 'the sign-in client built into this version'
    : 'the client from the GOOGLE_CALENDAR_CLIENT_ID environment variable';

  return (
    <section className="cp-oauth" data-testid="calendar-oauth-client">
      <h3 className="cp-label">{info.configured ? 'Google sign-in' : 'Set up Google sign-in (one time)'}</h3>
      {info.configured && !editing ? (
        <div className="cp-oauth-row">
          <KeyRound size={14} />
          <span className="cp-oauth-text">
            Signing in with {sourceLabel}
            {info.clientId && <span className="cp-oauth-id"> · {info.clientId}</span>}
            {saved && <span className="cp-oauth-saved"><Check size={12} /> Saved</span>}
          </span>
          <button type="button" className="cp-pill cp-pill--sm" onClick={() => setEditing(true)} disabled={busy}>
            {info.source === 'user' ? 'Change' : 'Use my own'}
          </button>
          {info.source === 'user' && (
            <button type="button" className="cp-pill cp-pill--sm cp-pill--danger" onClick={remove} disabled={busy}>Remove</button>
          )}
        </div>
      ) : null}

      {showForm && (
        <div className="cp-oauth-box">
          <p className="cp-desc">
            Google Calendar needs a sign-in client of your own. It is free, takes about five minutes, and only you use it.
          </p>
          <ol className="cp-oauth-steps">
            {STEPS.map((step, i) => (
              <li key={i}>
                <span>{step.text}</span>
                {step.link && (
                  <button type="button" className="cp-oauth-link" onClick={() => open(step.link!.url)}>
                    {step.link.label} <ArrowUpRight size={11} />
                  </button>
                )}
              </li>
            ))}
          </ol>
          <label className="cp-oauth-field">
            <span>Client ID</span>
            <input value={clientId} onChange={(e) => setClientId(e.target.value)} spellCheck={false} autoComplete="off"
              placeholder="1234567890-abc….apps.googleusercontent.com" />
          </label>
          <label className="cp-oauth-field">
            <span>Client secret</span>
            <input value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} type="password" spellCheck={false} autoComplete="off"
              placeholder="GOCSPX-…" />
          </label>
          {error && <div className="cp-notice" role="alert"><span>{error}</span></div>}
          <div className="cp-oauth-actions">
            <button type="button" className="cp-pill" onClick={save} disabled={busy || !clientId.trim() || !clientSecret.trim()}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : null} Save
            </button>
            {info.configured && (
              <button type="button" className="cp-pill" onClick={() => { setEditing(false); setError(null); }} disabled={busy}>Cancel</button>
            )}
          </div>
          <p className="cp-oauth-note">
            Stored encrypted on this computer. While your Google project is in "Testing", only the test users you added can sign in,
            and Google asks you to sign in again every 7 days.
          </p>
        </div>
      )}
    </section>
  );
}
