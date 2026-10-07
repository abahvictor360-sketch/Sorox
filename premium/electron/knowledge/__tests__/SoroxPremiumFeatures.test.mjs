// Soro X features built on the user's own AI key: company research, cover
// letter, negotiation script, Role Insight, Tavily search + job-URL import.
// Runs against the compiled output: `npm run build:electron` first.
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
const dist = (p) => path.join(path.resolve(__dirname, '../../../..'), 'dist-electron', p);

const { KnowledgeOrchestrator } = require(dist('premium/electron/knowledge/KnowledgeOrchestrator.js'));
const { KnowledgeDatabaseManager } = require(dist('premium/electron/knowledge/KnowledgeDatabaseManager.js'));
const { TavilySearchProvider } = require(dist('premium/electron/knowledge/TavilySearchProvider.js'));
const { resolveFromUrl } = require(dist('premium/electron/knowledge/roleInsight/JdSourceResolver.js'));
const { scoreOf } = require(dist('premium/electron/knowledge/roleInsight/RoleInsightService.js'));

const RESUME = { identity: { name: 'Ada Lovelace' }, experience: [{ role: 'Senior Engineer', company: 'Engines Ltd', start_date: '2019', bullets: ['Built billing'] }], skills: { Languages: ['TypeScript'] } };
const JD = { title: 'Staff Engineer', company: 'Babbage Corp', requirements: ['TypeScript', 'Kubernetes'], responsibilities: ['Own ingestion'] };
const DOSSIER = {
    company: 'Babbage Corp', hiring_strategy: 'Hires generalists.', interview_focus: 'System design', interview_difficulty: 'Very Hard',
    culture_ratings: { overall: 4.26, work_life_balance: 9, career_growth: 'x' },
    salary_estimates: [{ title: 'Staff Engineer', min: 180000, max: 230000, currency: 'USD', confidence: 'sure' }, { title: 'nothing' }],
    core_values: ['Rigor'], critics: [{ category: 'Pace', complaint: 'Long hours', frequency: 'common' }, { category: 'x' }], recent_news: '',
};
const LETTER = { greeting: 'Dear Babbage team,', opening_hook: 'I build billing systems.', body_paragraphs: ['At Engines Ltd I built billing.'], closing: 'Thanks, Ada' };
const SCRIPT = { summary: 'Aim high', target_range: '$200k-$230k', opening_script: 'Based on my experience…', counter_scripts: [{ situation: 'they offer below range', say: 'Could we get closer to…' }, { situation: 'x', say: '' }], leverage_points: ['Billing'], walk_away: '$185k' };
const INSIGHT = {
    fit_score: 64, verdict: 'Good fit with one gap', summary: 'Strong TypeScript, no Kubernetes.',
    requirements: [
        { requirement: 'TypeScript', priority: 'must', status: 'strong', evidence: 'Built billing in TypeScript' },
        { requirement: 'Kubernetes', priority: 'must', status: 'nonsense', evidence: '' },
        { requirement: 'Mentoring', priority: 'nice', status: 'partial' },
    ],
    talking_points: ['The billing migration'], likely_questions: [{ question: 'How have you used Kubernetes?', answer_hint: 'Be honest' }, { why: 'no question' }],
};

/** Answers each prompt by what it asks for, and records the prompts. */
function fakeModel() {
    const prompts = [];
    const fn = async (contents) => {
        const p = contents.map((c) => c.text).join('\n');
        prompts.push(p);
        const body = p.includes('from a résumé') ? RESUME
            : p.includes('from a job description') ? JD
            : p.includes('preparing a candidate for a job interview') ? DOSSIER
            : p.includes('Write a cover letter') ? LETTER
            : p.includes('salary negotiation script') ? SCRIPT
            : p.includes('honest career coach') ? INSIGHT
            : {};
        return JSON.stringify(body);
    };
    fn.prompts = prompts;
    return fn;
}

function sqliteDb() {
    const db = new DatabaseSync(':memory:');
    db.transaction = (fn) => (...a) => { db.exec('BEGIN'); try { const r = fn(...a); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
    return db;
}
const tmp = (name, text) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'sorox-')); fs.writeFileSync(path.join(d, name), text); return path.join(d, name); };
const RESUME_TEXT = 'Ada Lovelace\nSenior Engineer at Engines Ltd since 2019. Built billing in TypeScript.\n';
const JD_TEXT = 'Staff Engineer at Babbage Corp. Requirements: TypeScript, Kubernetes. Own ingestion.\n';

async function loaded(model = fakeModel()) {
    const db = sqliteDb();
    const o = new KnowledgeOrchestrator(new KnowledgeDatabaseManager(db));
    o.setGenerateContentFn(model);
    await o.ingestDocument(tmp('cv.txt', RESUME_TEXT), 'resume');
    await o.ingestDocument(tmp('jd.txt', JD_TEXT), 'jd');
    return { o, db, model };
}

// ─── Company research ───────────────────────────────────────────────────────

