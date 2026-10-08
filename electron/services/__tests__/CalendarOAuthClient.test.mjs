// Soro X: which Google OAuth client Calendar sync uses (calendarOAuthClient.ts).
// Natively's client ID without Natively's baked secret can never connect, so it
// must never be offered on its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const { resolveCalendarClient, validateCalendarClient, maskClientId } = require(path.join(root, 'dist-electron/electron/services/calendarOAuthClient.js'));

const NATIVELY_ID = '814531619520-80ib40f38i5vdeg0j8kk81r0usojrt9a.apps.googleusercontent.com';
const MY_ID = '1234567890-abcdefghij0123456789klmnopqrst.apps.googleusercontent.com';

test('no secret anywhere → no client (Natively\'s ID alone is not offered)', () => {
  assert.equal(resolveCalendarClient({ env: {}, user: null, bakedId: '', bakedSecret: '', fallbackId: NATIVELY_ID }), null);
});

test('the user\'s saved client is used', () => {
  assert.deepEqual(
    resolveCalendarClient({ env: {}, user: { id: ` ${MY_ID} `, secret: ' GOCSPX-abc123456 ' }, bakedSecret: '', fallbackId: NATIVELY_ID }),
    { id: MY_ID, secret: 'GOCSPX-abc123456', source: 'user' },
  );
});

test('environment overrides the saved client (development); half an env pair is ignored', () => {
  const user = { id: MY_ID, secret: 'GOCSPX-user000000' };
  assert.equal(resolveCalendarClient({ env: { GOOGLE_CALENDAR_CLIENT_ID: 'e-1.apps.googleusercontent.com', GOOGLE_CALENDAR_CLIENT_SECRET: 's' }, user }).source, 'env');
  assert.equal(resolveCalendarClient({ env: { GOOGLE_CALENDAR_CLIENT_ID: 'e-1.apps.googleusercontent.com' }, user }).source, 'user');
});

test('a baked client is the fallback; a baked secret without an ID keeps Natively\'s ID (Natively\'s own builds)', () => {
  assert.deepEqual(resolveCalendarClient({ env: {}, user: null, bakedId: MY_ID, bakedSecret: 'GOCSPX-baked0000', fallbackId: NATIVELY_ID }),
    { id: MY_ID, secret: 'GOCSPX-baked0000', source: 'built-in' });
  assert.equal(resolveCalendarClient({ env: {}, user: null, bakedId: '', bakedSecret: 'GOCSPX-nat', fallbackId: NATIVELY_ID }).id, NATIVELY_ID);
  assert.equal(resolveCalendarClient({ env: {}, user: { id: MY_ID, secret: 'GOCSPX-user000000' }, bakedId: 'x', bakedSecret: 'y' }).source, 'user', 'the user\'s own client wins');
});

test('validation explains what is wrong', () => {
  assert.equal(validateCalendarClient(MY_ID, 'GOCSPX-abcdefghijk'), null);
  assert.match(validateCalendarClient('', 'x'), /both/);
  assert.match(validateCalendarClient('my-client', 'GOCSPX-abcdefghijk'), /apps\.googleusercontent\.com/);
  assert.match(validateCalendarClient(MY_ID, 'short'), /Client secret/);
  assert.match(validateCalendarClient(MY_ID, 'GOCSPX abc defghij'), /Client secret/);
});

test('the shown client ID is shortened', () => {
  const masked = maskClientId(MY_ID);
  assert.ok(masked.startsWith('1234…-'));
  assert.ok(masked.endsWith('.apps.googleusercontent.com'));
  assert.ok(!masked.includes('abcdefghij0'));
});

test('CalendarManager signs in only through the resolver, and the build bakes an ID next to the secret', () => {
  const cm = fs.readFileSync(path.join(root, 'electron/services/CalendarManager.ts'), 'utf8');
  assert.match(cm, /function calendarOAuthClient\(\): CalendarOAuthClient \{\n\s+const client = currentCalendarClient\(\);\n\s+if \(!client\) throw new Error\(NO_CLIENT_MESSAGE\);/);
  assert.ok(!/process\.env\.GOOGLE_CALENDAR_CLIENT_ID \|\| DEFAULT_CALENDAR_CLIENT_ID/.test(cm), 'no unconditional fallback to Natively\'s client');
  assert.ok(cm.includes("'calendar_oauth_client.enc'"));
  assert.ok(cm.includes('safeStorage.encryptString(JSON.stringify(next))'), 'the user\'s client is stored encrypted');
  const build = fs.readFileSync(path.join(root, 'scripts/build-electron.js'), 'utf8');
  assert.ok(build.includes("'process.env.NATIVELY_BAKED_CALENDAR_CLIENT_ID': JSON.stringify(calendarClientId)"));
});
