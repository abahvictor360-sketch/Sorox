// Soro X: the local-features switch (electron/services/soroxLocalFeatures.ts),
// as React state. `engineAvailable` is false when premium/ has no profile engine.
import { useCallback, useEffect, useState } from 'react';

export interface SoroxLocalFeatures {
  enabled: boolean;
  engineAvailable: boolean;
  loaded: boolean;
  setEnabled: (enabled: boolean) => Promise<boolean>;
}

export function useSoroxLocalFeatures(): SoroxLocalFeatures {
  const [enabled, setEnabledState] = useState(false);
  const [engineAvailable, setEngineAvailable] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    window.electronAPI?.soroxGetLocalFeatures?.()
      .then((r) => {
        if (!alive) return;
        setEnabledState(!!r?.enabled);
        setEngineAvailable(!!r?.engineAvailable);
      })
      .catch(() => {})
      .finally(() => { if (alive) setLoaded(true); });
    const off = window.electronAPI?.onSoroxLocalFeaturesChanged?.((d) => setEnabledState(!!d?.enabled));
    return () => { alive = false; off?.(); };
  }, []);

  const setEnabled = useCallback(async (next: boolean) => {
    const r = await window.electronAPI?.soroxSetLocalFeatures?.(next).catch(() => null);
    if (r?.success) setEnabledState(!!r.enabled);
    return !!r?.success;
  }, []);

  return { enabled, engineAvailable, loaded, setEnabled };
}
