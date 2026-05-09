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

function svg(fill, width = 16, height = 16) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="${fill}"/></svg>`;
}

function layeredSvg(width, height, shapes) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`,
    ...shapes,
    '</svg>'
  ].join('');
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
  assert.equal(report.global.metrics.ssim, 1);
  assert.equal(report.global.metrics.hashSimilarity, 1);
  assert.equal(report.regions.length, 10);
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
  assert.ok(report.global.metrics.ssim < 1);
  assert.ok(report.global.metrics.hashSimilarity <= 1);
});

test('betterref-diff can normalize actual image size to the reference before diffing', async () => {
  const dir = await makeCase('match-size-reference');
  const ref = path.join(dir, 'reference.svg');
  const actual = path.join(dir, 'actual.svg');
  const out = path.join(dir, 'out');
  await writeFile(ref, svg('#111827', 20, 10));
  await writeFile(actual, svg('#111827', 40, 20));

  const result = spawnSync(process.execPath, [
    diffBin,
    '--ref',
    ref,
    '--actual',
    actual,
    '--out',
    out,
    '--match-size',
    'reference',
    '--max-changed',
    '0',
    '--max-mean',
    '0',
    '--min-ssim',
    '1',
    '--html'
  ], { cwd: repoRoot, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(await readFile(path.join(out, 'report.json'), 'utf8'));
  assert.equal(report.passed, true);
  assert.equal(report.dimensions.reference.width, 20);
  assert.equal(report.dimensions.actualSource.width, 40);
  assert.equal(report.dimensions.actualCompared.width, 20);
  assert.equal(report.normalization.matchSize, 'reference');
  assert.equal(report.normalization.actualResized, true);
  assert.match(report.artifacts.actualComparedPath, /actual-compared\.png$/);
  const html = await readFile(path.join(out, 'report.html'), 'utf8');
  assert.match(html, /actual-compared\.png/);
});

test('betterref-diff keeps dimension mismatch as hard fail by default', async () => {
  const dir = await makeCase('strict-dimension-mismatch');
  const ref = path.join(dir, 'reference.svg');
  const actual = path.join(dir, 'actual.svg');
  const out = path.join(dir, 'out');
  await writeFile(ref, svg('#111827', 20, 10));
  await writeFile(actual, svg('#111827', 40, 20));

  const result = spawnSync(process.execPath, [
    diffBin,
    '--ref',
    ref,
    '--actual',
    actual,
    '--out',
    out
  ], { cwd: repoRoot, encoding: 'utf8' });

  assert.equal(result.status, 1);
  const report = JSON.parse(await readFile(path.join(out, 'report.json'), 'utf8'));
  assert.equal(report.passed, false);
  assert.equal(report.normalization.matchSize, 'strict');
  assert.equal(report.verdict.same_state, false);
  assert.match(report.verdict.hardFailHints.join('\n'), /capture size mismatch/);
});

test('betterref-diff keeps color-only perceptual score useful even when pixel gate fails', async () => {
  const dir = await makeCase('color-only');
  const ref = path.join(dir, 'reference.svg');
  const actual = path.join(dir, 'actual.svg');
  const out = path.join(dir, 'out');
  await writeFile(ref, svg('#6d35ff', 20, 20));
  await writeFile(actual, svg('#7d45ff', 20, 20));

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
    '0',
    '--min-ssim',
    '0.999',
    '--threshold',
    '0'
  ], { cwd: repoRoot, encoding: 'utf8' });

  assert.equal(result.status, 1);
  const report = JSON.parse(await readFile(path.join(out, 'report.json'), 'utf8'));
  assert.equal(report.global.metrics.changedPercent, 100);
  assert.ok(report.global.metrics.ssim > 0.85);
  assert.ok(report.global.score > 60);
});

