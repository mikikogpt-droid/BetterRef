import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const threeDBin = path.join(repoRoot, 'bin', 'betterref-3d.mjs');

async function makeCase(name) {
  const dir = path.join(tmpdir(), `betterref-3d-${process.pid}-${name}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function run3D(args, options = {}) {
  return spawnSync(process.execPath, [threeDBin, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    ...options
  });
}

test('betterref-3d prints usage and exits code 2 without mode inputs', () => {
  const result = run3D([]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: betterref-3d/);
  assert.match(result.stderr, /--make-plan/);
  assert.match(result.stderr, /--make-hunyuan-request/);
  assert.match(result.stderr, /--verify/);
});

test('betterref-3d creates a 3D asset plan from a reference analysis', async () => {
  const dir = await makeCase('plan');
  const analysis = path.join(dir, 'reference-analysis.json');
  const out = path.join(dir, '3d-out');
  const referencePath = path.join(dir, 'reference.png');
  await writeJson(analysis, {
    schemaVersion: 'betterref.reference.analysis.v1',
    source: referencePath,
    targets: ['ui', '3d'],
    image: { width: 320, height: 240 },
    objectCues: {
      modelable: true,
      confidence: 'medium',
      silhouette: 'rounded device with raised circular detail',
      materialSlots: ['base-color', 'metal-trim']
    },
    uncertainties: [{ unknown: 'Hidden sides', impact: 'Need more refs', need: 'side/back ref' }]
  });

  const result = run3D([
    '--make-plan',
    '--analysis',
    analysis,
    '--out',
    out,
    '--format',
    'glb',
    '--json'
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.schemaVersion, 'betterref.3d.plan.result.v1');
  assert.match(payload.artifacts.planPath, /3d-asset-plan\.json$/);

  const plan = JSON.parse(await readFile(path.join(out, '3d-asset-plan.json'), 'utf8'));
  assert.equal(plan.schemaVersion, 'betterref.3d.asset.plan.v1');
  assert.equal(plan.threeDRequired, true);
  assert.equal(plan.assets.length, 1);
  assert.equal(plan.assets[0].id, 'model-001');
  assert.equal(plan.assets[0].status, 'pending');
  assert.equal(plan.assets[0].provider, 'hunyuan');
  assert.equal(plan.assets[0].sourceImage, referencePath);
  assert.equal(plan.assets[0].targetFormat, 'glb');
  assert.deepEqual(plan.assets[0].materialSlots, ['base-color', 'metal-trim']);
  assert.equal(plan.assets[0].acceptanceCriteria.some((item) => /turntable/i.test(item)), true);
});

test('betterref-3d creates a Hunyuan request with both Hugging Face adapters', async () => {
  const dir = await makeCase('hunyuan-request');
  const plan = path.join(dir, '3d-asset-plan.json');
  const out = path.join(dir, '3d-out');
  const sourceImage = path.join(dir, 'reference.png');
  await writeJson(plan, {
    schemaVersion: 'betterref.3d.asset.plan.v1',
    threeDRequired: true,
    assets: [
      {
        id: 'model-001',
        status: 'pending',
        provider: 'hunyuan',
        sourceImage,
        targetFormat: 'glb',
        prompt: 'rounded device with raised circular detail',
        targetPath: 'public/betterref-assets/model-001.glb',
        acceptanceCriteria: ['Mesh stats must show non-empty geometry.', 'Turntable evidence is required.']
      }
    ]
  });

  const result = run3D([
    '--make-hunyuan-request',
    '--plan',
    plan,
    '--out',
    out,
    '--provider',
    'both',
    '--space',
    'tencent/Hunyuan3D-2',
    '--endpoint',
    'https://hunyuan.example.endpoints.huggingface.cloud',
    '--json'
  ], {
    env: { ...process.env, HF_TOKEN: 'hf_test_token' }
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.schemaVersion, 'betterref.hunyuan.request.v1');
  assert.match(payload.artifacts.requestPath, /hunyuan-request\.json$/);

  const request = JSON.parse(await readFile(path.join(out, 'hunyuan-request.json'), 'utf8'));
  assert.equal(request.schemaVersion, 'betterref.hunyuan.request.v1');
  assert.deepEqual(request.providers, ['space', 'endpoint']);
  assert.deepEqual(request.huggingFace, {
    space: 'tencent/Hunyuan3D-2',
    endpoint: 'https://hunyuan.example.endpoints.huggingface.cloud',
    customUrl: null
  });
  assert.equal(request.auth.env, 'HF_TOKEN');
  assert.equal(request.auth.available, true);
  assert.equal(request.assets.length, 1);
  assert.equal(request.assets[0].id, 'model-001');
  assert.equal(request.assets[0].sourceImage, sourceImage);
  assert.equal(request.assets[0].targetFormat, 'glb');
  assert.equal(request.assets[0].targetPath, 'public/betterref-assets/model-001.glb');
  assert.equal(request.assets[0].prompt, 'rounded device with raised circular detail');
  assert.equal(request.assets[0].acceptanceCriteria.some((item) => /Mesh stats/i.test(item)), true);
});

test('betterref-3d verify treats omitted evidence as empty and writes a failing verdict', async () => {
  const dir = await makeCase('verify-fail');
  const plan = path.join(dir, '3d-asset-plan.json');
  const out = path.join(dir, '3d-out');
  await writeJson(plan, {
    schemaVersion: 'betterref.3d.asset.plan.v1',
    threeDRequired: true,
    assets: [
      {
        id: 'model-001',
        status: 'pending',
        provider: 'hunyuan',
        targetFormat: 'glb',
        targetPath: 'public/betterref-assets/model-001.glb'
      }
    ]
  });

  const result = run3D([
    '--verify',
    '--plan',
    plan,
    '--out',
    out,
    '--project',
    dir,
    '--json'
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.match(result.stdout, /betterref\.3d\.verdict\.v1/);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.schemaVersion, 'betterref.3d.verdict.v1');
  assert.equal(payload.passed, false);
  assert.equal(payload.verdict, 'fail');
  assert.equal(payload.hardFailPresent, true);
  assert.equal(payload.inputs.planPath, path.resolve(plan));
  assert.equal(payload.inputs.evidencePath, null);
  assert.match(payload.artifacts.verdictPath, /3d-verdict\.json$/);
  assert.equal(payload.assets.length, 1);
  assert.equal(payload.assets[0].id, 'model-001');
  assert.equal(payload.assets[0].passed, false);
  assert.equal(payload.blockingReasons.some((item) => /model-001 is pending/.test(item)), true);
  assert.equal(payload.blockingReasons.some((item) => /model-001 is missing model file/.test(item)), true);
  assert.equal(payload.blockingReasons.some((item) => /model-001 is missing mesh stats/.test(item)), true);
  assert.equal(payload.blockingReasons.some((item) => /model-001 is missing render or turntable evidence/.test(item)), true);

  const verdict = JSON.parse(await readFile(path.join(out, '3d-verdict.json'), 'utf8'));
  assert.equal(verdict.verdict, 'fail');
  assert.equal(verdict.passed, false);
});

test('betterref-3d verify exits 0 when model evidence passes', async () => {
  const dir = await makeCase('verify-pass');
  const project = path.join(dir, 'project');
  const model = path.join(project, 'public', 'betterref-assets', 'model-001.glb');
  const plan = path.join(dir, '3d-asset-plan.json');
  const evidence = path.join(dir, '3d-evidence.json');
  const out = path.join(dir, '3d-out');
  await mkdir(path.dirname(model), { recursive: true });
  await writeFile(model, 'fake-glb-bytes');
  await writeJson(plan, {
    schemaVersion: 'betterref.3d.asset.plan.v1',
    threeDRequired: true,
    assets: [
      {
        id: 'model-001',
        status: 'pass',
        provider: 'hunyuan',
        targetFormat: 'glb',
        targetPath: 'public/betterref-assets/model-001.glb'
      }
    ]
  });
  await writeJson(evidence, {
    schemaVersion: 'betterref.3d.evidence.v1',
    assets: [
      {
        id: 'model-001',
        status: 'completed',
        modelPath: 'public/betterref-assets/model-001.glb',
        meshStats: { vertexCount: 120, faceCount: 60 },
        renders: ['turntable/front.png']
      }
    ]
  });

  const result = run3D([
    '--verify',
    '--plan',
    plan,
    '--evidence',
    evidence,
    '--out',
    out,
    '--project',
    project,
    '--json'
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.schemaVersion, 'betterref.3d.verdict.v1');
  assert.equal(payload.passed, true);
  assert.equal(payload.verdict, 'pass');
  assert.equal(payload.hardFailPresent, false);
  assert.deepEqual(payload.blockingReasons, []);
  assert.equal(payload.assets[0].passed, true);

  const verdict = JSON.parse(await readFile(path.join(out, '3d-verdict.json'), 'utf8'));
  assert.equal(verdict.verdict, 'pass');
});
