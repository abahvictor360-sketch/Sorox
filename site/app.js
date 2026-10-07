// Soro X download page: links point at the latest GitHub release (stable file
// names, published by .github/workflows/release.yml); the visitor's OS picks the
// main button.
(() => {
  const REPO = 'abahvictor360-sketch/Sorox';
  const DOWNLOAD = (name) => `https://github.com/${REPO}/releases/latest/download/${name}`;

  for (const a of document.querySelectorAll('[data-asset]')) a.href = DOWNLOAD(a.dataset.asset);

  // ── Main button by platform ───────────────────────────────────────────
  const ua = navigator.userAgent;
  const platform = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
  const isIPad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  const isMac = !isIPad && /Mac/i.test(platform + ua);
  const isWindows = /Win/i.test(platform + ua);

  const primary = document.getElementById('primary-download');
  const pick = (label, asset) => { primary.textContent = label; primary.href = DOWNLOAD(asset); };
  if (isWindows) pick('Download for Windows', 'SoroX-Windows-Setup.exe');
  else if (isAndroid) pick('Download for Android tablet', 'SoroX-Tablet-Android.apk');
  else if (isIPad) { primary.textContent = 'Get the iPad app'; primary.href = '#download'; }
  else if (isMac) {
    pick('Download for Mac (Apple Silicon)', 'SoroX-macOS-AppleSilicon.dmg');
    // Chromium can tell Apple Silicon from Intel; Safari cannot, so Apple Silicon stays the default.
    navigator.userAgentData?.getHighEntropyValues?.(['architecture'])
      .then((v) => { if (v.architecture === 'x86') pick('Download for Mac (Intel)', 'SoroX-macOS-Intel.dmg'); })
      .catch(() => {});
  }
  const mine = isWindows ? 'windows' : isAndroid ? 'android' : isIPad ? 'ipad' : isMac ? 'mac' : null;
  if (mine) document.querySelector(`.card[data-os="${mine}"]`)?.classList.add('yours');

  // ── Release check: version line, and no links to files that do not exist yet ──
  const markMissing = (available) => {
    const anchors = [...document.querySelectorAll('[data-asset]'), primary];
    for (const a of anchors) {
      const name = a === primary ? (a.href.split('/download/')[1] || '') : a.dataset.asset;
      if (!name || available.has(name)) continue;
      a.removeAttribute('href');
      a.classList.add('pending');
      a.setAttribute('aria-disabled', 'true');
      a.dataset.label = a.textContent;
      a.textContent = `${a.textContent} — coming soon`;
    }
  };
  fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
    .then((r) => {
      if (r.status === 404) return { none: true }; // nothing published yet
      return r.ok ? r.json() : null;               // rate limit / outage: leave the links alone
    })
    .then((rel) => {
      const info = document.getElementById('release-info');
      if (!rel) return;
      if (rel.none) {
        markMissing(new Set());
        info.textContent = 'The first release is being built. Check back soon.';
        return;
      }
      markMissing(new Set((rel.assets || []).map((x) => x.name)));
      const when = rel.published_at ? new Date(rel.published_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
      info.textContent = `Latest: ${rel.name || rel.tag_name}${when ? ` · ${when}` : ''}`;
      document.getElementById('releases-link').href = rel.html_url;
    })
    .catch(() => {});
})();
