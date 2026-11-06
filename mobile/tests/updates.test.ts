import { describe, expect, it } from 'vitest';
import { updateFrom } from '../src/lib/updates';

const release = (run: string, published: string) => ({
  tag_name: 'v2.9.2-sorox.9', published_at: published,
  body: `Soro X 2.9.2\n\nBuilt from abc (desktop run 1, tablet run 2, mobile run ${run}).`,
  assets: [{ name: 'SoroX-Android.apk', browser_download_url: 'https://example.com/SoroX-Android.apk' }, { name: 'SoroX-iPhone-unsigned.ipa', browser_download_url: 'https://example.com/ios.ipa' }],
});

describe('update notice', () => {
  it('offers a release built by a different, newer run', () => {
    const u = updateFrom(release('200', '2026-11-06T10:00:00Z'), '100', '2026-11-06T09:00:00Z', 'android');
    expect(u?.version).toBe('v2.9.2-sorox.9');
    expect(u?.url).toBe('https://example.com/SoroX-Android.apk');
    expect(updateFrom(release('200', '2026-11-06T10:00:00Z'), '100', '2026-11-06T09:00:00Z', 'ios')?.url).toBe('https://example.com/ios.ipa');
  });
  it('stays quiet for the same build, an older release, or a local build', () => {
    expect(updateFrom(release('100', '2026-11-06T10:00:00Z'), '100', '2026-11-06T09:00:00Z')).toBeNull();
    expect(updateFrom(release('200', '2026-11-06T08:00:00Z'), '100', '2026-11-06T09:00:00Z')).toBeNull();
    expect(updateFrom(release('200', '2026-11-06T10:00:00Z'), '', '')).toBeNull();
    expect(updateFrom({ tag_name: 'v1', body: 'no run here' }, '100', '')).toBeNull();
  });
});
