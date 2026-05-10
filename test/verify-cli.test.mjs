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

test('betterref-verify prints usage and exits code 2 without a report', () => {
  const result = runVerify([]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: betterref-verify/);
});
