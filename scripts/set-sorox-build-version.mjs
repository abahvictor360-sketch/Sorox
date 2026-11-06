// Soro X: give each CI build of the desktop app its own, rising version, so
// installed copies see new releases as updates (electron-updater compares
// versions). 2.9.<100 + build number>; outside CI nothing changes.
// Cross-platform (Node only): run before electron-builder on Windows and macOS.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = Number(process.env.GITHUB_RUN_NUMBER);
if (!Number.isInteger(run) || run <= 0) {
  console.log('[sorox-version] not a CI build: version unchanged');
  process.exit(0);
}
const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
const [major, minor] = String(pkg.version).split('.');
pkg.version = `${major}.${minor}.${100 + run}`;
fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`[sorox-version] ${pkg.version}`);
