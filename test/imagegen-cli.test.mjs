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
  assert.match(payload.requests[0].outputSlot, /generated[\\/]asset-001\.png$/);
  assert.match(payload.requests[0].attachCommand, /--attach asset-001=/);
  assert.match(payload.requests[0].autoAttachCommand, /--auto-attach-dir/);
  assert.match(payload.requests[0].wireIntoAppReminder, /wire public\/betterref-assets\/hero\.png into the actual app/);
  assert.deepEqual(payload.requests[0].publicUrlCandidates.slice(0, 2), [
    '/betterref-assets/hero.png',
    'betterref-assets/hero.png'
  ]);
  assert.match(payload.requests[0].prompt, /Create a premium ONETAPGG/);
  assert.match(payload.requests[0].prompt, /Do not include browser chrome/);

  const queue = JSON.parse(await readFile(path.join(out, 'imagegen-requests.json'), 'utf8'));
  assert.equal(queue.requests.length, 1);
  assert.match(queue.generatedDir, /generated$/);
  const prompts = await readFile(path.join(out, 'imagegen-prompts.md'), 'utf8');
  assert.match(prompts, /built-in `image_gen`/);
  assert.match(prompts, /Role: cinematic-hero/);
  assert.match(prompts, /Output slot:/);
  assert.match(prompts, /Attach command:/);
  assert.match(prompts, /Native asset is sharp/);
  assert.match(prompts, /public\/betterref-assets\/hero\.png/);
  assert.match(prompts, /Do not leave project assets under/);
});

test('betterref-imagegen ignores pending HyperFrames assets', async () => {
  const dir = await makeCase('skip-hyperframes');
  const assetPlan = path.join(dir, 'asset-plan.json');
  const out = path.join(dir, 'imagegen');
  await writeJson(assetPlan, {
    schemaVersion: 'betterref.asset.plan.v1',
    imagegenRequired: true,
    hyperframesRequired: true,
    assets: [
      {
        id: 'asset-001',
        status: 'pending',
        tool: 'hyperframes',
        implementation: 'hyperframes-composition-rendered-video',
        role: 'animated-cinematic-hero',
        targetPath: 'public/betterref-assets/hero-loop.webm',
        prompt: 'Build a HyperFrames neon logo reveal.'
      },
      {
        id: 'asset-002',
        status: 'pending',
        tool: 'image_gen',
        role: 'game-card-art',
        targetPath: 'public/betterref-assets/game-card.png',
        prompt: 'Create game-card art.'
      }
    ]
  });

  const result = runImagegen(['--asset-plan', assetPlan, '--out', out, '--json']);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.requests.length, 1);
  assert.equal(payload.requests[0].id, 'asset-002');
  assert.equal(payload.requests[0].tool, 'image_gen');
});

test('betterref-imagegen ignores pending Hunyuan 3D model assets in mixed plans', async () => {
  const dir = await makeCase('skip-hunyuan-mixed');
  const assetPlan = path.join(dir, 'asset-plan.json');
  const out = path.join(dir, 'imagegen');
  await writeJson(assetPlan, {
    schemaVersion: 'betterref.asset.plan.v1',
    imagegenRequired: true,
    threeDRequired: true,
    assets: [
      {
        id: 'asset-001',
        status: 'pending',
        tool: 'image_gen',
        role: 'cinematic-hero',
        targetPath: 'public/betterref-assets/hero.png',
        prompt: 'Create a 3D-looking mascot background as a raster asset.'
      },
      {
        id: 'model-001',
        status: 'pending',
        tool: 'hunyuan3d',
        implementation: 'hunyuan-3d-model-via-tencent-api',
        role: 'hunyuan-3d-model',
        targetPath: 'public/betterref-assets/hunyuan-model-01.glb',
        targetFormat: 'glb',
        prompt: 'Generate a GLB mascot model.'
      }
    ]
  });

  const result = runImagegen(['--asset-plan', assetPlan, '--out', out, '--json']);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.requests.length, 1);
  assert.equal(payload.requests[0].id, 'asset-001');
  assert.equal(payload.requests[0].targetPath, 'public/betterref-assets/hero.png');
});

