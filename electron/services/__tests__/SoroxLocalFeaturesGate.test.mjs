// Soro X local-features switch: which handlers it opens, and which it must not.
//
// The switch unlocks only what Soro X implements itself in premium/: résumé /
// JD upload, the profile-mode toggle, and the mode switching that profile
// answers need. Natively's own Pro / trial check is left exactly as it was, and
// every feature Soro X does not build stays behind it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const src = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');

/** Source of one safeHandle('<channel>', …) registration, up to the next one. */
function handler(channel) {
    const start = src.indexOf(`'${channel}',`);
    assert.ok(start >= 0, `${channel} handler not found`);
    const next = src.indexOf('safeHandle(', start + channel.length);
    return src.slice(start, next < 0 ? undefined : next);
}

const OPENED = [
    'profile:upload-resume',
    'profile:upload-jd',
    'profile:set-mode',
    'modes:create',
    'modes:delete',
    'modes:set-active',
];

const STILL_NATIVELY_ONLY = [
    'profile:research-company',
    'profile:generate-negotiation',
    'profile:generate-cover-letter',
    'modes:upload-reference-file',
];

test('the switch opens exactly the Soro X profile + mode handlers', () => {
    for (const ch of OPENED) {
        const body = handler(ch);
        assert.ok(body.includes('isProfileFeatureAllowed()'), `${ch} should accept the Soro X switch`);
        assert.ok(!body.includes('isProOrTrialActive()'), `${ch} should not keep a separate Pro-only check`);
    }
});

test('features Soro X does not build stay behind Natively Pro / trial', () => {
    for (const ch of STILL_NATIVELY_ONLY) {
        const body = handler(ch);
        assert.ok(!body.includes('isProfileFeatureAllowed()'), `${ch} must not be opened by the Soro X switch`);
    }
    assert.equal((src.match(/isProfileFeatureAllowed\(\)/g) || []).length, OPENED.length,
        'isProfileFeatureAllowed() is used only by the opened handlers');
});

test("Natively's own Pro / trial check is unchanged", () => {
    const start = src.indexOf('const isProOrTrialActive = (): boolean => {');
    const end = src.indexOf('\n  };', start);
    const body = src.slice(start, end);
    assert.ok(start >= 0 && end > start);
    assert.ok(!/sorox/i.test(body), 'isProOrTrialActive must not know about the Soro X switch');
    assert.ok(body.includes("require('../premium/electron/services/LicenseManager')"));
});

test('the combined check is Pro / trial OR (the Soro X switch AND its engine is present)', () => {
    assert.match(src, /const isProfileFeatureAllowed = \(\): boolean =>\s*isProOrTrialActive\(\)\s*\|\| \(require\('\.\/services\/soroxLocalFeatures'\)\.isSoroxLocalFeaturesEnabled\(\) && !!appState\.getKnowledgeOrchestrator\(\)\);/);
});

test('turning the switch off takes back the mode and profile mode unless Pro / trial still grants them', () => {
    const body = handler('sorox:set-local-features');
    assert.ok(body.includes('if (!on && !isProOrTrialActive()) {'));
    assert.ok(body.includes('setKnowledgeMode(false)'));
    assert.ok(body.includes("SettingsManager.getInstance().set('knowledgeMode', false)"));
    assert.ok(body.includes('clearActiveModeOnLicenseLoss()'));
});

test('the setting is declared and defaults to off', () => {
    const settings = fs.readFileSync(path.join(root, 'electron/services/SettingsManager.ts'), 'utf8');
    assert.match(settings, /soroxLocalFeatures\?: boolean;/);
    const helper = fs.readFileSync(path.join(root, 'electron/services/soroxLocalFeatures.ts'), 'utf8');
    assert.ok(helper.includes("get('soroxLocalFeatures') === true"), 'only an explicit true turns it on');
});

test('preload, its interface and the renderer types all expose the switch', () => {
    const preload = fs.readFileSync(path.join(root, 'electron/preload.ts'), 'utf8');
    const types = fs.readFileSync(path.join(root, 'src/types/electron.d.ts'), 'utf8');
    for (const name of ['soroxGetLocalFeatures', 'soroxSetLocalFeatures', 'onSoroxLocalFeaturesChanged']) {
        assert.equal((preload.match(new RegExp(`\\b${name}:`, 'g')) || []).length, 2, `${name} in preload interface + implementation`);
        assert.ok(types.includes(`${name}:`), `${name} in src/types/electron.d.ts`);
    }
    assert.ok(preload.includes("ipcRenderer.invoke('sorox:get-local-features')"));
    assert.ok(preload.includes("ipcRenderer.invoke('sorox:set-local-features', enabled)"));
});
