/**
 * Soro X — Modes manager.
 *
 * Soro X's own replacement for the premium Modes screen (loaded through
 * src/premium/index.tsx as the default export). It does the minimum Profile
 * Intelligence needs: list modes, switch the active one, add and remove modes.
 * Answers use your résumé / job description only in a mode whose template
 * opts into profile context ("Looking for work", "Technical Interview").
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Check, Plus, Trash2, X } from 'lucide-react';
import { useSoroxLocalFeatures } from '../../src/lib/useSoroxLocalFeatures';

interface ModeRow {
    id: string;
    name: string;
    templateType: string;
    isActive: boolean;
    isBuiltin?: boolean;
}

/** Mirrors MODE_TEMPLATES in electron/services/ModesManager.ts (labels only). */
const TEMPLATES: { type: string; label: string; usesProfile: boolean }[] = [
    { type: 'looking-for-work', label: 'Looking for work', usesProfile: true },
    { type: 'technical-interview', label: 'Technical Interview', usesProfile: true },
    { type: 'general', label: 'General', usesProfile: false },
    { type: 'sales', label: 'Sales', usesProfile: false },
    { type: 'recruiting', label: 'Recruiting', usesProfile: false },
    { type: 'team-meet', label: 'Team Meet', usesProfile: false },
    { type: 'lecture', label: 'Lecture', usesProfile: false },
];

const usesProfile = (templateType: string) => TEMPLATES.some((t) => t.type === templateType && t.usesProfile);
const templateLabel = (templateType: string) => TEMPLATES.find((t) => t.type === templateType)?.label ?? templateType;

export default function ModesSettings({ onClose, isPremium = false, isTrialActive = false }: {
    onClose?: () => void;
    isPremium?: boolean;
    isLoaded?: boolean;
    isTrialActive?: boolean;
    onOpenNativelyAPI?: () => void;
}) {
    const sorox = useSoroxLocalFeatures();
    const canChange = isPremium || isTrialActive || (sorox.enabled && sorox.engineAvailable);

    const [modes, setModes] = useState<ModeRow[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [newName, setNewName] = useState('');
    const [newTemplate, setNewTemplate] = useState('looking-for-work');

    const refresh = useCallback(async () => {
        const list = await window.electronAPI?.modesGetAll?.().catch(() => []);
        setModes(Array.isArray(list) ? (list as ModeRow[]) : []);
    }, []);

    useEffect(() => {
        void refresh();
        const off = window.electronAPI?.onModesActiveCleared?.(() => { void refresh(); });
        return () => { off?.(); };
    }, [refresh, sorox.enabled]);

    const run = async (action: () => Promise<{ success: boolean; error?: string } | undefined>) => {
        setBusy(true);
        setError(null);
        try {
            const r = await action();
            if (r && !r.success) {
                setError(r.error === 'pro_required' ? 'Turn on the Soro X switch above first.' : (r.error ?? 'That did not work.'));
            }
        } catch (e: any) {
            setError(e?.message ?? 'That did not work.');
        } finally {
            setBusy(false);
            await refresh();
        }
    };

    const activate = (id: string | null) => run(() => window.electronAPI.modesSetActive(id));
    const remove = (id: string) => run(() => window.electronAPI.modesDelete(id));
    const create = () => {
        const name = newName.trim() || templateLabel(newTemplate);
        return run(async () => {
            const r = await window.electronAPI.modesCreate({ name, templateType: newTemplate });
            if (r?.success) setNewName('');
            return r;
        });
    };

    const active = modes.find((m) => m.isActive) ?? null;

    return (
        <div className="flex h-full w-full flex-col text-text-primary" data-testid="sorox-modes-settings">
            <div className="flex items-center justify-between border-b border-border-muted px-5 py-4">
                <div>
                    <h2 className="text-[15px] font-semibold">Modes</h2>
                    <p className="mt-0.5 text-xs text-text-secondary">
                        {active ? `Active: ${active.name}` : 'No mode active'}
                        {active && usesProfile(active.templateType) ? ' · answers use your profile' : ''}
                    </p>
                </div>
                {onClose && (
                    <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-text-secondary hover:bg-bg-secondary">
                        <X size={14} />
                    </button>
                )}
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
                {/* Soro X switch */}
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border-muted bg-bg-secondary px-4 py-3">
                    <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={sorox.enabled}
                        disabled={!sorox.loaded || !sorox.engineAvailable}
                        onChange={(e) => { void sorox.setEnabled(e.target.checked); }}
                        data-testid="sorox-local-features-toggle"
                    />
                    <span>
                        <span className="block text-sm font-medium">Soro X profile engine</span>
                        <span className="block text-xs text-text-secondary">
                            {sorox.engineAvailable
                                ? 'Uses your own AI key to read your résumé and job description, and lets you switch modes here.'
                                : 'The profile engine is not in this build (premium/ is empty).'}
                        </span>
                    </span>
                </label>

                {error && <p className="text-xs text-red-500" role="alert">{error}</p>}

                {/* Mode list */}
                <section>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">Your modes</h3>
                    <div className="space-y-1.5">
                        {modes.map((m) => (
                            <div key={m.id} className="flex items-center gap-3 rounded-lg border border-border-muted px-3 py-2">
                                <div className="min-w-0 flex-1">
                                    <div className="truncate text-sm">{m.name}</div>
                                    <div className="text-[11px] text-text-secondary">
                                        {templateLabel(m.templateType)}{usesProfile(m.templateType) ? ' · uses profile' : ''}
                                    </div>
                                </div>
                                {m.isActive ? (
                                    <button type="button" disabled={busy} onClick={() => activate(null)}
                                        className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-accent-primary">
                                        <Check size={12} /> Active
                                    </button>
                                ) : (
                                    <button type="button" disabled={busy || (!canChange && m.templateType !== 'general')}
                                        onClick={() => activate(m.id)}
                                        className="rounded-md border border-border-muted px-2 py-1 text-xs hover:bg-bg-secondary disabled:opacity-40">
                                        Use
                                    </button>
                                )}
                                {!m.isBuiltin && (
                                    <button type="button" disabled={busy || !canChange} onClick={() => remove(m.id)} aria-label={`Delete ${m.name}`}
                                        className="rounded-md p-1 text-text-secondary hover:bg-bg-secondary disabled:opacity-40">
                                        <Trash2 size={13} />
                                    </button>
                                )}
                            </div>
                        ))}
                        {modes.length === 0 && <p className="text-xs text-text-secondary">No modes yet.</p>}
                    </div>
                </section>

                {/* New mode */}
                <section>
                    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-secondary">Add a mode</h3>
                    <div className="flex gap-2">
                        <input
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            placeholder="Name (optional)"
                            className="min-w-0 flex-1 rounded-md border border-border-muted bg-bg-input px-2.5 py-1.5 text-sm"
                        />
                        <select
                            value={newTemplate}
                            onChange={(e) => setNewTemplate(e.target.value)}
                            className="rounded-md border border-border-muted bg-bg-input px-2 py-1.5 text-sm"
                        >
                            {TEMPLATES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
                        </select>
                        <button type="button" disabled={busy || !canChange} onClick={create}
                            className="flex items-center gap-1 rounded-md border border-border-muted px-2.5 py-1.5 text-sm hover:bg-bg-secondary disabled:opacity-40">
                            <Plus size={13} /> Add
                        </button>
                    </div>
                </section>
            </div>
        </div>
    );
}
