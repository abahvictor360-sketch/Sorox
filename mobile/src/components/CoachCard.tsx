// The negotiation coach card (same content as the desktop's).
import { useEffect, useState } from 'react';
import { Handshake, Timer } from 'lucide-react';
import { iconize, noEmDash } from './Markdown';
import type { Coaching } from '../lib/negotiation';

const PHASE: Record<string, string> = {
  probing: 'They are asking about pay', anchoring: 'Setting the range', offer: 'They made an offer', pushback: 'They are pushing back', closing: 'Closing the deal',
};
const SILENCE = 6;

export function money(n: number | null, cur: string) {
  if (n === null) return 'Not yet';
  try { if (/^[A-Z]{3}$/.test(cur)) return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, maximumFractionDigits: 0 }).format(n); } catch { /* unknown code */ }
  return n.toLocaleString();
}

export function CoachCard({ c }: { c: Coaching }) {
  const [left, setLeft] = useState(c.showSilenceTimer ? SILENCE : 0);
  useEffect(() => {
    if (!c.showSilenceTimer) return;
    const t0 = Date.now();
    const id = window.setInterval(() => {
      const l = SILENCE - Math.floor((Date.now() - t0) / 1000);
      setLeft(Math.max(0, l));
      if (l <= 0) window.clearInterval(id);
    }, 250);
    return () => window.clearInterval(id);
  }, [c.showSilenceTimer]);
  const gap = c.theirOffer !== null && c.yourTarget ? (c.theirOffer - c.yourTarget) / c.yourTarget : null;
  return (
    <div className="glass coach">
      <div className="coach-head"><Handshake size={14} aria-hidden /> Negotiation coach · {PHASE[c.phase] ?? c.phase}</div>
      {c.tacticalNote && <b>{iconize(noEmDash(c.tacticalNote), 'tn')}</b>}
      {c.exactScript && <blockquote><small>Say</small>“{iconize(noEmDash(c.exactScript), 'es')}”</blockquote>}
      {(c.theirOffer !== null || c.yourTarget !== null) && (
        <div className="coach-nums">
          <span>Their number <b>{money(c.theirOffer, c.currency)}</b></span>
          <span>Your target <b>{money(c.yourTarget, c.currency)}</b></span>
          {gap !== null && <span className={gap >= 0 ? 'ok' : 'warn'}>{gap >= 0 ? 'At or above target' : `${Math.round(-gap * 100)}% below target`}</span>}
        </div>
      )}
      {left > 0 && <div className="silence"><Timer size={14} aria-hidden /> Stay silent and let them answer… {left}s<i style={{ width: `${(left / SILENCE) * 100}%` }} /></div>}
    </div>
  );
}
