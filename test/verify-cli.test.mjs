import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const verifyBin = path.join(repoRoot, 'bin', 'betterref-verify.mjs');

async function makeCase(name) {
  const dir = path.join(tmpdir(), `betterref-verify-${process.pid}-${name}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function writeJson(filePath, value) {
  await writeFile(filePath, JSON.stringify(value, null, 2));
}

function runVerify(args) {
  return spawnSync(process.execPath, [verifyBin, ...args], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
}

test('betterref-verify passes only when visual, guard, and PRD checklist all pass', async () => {
  const dir = await makeCase('pass');
  const visual = path.join(dir, 'report.json');
  const guard = path.join(dir, 'guard-report.json');
  const prd = path.join(dir, 'prd-checklist.json');
  const out = path.join(dir, 'final-verdict.json');
  await writeJson(visual, { passed: true, verdict: { verdict: 'pass', score: 97, hard_fail_present: false } });
  await writeJson(guard, { passed: true, hardFailPresent: false, hardFails: [] });
  await writeJson(prd, { items: [{ id: 'hero', status: 'pass' }, { id: 'mobile', status: 'pass' }] });

  const result = runVerify(['--report', visual, '--guard', guard, '--prd', prd, '--out', out, '--json']);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const verdict = JSON.parse(await readFile(out, 'utf8'));
  assert.equal(verdict.verdict, 'pass');
  assert.equal(verdict.hardFailPresent, false);
  assert.equal(verdict.prdCompliance.score, 100);
  assert.deepEqual(verdict.blockingReasons, []);
});

test('betterref-verify fails high visual scores when guard has hard fails', async () => {
  const dir = await makeCase('guard-fail');
  const visual = path.join(dir, 'report.json');
  const guard = path.join(dir, 'guard-report.json');
  await writeJson(visual, { passed: true, verdict: { verdict: 'pass', score: 99, hard_fail_present: false } });
  await writeJson(guard, {
    passed: false,
    hardFailPresent: true,
    hardFails: [{ code: 'reference_asset_used_in_source', message: 'Reference asset used as UI.' }]
  });

  const result = runVerify(['--report', visual, '--guard', guard, '--json']);

  assert.equal(result.status, 1);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.verdict, 'fail');
  assert.equal(verdict.hardFailPresent, true);
  assert.ok(verdict.blockingReasons.some((item) => item.includes('reference_asset_used_in_source')));
});

test('betterref-verify keeps PRD gaps as revise even when visual and guard pass', async () => {
  const dir = await makeCase('prd-gap');
  const visual = path.join(dir, 'report.json');
  const guard = path.join(dir, 'guard-report.json');
  const prd = path.join(dir, 'prd-checklist.json');
  await writeJson(visual, { passed: true, verdict: { verdict: 'pass', score: 98, hard_fail_present: false } });
  await writeJson(guard, { passed: true, hardFailPresent: false, hardFails: [] });
  await writeJson(prd, {
    items: [
      { id: 'desktop-hero', status: 'pass' },
      { id: 'mobile-menu', status: 'missing', requirement: 'Mobile navigation opens and closes.' }
    ]
  });

  const result = runVerify(['--report', visual, '--guard', guard, '--prd', prd, '--json']);

  assert.equal(result.status, 1);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.verdict, 'revise');
  assert.equal(verdict.hardFailPresent, false);
  assert.equal(verdict.prdCompliance.score, 50);
  assert.ok(verdict.blockingReasons.some((item) => item.includes('mobile-menu')));
});

test('betterref-verify fails when long-page section report has blocking differences', async () => {
  const dir = await makeCase('longpage-fail');
  const visual = path.join(dir, 'report.json');
  const guard = path.join(dir, 'guard-report.json');
  const prd = path.join(dir, 'prd-checklist.json');
  const longpage = path.join(dir, 'longpage-report.json');
  await writeJson(visual, { passed: true, verdict: { verdict: 'pass', score: 98, hard_fail_present: false } });
  await writeJson(guard, { passed: true, hardFailPresent: false, hardFails: [] });
  await writeJson(prd, { items: [{ id: 'hero', status: 'pass' }] });
  await writeJson(longpage, {
    passed: false,
    hardFailPresent: true,
    fullPageStructure: { passed: true, score: 98 },
    sections: [
      { name: 'hero', passed: false, score: 62, dimensionDrift: { width: 0, height: 120 } }
    ]
  });

  const result = runVerify(['--report', visual, '--guard', guard, '--prd', prd, '--longpage', longpage, '--json']);

  assert.equal(result.status, 1);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.verdict, 'fail');
  assert.equal(verdict.hardFailPresent, true);
  assert.equal(verdict.longPage.passed, false);
  assert.ok(verdict.blockingReasons.some((item) => item.includes('long-page section hero')));
});

test('betterref-verify writes a readable HTML verdict with blocking evidence', async () => {
  const dir = await makeCase('html-verdict');
  const visual = path.join(dir, 'report.json');
  const guard = path.join(dir, 'guard-report.json');
  const prd = path.join(dir, 'prd-checklist.json');
  const longpage = path.join(dir, 'longpage-report.json');
  const html = path.join(dir, 'final-verdict.html');
  await writeJson(visual, { passed: true, verdict: { verdict: 'pass', score: 99, hard_fail_present: false } });
  await writeJson(guard, {
    passed: false,
    hardFailPresent: true,
    hardFails: [{ code: 'asset_quality_below_threshold', message: 'Hero asset sharpness is too low.' }]
  });
  await writeJson(prd, {
    items: [
      { id: 'desktop-home', status: 'pass' },
      { id: 'mobile-menu', status: 'missing', requirement: 'Mobile navigation opens and closes.' }
    ]
  });
  await writeJson(longpage, {
    passed: false,
    hardFailPresent: true,
    fullPageStructure: { passed: true, score: 91 },
    sections: [
      { name: 'promotions', passed: false, score: 74, dimensionDrift: { width: 0, height: 88 } }
    ]
  });

  const result = runVerify([
    '--report', visual,
    '--guard', guard,
    '--prd', prd,
    '--longpage', longpage,
    '--html', html,
    '--json'
  ]);

  assert.equal(result.status, 1);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.verdict, 'fail');

  const htmlBody = await readFile(html, 'utf8');
  assert.match(htmlBody, /<title>BetterRef Final Verdict<\/title>/);
  assert.match(htmlBody, /Final Verdict/);
  assert.match(htmlBody, /FAIL/);
  assert.match(htmlBody, /Visual Score/);
  assert.match(htmlBody, /PRD Compliance/);
  assert.match(htmlBody, /Long-Page Score/);
  assert.match(htmlBody, /91/);
  assert.match(htmlBody, /asset_quality_below_threshold/);
  assert.match(htmlBody, /mobile-menu/);
  assert.match(htmlBody, /long-page section promotions/);
});

test('betterref-verify writes an evidence bundle with hashed artifacts', async () => {
  const dir = await makeCase('evidence-bundle');
  const visual = path.join(dir, 'report.json');
  const guard = path.join(dir, 'guard-report.json');
  const prd = path.join(dir, 'prd-checklist.json');
  const out = path.join(dir, 'final-verdict.json');
  const html = path.join(dir, 'final-verdict.html');
  const bundle = path.join(dir, 'evidence-bundle.json');
  await writeJson(visual, { passed: true, verdict: { verdict: 'pass', score: 97, hard_fail_present: false } });
  await writeJson(guard, { passed: true, hardFailPresent: false, hardFails: [] });
  await writeJson(prd, { items: [{ id: 'hero', status: 'pass' }, { id: 'mobile', status: 'pass' }] });

  const result = runVerify([
    '--report', visual,
    '--guard', guard,
    '--prd', prd,
    '--out', out,
    '--html', html,
    '--bundle', bundle,
    '--json'
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const evidence = JSON.parse(await readFile(bundle, 'utf8'));
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.verdict.verdict, 'pass');
  assert.equal(evidence.verdict.visualScore, 97);
  assert.equal(evidence.verdict.prdScore, 100);
  assert.deepEqual(evidence.blockingReasons, []);

  const kinds = evidence.artifacts.map((artifact) => artifact.kind).sort();
  assert.deepEqual(kinds, [
    'final-verdict-html',
    'final-verdict-json',
    'guard-report',
    'prd-checklist',
    'visual-report'
  ]);
  for (const artifact of evidence.artifacts) {
    assert.equal(artifact.present, true, artifact.kind);
    assert.match(artifact.path, /betterref-verify-/);
    assert.equal(typeof artifact.bytes, 'number');
    assert.ok(artifact.bytes > 0);
    assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
  }
});

test('betterref-verify fails when required evidence is missing', async () => {
  const dir = await makeCase('required-evidence-missing');
  const visual = path.join(dir, 'report.json');
  await writeJson(visual, { passed: true, verdict: { verdict: 'pass', score: 99, hard_fail_present: false } });

  const result = runVerify(['--report', visual, '--require', 'guard,prd,longpage', '--json']);

  assert.equal(result.status, 1);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.verdict, 'fail');
  assert.equal(verdict.hardFailPresent, true);
  assert.deepEqual(verdict.requiredEvidence.missing, ['guard', 'prd', 'longpage']);
  assert.ok(verdict.blockingReasons.some((item) => item.includes('required guard evidence is missing')));
  assert.ok(verdict.blockingReasons.some((item) => item.includes('required PRD evidence is missing')));
  assert.ok(verdict.blockingReasons.some((item) => item.includes('required long-page evidence is missing')));
});

test('betterref-verify passes required evidence when every required report is present', async () => {
  const dir = await makeCase('required-evidence-present');
  const visual = path.join(dir, 'report.json');
  const guard = path.join(dir, 'guard-report.json');
  const prd = path.join(dir, 'prd-checklist.json');
  const longpage = path.join(dir, 'longpage-report.json');
  await writeJson(visual, { passed: true, verdict: { verdict: 'pass', score: 99, hard_fail_present: false } });
  await writeJson(guard, { passed: true, hardFailPresent: false, hardFails: [] });
  await writeJson(prd, { items: [{ id: 'hero', status: 'pass' }] });
  await writeJson(longpage, {
    passed: true,
    hardFailPresent: false,
    fullPageStructure: { passed: true, score: 99 },
    sections: [{ name: 'hero', passed: true, score: 99 }]
  });

  const result = runVerify([
    '--report', visual,
    '--guard', guard,
    '--prd', prd,
    '--longpage', longpage,
    '--require', 'guard,prd,longpage',
    '--json'
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.verdict, 'pass');
  assert.deepEqual(verdict.requiredEvidence.missing, []);
  assert.deepEqual(verdict.requiredEvidence.required, ['guard', 'prd', 'longpage']);
});

test('betterref-verify prints usage and exits code 2 without a report', () => {
  const result = runVerify([]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: betterref-verify/);
  assert.match(result.stderr, /--html/);
  assert.match(result.stderr, /--bundle/);
  assert.match(result.stderr, /--require/);
});
