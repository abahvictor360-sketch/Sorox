// Copy pdf.js's worker into public/ as .js: Android's Capacitor web view serves
// .mjs files without a JavaScript MIME type, which stops a module worker loading.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const from = path.join(root, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.min.mjs');
const to = path.join(root, 'public', 'pdf.worker.min.js');
fs.copyFileSync(from, to);
