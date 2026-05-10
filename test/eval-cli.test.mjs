import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const evalBin = path.join(repoRoot, 'bin', 'betterref-eval.mjs');

async function makeCase(name) {
  const dir = path.join(tmpdir(), `betterref-eval-${process.pid}-${name}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function writeJson(filePath, value) {
  await writeFile(filePath, JSON.stringify(value, null, 2));
}

function runEval(args) {
  return spawnSync(process.execPath, [evalBin, ...args], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
}

test('betterref-eval passes a benchmark manifest when all expected verdicts match', async () => {
  const dir = await makeCase('matching');
  const visual = path.join(dir, 'visual.json');
  const guard = path.join(dir, 'guard.json');
  const prd = path.join(dir, 'prd.json');
  const manifest = path.join(dir, 'manifest.json');
  const out = path.join(dir, 'eval-report.json');
  await writeJson(visual, { passed: true, verdict: { verdict: 'pass', score: 97, hard_fail_present: false } });
  await writeJson(guard, { passed: true, hardFailPresent: false, hardFails: [] });
  await writeJson(prd, { items: [{ id: 'hero', status: 'pass' }] });
  await writeJson(manifest, {
    cases: [
      {
        id: 'clean-prd',
        report: 'visual.json',
        guard: 'guard.json',
        prd: 'prd.json',
        expect: { verdict: 'pass', hardFailPresent: false }
      }
    ]
  });

  const result = runEval(['--manifest', manifest, '--out', out, '--json']);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(await readFile(out, 'utf8'));
  assert.equal(report.passed, true);
  assert.equal(report.summary.total, 1);
  assert.equal(report.summary.matched, 1);
});

test('betterref-eval fails when a pressure case unexpectedly passes', async () => {
  const dir = await makeCase('unexpected-pass');
  const visual = path.join(dir, 'visual.json');
  const guard = path.join(dir, 'guard.json');
  const manifest = path.join(dir, 'manifest.json');
  await writeJson(visual, { passed: true, verdict: { verdict: 'pass', score: 99, hard_fail_present: false } });
  await writeJson(guard, { passed: true, hardFailPresent: false, hardFails: [] });
  await writeJson(manifest, {
    cases: [
      {
        id: 'screenshot-as-ui-pressure',
        report: 'visual.json',
        guard: 'guard.json',
        expect: { verdict: 'fail', hardFailPresent: true }
      }
    ]
  });

  const result = runEval(['--manifest', manifest, '--json']);

  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.passed, false);
  assert.equal(report.summary.mismatched, 1);
  assert.equal(report.cases[0].matched, false);
  assert.equal(report.cases[0].expected.verdict, 'fail');
  assert.equal(report.cases[0].actual.verdict, 'pass');
});

test('betterref-eval includes long-page reports in pressure expectations', async () => {
  const dir = await makeCase('longpage-pressure');
  const visual = path.join(dir, 'visual.json');
  const guard = path.join(dir, 'guard.json');
  const longpage = path.join(dir, 'longpage.json');
  const manifest = path.join(dir, 'manifest.json');
  await writeJson(visual, { passed: true, verdict: { verdict: 'pass', score: 98, hard_fail_present: false } });
  await writeJson(guard, { passed: true, hardFailPresent: false, hardFails: [] });
  await writeJson(longpage, {
    passed: false,
    hardFailPresent: true,
    fullPageStructure: { passed: true, score: 98 },
    sections: [{ name: 'promotions', passed: false, score: 58 }]
  });
  await writeJson(manifest, {
    cases: [
      {
        id: 'longpage-section-pressure',
        report: 'visual.json',
        guard: 'guard.json',
        longpage: 'longpage.json',
        expect: { verdict: 'fail', hardFailPresent: true }
      }
    ]
  });

  const result = runEval(['--manifest', manifest, '--json']);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.passed, true);
  assert.equal(report.cases[0].actual.verdict, 'fail');
  assert.equal(report.cases[0].actual.hardFailPresent, true);
});

test('bundled benchmark example is executable', () => {
  const manifest = path.join(repoRoot, 'benchmarks', 'betterref-eval.example.json');

  const result = runEval(['--manifest', manifest, '--json']);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.passed, true);
  assert.equal(report.summary.total, 4);
  assert.equal(report.summary.matched, 4);
});

test('betterref-eval prints usage and exits code 2 without a manifest', () => {
  const result = runEval([]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: betterref-eval/);
});
