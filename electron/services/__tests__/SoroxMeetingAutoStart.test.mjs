// Soro X: "Start automatically" — a detected call starts listening without the
// "Start?" notification; off (the default) keeps the notification.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const { wireMeetingDetection } = require(path.join(root, 'dist-electron/electron/services/meetingDetection/wireMeetingDetection.js'));

const SELF = { darwin: { pid: 1, execPath: '/Applications/Soro X.app/Contents/MacOS/Soro X' }, win32: { pid: 1, execPath: 'C:\\Program Files\\Soro X\\Soro X.exe' } };

function run(platform, auto) {
    let t = 0;
    const starts = []; const notes = [];
    let active = false;
    const detector = wireMeetingDetection({
        platform,
        native: { getMicUsers: () => [platform === 'darwin' ? { pid: 700, bundleId: 'us.zoom.xos' } : { pid: 700, path: 'C:\\Users\\a\\AppData\\Roaming\\Zoom\\bin\\Zoom.exe' }], getVisibleWindows: () => [] },
        self: SELF[platform],
        isMeetingActive: () => active,
        promptsBlocked: () => false,
        events: () => null,
        requestStart: (r) => { starts.push(r); active = true; },
        notify: (n) => { notes.push(n); return true; },
        autoStart: () => auto,
        live: { list: () => [], keys: () => [], on: () => {}, off: () => {} },
        now: () => t,
    });
    const tick = (ms) => { t += ms; detector.tick(); };
    tick(0); tick(5000); tick(5000);
    return { starts, notes };
}

for (const platform of ['darwin', 'win32']) {
    test(`${platform}: auto-start on starts without a notification`, () => {
        const { starts, notes } = run(platform, true);
        assert.equal(notes.length, 0);
        assert.deepEqual(starts, [{ via: 'detected' }]);
    });
    test(`${platform}: auto-start off still asks first`, () => {
        const { starts, notes } = run(platform, false);
        assert.equal(starts.length, 0);
        assert.equal(notes.length, 1);
    });
}

test('the setting is off unless explicitly turned on', () => {
    const main = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
    assert.ok(main.includes("autoStart: () => SettingsManager.getInstance().get('meetingAutoStart') === true"));
});
