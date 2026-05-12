import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';

const repoRoot = path.resolve(import.meta.dirname, '..');
const referenceBin = path.join(repoRoot, 'bin', 'betterref-reference.mjs');

async function makeCase(name) {
  const dir = path.join(tmpdir(), `betterref-reference-${process.pid}-${name}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function writeReference(filePath) {
  await sharp({
    create: {
      width: 320,
      height: 240,
      channels: 3,
      background: { r: 18, g: 24, b: 38 }
    }
  })
    .composite([
      {
        input: Buffer.from(
          `<svg width="320" height="240" xmlns="http://www.w3.org/2000/svg">
            <rect x="0" y="0" width="320" height="240" fill="#121826"/>
            <rect x="42" y="34" width="236" height="150" rx="28" fill="#7dd3fc"/>
            <circle cx="116" cy="110" r="42" fill="#f97316"/>
            <rect x="176" y="78" width="72" height="64" rx="10" fill="#e5e7eb"/>
          </svg>`
        ),
        top: 0,
        left: 0
      }
    ])
    .png()
    .toFile(filePath);
}

async function writeLargeSvgReference(filePath) {
  await writeFile(
    filePath,
    `<svg width="20000" height="15000" viewBox="0 0 20000 15000" xmlns="http://www.w3.org/2000/svg">
      <rect width="20000" height="15000" fill="#121826"/>
      <rect x="2200" y="1800" width="15600" height="9400" rx="900" fill="#7dd3fc"/>
      <circle cx="7400" cy="7000" r="2600" fill="#f97316"/>
      <rect x="11200" y="4900" width="4300" height="4100" rx="420" fill="#e5e7eb"/>
    </svg>`
  );
}

test('betterref-reference prints usage and exits code 2 without a reference image', () => {
  const result = spawnSync(process.execPath, [referenceBin], {
    cwd: repoRoot,
    encoding: 'utf8'
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: betterref-reference/);
  assert.match(result.stderr, /--ref/);
  assert.match(result.stderr, /--out/);
});

test('betterref-reference analyzes a visual reference and writes supervisor artifacts', async () => {
  const dir = await makeCase('analysis');
  const ref = path.join(dir, 'reference.png');
  const out = path.join(dir, 'reference-out');
  await writeReference(ref);

  const result = spawnSync(process.execPath, [
    referenceBin,
    '--ref',
    ref,
    '--out',
    out,
    '--target',
    'ui,3d',
    '--json'
  ], { cwd: repoRoot, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.schemaVersion, 'betterref.reference.v1');
  assert.match(payload.artifacts.analysisPath, /reference-analysis\.json$/);
  assert.match(payload.artifacts.visualChecklistPath, /visual-checklist\.md$/);
  assert.match(payload.artifacts.threeDBriefPath, /3d-brief\.md$/);
  assert.match(payload.artifacts.negativePromptsPath, /negative-prompts\.md$/);

  const analysis = JSON.parse(await readFile(path.join(out, 'reference-analysis.json'), 'utf8'));
  assert.equal(analysis.image.width, 320);
  assert.equal(analysis.image.height, 240);
  assert.equal(analysis.targets.includes('ui'), true);
  assert.equal(analysis.targets.includes('3d'), true);
  assert.equal(analysis.pixelFacts.aspectRatio, '4:3');
  assert.equal(analysis.color.swatches.length >= 3, true);
  assert.equal(analysis.objectCues.modelable, true);
  assert.equal(analysis.objectCues.confidence, 'medium');
  assert.equal(analysis.uncertainties.some((item) => /Hidden sides/i.test(item.unknown)), true);

  const brief = await readFile(path.join(out, '3d-brief.md'), 'utf8');
  assert.match(brief, /# BetterRef 3D Brief/);
  assert.match(brief, /Silhouette/);
  assert.match(brief, /Known Unknowns/);

  const checklist = await readFile(path.join(out, 'visual-checklist.md'), 'utf8');
  assert.match(checklist, /# BetterRef Visual Checklist/);
  assert.match(checklist, /Aspect ratio: 4:3/);

  const negativePrompts = await readFile(path.join(out, 'negative-prompts.md'), 'utf8');
  assert.match(negativePrompts, /flat billboard/i);
  assert.match(negativePrompts, /screenshot/i);
});

test('betterref-reference analyzes oversized design references without Sharp pixel limit failures', async () => {
  const dir = await makeCase('large-svg');
  const ref = path.join(dir, 'large-reference.svg');
  const out = path.join(dir, 'reference-out');
  await writeLargeSvgReference(ref);

  const result = spawnSync(process.execPath, [
    referenceBin,
    '--ref',
    ref,
    '--out',
    out,
    '--json'
  ], { cwd: repoRoot, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const analysis = JSON.parse(await readFile(path.join(out, 'reference-analysis.json'), 'utf8'));
  assert.equal(analysis.image.width, 20000);
  assert.equal(analysis.image.height, 15000);
  assert.equal(analysis.pixelFacts.aspectRatio, '4:3');
});
