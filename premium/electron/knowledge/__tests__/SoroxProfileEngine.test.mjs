// Soro X profile engine (premium/electron/knowledge). Runs against the compiled
// output: `npm run build:electron` first.
//
// Covers the contract the core app relies on (electron/main.ts, ipcHandlers.ts
// profile:* handlers, llm/ActiveProfileContext.ts): ingest → activeResume /
// activeJD shape, status + profile data for the Profile screen, the context
// block handed to live answers, and the synchronous delete.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../../..');
const dist = (p) => path.join(root, 'dist-electron', p);

const { KnowledgeOrchestrator } = require(dist('premium/electron/knowledge/KnowledgeOrchestrator.js'));
const { KnowledgeDatabaseManager } = require(dist('premium/electron/knowledge/KnowledgeDatabaseManager.js'));
const { textHasCompEvidence } = require(dist('premium/electron/knowledge/NegotiationConversationTracker.js'));
const { buildActiveProfileContext } = require(dist('electron/llm/ActiveProfileContext.js'));
const { profileFactsReady } = require(dist('electron/llm/manualProfileIntelligence.js'));

const RESUME_TEXT = `Ada Lovelace
ada@example.com · London

SUMMARY
Backend engineer who builds data pipelines.

EXPERIENCE
Senior Engineer, Analytical Engines Ltd, 2019 – Present

SKILLS
Languages: TypeScript, Python
Tools: Docker, Postgres
`;

const JD_TEXT = `Staff Backend Engineer
Babbage Corp is hiring. Requirements: 7+ years building distributed systems in TypeScript.
Responsibilities: own the ingestion platform.`;

const RESUME_JSON = {
    identity: { name: 'Ada Lovelace', email: 'ada@example.com', location: 'London', summary: 'Backend engineer who builds data pipelines.' },
    experience: [{ role: 'Senior Engineer', company: 'Analytical Engines Ltd', start_date: '2019', end_date: 'Present', bullets: ['Built the billing pipeline'] }],
    projects: [{ name: 'Difference Engine', description: 'Batch compute scheduler', technologies: ['Go'] }],
    skills: { Languages: ['TypeScript', 'Python'], Tools: ['Docker', 'TypeScript'] },
    education: [{ degree: 'BSc', field: 'Mathematics', institution: 'University of London', end_date: '2015' }],
};
const JD_JSON = {
    title: 'Staff Backend Engineer', company: 'Babbage Corp', requirements: ['7+ years distributed systems'],
    responsibilities: ['Own the ingestion platform'], technologies: ['TypeScript'], min_years_experience: 7,
};

/** better-sqlite3's API surface the manager uses, over node:sqlite. */
function sqliteDb() {
    const db = new DatabaseSync(':memory:');
    db.transaction = (fn) => (...args) => {
        db.exec('BEGIN');
        try { const r = fn(...args); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
    };
    return db;
}

function tmpFile(name, text) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sorox-profile-'));
    const file = path.join(dir, name);
    fs.writeFileSync(file, text);
    return file;
}

/** A generate fn that answers résumé prompts and JD prompts with fixed JSON. */
const fakeModel = async (contents) => {
    const prompt = contents.map((c) => (typeof c === 'string' ? c : c.text)).join('\n');
    const body = prompt.includes('from a résumé') ? RESUME_JSON : JD_JSON;
    return '```json\n' + JSON.stringify(body) + '\n```';
};

function engine(generate = fakeModel) {
    const db = sqliteDb();
    const o = new KnowledgeOrchestrator(new KnowledgeDatabaseManager(db));
    o.setGenerateContentFn(generate);
    o.setEmbedFn(async () => []);
    return { o, db };
}

test('résumé ingest stores AI-extracted facts in the shape the core app reads', async () => {
    const { o } = engine();
    const res = await o.ingestDocument(tmpFile('cv.txt', RESUME_TEXT), 'resume');
    assert.equal(res.success, true);
    assert.equal(res.extractionMode, 'llm');

    const r = o.activeResume;
    assert.equal(r.structured_data.identity.name, 'Ada Lovelace');
    assert.equal(r.structured_data.experience[0].company, 'Analytical Engines Ltd');
    assert.ok(r.raw_text.includes('Analytical Engines'), 'raw text kept for the core raw-text index');
    assert.equal(profileFactsReady(r.structured_data), true, 'core readiness check accepts the facts');

    const ctx = buildActiveProfileContext(o);
    assert.equal(ctx.activeResume.structured.identity.name, 'Ada Lovelace');
    assert.ok(ctx.activeResume.rawText.includes('Ada Lovelace'));
});

test('without a working AI provider the résumé still ingests, heuristically', async () => {
    const { o } = engine(async () => { throw new Error('no provider configured'); });
    const res = await o.ingestDocument(tmpFile('cv.txt', RESUME_TEXT), 'resume');
    assert.equal(res.success, true);
    assert.equal(res.extractionMode, 'heuristic');
    const facts = o.activeResume.structured_data;
    assert.equal(facts.identity.name, 'Ada Lovelace');
    assert.equal(facts.identity.email, 'ada@example.com');
    assert.deepEqual(facts.skills.Skills, ['TypeScript', 'Python', 'Docker', 'Postgres']);
});

