// Soro X Tablet — pairing link handling (pure functions, unit-tested in tests/).
//
// The desktop app's Settings → Sync shows a QR code / link of the form
//   http://<computer-ip>:<port>/?t=<token>
// (electron/services/PhoneMirrorService.ts). The tablet only ever opens such a
// link on the local network: the companion page has no cloud relay.

/** Hosts the tablet may open: loopback, private IPv4 ranges, link-local, mDNS. */
export function isLocalNetworkHost(host) {
  if (typeof host !== 'string' || !host) return false;
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.local')) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  if ([a, b, c, d].some((n) => n > 255)) return false;
  return a === 10
    || a === 127
    || (a === 192 && b === 168)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 169 && b === 254);
}

/**
 * Parse what the user scanned or pasted. Accepts the full link, or the link
 * without "http://". Returns { ok: true, url, origin, host, port } or
 * { ok: false, error } with a message fit to show the user.
 */
export function parsePairingLink(input) {
  let text = typeof input === 'string' ? input.trim() : '';
  if (!text) return { ok: false, error: 'Scan the QR code or paste the link from Soro X on your computer.' };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `http://${text}`;
  let u;
  try {
    u = new URL(text);
  } catch {
    return { ok: false, error: 'That is not a link. Copy it again from Settings → Sync on your computer.' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, error: 'That link is not a Soro X pairing link.' };
  }
  if (!isLocalNetworkHost(u.hostname)) {
    return { ok: false, error: 'This link does not point to a computer on your Wi-Fi. Turn on "Allow LAN access" in Settings → Sync and use the link it shows.' };
  }
  if (u.hostname === 'localhost' || u.hostname.startsWith('127.')) {
    return { ok: false, error: 'This link only works on the computer itself. In Settings → Sync, turn on "Allow LAN access" and scan the new code.' };
  }
  const token = u.searchParams.get('t');
  if (!token || token.length < 16) {
    return { ok: false, error: 'The link is missing its pairing code. Copy the whole link from Settings → Sync.' };
  }
  const clean = new URL(`${u.protocol}//${u.host}/`);
  clean.searchParams.set('t', token);
  return { ok: true, url: clean.toString(), origin: clean.origin, host: u.hostname, port: u.port || (u.protocol === 'https:' ? '443' : '80') };
}

/** Saved computers, most recent first, one entry per host:port. */
export function rememberComputer(list, entry, max = 5) {
  const rest = (Array.isArray(list) ? list : []).filter((c) => c && c.origin !== entry.origin);
  return [{ ...entry, lastUsed: entry.lastUsed ?? Date.now() }, ...rest].slice(0, max);
}
