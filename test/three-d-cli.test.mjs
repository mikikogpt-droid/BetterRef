import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { once } from 'node:events';

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

function run3DAsync(args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [threeDBin, ...args], {
      cwd: repoRoot,
      ...options
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (status) => {
      resolve({ status, stdout, stderr });
    });
  });
}

async function writeModelAndRender(project, name = 'model-001') {
  const modelRelative = `public/betterref-assets/${name}.glb`;
  const renderRelative = `evidence/${name}-turntable-front.png`;
  const model = path.join(project, modelRelative);
  const render = path.join(project, renderRelative);
  await mkdir(path.dirname(model), { recursive: true });
  await mkdir(path.dirname(render), { recursive: true });
  await writeFile(model, 'fake-glb-bytes');
  await writeFile(render, 'fake-render-bytes');
  return { modelRelative, renderRelative };
}

async function readRequestBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function writeHunyuanMetadata(dir, { id = 'model-001', targetPath = 'public/betterref-assets/model-001.glb' } = {}) {
  const request = path.join(dir, 'hunyuan-request.json');
  const response = path.join(dir, 'hunyuan-response.json');
  await writeJson(request, {
    schemaVersion: 'betterref.hunyuan.request.v1',
    providers: ['space', 'endpoint'],
    huggingFace: {
      space: 'tencent/Hunyuan3D-2',
      endpoint: 'https://hunyuan.example.endpoints.huggingface.cloud',
      customUrl: null
    },
    assets: [{ id, targetPath }]
  });
  await writeJson(response, {
    schemaVersion: 'betterref.hunyuan.response.v1',
    provider: 'endpoint',
    assets: [{ id, status: 'completed', targetPath, responseId: `${id}-hf-job` }]
  });
  return { request, response };
}

async function writeTencentHunyuanMetadata(dir, { id = 'model-001', targetPath = 'public/betterref-assets/model-001.glb' } = {}) {
  const request = path.join(dir, 'hunyuan-request.json');
  const response = path.join(dir, 'hunyuan-response.json');
  await writeJson(request, {
    schemaVersion: 'betterref.hunyuan.request.v1',
    providers: ['tencent'],
    tencentCloud: {
      endpoint: 'hunyuan3d.tencentcloudapi.com',
      region: 'ap-guangzhou',
      edition: 'pro',
      submitAction: 'SubmitHunyuanTo3DProJob',
      queryAction: 'QueryHunyuanTo3DProJob',
      model: '3.1',
      resultFormat: 'GLB',
      enablePBR: true,
      faceCount: 50000
    },
    assets: [{ id, targetPath }]
  });
  await writeJson(response, {
    schemaVersion: 'betterref.hunyuan.response.v1',
    provider: 'tencent',
    requestId: 'tc-request-001',
    assets: [
      {
        id,
        status: 'DONE',
        targetPath,
        jobId: `${id}-tc-job`,
        requestId: 'tc-request-001',
        resultFile3Ds: [{ type: 'GLB', url: 'https://cos.example/model.glb' }]
      }
    ]
  });
  return { request, response };
}