test('betterref-diff prints usage and exits with code 2 when required args are missing', () => {
  const result = spawnSync(process.execPath, [diffBin], {
    cwd: repoRoot,
    encoding: 'utf8'
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: betterref-diff/);
});

test('betterref-diff writes html report and sorts configured failing regions by severity', async () => {
  const dir = await makeCase('regions');
  const ref = path.join(dir, 'reference.svg');
  const actual = path.join(dir, 'actual.svg');
  const config = path.join(dir, '.betterref.json');
  const out = path.join(dir, 'out');

  await writeFile(ref, layeredSvg(30, 20, [
    '<rect width="30" height="20" fill="#050505"/>',
    '<rect x="0" y="0" width="30" height="8" fill="#6d35ff"/>',
    '<rect x="0" y="8" width="30" height="12" fill="#101828"/>'
  ]));
  await writeFile(actual, layeredSvg(30, 20, [
    '<rect width="30" height="20" fill="#050505"/>',
    '<rect x="0" y="0" width="30" height="8" fill="#33d5ff"/>',
    '<rect x="0" y="8" width="30" height="12" fill="#101828"/>'
  ]));
  await writeFile(config, JSON.stringify({
    minSsim: 0.999,
    regions: [
      { name: 'header', x: 0, y: 0, width: 30, height: 8 },
      { name: 'body', x: 0, y: 8, width: 30, height: 12 }
    ]
  }));

  const result = spawnSync(process.execPath, [
    diffBin,
    '--ref',
    ref,
    '--actual',
    actual,
    '--out',
    out,
    '--config',
    config,
    '--regions',
    'both',
    '--html',
    '--max-changed',
    '0',
    '--max-mean',
    '0',
    '--min-ssim',
    '0.999'
  ], { cwd: repoRoot, encoding: 'utf8' });

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const report = JSON.parse(await readFile(path.join(out, 'report.json'), 'utf8'));
  assert.equal(report.passed, false);
  assert.equal(report.regions[0].name, 'header');
  assert.equal(report.regions.some((region) => region.name === 'body'), true);
  assert.equal(report.regions.some((region) => region.name === 'auto-center'), true);
  assert.ok(report.regions[0].severity > 0);
  assert.match(report.verdict.topDifferences.join('\n'), /header/);
  assert.match(report.verdict.nextEdits.join('\n'), /header/);
  const html = await readFile(path.join(out, 'report.html'), 'utf8');
  assert.match(html, /BetterRef Report/);
  assert.match(html, /header/);
});

test('betterref-diff ignores configured dynamic regions in global and region metrics', async () => {
  const dir = await makeCase('ignore');
  const ref = path.join(dir, 'reference.svg');
  const actual = path.join(dir, 'actual.svg');
  const config = path.join(dir, '.betterref.json');
  const out = path.join(dir, 'out');

  await writeFile(ref, layeredSvg(20, 10, [
    '<rect width="20" height="10" fill="#ffffff"/>',
    '<rect x="0" y="0" width="10" height="10" fill="#000000"/>'
  ]));
  await writeFile(actual, layeredSvg(20, 10, [
    '<rect width="20" height="10" fill="#ffffff"/>',
    '<rect x="0" y="0" width="10" height="10" fill="#ff0000"/>'
  ]));
  await writeFile(config, JSON.stringify({
    ignoreRegions: [
      { name: 'dynamic-clock', x: 0, y: 0, width: 10, height: 10 }
    ]
  }));

  const result = spawnSync(process.execPath, [
    diffBin,
    '--ref',
    ref,
    '--actual',
    actual,
    '--out',
    out,
    '--config',
    config,
    '--max-changed',
    '0',
    '--max-mean',
    '0',
    '--min-ssim',
    '1'
  ], { cwd: repoRoot, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(await readFile(path.join(out, 'report.json'), 'utf8'));
  assert.equal(report.global.metrics.changedPercent, 0);
  assert.equal(report.global.metrics.meanAbsoluteChannelDiff, 0);
  assert.equal(report.global.metrics.ssim, 1);
  assert.equal(report.passed, true);
});

test('betterref-diff lets config thresholds apply when CLI thresholds are omitted', async () => {
  const dir = await makeCase('config-thresholds');
  const ref = path.join(dir, 'reference.svg');
  const actual = path.join(dir, 'actual.svg');
  const config = path.join(dir, '.betterref.json');
  const out = path.join(dir, 'out');
  await writeFile(ref, svg('#000000', 12, 12));
  await writeFile(actual, svg('#ffffff', 12, 12));
  await writeFile(config, JSON.stringify({
    thresholds: {
      maxChangedPercent: 100,
      maxMeanDiff: 255,
      minSsim: 0,
      minHashSimilarity: 0
    }
  }));

  const result = spawnSync(process.execPath, [
    diffBin,
    '--ref',
    ref,
    '--actual',
    actual,
    '--out',
    out,
    '--config',
    config
  ], { cwd: repoRoot, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(await readFile(path.join(out, 'report.json'), 'utf8'));
  assert.equal(report.thresholds.maxChangedPercent, 100);
  assert.equal(report.passed, true);
});

test('betterref-diff reports config errors with exit code 2', async () => {
  const dir = await makeCase('bad-config');
  const ref = path.join(dir, 'reference.svg');
  const actual = path.join(dir, 'actual.svg');
  const config = path.join(dir, '.betterref.json');
  const out = path.join(dir, 'out');
  await writeFile(ref, svg('#ffffff', 10, 10));
  await writeFile(actual, svg('#ffffff', 10, 10));
  await writeFile(config, JSON.stringify({
    regions: [
      { name: 'outside', x: 8, y: 8, width: 5, height: 5 }
    ]
  }));

  const result = spawnSync(process.execPath, [
    diffBin,
    '--ref',
    ref,
    '--actual',
    actual,
    '--out',
    out,
    '--config',
    config
  ], { cwd: repoRoot, encoding: 'utf8' });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /outside/);
});
