import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const regionsBin = path.join(repoRoot, 'bin', 'betterref-regions.mjs');

async function makeCase(name) {
  const dir = path.join(tmpdir(), `betterref-regions-${process.pid}-${name}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

test('betterref-regions prints usage and exits with code 2 when required args are missing', () => {
  const result = spawnSync(process.execPath, [regionsBin], {
    cwd: repoRoot,
    encoding: 'utf8'
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: betterref-regions/);
  assert.match(result.stderr, /--input/);
  assert.match(result.stderr, /--out/);
});

test('betterref-regions writes .betterref.json from Chrome-style DOM boxes', async () => {
  const dir = await makeCase('chrome-boxes');
  const input = path.join(dir, 'boxes.json');
  const out = path.join(dir, '.betterref.json');

  await writeFile(input, JSON.stringify({
    viewport: { width: 1440, height: 900 },
    elements: [
      { name: 'header', selector: 'header.site-header', boundingBox: { x: 0.2, y: 0.4, width: 1439.7, height: 78.8 } },
      { name: 'hero', selector: '[data-betterref="hero"]', rect: { left: 0, top: 79, right: 1440, bottom: 560 } },
      { name: 'hidden', selector: '.hidden', rect: { x: 10, y: 10, width: 0, height: 40 } }
    ]
  }));

  const result = spawnSync(process.execPath, [
    regionsBin,
    '--input',
    input,
    '--out',
    out,
    '--threshold',
    'maxChangedPercent=4',
    '--threshold',
    'minSsim=0.98'
  ], { cwd: repoRoot, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /regions=2/);
  const config = JSON.parse(await readFile(out, 'utf8'));
  assert.equal(config.viewport, '1440x900');
  assert.equal(config.matchSize, 'strict');
  assert.equal(config.thresholds.maxChangedPercent, 4);
  assert.equal(config.thresholds.minSsim, 0.98);
  assert.equal(config.regions.length, 2);
  assert.deepEqual(config.regions[0], {
    name: 'header',
    x: 0,
    y: 0,
    width: 1440,
    height: 79,
    weight: 1,
    source: 'header.site-header'
  });
  assert.equal(config.regions[1].name, 'hero');
  assert.equal(config.metadata.generatedBy, 'betterref-regions');
});

test('betterref-regions can merge thresholds and ignoreRegions from an existing config', async () => {
  const dir = await makeCase('merge');
  const input = path.join(dir, 'boxes.json');
  const merge = path.join(dir, 'base.json');
  const out = path.join(dir, '.betterref.json');

  await writeFile(input, JSON.stringify({
    boxes: [
      { name: 'card-grid', bounds: { x: 32, y: 400, width: 800, height: 300 } }
    ]
  }));
  await writeFile(merge, JSON.stringify({
    viewport: '1200x800',
    matchSize: 'reference',
    thresholds: { maxMeanDiff: 8 },
    ignoreRegions: [{ name: 'clock', x: 1000, y: 20, width: 80, height: 24 }]
  }));

  const result = spawnSync(process.execPath, [
    regionsBin,
    '--input',
    input,
    '--out',
    out,
    '--merge',
    merge
  ], { cwd: repoRoot, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const config = JSON.parse(await readFile(out, 'utf8'));
  assert.equal(config.viewport, '1200x800');
  assert.equal(config.matchSize, 'reference');
  assert.deepEqual(config.thresholds, { maxMeanDiff: 8 });
  assert.deepEqual(config.ignoreRegions, [{ name: 'clock', x: 1000, y: 20, width: 80, height: 24 }]);
  assert.equal(config.regions[0].name, 'card-grid');
});

test('betterref-regions rejects boxes outside the viewport in strict bounds mode', async () => {
  const dir = await makeCase('strict-bounds');
  const input = path.join(dir, 'boxes.json');
  const out = path.join(dir, '.betterref.json');
  await writeFile(input, JSON.stringify({
    viewport: { width: 100, height: 100 },
    elements: [
      { name: 'overflow', rect: { x: 80, y: 10, width: 40, height: 20 } }
    ]
  }));

  const result = spawnSync(process.execPath, [
    regionsBin,
    '--input',
    input,
    '--out',
    out,
    '--strict-bounds'
  ], { cwd: repoRoot, encoding: 'utf8' });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /overflow/);
  assert.match(result.stderr, /outside viewport/);
});