test('betterref-3d prints usage and exits code 2 without mode inputs', () => {
  const result = run3D([]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: betterref-3d/);
  assert.match(result.stderr, /--make-plan/);
  assert.match(result.stderr, /--make-hunyuan-request/);
  assert.match(result.stderr, /--make-refine-plan/);
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

test('betterref-3d make-plan preserves PRD 3D asset ids and target paths', async () => {
  const dir = await makeCase('plan-from-prd-assets');
  const analysis = path.join(dir, 'reference-analysis.json');
  const assetPlan = path.join(dir, 'asset-plan.json');
  const out = path.join(dir, '3d-out');
  await writeJson(analysis, {
    schemaVersion: 'betterref.reference.analysis.v1',
    source: path.join(dir, 'reference.png'),
    targets: ['ui', '3d', 'hunyuan'],
    objectCues: {
      modelable: true,
      silhouette: 'rounded mascot with glass face',
      materialSlots: ['glass-face']
    }
  });
  await writeJson(assetPlan, {
    schemaVersion: 'betterref.asset.plan.v1',
    threeDRequired: true,
    assets: [
      {
        id: 'model-001',
        status: 'pending',
        tool: 'hunyuan3d',
        implementation: 'hunyuan-3d-model-via-huggingface',
        role: 'hunyuan-3d-model',
        targetPath: 'public/betterref-assets/hunyuan-model-01.glb',
        targetFormat: 'glb',
        requirement: 'Generate the product mascot as a GLB model.'
      }
    ]
  });

  const result = run3D([
    '--make-plan',
    '--analysis',
    analysis,
    '--asset-plan',
    assetPlan,
    '--out',
    out,
    '--json'
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const plan = JSON.parse(await readFile(path.join(out, '3d-asset-plan.json'), 'utf8'));
  assert.equal(plan.assets.length, 1);
  assert.equal(plan.assets[0].id, 'model-001');
  assert.equal(plan.assets[0].targetPath, 'public/betterref-assets/hunyuan-model-01.glb');
  assert.equal(plan.assets[0].requirement, 'Generate the product mascot as a GLB model.');
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

test('betterref-3d creates a Hunyuan request with the Tencent Cloud adapter', async () => {
  const dir = await makeCase('tencent-hunyuan-request');
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
        prompt: 'rounded mascot with glass face',
        targetPath: 'public/betterref-assets/model-001.glb',
        acceptanceCriteria: ['PBR material evidence is required.']
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
    'tencent',
    '--tencent-region',
    'ap-guangzhou',
    '--tencent-edition',
    'pro',
    '--tencent-model',
    '3.1',
    '--result-format',
    'GLB',
    '--enable-pbr',
    'true',
    '--face-count',
    '50000',
    '--json'
  ], {
    env: {
      ...process.env,
      TENCENTCLOUD_SECRET_ID: 'secret-id',
      TENCENTCLOUD_SECRET_KEY: 'secret-key'
    }
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.schemaVersion, 'betterref.hunyuan.request.v1');

  const request = JSON.parse(await readFile(path.join(out, 'hunyuan-request.json'), 'utf8'));
  assert.deepEqual(request.providers, ['tencent']);
  assert.deepEqual(request.tencentCloud, {
    endpoint: 'hunyuan3d.tencentcloudapi.com',
    region: 'ap-guangzhou',
    edition: 'pro',
    submitAction: 'SubmitHunyuanTo3DProJob',
    queryAction: 'QueryHunyuanTo3DProJob',
    model: '3.1',
    resultFormat: 'GLB',
    enablePBR: true,
    faceCount: 50000
  });
  assert.equal(request.auth.type, 'tencentcloud-secret');
  assert.deepEqual(request.auth.env, ['TENCENTCLOUD_SECRET_ID', 'TENCENTCLOUD_SECRET_KEY']);
  assert.equal(request.auth.available, true);
  assert.equal(request.assets[0].provider, 'hunyuan');
  assert.equal(request.assets[0].targetPath, 'public/betterref-assets/model-001.glb');
});

test('betterref-3d rejects unusable Hunyuan provider options', async () => {
  const dir = await makeCase('provider-validation');
  const plan = path.join(dir, '3d-asset-plan.json');
  const out = path.join(dir, '3d-out');
  await writeJson(plan, {
    schemaVersion: 'betterref.3d.asset.plan.v1',
    threeDRequired: true,
    assets: [{ id: 'model-001', status: 'pending', sourceImage: path.join(dir, 'reference.png') }]
  });

  const cases = [
    {
      name: 'unknown provider',
      args: ['--provider', 'wat'],
      message: /Unknown Hunyuan provider/i
    },
    {
      name: 'missing endpoint',
      args: ['--provider', 'endpoint'],
      message: /--endpoint is required/i
    },
    {
      name: 'missing both endpoint',
      args: ['--provider', 'both'],
      message: /--endpoint is required/i
    },
    {
      name: 'missing custom url',
      args: ['--provider', 'custom'],
      message: /--custom-url is required/i
    },
    {
      name: 'unknown Tencent edition',
      args: ['--provider', 'tencent', '--tencent-edition', 'gold'],
      message: /Unknown Tencent Hunyuan3D edition/i
    }
  ];

  for (const item of cases) {
    const result = run3D([
      '--make-hunyuan-request',
      '--plan',
      plan,
      '--out',
      out,
      ...item.args,
      '--json'
    ]);

    assert.equal(result.status, 2, item.name);
    assert.match(result.stderr, item.message, item.name);
  }
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
  const plan = path.join(dir, '3d-asset-plan.json');
  const evidence = path.join(dir, '3d-evidence.json');
  const out = path.join(dir, '3d-out');
  const { modelRelative, renderRelative } = await writeModelAndRender(project);
  const metadata = await writeHunyuanMetadata(dir, { targetPath: modelRelative });
  await writeJson(plan, {
    schemaVersion: 'betterref.3d.asset.plan.v1',
    threeDRequired: true,
    assets: [
      {
        id: 'model-001',
        status: 'pass',
        provider: 'hunyuan',
        targetFormat: 'glb',
        targetPath: modelRelative
      }
    ]
  });
  await writeJson(evidence, {
    schemaVersion: 'betterref.3d.evidence.v1',
    assets: [
      {
        id: 'model-001',
        status: 'completed',
        modelPath: modelRelative,
        meshStats: { vertexCount: 120, faceCount: 60 },
        renders: [renderRelative]
      }
    ]
  });

  const result = run3D([
    '--verify',
    '--plan',
    plan,
    '--evidence',
    evidence,
    '--hunyuan-request',
    metadata.request,
    '--hunyuan-response',
    metadata.response,
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
  assert.equal(payload.assets[0].requestMetadataPresent, true);
  assert.equal(payload.assets[0].responseMetadataPresent, true);

  const verdict = JSON.parse(await readFile(path.join(out, '3d-verdict.json'), 'utf8'));
  assert.equal(verdict.verdict, 'pass');
});

test('betterref-3d verify requires Hunyuan request and response metadata', async () => {
  const dir = await makeCase('verify-missing-hunyuan-metadata');
  const project = path.join(dir, 'project');
  const plan = path.join(dir, '3d-asset-plan.json');
  const evidence = path.join(dir, '3d-evidence.json');
  const out = path.join(dir, '3d-out');
  const { modelRelative, renderRelative } = await writeModelAndRender(project);
  await writeJson(plan, {
    schemaVersion: 'betterref.3d.asset.plan.v1',
    threeDRequired: true,
    assets: [
      {
        id: 'model-001',
        status: 'pending',
        provider: 'hunyuan',
        targetFormat: 'glb',
        targetPath: modelRelative
      }
    ]
  });
  await writeJson(evidence, {
    schemaVersion: 'betterref.3d.evidence.v1',
    assets: [
      {
        id: 'model-001',
        status: 'completed',
        modelPath: modelRelative,
        meshStats: { vertexCount: 240, faceCount: 120 },
        renders: [renderRelative]
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

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.passed, false);
  assert.equal(payload.blockingReasons.some((item) => /Hunyuan request metadata/i.test(item)), true);
  assert.equal(payload.blockingReasons.some((item) => /Hunyuan response metadata/i.test(item)), true);
});

test('betterref-3d verify accepts Tencent Cloud Hunyuan request and response metadata', async () => {
  const dir = await makeCase('verify-tencent-hunyuan-pass');
  const project = path.join(dir, 'project');
  const plan = path.join(dir, '3d-asset-plan.json');
  const evidence = path.join(dir, '3d-evidence.json');
  const out = path.join(dir, '3d-out');
  const { modelRelative, renderRelative } = await writeModelAndRender(project);
  const metadata = await writeTencentHunyuanMetadata(dir, { targetPath: modelRelative });
  await writeJson(plan, {
    schemaVersion: 'betterref.3d.asset.plan.v1',
    threeDRequired: true,
    assets: [
      {
        id: 'model-001',
        status: 'pending',
        provider: 'hunyuan',
        targetFormat: 'glb',
        targetPath: modelRelative
      }
    ]
  });
  await writeJson(evidence, {
    schemaVersion: 'betterref.3d.evidence.v1',
    assets: [
      {
        id: 'model-001',
        status: 'completed',
        modelPath: modelRelative,
        meshStats: { vertexCount: 240, faceCount: 120 },
        renders: [renderRelative]
      }
    ]
  });

  const result = run3D([
    '--verify',
    '--plan',
    plan,
    '--evidence',
    evidence,
    '--hunyuan-request',
    metadata.request,
    '--hunyuan-response',
    metadata.response,
    '--out',
    out,
    '--project',
    project,
    '--json'
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.passed, true);
  assert.equal(payload.assets[0].requestMetadataPresent, true);
  assert.equal(payload.assets[0].responseMetadataPresent, true);
});

test('betterref-3d creates a post-Hunyuan refine plan from Tencent result files', async () => {
  const dir = await makeCase('post-hunyuan-refine-plan');
  const plan = path.join(dir, '3d-asset-plan.json');
  const assetBrief = path.join(dir, 'asset-brief.json');
  const out = path.join(dir, '3d-out');
  const response = path.join(dir, 'hunyuan-response.json');
  await writeJson(plan, {
    schemaVersion: 'betterref.3d.asset.plan.v1',
    threeDRequired: true,
    assets: [
      {
        id: 'model-001',
        status: 'pending',
        provider: 'hunyuan',
        targetFormat: 'glb',
        targetPath: 'public/betterref-assets/roblox-mascot.glb',
        targetPlatform: 'roblox',
        targetUse: 'accessory',
        materialSlots: ['base-color', 'metal-trim']
      }
    ]
  });
  await writeJson(assetBrief, {
    schemaVersion: 'betterref.asset.brief.v1',
    assetId: 'roblox-mascot',
    targetPlatform: 'roblox',
    targetUse: 'accessory',
    textureReferences: [
      {
        id: 'metal-trim',
        path: path.join(dir, 'refs', 'metal.png'),
        materialSlot: 'metal-trim',
        workflowTargets: ['Blender', 'Substance', 'artist']
      }
    ],
    roblox: {
      triangleBudgets: {
        genericMeshPartMaxTriangles: 20000,
        accessoryMaxTriangles: 4000,
        avatarBodyTotalMaxTriangles: 10742
      }
    }
  });
  await writeJson(response, {
    schemaVersion: 'betterref.hunyuan.response.v1',
    provider: 'tencent',
    requestId: 'tc-request-001',
    assets: [
      {
        id: 'model-001',
        status: 'DONE',
        targetPath: 'public/betterref-assets/roblox-mascot.glb',
        jobId: 'tc-job-001',
        requestId: 'tc-request-001',
        resultFile3Ds: [
          { type: 'GLB', url: 'https://cos.example/tencent/raw-mascot.glb' },
          { type: 'Texture', url: 'https://cos.example/tencent/raw-texture.zip' }
        ]
      }
    ]
  });

  const result = run3D([
    '--make-refine-plan',
    '--plan',
    plan,
    '--hunyuan-response',
    response,
    '--asset-brief',
    assetBrief,
    '--out',
    out,
    '--json'
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.schemaVersion, 'betterref.3d.refine.result.v1');
  assert.match(payload.artifacts.refinePlanPath, /3d-refine-plan\.json$/);
  assert.match(payload.artifacts.checklistPath, /3d-refine-checklist\.md$/);

  const refinePlan = JSON.parse(await readFile(path.join(out, '3d-refine-plan.json'), 'utf8'));
  assert.equal(refinePlan.schemaVersion, 'betterref.3d.refine.plan.v1');
  assert.equal(refinePlan.assets.length, 1);
  assert.equal(refinePlan.assets[0].id, 'model-001');
  assert.equal(refinePlan.assets[0].targetPlatform, 'roblox');
  assert.equal(refinePlan.assets[0].targetUse, 'accessory');
  assert.equal(refinePlan.assets[0].triangleBudget.maxTriangles, 4000);
  assert.equal(refinePlan.assets[0].source.provider, 'tencent');
  assert.equal(refinePlan.assets[0].source.resultFiles[0].url, 'https://cos.example/tencent/raw-mascot.glb');
  assert.equal(refinePlan.assets[0].textureReferences[0].id, 'metal-trim');
  assert.deepEqual(
    refinePlan.assets[0].actions.map((item) => item.id),
    [
      'download_tencent_result',
      'place_target_model',
      'inspect_mesh_stats',
      'retopo_or_decimate',
      'bake_texture_maps',
      'render_turntable',
      'roblox_import_preview',
      'rerun_betterref_verify'
    ]
  );
  assert.deepEqual(refinePlan.assets[0].requiredEvidence, [
    'modelPath',
    'meshStats',
    'refinementEvidence',
    'materialEvidence',
    'turntableEvidence',
    'robloxImportEvidence'
  ]);

  const checklist = await readFile(path.join(out, '3d-refine-checklist.md'), 'utf8');
  assert.match(checklist, /Post-Hunyuan Refinement Plan/);
  assert.match(checklist, /Tencent result/);
  assert.match(checklist, /Roblox import/);
  assert.match(checklist, /betterref-3d --verify/);
});

test('betterref-3d auto-refine writes Blender automation artifacts in dry-run mode', async () => {
  const dir = await makeCase('auto-refine-dry-run');
  const project = path.join(dir, 'project');
  const out = path.join(dir, '3d-out');
  const rawModel = path.join(dir, 'raw-hunyuan.glb');
  const refinePlan = path.join(dir, '3d-refine-plan.json');
  await writeFile(rawModel, 'raw-glb-bytes');
  await writeJson(refinePlan, {
    schemaVersion: 'betterref.3d.refine.plan.v1',
    projectDir: project,
    assets: [
      {
        id: 'model-001',
        targetPath: 'public/betterref-assets/roblox-mascot.glb',
        targetFormat: 'glb',
        targetPlatform: 'roblox',
        source: {
          provider: 'tencent',
          resultFiles: [{ type: 'GLB', url: rawModel }]
        },
        triangleBudget: {
          maxTriangles: 4000,
          source: 'accessoryMaxTriangles'
        },
        textureReferences: [
          {
            id: 'metal-trim',
            path: path.join(dir, 'refs', 'metal.png'),
            materialSlot: 'metal-trim'
          }
        ],
        requiredEvidence: [
          'modelPath',
          'meshStats',
          'refinementEvidence',
          'materialEvidence',
          'turntableEvidence',
          'robloxImportEvidence'
        ]
      }
    ]
  });

  const result = run3D([
    '--auto-refine',
    '--refine-plan',
    refinePlan,
    '--out',
    out,
    '--project',
    project,
    '--dry-run',
    '--json'
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.schemaVersion, 'betterref.3d.auto_refine.result.v1');
  assert.equal(payload.status, 'planned');
  assert.match(payload.artifacts.blenderScriptPath, /betterref-auto-refine\.py$/);
  assert.match(payload.artifacts.evidencePath, /3d-evidence\.json$/);
  assert.equal(payload.assets.length, 1);
  assert.equal(payload.assets[0].id, 'model-001');
  assert.equal(payload.assets[0].triangleBudget.maxTriangles, 4000);
  assert.equal(payload.assets[0].ranBlender, false);
  assert.equal(payload.assets[0].sourceModelPath, rawModel);
  assert.match(payload.assets[0].command.join(' '), /betterref-auto-refine\.py/);

  const script = await readFile(path.join(out, 'blender', 'betterref-auto-refine.py'), 'utf8');
  assert.match(script, /bpy\.ops\.import_scene\.gltf/);
  assert.match(script, /DECIMATE/);
  assert.match(script, /export_scene\.gltf/);
  assert.match(script, /turntable/);
  assert.match(script, /betterref-output/);
});

test('betterref-3d roblox-upload uses Open Cloud and records import evidence', async () => {
  const dir = await makeCase('roblox-upload');
  const project = path.join(dir, 'project');
  const out = path.join(dir, '3d-out');
  const evidence = path.join(dir, '3d-evidence.json');
  const { modelRelative, renderRelative } = await writeModelAndRender(project);
  await writeJson(evidence, {
    schemaVersion: 'betterref.3d.evidence.v1',
    assets: [
      {
        id: 'model-001',
        status: 'completed',
        modelPath: modelRelative,
        meshStats: { vertexCount: 3000, faceCount: 3000, triangleCount: 3000 },
        renders: [renderRelative],
        materialEvidence: { textureMaps: ['baseColor', 'normal'] },
        refinementEvidence: {
          tool: 'blender',
          decimate: true,
          bakedMaps: ['baseColor', 'normal'],
          finalModelPath: modelRelative
        }
      }
    ]
  });

  const calls = [];
  const server = createServer(async (request, response) => {
    const body = await readRequestBody(request);
    calls.push({
      method: request.method,
      url: request.url,
      apiKey: request.headers['x-api-key'],
      contentType: request.headers['content-type'],
      body: body.toString('utf8')
    });

    if (request.method === 'POST' && request.url === '/assets/v1/assets') {
      response.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
      response.end(JSON.stringify({ path: 'operations/op-001' }));
      return;
    }
    if (request.method === 'GET' && request.url === '/assets/v1/operations/op-001') {
      response.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
      response.end(JSON.stringify({ done: true, response: { assetId: '987654321' } }));
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json', connection: 'close' });
    response.end(JSON.stringify({ error: 'not found' }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();

  try {
    const result = await run3DAsync([
      '--roblox-upload',
      '--evidence',
      evidence,
      '--out',
      out,
      '--project',
      project,
      '--asset-id',
      'model-001',
      '--creator-user-id',
      '1234567',
      '--display-name',
      'BetterRef Mascot',
      '--description',
      'Generated through BetterRef automated 3D production.',
      '--roblox-api-base',
      `http://127.0.0.1:${port}`,
      '--roblox-api-key',
      'test-api-key',
      '--poll-interval-ms',
      '1',
      '--json'
    ]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.schemaVersion, 'betterref.roblox.upload.result.v1');
    assert.equal(payload.status, 'completed');
    assert.equal(payload.assetId, 'model-001');
    assert.equal(payload.roblox.assetId, '987654321');
    assert.equal(payload.roblox.operationId, 'op-001');
    assert.match(payload.artifacts.requestPath, /roblox-upload-request\.json$/);
    assert.match(payload.artifacts.resultPath, /roblox-upload-result\.json$/);

    assert.equal(calls.length, 2);
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].apiKey, 'test-api-key');
    assert.match(calls[0].contentType, /multipart\/form-data/);
    assert.match(calls[0].body, /"assetType":"Model"/);
    assert.match(calls[0].body, /"userId":"1234567"/);
    assert.match(calls[0].body, /BetterRef Mascot/);
    assert.equal(calls[1].url, '/assets/v1/operations/op-001');

    const updatedEvidence = JSON.parse(await readFile(evidence, 'utf8'));
    const updatedAsset = updatedEvidence.assets[0];
    assert.equal(updatedAsset.robloxImportEvidence.imported, true);
    assert.equal(updatedAsset.robloxImportEvidence.method, 'open-cloud-assets-api');
    assert.equal(updatedAsset.robloxImportEvidence.assetId, '987654321');
    assert.equal(updatedAsset.robloxImportEvidence.operationId, 'op-001');
    assert.equal(updatedAsset.robloxImportEvidence.sourceModelPath, modelRelative);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('betterref-3d verify rejects Tencent Cloud Hunyuan metadata without result files', async () => {
  const dir = await makeCase('verify-tencent-hunyuan-missing-result-files');
  const project = path.join(dir, 'project');
  const plan = path.join(dir, '3d-asset-plan.json');
  const evidence = path.join(dir, '3d-evidence.json');
  const request = path.join(dir, 'hunyuan-request.json');
  const response = path.join(dir, 'hunyuan-response.json');
  const out = path.join(dir, '3d-out');
  const { modelRelative, renderRelative } = await writeModelAndRender(project);
  await writeJson(request, {
    schemaVersion: 'betterref.hunyuan.request.v1',
    providers: ['tencent'],
    tencentCloud: {
      endpoint: 'hunyuan3d.tencentcloudapi.com',
      region: 'ap-guangzhou',
      edition: 'pro',
      submitAction: 'SubmitHunyuanTo3DProJob',
      queryAction: 'QueryHunyuanTo3DProJob'
    },
    assets: [{ id: 'model-001', targetPath: modelRelative }]
  });
  await writeJson(response, {
    schemaVersion: 'betterref.hunyuan.response.v1',
    provider: 'tencent',
    assets: [
      {
        id: 'model-001',
        status: 'DONE',
        targetPath: modelRelative,
        jobId: 'model-001-tc-job',
        requestId: 'tc-request-001'
      }
    ]
  });
  await writeJson(plan, {
    schemaVersion: 'betterref.3d.asset.plan.v1',
    threeDRequired: true,
    assets: [
      {
        id: 'model-001',
        status: 'pending',
        provider: 'hunyuan',
        targetFormat: 'glb',
        targetPath: modelRelative
      }
    ]
  });
  await writeJson(evidence, {
    schemaVersion: 'betterref.3d.evidence.v1',
    assets: [
      {
        id: 'model-001',
        status: 'completed',
        modelPath: modelRelative,
        meshStats: { vertexCount: 240, faceCount: 120 },
        renders: [renderRelative]
      }
    ]
  });

  const result = run3D([
    '--verify',
    '--plan',
    plan,
    '--evidence',
    evidence,
    '--hunyuan-request',
    request,
    '--hunyuan-response',
    response,
    '--out',
    out,
    '--project',
    project,
    '--json'
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.passed, false);
  assert.equal(payload.blockingReasons.some((item) => /Hunyuan response metadata/i.test(item)), true);
});

test('betterref-3d verify fails Roblox Hunyuan output without post-Hunyuan refinement evidence', async () => {
  const dir = await makeCase('verify-roblox-raw-hunyuan-fails');
  const project = path.join(dir, 'project');
  const plan = path.join(dir, '3d-asset-plan.json');
  const evidence = path.join(dir, '3d-evidence.json');
  const out = path.join(dir, '3d-out');
  const { modelRelative, renderRelative } = await writeModelAndRender(project);
  const metadata = await writeTencentHunyuanMetadata(dir, { targetPath: modelRelative });
  await writeJson(plan, {
    schemaVersion: 'betterref.3d.asset.plan.v1',
    threeDRequired: true,
    assets: [
      {
        id: 'model-001',
        status: 'pending',
        provider: 'hunyuan',
        targetPlatform: 'roblox',
        targetUse: 'accessory',
        targetFormat: 'glb',
        targetPath: modelRelative,
        materialSlots: ['base-color'],
        acceptanceCriteria: ['Roblox-ready low-poly mesh and baked texture evidence are required.']
      }
    ]
  });
  await writeJson(evidence, {
    schemaVersion: 'betterref.3d.evidence.v1',
    assets: [
      {
        id: 'model-001',
        status: 'completed',
        modelPath: modelRelative,
        meshStats: { vertexCount: 65000, faceCount: 52000 },
        renders: [renderRelative],
        materialEvidence: { textureMaps: ['baseColor', 'normal'] }
      }
    ]
  });

  const result = run3D([
    '--verify',
    '--plan',
    plan,
    '--evidence',
    evidence,
    '--hunyuan-request',
    metadata.request,
    '--hunyuan-response',
    metadata.response,
    '--out',
    out,
    '--project',
    project,
    '--json'
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.passed, false);
  assert.equal(payload.assets[0].refinementEvidenceRequired, true);
  assert.equal(payload.assets[0].postHunyuanRefinementPresent, false);
  assert.equal(payload.assets[0].robloxImportEvidencePresent, false);
  assert.equal(payload.assets[0].triangleBudget.passed, false);
  assert.equal(payload.blockingReasons.some((item) => /post-Hunyuan refinement/i.test(item)), true);
  assert.equal(payload.blockingReasons.some((item) => /Roblox triangle budget/i.test(item)), true);
  assert.equal(payload.blockingReasons.some((item) => /Roblox import evidence/i.test(item)), true);
});

test('betterref-3d verify passes Roblox Hunyuan output after refinement, budget, and import evidence', async () => {
  const dir = await makeCase('verify-roblox-refined-pass');
  const project = path.join(dir, 'project');
  const plan = path.join(dir, '3d-asset-plan.json');
  const evidence = path.join(dir, '3d-evidence.json');
  const out = path.join(dir, '3d-out');
  const { modelRelative, renderRelative } = await writeModelAndRender(project);
  const robloxPreview = path.join(project, 'evidence', 'model-001-roblox-preview.png');
  await mkdir(path.dirname(robloxPreview), { recursive: true });
  await writeFile(robloxPreview, 'fake-roblox-preview-bytes');
  const metadata = await writeTencentHunyuanMetadata(dir, { targetPath: modelRelative });
  await writeJson(plan, {
    schemaVersion: 'betterref.3d.asset.plan.v1',
    threeDRequired: true,
    assets: [
      {
        id: 'model-001',
        status: 'pending',
        provider: 'hunyuan',
        targetPlatform: 'roblox',
        targetUse: 'accessory',
        targetFormat: 'glb',
        targetPath: modelRelative,
        materialSlots: ['base-color'],
        acceptanceCriteria: ['Roblox-ready low-poly mesh and baked texture evidence are required.']
      }
    ]
  });
  await writeJson(evidence, {
    schemaVersion: 'betterref.3d.evidence.v1',
    assets: [
      {
        id: 'model-001',
        status: 'completed',
        modelPath: modelRelative,
        meshStats: { vertexCount: 3600, faceCount: 3600 },
        renders: [renderRelative],
        materialEvidence: { textureMaps: ['baseColor', 'normal'] },
        refinementEvidence: {
          retopo: true,
          decimate: true,
          bakedMaps: ['baseColor', 'normal'],
          finalModelPath: modelRelative
        },
        robloxImportEvidence: {
          previewPath: 'evidence/model-001-roblox-preview.png',
          imported: true
        }
      }
    ]
  });

  const result = run3D([
    '--verify',
    '--plan',
    plan,
    '--evidence',
    evidence,
    '--hunyuan-request',
    metadata.request,
    '--hunyuan-response',
    metadata.response,
    '--out',
    out,
    '--project',
    project,
    '--json'
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.passed, true);
  assert.equal(payload.assets[0].refinementEvidenceRequired, true);
  assert.equal(payload.assets[0].postHunyuanRefinementPresent, true);
  assert.equal(payload.assets[0].robloxImportEvidencePresent, true);
  assert.equal(payload.assets[0].triangleBudget.passed, true);
});

test('betterref-3d verify rejects Tencent Cloud Hunyuan metadata without DONE status', async () => {
  const dir = await makeCase('verify-tencent-hunyuan-missing-done-status');
  const project = path.join(dir, 'project');
  const plan = path.join(dir, '3d-asset-plan.json');
  const evidence = path.join(dir, '3d-evidence.json');
  const request = path.join(dir, 'hunyuan-request.json');
  const response = path.join(dir, 'hunyuan-response.json');
  const out = path.join(dir, '3d-out');
  const { modelRelative, renderRelative } = await writeModelAndRender(project);
  await writeJson(request, {
    schemaVersion: 'betterref.hunyuan.request.v1',
    providers: ['tencent'],
    tencentCloud: {
      endpoint: 'hunyuan3d.tencentcloudapi.com',
      region: 'ap-guangzhou',
      edition: 'pro',
      submitAction: 'SubmitHunyuanTo3DProJob',
      queryAction: 'QueryHunyuanTo3DProJob'
    },
    assets: [{ id: 'model-001', targetPath: modelRelative }]
  });
  await writeJson(response, {
    schemaVersion: 'betterref.hunyuan.response.v1',
    provider: 'tencent',
    assets: [
      {
        id: 'model-001',
        targetPath: modelRelative,
        jobId: 'model-001-tc-job',
        requestId: 'tc-request-001',
        resultFile3Ds: [{ type: 'GLB', url: 'https://cos.example/model.glb' }]
      }
    ]
  });
  await writeJson(plan, {
    schemaVersion: 'betterref.3d.asset.plan.v1',
    threeDRequired: true,
    assets: [
      {
        id: 'model-001',
        status: 'pending',
        provider: 'hunyuan',
        targetFormat: 'glb',
        targetPath: modelRelative
      }
    ]
  });
  await writeJson(evidence, {
    schemaVersion: 'betterref.3d.evidence.v1',
    assets: [
      {
        id: 'model-001',
        status: 'completed',
        modelPath: modelRelative,
        meshStats: { vertexCount: 240, faceCount: 120 },
        renders: [renderRelative]
      }
    ]
  });

  const result = run3D([
    '--verify',
    '--plan',
    plan,
    '--evidence',
    evidence,
    '--hunyuan-request',
    request,
    '--hunyuan-response',
    response,
    '--out',
    out,
    '--project',
    project,
    '--json'
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.passed, false);
  assert.equal(payload.blockingReasons.some((item) => /Hunyuan response metadata/i.test(item)), true);
});

test('betterref-3d verify requires the model at the planned target path', async () => {
  const dir = await makeCase('verify-target-path-missing');
  const project = path.join(dir, 'project');
  const plan = path.join(dir, '3d-asset-plan.json');
  const evidence = path.join(dir, '3d-evidence.json');
  const out = path.join(dir, '3d-out');
  const generated = path.join(project, 'tmp', 'generated-model.glb');
  const render = path.join(project, 'evidence', 'model-001-turntable-front.png');
  const targetPath = 'public/betterref-assets/hunyuan-model-01.glb';
  const metadata = await writeHunyuanMetadata(dir, { targetPath });
  await mkdir(path.dirname(generated), { recursive: true });
  await mkdir(path.dirname(render), { recursive: true });
  await writeFile(generated, 'fake-glb-bytes');
  await writeFile(render, 'fake-render-bytes');
  await writeJson(plan, {
    schemaVersion: 'betterref.3d.asset.plan.v1',
    threeDRequired: true,
    assets: [
      {
        id: 'model-001',
        status: 'pending',
        provider: 'hunyuan',
        targetFormat: 'glb',
        targetPath
      }
    ]
  });
  await writeJson(evidence, {
    schemaVersion: 'betterref.3d.evidence.v1',
    assets: [
      {
        id: 'model-001',
        status: 'completed',
        modelPath: generated,
        meshStats: { vertexCount: 240, faceCount: 120 },
        renders: ['evidence/model-001-turntable-front.png']
      }
    ]
  });

  const result = run3D([
    '--verify',
    '--plan',
    plan,
    '--evidence',
    evidence,
    '--hunyuan-request',
    metadata.request,
    '--hunyuan-response',
    metadata.response,
    '--out',
    out,
    '--project',
    project,
    '--json'
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.passed, false);
  assert.equal(payload.blockingReasons.some((item) => /target path/i.test(item)), true);
});

test('betterref-3d verify rejects placeholder Hunyuan metadata without matched asset records', async () => {
  const dir = await makeCase('verify-placeholder-metadata');
  const project = path.join(dir, 'project');
  const plan = path.join(dir, '3d-asset-plan.json');
  const evidence = path.join(dir, '3d-evidence.json');
  const request = path.join(dir, 'hunyuan-request.json');
  const response = path.join(dir, 'hunyuan-response.json');
  const out = path.join(dir, '3d-out');
  const { modelRelative, renderRelative } = await writeModelAndRender(project);
  await writeJson(plan, {
    schemaVersion: 'betterref.3d.asset.plan.v1',
    threeDRequired: true,
    assets: [
      {
        id: 'model-001',
        status: 'pending',
        provider: 'hunyuan',
        targetFormat: 'glb',
        targetPath: modelRelative
      }
    ]
  });
  await writeJson(evidence, {
    schemaVersion: 'betterref.3d.evidence.v1',
    assets: [
      {
        id: 'model-001',
        status: 'completed',
        modelPath: modelRelative,
        meshStats: { vertexCount: 240, faceCount: 120 },
        renders: [renderRelative]
      }
    ]
  });
  await writeJson(request, {
    schemaVersion: 'betterref.hunyuan.request.v1',
    providers: ['endpoint'],
    huggingFace: { endpoint: 'https://hunyuan.example.endpoints.huggingface.cloud' }
  });
  await writeJson(response, {
    schemaVersion: 'betterref.hunyuan.response.v1',
    generatedAt: '2026-05-12T00:00:00.000Z'
  });

  const result = run3D([
    '--verify',
    '--plan',
    plan,
    '--evidence',
    evidence,
    '--hunyuan-request',
    request,
    '--hunyuan-response',
    response,
    '--out',
    out,
    '--project',
    project,
    '--json'
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.blockingReasons.some((item) => /Hunyuan request metadata/i.test(item)), true);
  assert.equal(payload.blockingReasons.some((item) => /Hunyuan response metadata/i.test(item)), true);
});

test('betterref-3d verify lets completed evidence override a pending generated plan', async () => {
  const dir = await makeCase('pending-plan-complete-evidence');
  const project = path.join(dir, 'project');
  const plan = path.join(dir, '3d-asset-plan.json');
  const evidence = path.join(dir, '3d-evidence.json');
  const out = path.join(dir, '3d-out');
  const { modelRelative, renderRelative } = await writeModelAndRender(project);
  const metadata = await writeHunyuanMetadata(dir, { targetPath: modelRelative });
  await writeJson(plan, {
    schemaVersion: 'betterref.3d.asset.plan.v1',
    threeDRequired: true,
    assets: [
      {
        id: 'model-001',
        status: 'pending',
        provider: 'hunyuan',
        targetFormat: 'glb',
        targetPath: modelRelative
      }
    ]
  });
  await writeJson(evidence, {
    schemaVersion: 'betterref.3d.evidence.v1',
    assets: [
      {
        id: 'model-001',
        status: 'completed',
        modelPath: modelRelative,
        meshStats: { vertexCount: 240, faceCount: 120 },
        renders: [renderRelative]
      }
    ]
  });

  const result = run3D([
    '--verify',
    '--plan',
    plan,
    '--evidence',
    evidence,
    '--hunyuan-request',
    metadata.request,
    '--hunyuan-response',
    metadata.response,
    '--out',
    out,
    '--project',
    project,
    '--json'
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.passed, true);
  assert.equal(payload.verdict, 'pass');
  assert.deepEqual(payload.blockingReasons, []);
});

test('betterref-3d verify rejects unknown evidence status on a pending plan', async () => {
  const dir = await makeCase('pending-plan-in-progress-evidence');
  const project = path.join(dir, 'project');
  const plan = path.join(dir, '3d-asset-plan.json');
  const evidence = path.join(dir, '3d-evidence.json');
  const out = path.join(dir, '3d-out');
  const { modelRelative, renderRelative } = await writeModelAndRender(project);
  const metadata = await writeHunyuanMetadata(dir, { targetPath: modelRelative });
  await writeJson(plan, {
    schemaVersion: 'betterref.3d.asset.plan.v1',
    threeDRequired: true,
    assets: [
      {
        id: 'model-001',
        status: 'pending',
        provider: 'hunyuan',
        targetFormat: 'glb',
        targetPath: modelRelative
      }
    ]
  });
  await writeJson(evidence, {
    schemaVersion: 'betterref.3d.evidence.v1',
    assets: [
      {
        id: 'model-001',
        status: 'in_progress',
        modelPath: modelRelative,
        meshStats: { vertexCount: 240, faceCount: 120 },
        renders: [renderRelative]
      }
    ]
  });

  const result = run3D([
    '--verify',
    '--plan',
    plan,
    '--evidence',
    evidence,
    '--hunyuan-request',
    metadata.request,
    '--hunyuan-response',
    metadata.response,
    '--out',
    out,
    '--project',
    project,
    '--json'
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.passed, false);
  assert.equal(payload.verdict, 'fail');
  assert.equal(payload.blockingReasons.some((item) => /model-001 evidence status in_progress is not complete/i.test(item)), true);
});

test('betterref-3d verify requires material evidence when materials are planned', async () => {
  const dir = await makeCase('material-missing');
  const project = path.join(dir, 'project');
  const plan = path.join(dir, '3d-asset-plan.json');
  const evidence = path.join(dir, '3d-evidence.json');
  const out = path.join(dir, '3d-out');
  const { modelRelative, renderRelative } = await writeModelAndRender(project);
  await writeJson(plan, {
    schemaVersion: 'betterref.3d.asset.plan.v1',
    threeDRequired: true,
    assets: [
      {
        id: 'model-001',
        status: 'pass',
        provider: 'hunyuan',
        targetPath: modelRelative,
        materialSlots: ['metal-trim'],
        acceptanceCriteria: ['Material texture must preserve the metal trim.']
      }
    ]
  });
  await writeJson(evidence, {
    schemaVersion: 'betterref.3d.evidence.v1',
    assets: [
      {
        id: 'model-001',
        status: 'completed',
        modelPath: modelRelative,
        meshStats: { vertexCount: 120, faceCount: 60 },
        renders: [renderRelative]
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

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.passed, false);
  assert.equal(payload.blockingReasons.some((item) => /material\/texture evidence/i.test(item)), true);
});

test('betterref-3d verify accepts required material evidence', async () => {
  const dir = await makeCase('material-pass');
  const project = path.join(dir, 'project');
  const plan = path.join(dir, '3d-asset-plan.json');
  const evidence = path.join(dir, '3d-evidence.json');
  const out = path.join(dir, '3d-out');
  const { modelRelative, renderRelative } = await writeModelAndRender(project);
  const metadata = await writeHunyuanMetadata(dir, { targetPath: modelRelative });
  await writeJson(plan, {
    schemaVersion: 'betterref.3d.asset.plan.v1',
    threeDRequired: true,
    assets: [
      {
        id: 'model-001',
        status: 'pending',
        provider: 'hunyuan',
        targetPath: modelRelative,
        materialSlots: ['metal-trim'],
        acceptanceCriteria: ['PBR texture maps are required.']
      }
    ]
  });
  await writeJson(evidence, {
    schemaVersion: 'betterref.3d.evidence.v1',
    assets: [
      {
        id: 'model-001',
        status: 'completed',
        modelPath: modelRelative,
        meshStats: { vertexCount: 120, faceCount: 60 },
        renders: [renderRelative],
        materialEvidence: { slots: ['metal-trim'], textureMaps: ['baseColor'] }
      }
    ]
  });

  const result = run3D([
    '--verify',
    '--plan',
    plan,
    '--evidence',
    evidence,
    '--hunyuan-request',
    metadata.request,
    '--hunyuan-response',
    metadata.response,
    '--out',
    out,
    '--project',
    project,
    '--json'
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.passed, true);
});

test('betterref-3d verify fails when render evidence paths do not exist', async () => {
  const dir = await makeCase('missing-render-file');
  const project = path.join(dir, 'project');
  const plan = path.join(dir, '3d-asset-plan.json');
  const evidence = path.join(dir, '3d-evidence.json');
  const out = path.join(dir, '3d-out');
  const { modelRelative } = await writeModelAndRender(project);
  await writeJson(plan, {
    schemaVersion: 'betterref.3d.asset.plan.v1',
    threeDRequired: true,
    assets: [
      {
        id: 'model-001',
        status: 'pass',
        provider: 'hunyuan',
        targetPath: modelRelative
      }
    ]
  });
  await writeJson(evidence, {
    schemaVersion: 'betterref.3d.evidence.v1',
    assets: [
      {
        id: 'model-001',
        status: 'completed',
        modelPath: modelRelative,
        meshStats: { vertexCount: 120, faceCount: 60 },
        renders: ['evidence/missing-turntable.png']
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

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.passed, false);
  assert.equal(payload.blockingReasons.some((item) => /missing render or turntable evidence/i.test(item)), true);
});