test('company research without a search key: LLM-only, marked degraded, normalised, cached', async () => {
    const { o, model } = await loaded();
    const engine = o.getCompanyResearchEngine();
    engine.setSearchProvider(null);
    const d = await engine.researchCompany('Babbage Corp', { title: 'Staff Engineer' });
    assert.equal(d.degraded, true);
    assert.deepEqual(d.sources, []);
    assert.equal(d.interview_difficulty, 'very_hard');
    assert.deepEqual(d.culture_ratings, { overall: 4.3, work_life_balance: 5, career_growth: 0, compensation: 0, management: 0 });
    assert.equal(d.salary_estimates.length, 1, 'rows without figures dropped');
    assert.equal(d.salary_estimates[0].confidence, 'low', 'unknown confidence becomes low');
    assert.equal(d.critics.length, 1);
    assert.ok(model.prompts.at(-1).includes('No web search is available'));

    const calls = model.prompts.length;
    assert.deepEqual(await engine.researchCompany('babbage corp'), d, 'fresh cache reused (case-insensitive)');
    assert.equal(model.prompts.length, calls);
    assert.deepEqual(engine.getCachedDossier('Babbage Corp'), d);
    assert.equal(o.getProfileData().companyDossier.company, 'Babbage Corp', 'Profile screen rehydrates it');
});

test('company research with search: sources kept, deduplicated, and a degraded cache is not reused', async () => {
    const { o, model } = await loaded();
    const engine = o.getCompanyResearchEngine();
    engine.setSearchProvider(null);
    await engine.researchCompany('Babbage Corp', {});
    const queries = [];
    engine.setSearchProvider({
        search: async (q) => { queries.push(q); return [{ title: 'Reviews', url: 'https://ex.com/a', content: 'Long hours.' }, { title: 'Dup', url: 'https://ex.com/a', content: 'dup' }]; },
    });
    const d = await engine.researchCompany('Babbage Corp', { title: 'Staff Engineer' });
    assert.equal(d.degraded, false);
    assert.deepEqual(d.sources, [{ title: 'Reviews', url: 'https://ex.com/a' }]);
    assert.equal(queries.length, 4);
    assert.ok(queries.some((q) => q.includes('Staff Engineer') && q.includes('salary')));
    assert.ok(model.prompts.at(-1).includes('Web search results'));
});

test('a failing or exhausted search provider falls back instead of failing', async () => {
    const { o } = await loaded();
    const engine = o.getCompanyResearchEngine();
    const provider = { quotaExhausted: false, search: async () => { provider.quotaExhausted = true; throw new Error('429'); } };
    engine.setSearchProvider(provider);
    const d = await engine.researchCompany('Babbage Corp', {}, true);
    assert.equal(d.degraded, true);
});

test('research needs an AI provider and a company name', async () => {
    const db = sqliteDb();
    const o = new KnowledgeOrchestrator(new KnowledgeDatabaseManager(db));
    await assert.rejects(() => o.getCompanyResearchEngine().researchCompany('Acme'), /No AI provider/);
    o.setGenerateContentFn(fakeModel());
    await assert.rejects(() => o.getCompanyResearchEngine().researchCompany('  '), /No company name/);
});

// ─── Cover letter + negotiation script ──────────────────────────────────────

test('cover letter: written from résumé + JD, stored, and tied to those documents', async () => {
    const { o, model } = await loaded();
    assert.equal(o.getCoverLetter(), null);
    const letter = await o.generateCoverLetterOnDemand();
    assert.equal(letter.greeting, 'Dear Babbage team,');
    assert.equal(letter.full_text, 'Dear Babbage team,\n\nI build billing systems.\n\nAt Engines Ltd I built billing.\n\nThanks, Ada');
    assert.deepEqual(o.getCoverLetter(), letter);
    assert.deepEqual(o.getProfileData().coverLetter, letter);
    assert.ok(model.prompts.at(-1).includes('"company":"Babbage Corp"'));

    await o.ingestDocument(tmp('jd2.txt', JD_TEXT + ' Updated.'), 'jd');
    assert.equal(o.getCoverLetter(), null, 'a new JD makes the old letter stale');
});

test('negotiation script: normalised and cached per document pair', async () => {
    const { o } = await loaded();
    const s = await o.generateNegotiationScriptOnDemand();
    assert.equal(s.target_range, '$200k-$230k');
    assert.equal(s.counter_scripts.length, 1, 'empty lines dropped');
    assert.deepEqual(o.getNegotiationScript(), s);
});

test('documents need both a résumé and a JD', async () => {
    const db = sqliteDb();
    const o = new KnowledgeOrchestrator(new KnowledgeDatabaseManager(db));
    o.setGenerateContentFn(fakeModel());
    assert.equal(await o.generateCoverLetterOnDemand(), null);
    assert.equal(await o.generateNegotiationScriptOnDemand(), null);
});

test('deleting the résumé or JD removes what was generated from them', async () => {
    const { o } = await loaded();
    await o.generateCoverLetterOnDemand();
    await o.getRoleInsightService().analyse();
    o.deleteDocumentsByType('jd');
    assert.equal(o.getCoverLetter(), null);
    assert.equal(o.getRoleInsightService().getReport(), null);
});

