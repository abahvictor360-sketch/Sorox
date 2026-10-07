// Soro X Tablet — pairing screen.
//
// Scans (or accepts a pasted) Soro X pairing link and opens the desktop's
// companion page in this app. Back (Android) or a swipe from the left edge
// (iPad) returns here.
import { parsePairingLink, rememberComputer } from './pairing.js';

const STORE_KEY = 'sorox.computers';
const $ = (id) => document.getElementById(id);
const message = $('message');

function say(text, kind = 'info') {
  message.textContent = text;
  message.dataset.kind = kind;
}

function loadComputers() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch { return []; }
}

function saveComputers(list) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); } catch { /* private mode: not remembered */ }
}

function renderSaved() {
  const list = loadComputers();
  $('saved').hidden = list.length === 0;
  const ul = $('saved-list');
  ul.replaceChildren(...list.map((c) => {
    const li = document.createElement('li');
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'primary';
    open.textContent = 'Open';
    open.addEventListener('click', () => connect(c.url));
    const label = document.createElement('div');
    label.innerHTML = `<b></b><span></span>`;
    label.querySelector('b').textContent = c.host;
    label.querySelector('span').textContent = `Port ${c.port} · last used ${new Date(c.lastUsed).toLocaleString()}`;
    const forget = document.createElement('button');
    forget.type = 'button';
    forget.className = 'link';
    forget.textContent = 'Forget';
    forget.addEventListener('click', () => { saveComputers(loadComputers().filter((x) => x.origin !== c.origin)); renderSaved(); });
    li.append(label, open, forget);
    return li;
  }));
}

/** Is the computer answering? `no-cors` keeps this a reachability probe only. */
async function reachable(origin) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    await fetch(`${origin}/healthz`, { mode: 'no-cors', cache: 'no-store', signal: ctrl.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

let pendingAnyway = null;

async function connect(input) {
  const link = parsePairingLink(input);
  if (!link.ok) { say(link.error, 'error'); return; }
  stopCamera();
  if (pendingAnyway !== link.url) {
    say(`Connecting to ${link.host}…`);
    if (!(await reachable(link.origin))) {
      pendingAnyway = link.url;
      say(`Can't reach ${link.host}:${link.port}. Check that this tablet is on the same Wi-Fi and that Phone Mirror and "Allow LAN access" are on. Tap Connect again to try anyway.`, 'error');
      $('link').value = link.url;
      return;
    }
  }
  pendingAnyway = null;
  saveComputers(rememberComputer(loadComputers(), { url: link.url, origin: link.origin, host: link.host, port: link.port }));
  window.location.href = link.url;
}

// ─── QR scanning ─────────────────────────────────────────────────────────────

let stream = null;
let scanning = false;

function decode(source, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, width, height);
  const img = ctx.getImageData(0, 0, width, height);
  return window.jsQR?.(img.data, width, height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    say('Live scanning is not available here. Use "Photo of QR code" or paste the link.', 'error');
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  } catch {
    say('Camera access was not allowed. Allow it in the system settings, or use "Photo of QR code" / paste the link.', 'error');
    return;
  }
  const video = $('video');
  video.srcObject = stream;
  await video.play().catch(() => {});
  $('camera').hidden = false;
  say('Point the camera at the QR code on your computer.');
  scanning = true;
  const tick = () => {
    if (!scanning) return;
    if (video.readyState >= 2 && video.videoWidth) {
      const scale = Math.min(1, 720 / video.videoWidth);
      const text = decode(video, Math.round(video.videoWidth * scale), Math.round(video.videoHeight * scale));
      if (text) { connect(text); return; }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function stopCamera() {
  scanning = false;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  $('camera').hidden = true;
}

async function scanPhoto(file) {
  if (!file) return;
  say('Reading the photo…');
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const text = decode(bitmap, Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
    if (text) connect(text);
    else say('No QR code found in that photo. Try again closer to the screen, or paste the link.', 'error');
  } catch {
    say('Could not read that photo.', 'error');
  }
}

// ─── Wiring ──────────────────────────────────────────────────────────────────

$('scan').addEventListener('click', startCamera);
$('stop').addEventListener('click', () => { stopCamera(); say(''); });
$('photo').addEventListener('change', (e) => { scanPhoto(e.target.files?.[0]); e.target.value = ''; });
$('manual').addEventListener('submit', (e) => { e.preventDefault(); connect($('link').value); });
$('link').addEventListener('input', () => { pendingAnyway = null; });
document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });

renderSaved();
