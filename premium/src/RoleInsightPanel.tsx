/**
 * Soro X — Role Insight panel (Profile Intelligence → Role Insight).
 *
 * Shows how the résumé fits the job description (backend:
 * premium/electron/knowledge/roleInsight/RoleInsightService.ts) and, below it,
 * a salary negotiation script. Rendered inside the Profile Intelligence
 * screen, so it uses that screen's --pi-* theme variables.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleDashed, Loader2, RefreshCw, XCircle } from 'lucide-react';

type Status = {
    available?: boolean;
    hasResume?: boolean;
    hasJobDescription?: boolean;
    hasAnalysis?: boolean;
    analysing?: boolean;
    stage?: string | null;
    outdated?: boolean;
    jdTitle?: string;
    jdCompany?: string;
};

type Requirement = { id: string; requirement: string; priority: 'must' | 'nice'; status: 'strong' | 'partial' | 'gap'; evidence: string; suggestion: string; corrected?: boolean };
type Report = {
    id: string; created_at: string; jd_title: string; jd_company: string; fit_score: number; verdict: string; summary: string;
    requirements: Requirement[]; strengths: string[]; gaps: string[]; talking_points: string[];
    likely_questions: { question: string; why: string; answer_hint: string }[]; outdated?: boolean;
};
type Script = { summary: string; target_range: string; opening_script: string; counter_scripts: { situation: string; say: string }[]; leverage_points: string[]; walk_away: string };

const api = () => (window as any).electronAPI;

const card: React.CSSProperties = { border: '1px solid var(--pi-border)', borderRadius: 'var(--pi-r-md, 10px)', padding: '12px 14px', background: 'rgba(255,255,255,0.015)' };
const label: React.CSSProperties = { fontSize: 11, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--pi-tertiary)', margin: '18px 0 8px' };
const btn: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--pi-border)', background: 'transparent', color: 'var(--pi-primary)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' };
const STATUS_STYLE = {
    strong: { color: '#22c55e', Icon: CheckCircle2, text: 'Strong' },
    partial: { color: '#f59e0b', Icon: CircleDashed, text: 'Partial' },
    gap: { color: '#ef4444', Icon: XCircle, text: 'Gap' },
} as const;
const STAGES: Record<string, string> = { matching: 'Comparing your résumé with the job…', writing: 'Writing the report…' };

export function RoleInsightPanel({ hasAccess, onNeedUpgrade, onGoToProfile }: {
    hasAccess: boolean;
    onNeedUpgrade?: () => void;
    onGoToProfile?: () => void;
}) {
    const [status, setStatus] = useState<Status | null>(null);
    const [report, setReport] = useState<Report | null>(null);
    const [busy, setBusy] = useState(false);
    const [stage, setStage] = useState<string | null>(null);
    const [error, setError] = useState('');
    const [pasteText, setPasteText] = useState('');
    const [jobUrl, setJobUrl] = useState('');
    const [script, setScript] = useState<Script | null>(null);
    const [scriptBusy, setScriptBusy] = useState(false);
    // "I have this": inline evidence box (Electron has no window.prompt).
    const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

    const load = useCallback(async () => {
        const st: Status = await api()?.roleInsightGetStatus?.().catch(() => null);
        setStatus(st);
        if (st?.hasAnalysis) {
            const r = await api()?.roleInsightGetReport?.().catch(() => null);
            if (r?.success) setReport(r.report ?? null);
        }
    }, []);

    useEffect(() => {
        void load();
        const off = api()?.onRoleInsightProgress?.((p: { stage: string | null }) => setStage(p?.stage ?? null));
        return () => { off?.(); };
    }, [load]);

    const analyse = async () => {
        if (!hasAccess) { onNeedUpgrade?.(); return; }
        setBusy(true); setError('');
        try {
            const r = await api()?.roleInsightAnalyse?.({});
            if (r?.success) setReport(r.report);
            else if (!r?.cancelled) setError(r?.error || 'The analysis could not be completed.');
        } finally {
            setBusy(false); setStage(null); void load();
        }
    };

    const addJob = async (kind: 'paste' | 'url') => {
        setBusy(true); setError('');
        try {
            const r = kind === 'paste' ? await api()?.roleInsightPasteJd?.(pasteText) : await api()?.roleInsightImportJdUrl?.(jobUrl.trim());
            if (r?.success) { setPasteText(''); setJobUrl(''); } else setError(r?.error || 'Could not add the job description.');
        } finally {
            setBusy(false); void load();
        }
    };

    const saveHave = async () => {
        if (!editing?.text.trim() || !report) return;
        const r = await api()?.roleInsightApplyCorrection?.({ analysisId: report.id, requirementId: editing.id, kind: 'i_have_this', evidenceText: editing.text.trim() });
        if (r?.success && r.report) { setReport(r.report); setEditing(null); }
        else setError(r?.error || 'Could not save that.');
    };

    const makeScript = async (force: boolean) => {
        if (!hasAccess) { onNeedUpgrade?.(); return; }
        setScriptBusy(true); setError('');
        try {
            const r = await api()?.profileGenerateNegotiation?.(force);
            if (r?.success) setScript(r.script); else setError(r?.error || 'Could not write the negotiation script.');
        } finally { setScriptBusy(false); }
    };

    if (!status) return <div aria-busy="true" style={{ padding: 20 }} />;

    // ── Prerequisites ───────────────────────────────────────────────────
    if (!status.hasResume) {
        return (
            <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>Upload your résumé first</div>
                <div style={{ fontSize: 12, color: 'var(--pi-secondary)' }}>Role Insight compares your résumé with a job description.</div>
                {onGoToProfile && <button type="button" style={btn} onClick={onGoToProfile}>Go to résumé upload</button>}
            </div>
        );
    }

    const jobInput = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <textarea value={pasteText} onChange={(e) => setPasteText(e.target.value)} rows={6}
                placeholder="Paste the full job description here"
                style={{ width: '100%', resize: 'vertical', borderRadius: 8, border: '1px solid var(--pi-border)', background: 'transparent', color: 'var(--pi-primary)', padding: 10, fontSize: 12, fontFamily: 'inherit' }} />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" style={btn} disabled={busy || pasteText.trim().length < 200} onClick={() => addJob('paste')}>Use pasted job</button>
                <input value={jobUrl} onChange={(e) => setJobUrl(e.target.value)} placeholder="…or a job posting URL (needs a Tavily key)"
                    style={{ flex: 1, minWidth: 180, borderRadius: 8, border: '1px solid var(--pi-border)', background: 'transparent', color: 'var(--pi-primary)', padding: '6px 10px', fontSize: 12, fontFamily: 'inherit' }} />
                <button type="button" style={btn} disabled={busy || !/^https?:\/\//i.test(jobUrl.trim())} onClick={() => addJob('url')}>Import</button>
            </div>
        </div>
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', fontSize: 13, color: 'var(--pi-primary)' }} data-testid="sorox-role-insight">
            {/* ── Header / action ───────────────────────────────────────── */}
            <div style={{ ...card, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>
                        {status.hasJobDescription ? `${status.jdTitle || 'Job'}${status.jdCompany ? ` · ${status.jdCompany}` : ''}` : 'No job description yet'}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--pi-secondary)' }}>
                        {busy ? (STAGES[stage ?? ''] ?? 'Working…') : report?.outdated ? 'Your résumé or the job changed since this report.' : 'How your résumé fits this job, requirement by requirement.'}
                    </div>
                </div>
                {status.hasJobDescription && (
                    busy
                        ? <button type="button" style={btn} onClick={() => api()?.roleInsightCancel?.()}><Loader2 size={13} className="animate-spin" /> Cancel</button>
                        : <button type="button" style={btn} onClick={analyse}><RefreshCw size={13} /> {report ? 'Re-analyse' : 'Analyse fit'}</button>
                )}
            </div>

            {error && <div role="alert" style={{ marginTop: 10, fontSize: 12, color: '#ef4444', display: 'flex', gap: 6 }}><AlertTriangle size={13} /> {error}</div>}

            {!status.hasJobDescription && (<><div style={label}>Add the job</div>{jobInput}</>)}

            {/* ── Report ────────────────────────────────────────────────── */}
            {report && (
                <>
                    <div style={{ ...card, marginTop: 12, display: 'flex', gap: 16, alignItems: 'center' }}>
                        <div style={{ fontSize: 36, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: report.fit_score >= 70 ? '#22c55e' : report.fit_score >= 45 ? '#f59e0b' : '#ef4444' }}>
                            {report.fit_score}<span style={{ fontSize: 14, color: 'var(--pi-tertiary)' }}>/100</span>
                        </div>
                        <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600 }}>{report.verdict}</div>
                            <div style={{ fontSize: 12, color: 'var(--pi-secondary)', marginTop: 2 }}>{report.summary}</div>
                        </div>
                    </div>

                    <div style={label}>Requirements</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {report.requirements.map((req) => {
                            const s = STATUS_STYLE[req.status] ?? STATUS_STYLE.gap;
                            return (
                                <div key={req.id} style={{ ...card, padding: '10px 12px' }}>
                                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                                        <s.Icon size={15} color={s.color} style={{ flexShrink: 0, marginTop: 1 }} />
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: 12.5, fontWeight: 500 }}>
                                                {req.requirement}
                                                <span style={{ marginLeft: 6, fontSize: 10.5, color: 'var(--pi-tertiary)' }}>{req.priority === 'must' ? 'must-have' : 'nice-to-have'}{req.corrected ? ' · corrected by you' : ''}</span>
                                            </div>
                                            {req.evidence && <div style={{ fontSize: 12, color: 'var(--pi-secondary)', marginTop: 3 }}>{req.evidence}</div>}
                                            {req.status !== 'strong' && req.suggestion && <div style={{ fontSize: 12, color: 'var(--pi-tertiary)', marginTop: 3 }}>Tip: {req.suggestion}</div>}
                                        </div>
                                        {req.status !== 'strong' && editing?.id !== req.id && (
                                            <button type="button" style={{ ...btn, padding: '3px 8px', fontSize: 11 }} onClick={() => setEditing({ id: req.id, text: '' })}>I have this</button>
                                        )}
                                    </div>
                                    {editing?.id === req.id && (
                                        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                                            <input autoFocus value={editing.text} onChange={(e) => setEditing({ id: req.id, text: e.target.value })}
                                                onKeyDown={(e) => { if (e.key === 'Enter') void saveHave(); if (e.key === 'Escape') setEditing(null); }}
                                                placeholder="What in your background covers this?"
                                                style={{ flex: 1, borderRadius: 8, border: '1px solid var(--pi-border)', background: 'transparent', color: 'var(--pi-primary)', padding: '5px 9px', fontSize: 12, fontFamily: 'inherit' }} />
                                            <button type="button" style={{ ...btn, padding: '3px 10px', fontSize: 11 }} disabled={!editing.text.trim()} onClick={saveHave}>Save</button>
                                            <button type="button" style={{ ...btn, padding: '3px 10px', fontSize: 11 }} onClick={() => setEditing(null)}>Cancel</button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {report.talking_points.length > 0 && (<>
                        <div style={label}>Stories to tell</div>
                        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.6 }}>{report.talking_points.map((t, i) => <li key={i}>{t}</li>)}</ul>
                    </>)}

                    {report.likely_questions.length > 0 && (<>
                        <div style={label}>Likely questions</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {report.likely_questions.map((q, i) => (
                                <div key={i} style={{ ...card, padding: '10px 12px' }}>
                                    <div style={{ fontSize: 12.5, fontWeight: 500 }}>{q.question}</div>
                                    {q.answer_hint && <div style={{ fontSize: 12, color: 'var(--pi-secondary)', marginTop: 3 }}>{q.answer_hint}</div>}
                                </div>
                            ))}
                        </div>
                    </>)}

                    {status.hasJobDescription && (<><div style={label}>Analyse a different job</div>{jobInput}</>)}
                </>
            )}

            {/* ── Negotiation script ────────────────────────────────────── */}
            {status.hasJobDescription && (
                <>
                    <div style={label}>Salary negotiation</div>
                    {!script ? (
                        <button type="button" style={btn} disabled={scriptBusy} onClick={() => makeScript(false)}>
                            {scriptBusy ? <Loader2 size={13} className="animate-spin" /> : null} Write my negotiation script
                        </button>
                    ) : (
                        <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12.5 }}>
                            {script.target_range && <div><b>Target:</b> {script.target_range}</div>}
                            {script.summary && <div style={{ color: 'var(--pi-secondary)' }}>{script.summary}</div>}
                            {script.opening_script && <div><b>Open with:</b> “{script.opening_script}”</div>}
                            {script.counter_scripts.map((c, i) => <div key={i}><b>If {c.situation}:</b> “{c.say}”</div>)}
                            {script.leverage_points.length > 0 && <div><b>Your leverage:</b> {script.leverage_points.join(' · ')}</div>}
                            {script.walk_away && <div><b>Walk-away point:</b> {script.walk_away}</div>}
                            <div><button type="button" style={btn} disabled={scriptBusy} onClick={() => makeScript(true)}><RefreshCw size={12} /> Rewrite</button></div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
