/**
 * Soro X — live negotiation coaching card, shown in the meeting chat when the
 * interviewer talks pay (engine: premium/electron/knowledge/LiveNegotiationCoach.ts,
 * rendered by src/components/NativelyInterface.tsx through src/premium/index.tsx).
 *
 * Shows the one move to make, the exact words to say, their number against
 * your target, and — after you state a number — a short "stay silent" timer.
 */
import React, { useEffect, useState } from 'react';
import { Copy, Handshake, Timer } from 'lucide-react';

export type NegotiationPhase = 'probing' | 'anchoring' | 'offer' | 'pushback' | 'closing';

export interface NegotiationCoachingCardProps {
    tacticalNote: string;
    exactScript: string;
    showSilenceTimer: boolean;
    phase: NegotiationPhase | string;
    theirOffer: number | null;
    yourTarget: number | null;
    currency: string;
    interfaceTheme?: string;
    isLightTheme?: boolean;
    onSilenceTimerEnd?: () => void;
}

const PHASE_LABEL: Record<string, string> = {
    probing: 'They are asking about pay',
    anchoring: 'Setting the range',
    offer: 'They made an offer',
    pushback: 'They are pushing back',
    closing: 'Closing the deal',
};

export const SILENCE_SECONDS = 6;

export function formatMoney(n: number | null, currency: string): string {
    if (n === null || !Number.isFinite(n)) return '—';
    try {
        if (/^[A-Z]{3}$/.test(currency)) return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
    } catch { /* unknown currency code */ }
    return n.toLocaleString();
}

export const NegotiationCoachingCard: React.FC<NegotiationCoachingCardProps> = ({
    tacticalNote, exactScript, showSilenceTimer, phase, theirOffer, yourTarget, currency, isLightTheme, onSilenceTimerEnd,
}) => {
    const [left, setLeft] = useState(showSilenceTimer ? SILENCE_SECONDS : 0);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (!showSilenceTimer) { setLeft(0); return; }
        setLeft(SILENCE_SECONDS);
        const started = Date.now();
        const id = window.setInterval(() => {
            const remaining = SILENCE_SECONDS - Math.floor((Date.now() - started) / 1000);
            if (remaining <= 0) {
                window.clearInterval(id);
                setLeft(0);
                onSilenceTimerEnd?.();
            } else setLeft(remaining);
        }, 250);
        return () => window.clearInterval(id);
        // onSilenceTimerEnd is a fresh closure on each render; the timer belongs to this card.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showSilenceTimer]);

    const light = !!isLightTheme;
    const c = {
        bg: light ? 'rgba(124, 92, 255, 0.07)' : 'rgba(124, 92, 255, 0.12)',
        border: light ? 'rgba(124, 92, 255, 0.35)' : 'rgba(167, 139, 250, 0.4)',
        text: light ? '#1d1838' : '#eceaff',
        muted: light ? '#5b567a' : '#a39fc9',
        accent: light ? '#5b3fd9' : '#a78bfa',
        quoteBg: light ? 'rgba(255,255,255,0.75)' : 'rgba(15, 13, 36, 0.55)',
    };
    const gap = theirOffer !== null && yourTarget !== null && yourTarget > 0 ? (theirOffer - yourTarget) / yourTarget : null;

    return (
        <div data-testid="negotiation-coaching-card" style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 14, padding: '12px 14px', color: c.text, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14, lineHeight: 1.45 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: c.accent, fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                <Handshake size={14} />
                <span>Negotiation coach · {PHASE_LABEL[phase] ?? phase}</span>
            </div>

            {tacticalNote && <div style={{ fontWeight: 600 }}>{tacticalNote}</div>}

            {exactScript && (
                <div style={{ background: c.quoteBg, borderLeft: `3px solid ${c.accent}`, borderRadius: 8, padding: '8px 10px', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, color: c.muted, marginBottom: 2 }}>Say</div>
                        <div style={{ fontSize: 15 }}>“{exactScript}”</div>
                    </div>
                    <button
                        type="button"
                        title="Copy"
                        onClick={() => { void navigator.clipboard?.writeText(exactScript).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1200); }).catch(() => {}); }}
                        style={{ background: 'none', border: 0, color: c.muted, cursor: 'pointer', padding: 2, fontSize: 11, display: 'flex', alignItems: 'center', gap: 3 }}
                    >
                        <Copy size={13} />{copied ? 'Copied' : ''}
                    </button>
                </div>
            )}

            {(theirOffer !== null || yourTarget !== null) && (
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 13 }}>
                    <span><span style={{ color: c.muted }}>Their number </span><b>{formatMoney(theirOffer, currency)}</b></span>
                    <span><span style={{ color: c.muted }}>Your target </span><b>{formatMoney(yourTarget, currency)}</b></span>
                    {gap !== null && (
                        <span style={{ color: gap >= 0 ? '#16a34a' : c.accent }}>
                            {gap >= 0 ? 'At or above target' : `${Math.round(Math.abs(gap) * 100)}% below target`}
                        </span>
                    )}
                </div>
            )}

            {left > 0 && (
                <div role="timer" style={{ display: 'flex', alignItems: 'center', gap: 8, color: c.accent, fontSize: 13 }}>
                    <Timer size={14} />
                    <span>Stay silent and let them answer… {left}s</span>
                    <div style={{ flex: 1, height: 4, borderRadius: 2, background: c.border, overflow: 'hidden' }}>
                        <div style={{ width: `${(left / SILENCE_SECONDS) * 100}%`, height: '100%', background: c.accent, transition: 'width 0.25s linear' }} />
                    </div>
                </div>
            )}
        </div>
    );
};

export default NegotiationCoachingCard;
