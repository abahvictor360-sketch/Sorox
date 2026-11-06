// Soro X Mobile: pairing with Soro X on your computer (Settings > Sync on the
// desktop shows a QR code / link http://<computer-ip>:<port>/?t=<token>).
// Same rules as the tablet companion (tablet/www/pairing.js): only links to a
// computer on the local network are opened; there is no cloud relay.

export function isLocalNetworkHost(host: string): boolean {
  if (typeof host !== 'string' || !host) return false;
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.local')) return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  if ([a, b, c, d].some((n) => n > 255)) return false;
  return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

export type PairingResult =
  | { ok: true; url: string; origin: string; host: string; port: string }
  | { ok: false; error: string };

export function parsePairingLink(input: string): PairingResult {
  let text = typeof input === 'string' ? input.trim() : '';
  if (!text) return { ok: false, error: 'Scan the QR code or paste the link from Soro X on your computer.' };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `http://${text}`;
  let u: URL;
  try { u = new URL(text); } catch { return { ok: false, error: 'That is not a link. Copy it again from Settings > Sync on your computer.' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: 'That link is not a Soro X pairing link.' };
  if (!isLocalNetworkHost(u.hostname)) return { ok: false, error: 'This link does not point to a computer on your Wi-Fi. Turn on "Allow LAN access" in Settings > Sync and use the link it shows.' };
  if (u.hostname === 'localhost' || u.hostname.startsWith('127.')) return { ok: false, error: 'This link only works on the computer itself. In Settings > Sync, turn on "Allow LAN access" and scan the new code.' };
  const token = u.searchParams.get('t');
  if (!token || token.length < 16) return { ok: false, error: 'The link is missing its pairing code. Copy the whole link from Settings > Sync.' };
  const clean = new URL(`${u.protocol}//${u.host}/`);
  clean.searchParams.set('t', token);
  return { ok: true, url: clean.toString(), origin: clean.origin, host: u.hostname, port: u.port || (u.protocol === 'https:' ? '443' : '80') };
}

export interface SavedComputer { url: string; origin: string; host: string; lastUsed: number }

const KEY = 'sorox.mobile.computers.v1';

export function rememberComputer(list: SavedComputer[], entry: Omit<SavedComputer, 'lastUsed'> & { lastUsed?: number }, max = 5): SavedComputer[] {
  const rest = (Array.isArray(list) ? list : []).filter((c) => c && c.origin !== entry.origin);
  return [{ ...entry, lastUsed: entry.lastUsed ?? Date.now() }, ...rest].slice(0, max);
}

export function loadComputers(): SavedComputer[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
}

export function saveComputers(list: SavedComputer[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage full */ }
}

/** Is Soro X answering at that address? (no-cors: any reply means it is up). */
export async function reachable(origin: string, timeoutMs = 4000): Promise<boolean> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try { await fetch(origin, { mode: 'no-cors', signal: ctl.signal, cache: 'no-store' }); return true; } catch { return false; } finally { clearTimeout(t); }
}
