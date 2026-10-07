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

  // ── Version line (best effort; the links above work without it) ───────
  fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
    .then((r) => (r.ok ? r.json() : null))
    .then((rel) => {
      if (!rel || !rel.tag_name) return;
      const when = rel.published_at ? new Date(rel.published_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
      const info = document.getElementById('release-info');
      info.textContent = `Latest: ${rel.name || rel.tag_name}${when ? ` · ${when}` : ''}`;
      document.getElementById('releases-link').href = rel.html_url;
    })
    .catch(() => {});
})();
