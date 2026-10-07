import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLocalNetworkHost, parsePairingLink, rememberComputer } from '../www/pairing.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345';

test('local network hosts only', () => {
  for (const h of ['192.168.1.20', '10.0.0.5', '172.16.0.1', '172.31.255.254', '169.254.3.4', 'MacBook-Pro.local', 'localhost', '127.0.0.1']) {
    assert.equal(isLocalNetworkHost(h), true, h);
  }
  for (const h of ['8.8.8.8', '172.32.0.1', '172.15.0.1', '192.169.0.1', 'example.com', 'evil.local.example.com', '999.1.1.1', '', null]) {
    assert.equal(isLocalNetworkHost(h), false, String(h));
  }
});

test('a desktop pairing link is accepted and normalised', () => {
  const r = parsePairingLink(`  http://192.168.1.20:4123/?t=${TOKEN}  `);
  assert.deepEqual(r, { ok: true, url: `http://192.168.1.20:4123/?t=${TOKEN}`, origin: 'http://192.168.1.20:4123', host: '192.168.1.20', port: '4123' });
});

test('the scheme may be missing; extra path and params are dropped', () => {
  const r = parsePairingLink(`10.0.0.7:4125/index.html?x=1&t=${TOKEN}#frag`);
  assert.equal(r.ok, true);
  assert.equal(r.url, `http://10.0.0.7:4125/?t=${TOKEN}`);
});

test('rejections explain what to do', () => {
  assert.match(parsePairingLink('').error, /Scan the QR code/);
  assert.match(parsePairingLink('http://').error, /not a link/);
  assert.match(parsePairingLink(`ftp://192.168.1.2/?t=${TOKEN}`).error, /not a Soro X pairing link/);
  assert.match(parsePairingLink(`https://example.com/?t=${TOKEN}`).error, /Allow LAN access/);
  assert.match(parsePairingLink(`http://127.0.0.1:4123/?t=${TOKEN}`).error, /only works on the computer itself/);
  assert.match(parsePairingLink('http://192.168.1.2:4123/').error, /missing its pairing code/);
  assert.match(parsePairingLink('http://192.168.1.2:4123/?t=short').error, /missing its pairing code/);
});

test('remembered computers: newest first, one per address, capped', () => {
  let list = [];
  for (let i = 1; i <= 7; i++) list = rememberComputer(list, { origin: `http://10.0.0.${i}:4123`, lastUsed: i });
  assert.equal(list.length, 5);
  assert.equal(list[0].origin, 'http://10.0.0.7:4123');
  list = rememberComputer(list, { origin: 'http://10.0.0.5:4123', url: 'new', lastUsed: 99 });
  assert.equal(list[0].url, 'new');
  assert.equal(list.filter((c) => c.origin === 'http://10.0.0.5:4123').length, 1);
});

test('navigation allow-list covers the same private ranges and nothing public', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8'));
  assert.equal(cfg.server.androidScheme, 'http', 'http origin: the app can probe http LAN addresses');
  assert.ok(!cfg.server.allowNavigation.includes('*'), 'never allow every host');
  assert.deepEqual(cfg.server.allowNavigation.sort(), ['*.local', '10.*.*.*', '169.254.*.*', '172.*.*.*', '192.168.*.*']);
});
