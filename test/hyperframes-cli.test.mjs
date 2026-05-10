import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const hyperframesBin = path.join(repoRoot, 'bin', 'betterref-hyperframes.mjs');

async function makeCase(name) {
  const dir = path.join(tmpdir(), `betterref-hyperframes-${process.pid}-${name}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function writeJson(filePath, value) {
  await writeFile(filePath, JSON.stringify(value, null, 2));
}

function runHyperframes(args) {
  return spawnSync(process.execPath, [hyperframesBin, ...args], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
}

function hyperframesEvidence() {
  return {
    schemaVersion: 'betterref.hyperframes.evidence.v1',
    compositionDir: 'hyperframes/asset-001',
    outputPath: 'renders/hero-loop.webm',
    format: 'webm',
    commands: {
      lint: { command: 'npx hyperframes lint', passed: true },
      validate: { command: 'npx hyperframes validate', passed: true },
      inspect: { command: 'npx hyperframes inspect --json', passed: true },
      render: { command: 'npx hyperframes render --format webm --quality high', passed: true }
    }
  };
}

test('betterref-hyperframes prints usage and exits 2 without an asset plan', () => {
  const result = runHyperframes([]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: betterref-hyperframes/);
  assert.match(result.stderr, /--asset-plan/);
});

test('betterref-hyperframes writes request queue for pending HyperFrames assets', async () => {
  const dir = await makeCase('queue');
  const assetPlan = path.join(dir, 'asset-plan.json');
  const out = path.join(dir, 'hyperframes');
  await writeJson(assetPlan, {
    schemaVersion: 'betterref.asset.plan.v1',
    hyperframesRequired: true,
    assets: [
      {
        id: 'asset-001',
        status: 'pending',
        tool: 'hyperframes',
        implementation: 'hyperframes-composition-rendered-video',
        role: 'animated-cinematic-hero',
        targetPath: 'public/betterref-assets/hero-loop.webm',
        prompt: 'Build a HyperFrames neon 3D logo reveal loop.'
      },
      {
        id: 'asset-002',
        status: 'pending',
        tool: 'image_gen',
        targetPath: 'public/betterref-assets/hero.png',
        prompt: 'Generate a static hero image.'
      }
    ]
  });

  const result = runHyperframes(['--asset-plan', assetPlan, '--out', out, '--json']);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.schemaVersion, 'betterref.hyperframes.queue.v1');
  assert.equal(payload.requests.length, 1);
  assert.equal(payload.requests[0].id, 'asset-001');
  assert.equal(payload.requests[0].tool, 'hyperframes');
  assert.match(payload.requests[0].prompt, /neon 3D logo reveal/);

  const queue = JSON.parse(await readFile(path.join(out, 'hyperframes-requests.json'), 'utf8'));
  assert.equal(queue.requests.length, 1);
  const runbook = await readFile(path.join(out, 'hyperframes-runbook.md'), 'utf8');
  assert.match(runbook, /npx hyperframes lint/);
  assert.match(runbook, /npx hyperframes validate/);
  assert.match(runbook, /npx hyperframes inspect --json/);
  assert.match(runbook, /npx hyperframes render --format webm --quality high/);
});

test('betterref-hyperframes attaches rendered output with CLI evidence', async () => {
  const dir = await makeCase('attach');
  const project = path.join(dir, 'project');
  const generated = path.join(dir, 'hero-loop.webm');
  const evidence = path.join(dir, 'hyperframes-evidence.json');
  const assetPlan = path.join(dir, 'asset-plan.json');
  await mkdir(project, { recursive: true });
  await writeFile(generated, Buffer.from('fake-webm-output'));
  await writeJson(evidence, hyperframesEvidence());
  await writeJson(assetPlan, {
    schemaVersion: 'betterref.asset.plan.v1',
    hyperframesRequired: true,
    assets: [
      {
        id: 'asset-001',
        status: 'pending',
        tool: 'hyperframes',
        implementation: 'hyperframes-composition-rendered-video',
        targetPath: 'public/betterref-assets/hero-loop.webm',
        prompt: 'Build a HyperFrames hero loop.'
      }
    ]
  });

  const result = runHyperframes([
    '--asset-plan', assetPlan,
    '--attach', `asset-001=${generated}`,
    '--evidence', evidence,
    '--project', project,
    '--json'
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.schemaVersion, 'betterref.hyperframes.attach.v1');
  assert.equal(payload.attached[0].id, 'asset-001');
  assert.equal(payload.attached[0].bytes, Buffer.byteLength('fake-webm-output'));
  await readFile(path.join(project, 'public', 'betterref-assets', 'hero-loop.webm'));

  const updatedPlan = JSON.parse(await readFile(assetPlan, 'utf8'));
  assert.equal(updatedPlan.assets[0].status, 'pass');
  assert.equal(updatedPlan.assets[0].verification, 'betterref-hyperframes attach');
  assert.equal(updatedPlan.assets[0].bytes, Buffer.byteLength('fake-webm-output'));
  assert.equal(updatedPlan.assets[0].hyperframesEvidence.commands.lint.passed, true);
});

test('betterref-hyperframes rejects failed CLI evidence', async () => {
  const dir = await makeCase('failed-evidence');
  const project = path.join(dir, 'project');
  const generated = path.join(dir, 'hero-loop.webm');
  const evidence = path.join(dir, 'hyperframes-evidence.json');
  const assetPlan = path.join(dir, 'asset-plan.json');
  const failedEvidence = hyperframesEvidence();
  failedEvidence.commands.inspect.passed = false;
  await mkdir(project, { recursive: true });
  await writeFile(generated, Buffer.from('fake-webm-output'));
  await writeJson(evidence, failedEvidence);
  await writeJson(assetPlan, {
    schemaVersion: 'betterref.asset.plan.v1',
    hyperframesRequired: true,
    assets: [
      {
        id: 'asset-001',
        status: 'pending',
        tool: 'hyperframes',
        implementation: 'hyperframes-composition-rendered-video',
        targetPath: 'public/betterref-assets/hero-loop.webm'
      }
    ]
  });

  const result = runHyperframes([
    '--asset-plan', assetPlan,
    '--attach', `asset-001=${generated}`,
    '--evidence', evidence,
    '--project', project,
    '--json'
  ]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /inspect/);
});