test('a reply with no JSON falls back instead of failing the upload', async () => {
    const { o } = engine(async () => 'Sorry, I cannot help with that.');
    const res = await o.ingestDocument(tmpFile('cv.txt', RESUME_TEXT), 'resume');
    assert.equal(res.success, true);
    assert.equal(res.extractionMode, 'heuristic');
});

test('an empty or unreadable file is refused with a reason', async () => {
    const { o } = engine();
    const res = await o.ingestDocument(tmpFile('cv.txt', '   '), 'resume');
    assert.equal(res.success, false);
    assert.match(res.error, /Could not read any text/);
    assert.equal(o.activeResume, null);
});

test('status and profile data feed the Profile screen', async () => {
    const { o } = engine();
    await o.ingestDocument(tmpFile('cv.txt', RESUME_TEXT), 'resume');
    await o.ingestDocument(tmpFile('jd.txt', JD_TEXT), 'jd');

    const status = o.getStatus();
    assert.equal(status.hasResume, true);
    assert.equal(status.hasActiveJD, true);
    assert.equal(status.activeMode, false, 'profile mode is off until enabled');
    assert.equal(status.resumeSummary.name, 'Ada Lovelace');
    assert.equal(status.resumeSummary.role, 'Senior Engineer');

    const data = o.getProfileData();
    assert.deepEqual(data.skillsFlat, ['TypeScript', 'Python', 'Docker'], 'deduplicated across categories');
    assert.equal(data.experienceCount, 1);
    assert.equal(data.activeJD.company, 'Babbage Corp');
    assert.equal(data.activeJD.min_years_experience, 7);
});

test('processQuestion: nothing until profile mode is on, then a grounded context block', async () => {
    const { o } = engine();
    await o.ingestDocument(tmpFile('cv.txt', RESUME_TEXT), 'resume');
    await o.ingestDocument(tmpFile('jd.txt', JD_TEXT), 'jd');
    assert.equal(await o.processQuestion('Tell me about your experience'), null);

    o.setKnowledgeMode(true);
    assert.equal(o.isKnowledgeMode(), true);
    const r = await o.processQuestion('Tell me about your experience');
    assert.ok(r.contextBlock.includes('<candidate_profile source="resume">'));
    assert.ok(r.contextBlock.includes('Senior Engineer at Analytical Engines Ltd (2019 – Present)'));
    assert.ok(r.contextBlock.includes('<target_job source="job_description">'));
    assert.ok(r.contextBlock.includes('Company: Babbage Corp'));
    assert.ok(r.contextBlock.trimEnd().endsWith('</profile_use_rule>'), 'block is never cut mid-tag');
    assert.equal(r.factualRecall, true);
    assert.equal(r.liveNegotiationResponse, undefined);

    const pay = await o.processQuestion('What are your salary expectations for this role?');
    assert.equal(pay.factualRecall, false, 'pay talk is not plain résumé recall');
});

test('profile mode needs a résumé', async () => {
    const { o } = engine();
    o.setKnowledgeMode(true);
    assert.equal(o.isKnowledgeMode(), false);
    assert.equal(await o.processQuestion('Who are you?'), null);
});

test('delete is synchronous, clears memory and storage, and survives a reload', async () => {
    const { o, db } = engine();
    await o.ingestDocument(tmpFile('cv.txt', RESUME_TEXT), 'resume');
    await o.ingestDocument(tmpFile('jd.txt', JD_TEXT), 'jd');

    const reloaded = new KnowledgeOrchestrator(new KnowledgeDatabaseManager(db));
    assert.equal(reloaded.activeResume.structured_data.identity.name, 'Ada Lovelace', 'persists across restarts');

    const ret = o.deleteDocumentsByType('resume');
    assert.equal(ret, undefined, 'not a promise: it runs inside a SQLite transaction');
    assert.equal(o.activeResume, null);
    assert.ok(o.activeJD, 'the JD is untouched');
    assert.equal(new KnowledgeOrchestrator(new KnowledgeDatabaseManager(db)).activeResume, null);
});

test('a new upload replaces the previous document of that type', async () => {
    const { o, db } = engine();
    await o.ingestDocument(tmpFile('cv.txt', RESUME_TEXT), 'resume');
    await o.ingestDocument(tmpFile('cv2.txt', RESUME_TEXT), 'resume');
    const rows = db.prepare(`SELECT COUNT(*) AS n FROM sorox_profile_documents WHERE type = 'resume'`).get();
    assert.equal(rows.n, 1);
});

test('live negotiation coaching is not part of Soro X and stays inert', async () => {
    const { o } = engine();
    assert.equal(o.getNegotiationTracker().isActive(), false);
    assert.equal(o.getNegotiationTracker().getState(), null);
    o.resetNegotiationSession();
    o.setKnowledgeMode(true);
    await o.ingestDocument(tmpFile('cv.txt', RESUME_TEXT), 'resume');
    const r = await o.processQuestion('What salary are you expecting?');
    assert.equal(r.liveNegotiationResponse, undefined);
});

test('compensation detector', () => {
    for (const t of ['What are your salary expectations?', 'Is $150k in range?', 'What is your current CTC?', 'Tell me about the equity']) {
        assert.equal(textHasCompEvidence(t), true, t);
    }
    for (const t of ['Tell me about yourself', 'Walk me through a project you led', '']) {
        assert.equal(textHasCompEvidence(t), false, t);
    }
});
