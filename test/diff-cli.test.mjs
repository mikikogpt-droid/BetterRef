import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const diffBin = path.join(repoRoot, 'bin', 'betterref-diff.mjs');

async function makeCase(name) {
  const dir = path.join(tmpdir(), `betterref-${process.pid}-${name}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

function svg(fill) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16" fill="${fill}"/></svg>`;
}

test('betterref-diff passes identical images and writes report plus diff image', async () => {
  const dir = await makeCase('identical');
  const ref = path.join(dir, 'reference.svg');
  const actual = path.join(dir, 'actual.svg');
  const out = path.join(dir, 'out');
  await writeFile(ref, svg('#6d35ff'));
  await writeFile(actual, svg('#6d35ff'));

  const result = spawnSync(process.execPath, [
    diffBin,
    '--ref',
    ref,
    '--actual',
    actual,
    '--out',
    out,
    '--max-changed',
    '0',
    '--max-mean',
    '0'
  ], { cwd: repoRoot, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(await readFile(path.join(out, 'report.json'), 'utf8'));
  assert.equal(report.passed, true);
  assert.equal(report.metrics.changedPercent, 0);
  assert.equal(report.metrics.meanAbsoluteChannelDiff, 0);
  assert.equal(report.verdict.verdict, 'pass');
  const diff = await readFile(path.join(out, 'diff.png'));
  assert.ok(diff.length > 0);
});

test('betterref-diff fails changed images and reports measured mismatch', async () => {
  const dir = await makeCase('changed');
  const ref = path.join(dir, 'reference.svg');
  const actual = path.join(dir, 'actual.svg');
  const out = path.join(dir, 'out');
  await writeFile(ref, svg('#000000'));
  await writeFile(actual, svg('#ffffff'));

  const result = spawnSync(process.execPath, [
    diffBin,
    '--ref',
    ref,
    '--actual',
    actual,
    '--out',
    out,
    '--max-changed',
    '0',
    '--max-mean',
    '0'
  ], { cwd: repoRoot, encoding: 'utf8' });

  assert.notEqual(result.status, 0);
  const report = JSON.parse(await readFile(path.join(out, 'report.json'), 'utf8'));
  assert.equal(report.passed, false);
  assert.equal(report.verdict.verdict, 'revise');
  assert.equal(report.metrics.changedPixels, 256);
  assert.equal(report.metrics.changedPercent, 100);
  assert.ok(report.metrics.meanAbsoluteChannelDiff > 0);
});

test('betterref-diff prints usage and exits with code 2 when required args are missing', () => {
  const result = spawnSync(process.execPath, [diffBin], {
    cwd: repoRoot,
    encoding: 'utf8'
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: betterref-diff/);
});
