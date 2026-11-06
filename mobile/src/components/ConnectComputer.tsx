// Open Soro X running on your computer (Settings → Sync) over Wi-Fi.
import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { loadComputers, parsePairingLink, reachable, rememberComputer, saveComputers, type SavedComputer } from '../lib/pairing';

export function ConnectComputer() {
  const [link, setLink] = useState('');
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [saved, setSaved] = useState<SavedComputer[]>(loadComputers);
  const [scanning, setScanning] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);

  const stopCamera = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; setScanning(false); };
  useEffect(() => stopCamera, []);

  const connect = async (input: string) => {
    const r = parsePairingLink(input);
    if (!r.ok) { setMsg({ text: r.error, bad: true }); return; }
    setMsg({ text: `Looking for ${r.host}…` });
    if (!(await reachable(r.origin))) { setMsg({ text: `Could not reach ${r.host}. Is Soro X open on that computer, and is this phone on the same Wi-Fi?`, bad: true }); return; }
    const list = rememberComputer(saved, { url: r.url, origin: r.origin, host: r.host });
    saveComputers(list); setSaved(list);
    window.location.href = r.url;
  };

  const decode = (src: CanvasImageSource, w: number, h: number) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true }); if (!ctx) return null;
    ctx.drawImage(src, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    return jsQR(img.data, w, h, { inversionAttempts: 'attemptBoth' })?.data ?? null;
  };

  const scan = async () => {
    setMsg(null);
    try { stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }); }
    catch { setMsg({ text: 'Camera access was not allowed. Paste the link instead.', bad: true }); return; }
    setScanning(true);
    requestAnimationFrame(function tick() {
      const v = video.current;
      if (!stream.current) return;
      if (v && !v.srcObject) { v.srcObject = stream.current; void v.play(); }
      if (v && v.readyState >= 2 && v.videoWidth) {
        const found = decode(v, v.videoWidth, v.videoHeight);
        if (found) { stopCamera(); setLink(found); void connect(found); return; }
      }
      requestAnimationFrame(tick);
    });
  };

  return (
    <div className="card">
      <h3>Connect to Soro X on your computer</h3>
      <p className="muted small">On your computer: Soro X → Settings → Sync, turn on “Allow LAN access”, then scan the code. Both devices must be on the same Wi-Fi.</p>
      {scanning ? (
        <div className="scanner"><video ref={video} playsInline muted /><button className="ghost" onClick={stopCamera}>Cancel</button></div>
      ) : (
        <button className="secondary" onClick={() => void scan()}>📷 Scan QR code</button>
      )}
      <form className="row" onSubmit={(e) => { e.preventDefault(); void connect(link); }}>
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="http://192.168.1.20:8787/?t=…" />
        <button className="primary" disabled={!link.trim()}>Open</button>
      </form>
      {msg && <p className={msg.bad ? 'error' : 'muted'}>{msg.text}</p>}
      {saved.map((c) => (
        <div key={c.origin} className="row saved">
          <button className="ghost grow" onClick={() => void connect(c.url)}>💻 {c.host}</button>
          <button className="ghost small" onClick={() => { const l = saved.filter((x) => x.origin !== c.origin); saveComputers(l); setSaved(l); }}>Forget</button>
        </div>
      ))}
    </div>
  );
}
