// Prepares www/ for `npx cap sync`: copies the QR decoder (jsQR) next to the app.
// Cross-platform (Node only), so it runs the same on macOS, Windows and CI.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(path.dirname(require.resolve('jsqr/package.json')), 'dist', 'jsQR.js');
const dest = path.join(root, 'www', 'vendor', 'jsQR.js');

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);
for (const f of ['index.html', 'app.js', 'pairing.js', 'styles.css', 'icon.png']) {
  if (!fs.existsSync(path.join(root, 'www', f))) throw new Error(`www/${f} is missing`);
}
console.log('[tablet] www ready (jsQR copied)');
