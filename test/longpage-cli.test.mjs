import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const longpageBin = path.join(repoRoot, 'bin', 'betterref-longpage.mjs');

async function makeCase(name) {
  const dir = path.join(tmpdir(), `betterref-longpage-${process.pid}-${name}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

function svg(width, height, shapes) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`,
    ...shapes,
    '</svg>'
  ].join('');
}

test('betterref-longpage prints usage and exits code 2 when required args are missing', () => {
  const result = spawnSync(process.execPath, [longpageBin], {
    cwd: repoRoot,
    encoding: 'utf8'
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: betterref-longpage/);
  assert.match(result.stderr, /--ref/);
  assert.match(result.stderr, /--browser-evidence/);
});

test('betterref-longpage auto-crops browser chrome and diffs full page plus sections', async () => {
  const dir = await makeCase('auto-crop-sections');
  const reference = path.join(dir, 'reference-with-browser.svg');
  const actualFull = path.join(dir, 'actual-full.svg');
  const sectionDir = path.join(dir, 'sections');
  const out = path.join(dir, 'out');
  await mkdir(sectionDir, { recursive: true });

  await writeFile(reference, svg(100, 100, [
    '<rect x="0" y="0" width="100" height="40" fill="#202124"/>',
    '<circle cx="12" cy="14" r="4" fill="#ff5f57"/>',
    '<circle cx="26" cy="14" r="4" fill="#ffbd2e"/>',
    '<circle cx="40" cy="14" r="4" fill="#28c840"/>',
    '<rect x="0" y="40" width="100" height="20" fill="#ff0000"/>',
    '<rect x="0" y="60" width="100" height="40" fill="#0000ff"/>'
  ]));
  await writeFile(actualFull, svg(100, 60, [
    '<rect x="0" y="0" width="100" height="20" fill="#ff0000"/>',
    '<rect x="0" y="20" width="100" height="40" fill="#0000ff"/>'
  ]));

  const header = path.join(sectionDir, 'header.svg');
  const hero = path.join(sectionDir, 'hero.svg');
  await writeFile(header, svg(100, 20, ['<rect x="0" y="0" width="100" height="20" fill="#ff0000"/>']));
  await writeFile(hero, svg(100, 40, ['<rect x="0" y="0" width="100" height="40" fill="#0000ff"/>']));

  const evidence = path.join(dir, 'browser-evidence.json');
  await writeFile(evidence, JSON.stringify({
    viewport: { width: 100, height: 40 },
    page: { scrollHeight: 60 },
    fullPageScreenshotPath: actualFull,
    sectionScreenshotPaths: [
      { name: 'header', path: header, clip: { x: 0, y: 0, width: 100, height: 20, scale: 1 } },
      { name: 'hero', path: hero, clip: { x: 0, y: 20, width: 100, height: 40, scale: 1 } }
    ]
  }, null, 2));

  const result = spawnSync(process.execPath, [
    longpageBin,
    '--ref',
    reference,
    '--actual-full',
    actualFull,
    '--browser-evidence',
    evidence,
    '--out',
    out,
    '--crop-reference',
    'auto',
    '--max-changed',
    '0',
    '--max-mean',
    '0',
    '--min-ssim',
    '1',
    '--json'
  ], { cwd: repoRoot, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.schemaVersion, 'betterref.longpage.v1');
  assert.equal(payload.referenceCrop.cropped, true);
  assert.equal(payload.referenceCrop.cropY, 40);
  assert.equal(payload.fullPageStructure.passed, true);
  assert.equal(payload.sections.length, 2);
  assert.equal(payload.sections.every((section) => section.passed), true);
  assert.match(payload.artifacts.referenceCroppedPath, /reference-cropped\.png$/);
  assert.match(payload.sections[0].referenceSlicePath, /reference-sections[\\/]+header\.png$/);
  assert.match(payload.sections[1].reportPath, /section-reports[\\/]+hero[\\/]+report\.json$/);
  assert.ok((await readFile(path.join(out, 'reference-cropped.png'))).length > 0);
  assert.ok((await readFile(path.join(out, 'reference-sections', 'header.png'))).length > 0);
  assert.ok((await readFile(path.join(out, 'longpage-report.json'))).length > 0);
});
