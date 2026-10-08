// electron/services/soroxLocalFeatures.ts
//
// Soro X: one switch for the features Soro X implements itself in premium/
// (the profile engine) and the mode switching it needs. Natively's own Pro /
// trial check (isProOrTrialActive in ipcHandlers.ts) is left as it is; the
// handlers that serve Soro X's own features accept either.

import { SettingsManager } from './SettingsManager';

export const SOROX_LOCAL_FEATURES_CHANGED = 'sorox-local-features-changed';

/** On unless the user turned it off (an explicit false). */
export function isSoroxLocalFeaturesEnabled(): boolean {
  try {
    return SettingsManager.getInstance().get('soroxLocalFeatures') !== false;
  } catch {
    return true;
  }
}

/** Returns false when the settings store refused the write. */
export function setSoroxLocalFeaturesEnabled(enabled: boolean): boolean {
  return SettingsManager.getInstance().set('soroxLocalFeatures', enabled === true);
}
