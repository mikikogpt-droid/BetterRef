import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';

const repoRoot = path.resolve(import.meta.dirname, '..');
const imagegenBin = path.join(repoRoot, 'bin', 'betterref-imagegen.mjs');

async function makeCase(name) {
  const dir = path.join(tmpdir(), `betterref-imagegen-${process.pid}-${name}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function writeJson(filePath, value) {
  await writeFile(filePath, JSON.stringify(value, null, 2));
}

function runImagegen(args) {
  return spawnSync(process.execPath, [imagegenBin, ...args], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
}

async function writeCheckerPng(filePath) {
  const size = 128;
  const channels = 3;
  const data = Buffer.alloc(size * size * channels);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * channels;
      const value = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0 ? 24 : 232;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
    }
  }
  await sharp(data, { raw: { width: size, height: size, channels } }).png().toFile(filePath);
}

test('betterref-imagegen prints usage and exits 2 without an asset plan', () => {
  const result = runImagegen([]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: betterref-imagegen/);
  assert.match(result.stderr, /--asset-plan/);
});

test('betterref-imagegen writes built-in image_gen requests for pending assets', async () => {
  const dir = await makeCase('queue');
  const assetPlan = path.join(dir, 'asset-plan.json');
  const out = path.join(dir, 'imagegen');
  await writeJson(assetPlan, {
    schemaVersion: 'betterref.asset.plan.v1',
    imagegenRequired: true,
    assets: [
      {
        id: 'asset-001',
        status: 'pending',
        role: 'cinematic-hero',
        targetPath: 'public/betterref-assets/hero.png',
        minNativeWidth: 128,
        minNativeHeight: 96,
        acceptanceCriteria: ['Native asset is sharp.', 'UI text remains code-native.'],
        prompt: 'Create a premium ONETAPGG neon 3D hero asset.'
      },
      {
        id: 'asset-002',
        status: 'pass',
        targetPath: 'public/betterref-assets/logo.png',
        prompt: 'Already complete.'
      }
    ]
  });

  const result = runImagegen(['--asset-plan', assetPlan, '--out', out, '--json']);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.schemaVersion, 'betterref.imagegen.queue.v1');
  assert.equal(payload.requests.length, 1);
  assert.equal(payload.requests[0].id, 'asset-001');
  assert.equal(payload.requests[0].tool, 'image_gen');
  assert.equal(payload.requests[0].mode, 'built-in');
  assert.equal(payload.requests[0].role, 'cinematic-hero');
  assert.equal(payload.requests[0].phase, null);
  assert.equal(payload.requests[0].acceptanceCriteria.length, 2);
  assert.equal(payload.requests[0].targetPath, 'public/betterref-assets/hero.png');
  assert.match(payload.requests[0].prompt, /Create a premium ONETAPGG/);
  assert.match(payload.requests[0].prompt, /Do not include browser chrome/);

  const queue = JSON.parse(await readFile(path.join(out, 'imagegen-requests.json'), 'utf8'));
  assert.equal(queue.requests.length, 1);
  const prompts = await readFile(path.join(out, 'imagegen-prompts.md'), 'utf8');
  assert.match(prompts, /built-in `image_gen`/);
  assert.match(prompts, /Role: cinematic-hero/);
  assert.match(prompts, /Native asset is sharp/);
  assert.match(prompts, /public\/betterref-assets\/hero\.png/);
  assert.match(prompts, /Do not leave project assets under/);
});

test('betterref-imagegen attaches a generated asset and marks the plan item pass', async () => {
  const dir = await makeCase('attach');
  const project = path.join(dir, 'project');
  const assetPlan = path.join(dir, 'asset-plan.json');
  const generated = path.join(dir, 'generated-hero.png');
  await mkdir(project, { recursive: true });
  await writeCheckerPng(generated);
  await writeJson(assetPlan, {
    schemaVersion: 'betterref.asset.plan.v1',
    imagegenRequired: true,
    assets: [
      {
        id: 'asset-001',
        status: 'pending',
        role: 'cinematic-hero',
        targetPath: 'public/betterref-assets/hero.png',
        minNativeWidth: 96,
        minNativeHeight: 96,
        minSharpness: 20,
        prompt: 'Create a premium hero.'
      }
    ]
  });

  const result = runImagegen([
    '--asset-plan', assetPlan,
    '--attach', `asset-001=${generated}`,
    '--project', project,
    '--json'
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.schemaVersion, 'betterref.imagegen.attach.v1');
  assert.equal(payload.attached[0].id, 'asset-001');
  assert.match(payload.attached[0].targetPath, /public\/betterref-assets\/hero\.png/);
  assert.equal(payload.attached[0].nativeWidth, 128);
  assert.equal(payload.attached[0].nativeHeight, 128);
  assert.equal(payload.attached[0].measuredSharpness >= 20, true);

  await readFile(path.join(project, 'public', 'betterref-assets', 'hero.png'));
  const updatedPlan = JSON.parse(await readFile(assetPlan, 'utf8'));
  assert.equal(updatedPlan.assets[0].status, 'pass');
  assert.match(updatedPlan.assets[0].generatedPath, /public\/betterref-assets\/hero\.png/);
  assert.equal(updatedPlan.assets[0].nativeWidth, 128);
  assert.equal(updatedPlan.assets[0].nativeHeight, 128);
  assert.equal(updatedPlan.assets[0].measuredSharpness >= 20, true);
});
