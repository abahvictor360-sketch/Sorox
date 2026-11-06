// Soro X Mobile: tells the user when a newer version is on the download page.
//
// Each release's notes name the GitHub Actions run that built the phone app
// ("mobile run 123"). This build knows its own run, so a different run in a
// newer release means there is an update.

declare const __BUILD_RUN__: string;
declare const __BUILD_TIME__: string;

export const BUILD_RUN = typeof __BUILD_RUN__ === 'string' ? __BUILD_RUN__ : '';
export const BUILD_TIME = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : '';

const REPO = 'abahvictor360-sketch/Sorox';
export const DOWNLOAD_PAGE = 'https://sorox-three.vercel.app';
const SEEN_KEY = 'sorox.mobile.update.dismissed.v1';
const CHECKED_KEY = 'sorox.mobile.update.checked.v1';

export interface UpdateInfo { version: string; url: string; publishedAt: string; notes: string }

interface Release { tag_name?: string; published_at?: string; body?: string; html_url?: string; assets?: { name: string; browser_download_url: string }[] }

/** The update in this release for this build, or null if there is none. */
export function updateFrom(release: Release, buildRun = BUILD_RUN, buildTime = BUILD_TIME, platform: 'android' | 'ios' | 'web' = 'android'): UpdateInfo | null {
  if (!release?.tag_name || !buildRun) return null;
  const run = /mobile run (\d+)/.exec(release.body ?? '')?.[1];
  if (!run || run === buildRun) return null;
  // A release built before this app was is not newer.
  if (buildTime && release.published_at && Date.parse(release.published_at) <= Date.parse(buildTime)) return null;
  const file = platform === 'ios' ? 'SoroX-iPhone-unsigned.ipa' : 'SoroX-Android.apk';
  const asset = release.assets?.find((a) => a.name === file);
  return {
    version: release.tag_name,
    url: asset?.browser_download_url ?? DOWNLOAD_PAGE,
    publishedAt: release.published_at ?? '',
    notes: (release.body ?? '').split('\n').find((l) => l.trim() && !l.startsWith('#'))?.trim() ?? '',
  };
}

/** Checks GitHub when the app opens (at most every 10 minutes, or when forced). Never throws. */
export async function checkForUpdate(platform: 'android' | 'ios' | 'web', force = false): Promise<UpdateInfo | null> {
  if (!BUILD_RUN) return null;
  try {
    const last = Number(localStorage.getItem(CHECKED_KEY) || 0);
    if (!force && Date.now() - last < 10 * 60_000) return null;
    localStorage.setItem(CHECKED_KEY, String(Date.now()));
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return null;
    const update = updateFrom(await res.json(), BUILD_RUN, BUILD_TIME, platform);
    if (update && !force && localStorage.getItem(SEEN_KEY) === update.version) return null;
    return update;
  } catch {
    return null;
  }
}

export function dismissUpdate(version: string) {
  try { localStorage.setItem(SEEN_KEY, version); } catch { /* ignore */ }
}