// ─── Role Insight ───────────────────────────────────────────────────────────

test('Role Insight: missing documents are named', async () => {
    const db = sqliteDb();
    const o = new KnowledgeOrchestrator(new KnowledgeDatabaseManager(db));
    o.setGenerateContentFn(fakeModel());
    await assert.rejects(() => o.getRoleInsightService().analyse(), (e) => e.name === 'MissingSourceError' && e.missing.join() === 'resume,job_description');
    const st = o.getRoleInsightService().getStatus();
    assert.equal(st.hasResume, false);
    assert.equal(st.analysing, false);
});

test('Role Insight: analyse → report, status, history, outdated after a new JD', async () => {
    const { o } = await loaded();
    const svc = o.getRoleInsightService();
    const report = await svc.analyse();
    assert.equal(report.fit_score, 64);
    assert.deepEqual(report.requirements.map((r) => [r.id, r.status, r.priority]), [['req_1', 'strong', 'must'], ['req_2', 'gap', 'must'], ['req_3', 'partial', 'nice']]);
    assert.equal(report.likely_questions.length, 1);
    assert.equal(report.jd_company, 'Babbage Corp');

    const st = svc.getStatus();
    assert.equal(st.hasAnalysis, true);
    assert.equal(st.outdated, false);
    assert.equal(st.jdTitle, 'Staff Engineer');
    assert.equal(svc.getReport().id, report.id);
    assert.equal(svc.listHistory(5)[0].fitScore, 64);
    assert.equal(svc.maybeAutoRefresh(), false);

    await o.ingestDocument(tmp('jd2.txt', JD_TEXT + ' v2'), 'jd');
    assert.equal(svc.getReport().outdated, true);
    assert.deepEqual(svc.getReport().outdatedReasons, ['jd_changed']);
});

test('Role Insight: "I have this" corrects a requirement and rescores', async () => {
    const { o } = await loaded();
    const svc = o.getRoleInsightService();
    const report = await svc.analyse();
    const r = svc.applyCorrection({ analysisId: report.id, requirementId: 'req_2', kind: 'i_have_this', evidenceText: 'Ran our k8s cluster' });
    const req = r.report.requirements.find((x) => x.id === 'req_2');
    assert.equal(req.status, 'strong');
    assert.equal(req.evidence, 'Ran our k8s cluster');
    assert.equal(req.corrected, true);
    assert.equal(r.report.fit_score, scoreOf(r.report.requirements));
    assert.equal(svc.getReport().requirements[1].status, 'strong', 'persisted');
    const c = svc.answerClarification({ analysisId: report.id, requirementId: 'req_3', answer: 'Mentored two juniors' });
    assert.equal(c.report.requirements[2].status, 'strong');
});

test('Role Insight: cancel during analysis', async () => {
    let release;
    const model = fakeModel();
    const { o } = await loaded(model);
    const svc = o.getRoleInsightService();
    o.setGenerateContentFn(async (c) => { await new Promise((r) => { release = r; }); return model(c); });
    const run = svc.analyse();
    await new Promise((r) => setImmediate(r));
    assert.equal(svc.getStatus().analysing, true);
    assert.equal(svc.getStatus().stage, 'matching');
    svc.cancel();
    release();
    await assert.rejects(run, (e) => e.name === 'AnalysisCancelledError');
    assert.equal(svc.getStatus().analysing, false);
});

test('fit score: musts count double', () => {
    assert.equal(scoreOf([{ priority: 'must', status: 'strong' }, { priority: 'nice', status: 'gap' }]), 67);
    assert.equal(scoreOf([]), 0);
});

// ─── Tavily + job URL import ────────────────────────────────────────────────

test('Tavily provider: search, extract, and a quota error is flagged', async () => {
    const calls = [];
    const real = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
        calls.push({ url, body: JSON.parse(init.body) });
        if (url.endsWith('/search')) return new Response(JSON.stringify({ results: [{ title: 'T', url: 'https://x', content: 'C' }, { title: 'empty' }] }));
        if (url.endsWith('/extract')) return new Response(JSON.stringify({ results: [{ raw_content: '  Job text  ' }] }));
        return new Response('', { status: 500 });
    };
    try {
        const p = new TavilySearchProvider('tvly-key');
        assert.deepEqual(await p.search('acme'), [{ title: 'T', url: 'https://x', content: 'C' }]);
        assert.equal(calls[0].body.api_key, 'tvly-key');
        assert.equal(await p.extractUrl('https://job'), 'Job text');
        globalThis.fetch = async () => new Response('', { status: 432 });
        await assert.rejects(() => p.search('again'), /quota/);
        assert.equal(p.quotaExhausted, true);
    } finally {
        globalThis.fetch = real;
    }
});

test('job URL import refuses pages too short to be a job description', async () => {
    assert.equal(await resolveFromUrl('https://x', { extractUrl: async () => 'Sign in to continue' }, ''), null);
    const long = 'Requirements: '.repeat(30);
    assert.deepEqual(await resolveFromUrl('https://x', { extractUrl: async () => long }, ''), { text: long.trim(), sourceUrl: 'https://x' });
});