test('betterref-imagegen reports no imagegen work for 3D-only model plans', async () => {
  const dir = await makeCase('skip-hunyuan-only');
  const assetPlan = path.join(dir, 'asset-plan.json');
  const out = path.join(dir, 'imagegen');
  await writeJson(assetPlan, {
    schemaVersion: 'betterref.asset.plan.v1',
    imagegenRequired: false,
    threeDRequired: true,
    assets: [
      {
        id: 'model-001',
        status: 'pending',
        tool: 'hunyuan3d',
        implementation: 'hunyuan-3d-model-via-tencent-api',
        role: 'hunyuan-3d-model',
        targetPath: 'public/betterref-assets/hunyuan-model-01.glb',
        targetFormat: 'glb'
      }
    ]
  });

  const queueResult = runImagegen(['--asset-plan', assetPlan, '--out', out, '--json']);
  assert.equal(queueResult.status, 0, queueResult.stderr || queueResult.stdout);
  const queue = JSON.parse(queueResult.stdout);
  assert.equal(queue.requests.length, 0);

  const statusResult = runImagegen(['--asset-plan', assetPlan, '--status', '--out', out, '--json']);
  assert.equal(statusResult.status, 0, statusResult.stderr || statusResult.stdout);
  const status = JSON.parse(statusResult.stdout);
  assert.deepEqual(status.counts, {});
  assert.equal(status.items.length, 0);
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

test('betterref-imagegen auto-attaches generated files by asset id from a directory', async () => {
  const dir = await makeCase('auto-attach');
  const project = path.join(dir, 'project');
  const generatedDir = path.join(dir, 'generated');
  const assetPlan = path.join(dir, 'asset-plan.json');
  const generated = path.join(generatedDir, 'asset-001.png');
  await mkdir(project, { recursive: true });
  await mkdir(generatedDir, { recursive: true });
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
    '--auto-attach-dir', generatedDir,
    '--project', project,
    '--json'
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.schemaVersion, 'betterref.imagegen.attach.v1');
  assert.equal(payload.attached[0].id, 'asset-001');
  await readFile(path.join(project, 'public', 'betterref-assets', 'hero.png'));
  const updatedPlan = JSON.parse(await readFile(assetPlan, 'utf8'));
  assert.equal(updatedPlan.assets[0].status, 'pass');
  assert.equal(updatedPlan.assets[0].verification, 'betterref-imagegen attach');
});

test('betterref-imagegen status separates pending, generated, rendered, and not-rendered states', async () => {
  const dir = await makeCase('status');
  const project = path.join(dir, 'project');
  const out = path.join(dir, 'imagegen');
  const generatedDir = path.join(out, 'generated');
  const assetPlan = path.join(dir, 'asset-plan.json');
  const browserEvidence = path.join(dir, 'browser-evidence.json');
  const attachedAsset = path.join(project, 'public', 'betterref-assets', 'attached.png');
  const missingRenderedAsset = path.join(project, 'public', 'betterref-assets', 'missing-rendered.png');
  await mkdir(path.dirname(attachedAsset), { recursive: true });
  await mkdir(generatedDir, { recursive: true });
  await writeCheckerPng(path.join(generatedDir, 'asset-002.png'));
  await writeCheckerPng(attachedAsset);
  await writeCheckerPng(missingRenderedAsset);
  await writeJson(assetPlan, {
    schemaVersion: 'betterref.asset.plan.v1',
    imagegenRequired: true,
    assets: [
      {
        id: 'asset-001',
        status: 'pending',
        targetPath: 'public/betterref-assets/pending.png'
      },
      {
        id: 'asset-002',
        status: 'pending',
        targetPath: 'public/betterref-assets/generated.png'
      },
      {
        id: 'asset-003',
        status: 'pass',
        targetPath: 'public/betterref-assets/attached.png',
        generatedPath: 'public/betterref-assets/attached.png',
        nativeWidth: 128,
        nativeHeight: 128,
        measuredSharpness: 25,
        verifiedAt: '2026-05-10T00:00:00.000Z',
        verification: 'betterref-imagegen attach'
      },
      {
        id: 'asset-004',
        status: 'pass',
        targetPath: 'public/betterref-assets/missing-rendered.png',
        generatedPath: 'public/betterref-assets/missing-rendered.png',
        nativeWidth: 128,
        nativeHeight: 128,
        measuredSharpness: 25,
        verifiedAt: '2026-05-10T00:00:00.000Z',
        verification: 'betterref-imagegen attach'
      }
    ]
  });
  await writeJson(browserEvidence, {
    viewport: { width: 1440, height: 900 },
    page: { scrollHeight: 1200, bodyTextLength: 100, interactiveCount: 4 },
    fonts: { ready: true, status: 'loaded' },
    console: [],
    images: [{ src: '/betterref-assets/attached.png', naturalWidth: 128, naturalHeight: 128, renderedWidth: 128, renderedHeight: 128 }]
  });

  const result = runImagegen([
    '--asset-plan', assetPlan,
    '--status',
    '--out', out,
    '--auto-attach-dir', generatedDir,
    '--project', project,
    '--browser-evidence', browserEvidence,
    '--json'
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.schemaVersion, 'betterref.imagegen.status.v1');
  assert.equal(payload.counts.pending, 1);
  assert.equal(payload.counts.generated_not_attached, 1);
  assert.equal(payload.counts.pass, 1);
  assert.equal(payload.counts.attached_not_rendered, 1);
  assert.equal(payload.items.find((item) => item.id === 'asset-002').status, 'generated_not_attached');
  assert.equal(payload.items.find((item) => item.id === 'asset-004').status, 'attached_not_rendered');

  const written = JSON.parse(await readFile(path.join(out, 'imagegen-status.json'), 'utf8'));
  assert.equal(written.counts.generated_not_attached, 1);
});
