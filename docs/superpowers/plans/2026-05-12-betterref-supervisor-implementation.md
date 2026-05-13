# BetterRef Supervisor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first production-ready BetterRef Supervisor foundation for reference intelligence, Hunyuan 3D handoff, expanded agent-team guidance, and final evidence gates.

**Architecture:** Add small, focused CLI/library modules that emit structured artifacts and plug into existing `betterref-prd`, `betterref-run`, and `betterref-verify` flows. Keep the first implementation deterministic and local: reference analysis uses image metadata and heuristic facts; Hunyuan support creates/validates provider handoffs without requiring a live API call in tests; 3D verification validates evidence artifacts and model file metadata.

**Tech Stack:** Node.js ESM, `node:test`, `sharp`, existing BetterRef CLI conventions, JSON artifact contracts, markdown references.

---

## File Structure

- Create `lib/reference.mjs`: reference image analysis, artifact creation, optional 3D brief and negative prompts.
- Create `bin/betterref-reference.mjs`: CLI wrapper for `lib/reference.mjs`.
- Create `test/reference-cli.test.mjs`: CLI and artifact tests for reference intelligence.
- Create `lib/threeD.mjs`: 3D asset plan, Hunyuan handoff, 3D evidence validation, and 3D verdict generation.
- Create `bin/betterref-3d.mjs`: CLI wrapper for `lib/threeD.mjs`.
- Create `test/three-d-cli.test.mjs`: tests for plan/handoff/verdict behavior.
- Modify `lib/verify.mjs`: include optional 3D verdict evidence in final verification.
- Modify `bin/betterref-verify.mjs`: add `--three-d` and `3d` required evidence.
- Modify `test/verify-cli.test.mjs`: pressure tests for missing/failed/passing 3D evidence.
- Modify `lib/prd.mjs`: detect concrete 3D model requirements and emit `threeDRequired` plus 3D plan hints.
- Modify `test/prd-cli.test.mjs`: tests for 3D requirement extraction.
- Modify `lib/run.mjs`: surface 3D blockers and next actions when a PRD/reference requires 3D.
- Modify `test/run-cli.test.mjs`: tests for 3D blocker/handoff artifacts.
- Modify `package.json`: add `betterref-reference` and `betterref-3d` bin entries.
- Modify `README.md`, `SKILL.md`, `agents/openai.yaml`: document reference intelligence, 3D lane, Hunyuan adapter, expanded agent team.
- Create `references/reference-intelligence.md`, `references/reference-to-3d.md`, `references/hunyuan-tencent.md`, `references/agent-team.md`.
- Modify `references/pressure-tests.md`, `references/hard-fail-ledger.md`, `test/skill-contract.test.mjs`.

## Task 1: Reference Intelligence CLI

**Files:**
- Create: `lib/reference.mjs`
- Create: `bin/betterref-reference.mjs`
- Create: `test/reference-cli.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing tests for reference analysis artifacts**

Add `test/reference-cli.test.mjs`:

```js
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
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
```

- [ ] **Step 2: Run the test to verify RED**

Run:

```bash
node --test test/reference-cli.test.mjs
```

Expected: FAIL because `bin/betterref-reference.mjs` does not exist.

- [ ] **Step 3: Implement `lib/reference.mjs`**

Create `lib/reference.mjs`:

```js
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export class BetterRefReferenceError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BetterRefReferenceError';
  }
}

function asArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : String(value).split(',');
}

function parseTargets(value) {
  const targets = asArray(value).map((item) => String(item).trim().toLowerCase()).filter(Boolean);
  return targets.length > 0 ? [...new Set(targets)] : ['ui'];
}

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}

function aspectRatio(width, height) {
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}

async function swatches(imagePath) {
  const { dominant } = await sharp(imagePath).stats();
  const dominantHex = `#${[dominant.r, dominant.g, dominant.b].map((item) => Math.round(item).toString(16).padStart(2, '0')).join('')}`;
  const palette = await sharp(imagePath)
    .resize(8, 8, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const colors = new Map();
  for (let index = 0; index < palette.data.length; index += palette.info.channels) {
    const r = palette.data[index];
    const g = palette.data[index + 1];
    const b = palette.data[index + 2];
    const key = `#${[r, g, b].map((item) => item.toString(16).padStart(2, '0')).join('')}`;
    colors.set(key, (colors.get(key) || 0) + 1);
  }
  return [
    { role: 'dominant', hex: dominantHex, confidence: 'high' },
    ...[...colors.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([hex, count]) => ({ role: 'sampled', hex, count, confidence: 'medium' }))
  ];
}

function makeAnalysis({ imagePath, metadata, targets, colorSwatches }) {
  const modelable = targets.includes('3d') || targets.includes('model') || targets.includes('hunyuan');
  return {
    schemaVersion: 'betterref.reference.analysis.v1',
    generatedAt: new Date().toISOString(),
    source: path.resolve(imagePath),
    targets,
    image: {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      channels: metadata.channels,
      hasAlpha: Boolean(metadata.hasAlpha)
    },
    pixelFacts: {
      aspectRatio: aspectRatio(metadata.width, metadata.height),
      orientation: metadata.width >= metadata.height ? 'landscape' : 'portrait',
      visibleViewport: `${metadata.width}x${metadata.height}`
    },
    color: {
      swatches: colorSwatches
    },
    designSemantics: {
      confidence: 'medium',
      notes: [
        'Reference analysis is deterministic and should be augmented by a specialist visual agent before final pass.',
        'Use browser or image-processing measurement for exact layout and typography decisions.'
      ]
    },
    objectCues: {
      modelable,
      confidence: modelable ? 'medium' : 'low',
      silhouette: modelable ? 'Extract major silhouette and volume boundaries before Hunyuan generation.' : 'No 3D target requested.',
      materialSlots: modelable ? ['base-color', 'surface-finish', 'detail-texture'] : []
    },
    uncertainties: [
      {
        unknown: 'Hidden sides and back view',
        impact: 'Blocks exact 3D pass when the deliverable requires all sides.',
        need: 'Provide side/back reference or accept an explicit assumption.'
      },
      {
        unknown: 'Exact physical scale',
        impact: 'Model may load at the wrong size in Three.js/model-viewer.',
        need: 'Provide target dimensions or runtime scale.'
      }
    ]
  };
}

function renderChecklist(analysis) {
  return `# BetterRef Visual Checklist

- Reference: ${analysis.source}
- Size: ${analysis.image.width}x${analysis.image.height}
- Aspect ratio: ${analysis.pixelFacts.aspectRatio}
- Orientation: ${analysis.pixelFacts.orientation}
- Dominant color: ${analysis.color.swatches[0]?.hex || 'unknown'}
- Targets: ${analysis.targets.join(', ')}

## Required Checks

- Match visible composition and crop before judging polish.
- Preserve high-confidence color and layout facts.
- Report uncertainty separately from facts.
- Do not use the reference image, PDF render, or screenshot as shipped UI.
`;
}

function render3DBrief(analysis) {
  return `# BetterRef 3D Brief

## Source

- Reference: ${analysis.source}
- Image size: ${analysis.image.width}x${analysis.image.height}
- Modelable: ${analysis.objectCues.modelable}
- Confidence: ${analysis.objectCues.confidence}

## Silhouette

${analysis.objectCues.silhouette}

## Material Slots

${analysis.objectCues.materialSlots.map((item) => `- ${item}`).join('\n') || '- No 3D material slots requested.'}

## Known Unknowns

${analysis.uncertainties.map((item) => `- ${item.unknown}: ${item.impact} Need: ${item.need}`).join('\n')}
`;
}

function renderNegativePrompts() {
  return `# BetterRef Negative Prompts

- Do not create a flat billboard pretending to be a 3D model.
- Do not bake browser chrome, UI panels, large text blocks, screenshots, or PDF renders into the asset.
- Do not ignore the reference silhouette, color zones, or material cues.
- Do not claim hidden sides are accurate without side/back reference evidence.
`;
}

export async function analyzeReference(options) {
  const { referencePath, outDir, target } = options;
  if (!referencePath) throw new BetterRefReferenceError('Missing --ref.');
  if (!outDir) throw new BetterRefReferenceError('Missing --out.');
  await mkdir(outDir, { recursive: true });
  let metadata;
  try {
    metadata = await sharp(referencePath).metadata();
  } catch (error) {
    throw new BetterRefReferenceError(`Could not read reference image ${referencePath}: ${error.message}`);
  }
  if (!metadata.width || !metadata.height) {
    throw new BetterRefReferenceError(`Reference image ${referencePath} has invalid dimensions.`);
  }
  const targets = parseTargets(target);
  const analysis = makeAnalysis({
    imagePath: referencePath,
    metadata,
    targets,
    colorSwatches: await swatches(referencePath)
  });
  const analysisPath = path.join(outDir, 'reference-analysis.json');
  const visualChecklistPath = path.join(outDir, 'visual-checklist.md');
  const threeDBriefPath = path.join(outDir, '3d-brief.md');
  const negativePromptsPath = path.join(outDir, 'negative-prompts.md');
  await writeFile(analysisPath, `${JSON.stringify(analysis, null, 2)}\n`);
  await writeFile(visualChecklistPath, renderChecklist(analysis));
  await writeFile(threeDBriefPath, render3DBrief(analysis));
  await writeFile(negativePromptsPath, renderNegativePrompts());
  return {
    schemaVersion: 'betterref.reference.v1',
    generatedAt: new Date().toISOString(),
    referencePath,
    targets,
    artifacts: {
      analysisPath,
      visualChecklistPath,
      threeDBriefPath,
      negativePromptsPath
    }
  };
}
```

- [ ] **Step 4: Implement `bin/betterref-reference.mjs`**

Create `bin/betterref-reference.mjs`:

```js
#!/usr/bin/env node
import { parseArgs, pick } from '../lib/args.mjs';
import { analyzeReference, BetterRefReferenceError } from '../lib/reference.mjs';

const usage = `Usage: betterref-reference --ref <reference.png> --out <dir> [options]

Required:
  --ref, --reference     Reference image path.
  --out                  Output directory for reference analysis artifacts.

Options:
  --target               Comma-separated targets: ui,3d,hunyuan.
  --json                 Print JSON result to stdout.
  --help                 Show this help.
`;

function failUsage(message) {
  if (message) console.error(message);
  console.error(usage);
  process.exit(2);
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    failUsage(error.message);
  }

  const { values, flags } = parsed;
  if (flags.has('help') || flags.has('h')) {
    console.log(usage);
    return;
  }

  const referencePath = pick(values, 'ref', 'reference');
  if (!referencePath || !values.out) {
    failUsage('Missing required --ref or --out.');
  }

  try {
    const result = await analyzeReference({
      referencePath,
      outDir: values.out,
      target: values.target
    });
    if (flags.has('json')) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`[betterref-reference] analysis=${result.artifacts.analysisPath}`);
      console.log(`[betterref-reference] checklist=${result.artifacts.visualChecklistPath}`);
      console.log(`[betterref-reference] threeDBrief=${result.artifacts.threeDBriefPath}`);
    }
  } catch (error) {
    if (error instanceof BetterRefReferenceError) {
      console.error(error.message);
      process.exit(2);
    }
    console.error(`[betterref-reference] ${error.stack || error.message}`);
    process.exit(1);
  }
}

await main();
```

- [ ] **Step 5: Add package bin entry**

Modify `package.json` `bin`:

```json
"betterref-reference": "./bin/betterref-reference.mjs"
```

- [ ] **Step 6: Run test to verify GREEN**

Run:

```bash
node --test test/reference-cli.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

Run:

```bash
git add package.json lib/reference.mjs bin/betterref-reference.mjs test/reference-cli.test.mjs
git commit -m "Add BetterRef reference analysis CLI"
```

## Task 2: 3D Asset Plan And Hunyuan Handoff

**Files:**
- Create: `lib/threeD.mjs`
- Create: `bin/betterref-3d.mjs`
- Create: `test/three-d-cli.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write failing 3D CLI tests**

Create `test/three-d-cli.test.mjs`:

```js
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
  await writeFile(filePath, JSON.stringify(value, null, 2));
}

test('betterref-3d prints usage and exits code 2 without mode inputs', () => {
  const result = spawnSync(process.execPath, [threeDBin], {
    cwd: repoRoot,
    encoding: 'utf8'
  });

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
  await writeJson(analysis, {
    schemaVersion: 'betterref.reference.analysis.v1',
    source: path.join(dir, 'reference.png'),
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

  const result = spawnSync(process.execPath, [
    threeDBin,
    '--make-plan',
    '--analysis',
    analysis,
    '--out',
    out,
    '--format',
    'glb',
    '--json'
  ], { cwd: repoRoot, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.schemaVersion, 'betterref.3d.plan.result.v1');
  assert.match(payload.artifacts.planPath, /3d-asset-plan\.json$/);

  const plan = JSON.parse(await readFile(path.join(out, '3d-asset-plan.json'), 'utf8'));
  assert.equal(plan.schemaVersion, 'betterref.3d.asset.plan.v1');
  assert.equal(plan.threeDRequired, true);
  assert.equal(plan.assets.length, 1);
  assert.equal(plan.assets[0].status, 'pending');
  assert.equal(plan.assets[0].provider, 'hunyuan');
  assert.equal(plan.assets[0].targetFormat, 'glb');
  assert.equal(plan.assets[0].acceptanceCriteria.some((item) => /turntable/i.test(item)), true);
});

test('betterref-3d creates a Tencent Cloud Hunyuan request', async () => {
  const dir = await makeCase('hunyuan-request');
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
        sourceImage: path.join(dir, 'reference.png'),
        targetFormat: 'glb',
        prompt: 'rounded device with metallic trim',
        acceptanceCriteria: []
      }
    ]
  });

  const result = spawnSync(process.execPath, [
    threeDBin,
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
    'hunyuan3d.tencentcloudapi.com',
    '--json'
  ], { cwd: repoRoot, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const request = JSON.parse(await readFile(path.join(out, 'hunyuan-request.json'), 'utf8'));
  assert.equal(request.schemaVersion, 'betterref.hunyuan.request.v1');
  assert.deepEqual(request.providers, ['space', 'endpoint']);
  assert.equal(request.tencentCloud.space, 'tencent/Hunyuan3D-2');
  assert.equal(request.tencentCloud.endpoint, 'hunyuan3d.tencentcloudapi.com');
  assert.equal(request.auth.env, 'TENCENTCLOUD_SECRET_ID/TENCENTCLOUD_SECRET_KEY');
  assert.equal(request.assets[0].id, 'model-001');
});

test('betterref-3d fails 3D verdict when model evidence is missing', async () => {
  const dir = await makeCase('verify-fail');
  const plan = path.join(dir, '3d-asset-plan.json');
  const out = path.join(dir, '3d-out');
  await writeJson(plan, {
    schemaVersion: 'betterref.3d.asset.plan.v1',
    threeDRequired: true,
    assets: [{ id: 'model-001', status: 'pending', targetFormat: 'glb' }]
  });

  const result = spawnSync(process.execPath, [
    threeDBin,
    '--verify',
    '--plan',
    plan,
    '--out',
    out,
    '--json'
  ], { cwd: repoRoot, encoding: 'utf8' });

  assert.equal(result.status, 1);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.verdict, 'fail');
  assert.equal(verdict.hardFailPresent, true);
  assert.ok(verdict.blockingReasons.some((item) => item.includes('model-001 is pending')));
});
```

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
node --test test/three-d-cli.test.mjs
```

Expected: FAIL because `bin/betterref-3d.mjs` does not exist.

- [ ] **Step 3: Implement `lib/threeD.mjs`**

Create `lib/threeD.mjs`:

```js
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class BetterRef3DError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BetterRef3DError';
  }
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new BetterRef3DError(`Could not read ${label} ${filePath}: ${error.message}`);
  }
}

function providers(value) {
  if (value === 'both') return ['space', 'endpoint'];
  if (value === 'endpoint') return ['endpoint'];
  if (value === 'custom') return ['custom'];
  return ['space'];
}

function isPassStatus(value) {
  return ['pass', 'passed', 'complete', 'completed', 'ok'].includes(String(value || '').toLowerCase());
}

export async function make3DAssetPlan(options) {
  const { analysisPath, outDir, format = 'glb' } = options;
  if (!analysisPath) throw new BetterRef3DError('Missing --analysis.');
  if (!outDir) throw new BetterRef3DError('Missing --out.');
  const analysis = await readJson(analysisPath, 'reference analysis');
  await mkdir(outDir, { recursive: true });
  const sourceImage = analysis.source;
  const asset = {
    id: 'model-001',
    status: 'pending',
    provider: 'hunyuan',
    sourceImage,
    targetFormat: format,
    prompt: [
      analysis.objectCues?.silhouette || 'Generate a model that matches the reference silhouette.',
      `Material slots: ${asArray(analysis.objectCues?.materialSlots).join(', ') || 'base material'}.`
    ].join(' '),
    uncertainties: asArray(analysis.uncertainties),
    acceptanceCriteria: [
      'Do not use a flat 2D billboard or reference screenshot as a model.',
      'Generated model must load in the intended runtime.',
      'Geometry must be non-empty and include mesh stats.',
      'Provide front, side, three-quarter, and turntable render evidence when possible.',
      'Material/PBR evidence is required when material fidelity is part of the reference.'
    ]
  };
  const plan = {
    schemaVersion: 'betterref.3d.asset.plan.v1',
    generatedAt: new Date().toISOString(),
    threeDRequired: true,
    sourceAnalysis: path.resolve(analysisPath),
    assets: [asset]
  };
  const planPath = path.join(outDir, '3d-asset-plan.json');
  await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
  return {
    schemaVersion: 'betterref.3d.plan.result.v1',
    generatedAt: new Date().toISOString(),
    artifacts: { planPath }
  };
}

export async function makeHunyuanRequest(options) {
  const { planPath, outDir, provider = 'space', space, endpoint, customUrl } = options;
  if (!planPath) throw new BetterRef3DError('Missing --plan.');
  if (!outDir) throw new BetterRef3DError('Missing --out.');
  const plan = await readJson(planPath, '3D asset plan');
  await mkdir(outDir, { recursive: true });
  const request = {
    schemaVersion: 'betterref.hunyuan.request.v1',
    generatedAt: new Date().toISOString(),
    providers: providers(provider),
    auth: { env: 'TENCENTCLOUD_SECRET_ID/TENCENTCLOUD_SECRET_KEY' },
    tencentCloud: {
      space: space || null,
      endpoint: endpoint || null,
      customUrl: customUrl || null
    },
    assets: asArray(plan.assets).map((asset) => ({
      id: asset.id,
      sourceImage: asset.sourceImage,
      targetFormat: asset.targetFormat || 'glb',
      prompt: asset.prompt,
      outputPath: `public/betterref-assets/${asset.id}.${asset.targetFormat || 'glb'}`,
      retry: {
        seed: null,
        notes: 'Record provider settings and response metadata before retrying.'
      }
    }))
  };
  const requestPath = path.join(outDir, 'hunyuan-request.json');
  await writeFile(requestPath, `${JSON.stringify(request, null, 2)}\n`);
  return {
    schemaVersion: 'betterref.hunyuan.request.result.v1',
    generatedAt: new Date().toISOString(),
    artifacts: { requestPath }
  };
}

async function filePresent(filePath, projectDir) {
  if (!filePath) return false;
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(projectDir || process.cwd(), filePath);
  try {
    const info = await stat(resolved);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

export async function verify3D(options) {
  const { planPath, evidencePath, outDir, projectDir } = options;
  if (!planPath) throw new BetterRef3DError('Missing --plan.');
  if (!outDir) throw new BetterRef3DError('Missing --out.');
  const plan = await readJson(planPath, '3D asset plan');
  const evidence = evidencePath ? await readJson(evidencePath, '3D evidence') : {};
  await mkdir(outDir, { recursive: true });
  const blockingReasons = [];
  const assets = [];
  for (const asset of asArray(plan.assets)) {
    const evidenceAsset = asArray(evidence.assets).find((item) => item.id === asset.id) || {};
    const status = evidenceAsset.status || asset.status;
    const modelPath = evidenceAsset.modelPath || asset.modelPath || asset.generatedPath;
    const present = await filePresent(modelPath, projectDir);
    const meshStats = evidenceAsset.meshStats || {};
    const renderEvidence = asArray(evidenceAsset.renders);
    if (!isPassStatus(status)) blockingReasons.push(`3D asset ${asset.id} is ${status || 'pending'}`);
    if (isPassStatus(status) && !present) blockingReasons.push(`3D asset ${asset.id} model file is missing or empty`);
    if (isPassStatus(status) && (!meshStats.vertices || !meshStats.faces)) blockingReasons.push(`3D asset ${asset.id} lacks mesh stats`);
    if (isPassStatus(status) && renderEvidence.length === 0) blockingReasons.push(`3D asset ${asset.id} lacks render or turntable evidence`);
    assets.push({ id: asset.id, status: status || 'pending', modelPath: modelPath || null, modelPresent: present });
  }
  const verdict = {
    schemaVersion: 'betterref.3d.verdict.v1',
    generatedAt: new Date().toISOString(),
    passed: blockingReasons.length === 0,
    verdict: blockingReasons.length === 0 ? 'pass' : 'fail',
    hardFailPresent: blockingReasons.length > 0,
    assets,
    blockingReasons,
    inputs: {
      plan: path.resolve(planPath),
      evidence: evidencePath ? path.resolve(evidencePath) : null,
      project: projectDir ? path.resolve(projectDir) : null
    }
  };
  const verdictPath = path.join(outDir, '3d-verdict.json');
  await writeFile(verdictPath, `${JSON.stringify(verdict, null, 2)}\n`);
  return {
    ...verdict,
    artifacts: { verdictPath }
  };
}
```

- [ ] **Step 4: Implement `bin/betterref-3d.mjs`**

Create `bin/betterref-3d.mjs`:

```js
#!/usr/bin/env node
import { parseArgs } from '../lib/args.mjs';
import { BetterRef3DError, make3DAssetPlan, makeHunyuanRequest, verify3D } from '../lib/threeD.mjs';

const usage = `Usage: betterref-3d [mode] --out <dir> [options]

Modes:
  --make-plan                  Build 3d-asset-plan.json from reference-analysis.json.
  --make-hunyuan-request       Build hunyuan-request.json from 3d-asset-plan.json.
  --verify                     Build 3d-verdict.json from plan and optional evidence.

Options:
  --analysis <path>            Reference analysis JSON for --make-plan.
  --plan <path>                3D asset plan JSON for request/verify modes.
  --evidence <path>            3D evidence JSON for --verify.
  --out <dir>                  Output directory.
  --format <glb|obj|usdz>      Target 3D format. Default: glb.
  --provider <space|endpoint|custom|both>
  --tencent-endpoint <host>     Tencent Cloud Hunyuan3D endpoint host.
  --tencent-region <region>    Tencent Cloud region.
  --custom-url <url>           Custom Hunyuan wrapper URL.
  --project <dir>              Project root for resolving model files.
  --json                       Print JSON result to stdout.
  --help                       Show this help.
`;

function failUsage(message) {
  if (message) console.error(message);
  console.error(usage);
  process.exit(2);
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    failUsage(error.message);
  }
  const { values, flags } = parsed;
  if (flags.has('help') || flags.has('h')) {
    console.log(usage);
    return;
  }
  if (!values.out) failUsage('Missing required --out.');
  const modes = ['make-plan', 'make-hunyuan-request', 'verify'].filter((name) => flags.has(name));
  if (modes.length !== 1) failUsage('Choose exactly one mode: --make-plan, --make-hunyuan-request, or --verify.');

  try {
    let result;
    if (flags.has('make-plan')) {
      result = await make3DAssetPlan({ analysisPath: values.analysis, outDir: values.out, format: values.format });
    } else if (flags.has('make-hunyuan-request')) {
      result = await makeHunyuanRequest({
        planPath: values.plan,
        outDir: values.out,
        provider: values.provider,
        space: values.space,
        endpoint: values.endpoint,
        customUrl: values['custom-url']
      });
    } else {
      result = await verify3D({
        planPath: values.plan,
        evidencePath: values.evidence,
        outDir: values.out,
        projectDir: values.project
      });
    }
    if (flags.has('json')) console.log(JSON.stringify(result, null, 2));
    else console.log(`[betterref-3d] ${result.verdict || 'ok'}`);
    if (flags.has('verify')) process.exit(result.passed ? 0 : 1);
  } catch (error) {
    if (error instanceof BetterRef3DError) {
      console.error(error.message);
      process.exit(2);
    }
    console.error(`[betterref-3d] ${error.stack || error.message}`);
    process.exit(1);
  }
}

await main();
```

- [ ] **Step 5: Add package bin entry**

Modify `package.json` `bin`:

```json
"betterref-3d": "./bin/betterref-3d.mjs"
```

- [ ] **Step 6: Run 3D CLI tests**

Run:

```bash
node --test test/three-d-cli.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

Run:

```bash
git add package.json lib/threeD.mjs bin/betterref-3d.mjs test/three-d-cli.test.mjs
git commit -m "Add BetterRef 3D handoff CLI"
```

## Task 3: Final Verify 3D Evidence Gate

**Files:**
- Modify: `lib/verify.mjs`
- Modify: `bin/betterref-verify.mjs`
- Modify: `test/verify-cli.test.mjs`

- [ ] **Step 1: Add failing verify tests for `--three-d`**

Append to `test/verify-cli.test.mjs`:

```js
test('betterref-verify treats required 3D evidence as missing when --three-d is omitted', async () => {
  const dir = await makeCase('required-3d-missing');
  const visual = path.join(dir, 'report.json');
  await writeJson(visual, { passed: true, verdict: { verdict: 'pass', score: 99, hard_fail_present: false } });

  const result = runVerify(['--report', visual, '--require', '3d', '--json']);

  assert.equal(result.status, 1);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.verdict, 'fail');
  assert.equal(verdict.hardFailPresent, true);
  assert.deepEqual(verdict.requiredEvidence.missing, ['3d']);
  assert.ok(verdict.blockingReasons.some((item) => item.includes('required 3D evidence is missing')));
});

test('betterref-verify fails when 3D verdict has hard fails', async () => {
  const dir = await makeCase('required-3d-fail');
  const visual = path.join(dir, 'report.json');
  const threeD = path.join(dir, '3d-verdict.json');
  await writeJson(visual, { passed: true, verdict: { verdict: 'pass', score: 99, hard_fail_present: false } });
  await writeJson(threeD, {
    passed: false,
    verdict: 'fail',
    hardFailPresent: true,
    blockingReasons: ['3D asset model-001 lacks mesh stats']
  });

  const result = runVerify(['--report', visual, '--three-d', threeD, '--require', '3d', '--json']);

  assert.equal(result.status, 1);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.verdict, 'fail');
  assert.equal(verdict.threeD.passed, false);
  assert.ok(verdict.blockingReasons.some((item) => item.includes('3D asset model-001 lacks mesh stats')));
});

test('betterref-verify passes required 3D evidence when 3D verdict passes', async () => {
  const dir = await makeCase('required-3d-pass');
  const visual = path.join(dir, 'report.json');
  const threeD = path.join(dir, '3d-verdict.json');
  await writeJson(visual, { passed: true, verdict: { verdict: 'pass', score: 99, hard_fail_present: false } });
  await writeJson(threeD, {
    passed: true,
    verdict: 'pass',
    hardFailPresent: false,
    blockingReasons: []
  });

  const result = runVerify(['--report', visual, '--three-d', threeD, '--require', '3d', '--json']);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.verdict, 'pass');
  assert.equal(verdict.threeD.passed, true);
  assert.deepEqual(verdict.requiredEvidence.missing, []);
});
```

- [ ] **Step 2: Run targeted verify tests to see RED**

Run:

```bash
node --test test/verify-cli.test.mjs
```

Expected: FAIL because `--three-d` and required evidence `3d` are unsupported.

- [ ] **Step 3: Extend `parseRequiredEvidence` in `lib/verify.mjs`**

Change aliases in `parseRequiredEvidence`:

```js
const aliases = new Map([
  ['all', ['guard', 'prd', 'longpage', 'assetplan', 'browser', '3d']],
  ['guard', ['guard']],
  ['prd', ['prd']],
  ['checklist', ['prd']],
  ['longpage', ['longpage']],
  ['long-page', ['longpage']],
  ['assetplan', ['assetplan']],
  ['asset-plan', ['assetplan']],
  ['browser', ['browser']],
  ['browser-evidence', ['browser']],
  ['3d', ['3d']],
  ['three-d', ['3d']],
  ['threed', ['3d']],
  ['model', ['3d']]
]);
```

- [ ] **Step 4: Add `threeDVerdict` helper in `lib/verify.mjs`**

Add near `browserEvidenceVerdict`:

```js
function threeDVerdict(report) {
  if (!report) {
    return {
      present: false,
      passed: true,
      hardFailPresent: false,
      blockingReasons: []
    };
  }
  const blockingReasons = asArray(report.blockingReasons);
  return {
    present: true,
    passed: report.passed !== false && report.verdict !== 'fail' && !report.hardFailPresent && blockingReasons.length === 0,
    hardFailPresent: Boolean(report.hardFailPresent || blockingReasons.length > 0 || report.verdict === 'fail'),
    blockingReasons,
    assets: asArray(report.assets)
  };
}
```

- [ ] **Step 5: Wire `threeD` into `requiredEvidenceVerdict`**

Add a parameter and missing check:

```js
if (required.includes('3d') && !parts.threeD.present) {
  missing.push('3d');
}
```

Update `requiredEvidenceLabel`:

```js
if (item === '3d') {
  return '3D';
}
```

- [ ] **Step 6: Read `threeDPath` and add blocking reasons in `verifyFinal`**

In `verifyFinal`, read:

```js
const threeDReport = await readJson(options.threeDPath, 'BetterRef 3D verdict');
```

Create verdict:

```js
const threeD = threeDVerdict(threeDReport);
```

Pass into required evidence:

```js
const requiredEvidence = requiredEvidenceVerdict(parseRequiredEvidence(options.requiredEvidence), {
  guard,
  prd,
  longPage,
  assetPlan,
  browserEvidence,
  threeD
});
```

Add blocking reasons:

```js
if (!threeD.passed) {
  for (const reason of threeD.blockingReasons) {
    blockingReasons.push(reason);
  }
  if (threeD.blockingReasons.length === 0) {
    blockingReasons.push('3D verdict did not pass');
  }
}
```

Include in hard fail and passed:

```js
const hardFailPresent = Boolean(
  visual.hardFailPresent ||
    guard.hardFailPresent ||
    longPage.hardFailPresent ||
    assetPlan.hardFailPresent ||
    browserEvidence.hardFailPresent ||
    threeD.hardFailPresent ||
    requiredEvidence.missing.length > 0
);
```

```js
const passed =
  blockingReasons.length === 0 &&
  visual.passed &&
  guard.passed &&
  longPage.passed &&
  assetPlan.passed &&
  browserEvidence.passed &&
  threeD.passed &&
  requiredEvidence.passed &&
  prd.score === 100;
```

Add `threeD` to `finalReport` and `inputs`:

```js
threeD,
```

```js
threeD: options.threeDPath ? path.resolve(options.threeDPath) : null,
```

- [ ] **Step 7: Update bundle summaries**

Add `['3d-verdict', options.threeDPath]` to `artifactInputs`.

Add this to the bundle object:

```js
threeD: {
  present: report.threeD.present,
  passed: report.threeD.passed,
  hardFailPresent: report.threeD.hardFailPresent,
  blockingReasons: report.threeD.blockingReasons
},
```

- [ ] **Step 8: Update `bin/betterref-verify.mjs`**

Add usage line:

```txt
  --three-d            BetterRef 3D verdict JSON from betterref-3d.
```

Pass option:

```js
threeDPath: values['three-d'],
```

- [ ] **Step 9: Run verify tests**

Run:

```bash
node --test test/verify-cli.test.mjs
```

Expected: PASS.

- [ ] **Step 10: Commit Task 3**

Run:

```bash
git add lib/verify.mjs bin/betterref-verify.mjs test/verify-cli.test.mjs
git commit -m "Add 3D evidence to final verification"
```

## Task 4: PRD Extraction Emits 3D Requirements

**Files:**
- Modify: `lib/prd.mjs`
- Modify: `test/prd-cli.test.mjs`

- [ ] **Step 1: Add failing PRD extraction test**

Append to `test/prd-cli.test.mjs`:

```js
test('betterref-prd detects Hunyuan 3D model requirements separately from raster assets', async () => {
  const dir = await makeCase('hunyuan-3d');
  const pdf = path.join(dir, 'prd.pdf');
  const out = path.join(dir, 'prd-out');
  await writePdf(pdf, [
    'Viewport: 1440x900.',
    'Reference image: product mascot should become a real 3D model.',
    'Hunyuan 3D: generate GLB model through Tencent Cloud API.',
    '3D acceptance: mesh must load in Three.js, include texture material, and provide turntable evidence.',
    'Hero UI text and buttons remain code-native.'
  ]);

  const result = spawnSync(process.execPath, [
    prdBin,
    '--pdf',
    pdf,
    '--out',
    out,
    '--json'
  ], { cwd: repoRoot, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const summary = JSON.parse(await readFile(path.join(out, 'prd-summary.json'), 'utf8'));
  assert.equal(summary.threeDRequired, true);
  assert.equal(summary.hunyuanRequired, true);

  const assetPlan = JSON.parse(await readFile(path.join(out, 'asset-plan.json'), 'utf8'));
  assert.equal(assetPlan.threeDRequired, true);
  assert.equal(assetPlan.assets.some((asset) => asset.tool === 'hunyuan3d'), true);
  const model = assetPlan.assets.find((asset) => asset.tool === 'hunyuan3d');
  assert.match(model.targetPath, /\.glb$/);
  assert.equal(model.acceptanceCriteria.some((item) => /turntable/i.test(item)), true);

  const runbook = await readFile(path.join(out, 'betterref-runbook.md'), 'utf8');
  assert.match(runbook, /betterref-3d --make-plan/);
  assert.match(runbook, /betterref-3d --make-hunyuan-request/);
  assert.match(runbook, /--three-d \.betterref-3d\/3d-verdict\.json/);
});
```

- [ ] **Step 2: Run PRD tests to verify RED**

Run:

```bash
node --test test/prd-cli.test.mjs
```

Expected: FAIL because `threeDRequired`, `hunyuanRequired`, and `hunyuan3d` asset plan entries are not emitted.

- [ ] **Step 3: Add 3D detectors in `lib/prd.mjs`**

Add helpers near existing asset classifiers:

```js
function isThreeDModelRequirement(item) {
  if (isCodeNativeVisualBehavior(item)) {
    return false;
  }
  return /\b(?:3d model|real 3d|glb|gltf|obj|usdz|mesh|topology|turntable|model-viewer|three\.js|hunyuan\s*3d|hugging\s*face)\b/i.test(item);
}

function inferThreeDRequired(requirements = []) {
  return requirements.some(isThreeDModelRequirement);
}

function inferHunyuanRequired(requirements = []) {
  return requirements.some((item) => /\bhunyuan\s*3d\b|hugging\s*face/i.test(item));
}
```

- [ ] **Step 4: Add Hunyuan asset entries in `makeAssetPlan`**

At the start of `makeAssetPlan`, compute:

```js
const threeDRequirements = unique(requirements.filter(isThreeDModelRequirement));
```

When creating assets, append:

```js
const threeDAssets = threeDRequirements.map((requirement, index) => ({
  id: `model-${String(index + 1).padStart(3, '0')}`,
  status: 'pending',
  phase: phaseForRequirement(requirement),
  role: 'hunyuan-3d-model',
  requirement,
  tool: 'hunyuan3d',
  implementation: 'hunyuan-3d-model-via-tencent-api',
  targetPath: `public/betterref-assets/hunyuan-model-${String(index + 1).padStart(2, '0')}.glb`,
  targetFormat: 'glb',
  acceptanceCriteria: [
    'Do not use a flat 2D billboard or screenshot as a model.',
    'Model must load in the intended runtime.',
    'Mesh stats must show non-empty geometry.',
    'Turntable or multi-angle render evidence is required.',
    'Material or texture evidence is required when the PRD/reference asks for material fidelity.'
  ]
}));
```

Return `threeDRequired`:

```js
return {
  schemaVersion: 'betterref.asset.plan.v1',
  imagegenRequired,
  hyperframesRequired,
  threeDRequired: threeDAssets.length > 0,
  assets: [...assets, ...threeDAssets]
};
```

Ensure `assets` variable here means the existing imagegen/hyperframes asset array.

- [ ] **Step 5: Add summary fields**

In `buildPrdArtifacts`, compute:

```js
const threeDRequired = inferThreeDRequired(requirements);
const hunyuanRequired = inferHunyuanRequired(requirements);
```

Add to `summary`:

```js
threeDRequired,
hunyuanRequired,
```

After asset plan creation, set:

```js
summary.threeDRequired = assetPlan.threeDRequired;
```

- [ ] **Step 6: Add runbook 3D section**

In `makeRunbook`, add `threeDRequired` parameter and render section:

```js
const threeDSection = threeDRequired
  ? `
## Hunyuan 3D Model Loop

\`\`\`bash
betterref-reference --ref ${reference} --out .betterref-reference --target ui,3d,hunyuan --json
betterref-3d --make-plan --analysis .betterref-reference/reference-analysis.json --out .betterref-3d --format glb --json
betterref-3d --make-hunyuan-request --plan .betterref-3d/3d-asset-plan.json --out .betterref-3d --provider tencent --tencent-region ap-guangzhou --tencent-edition pro --tencent-model 3.1 --result-format GLB --enable-pbr true --face-count 50000 --json
# After Hunyuan returns a model and render evidence:
betterref-3d --verify --plan .betterref-3d/3d-asset-plan.json --evidence .betterref-3d/3d-evidence.json --project . --out .betterref-3d --json
\`\`\`
`
  : '';
```

Include `${threeDSection}` before final verify commands.

Update final verify command:

```bash
betterref-verify ... --three-d .betterref-3d/3d-verdict.json --require guard,prd,longpage,assetplan,browser,3d ...
```

Only include `3d` in the require list when `threeDRequired` is true.

- [ ] **Step 7: Run PRD tests**

Run:

```bash
node --test test/prd-cli.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

Run:

```bash
git add lib/prd.mjs test/prd-cli.test.mjs
git commit -m "Detect 3D requirements in PRD artifacts"
```

## Task 5: Run Orchestrator 3D Blockers

**Files:**
- Modify: `lib/run.mjs`
- Modify: `test/run-cli.test.mjs`

- [ ] **Step 1: Add failing run test for 3D blockers**

In `test/run-cli.test.mjs`, add a fixture-style test matching existing patterns:

```js
test('betterref-run blocks on required Hunyuan 3D handoff before browser verification', async () => {
  const dir = await makeCase('hunyuan-3d-blocker');
  const project = path.join(dir, 'project');
  const pdf = path.join(dir, 'prd.pdf');
  const ref = path.join(dir, 'reference.png');
  await mkdir(project, { recursive: true });
  await writePdf(pdf, [
    'Viewport: 1440x900.',
    'Hunyuan 3D: generate GLB model through Tencent Cloud API.',
    '3D acceptance: mesh must load in Three.js and provide turntable evidence.'
  ]);
  await writePng(ref);

  const result = spawnSync(process.execPath, [
    runBin,
    '--pdf',
    pdf,
    '--project',
    project,
    '--ref',
    ref,
    '--url',
    'http://127.0.0.1:3000/',
    '--json'
  ], { cwd: repoRoot, encoding: 'utf8' });

  assert.equal(result.status, 3, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'blocked');
  assert.equal(payload.phase, '3d');
  assert.ok(payload.blockers.some((item) => item.code === 'blocked_external_3d_generation'));
  assert.match(payload.artifacts.threeDPlanPath, /3d-asset-plan\.json$/);
  assert.match(payload.artifacts.hunyuanRequestPath, /hunyuan-request\.json$/);
});
```

This test uses existing helpers already defined in `test/run-cli.test.mjs`: `makeCase`, `writePdf`, `writePng`, `runBin`, and `repoRoot`.

- [ ] **Step 2: Run test to verify RED**

Run:

```bash
node --test test/run-cli.test.mjs
```

Expected: FAIL because `betterref-run` does not create 3D blockers.

- [ ] **Step 3: Import 3D helpers in `lib/run.mjs`**

Add:

```js
import { make3DAssetPlan, makeHunyuanRequest, verify3D } from './threeD.mjs';
```

- [ ] **Step 4: Add 3D paths to `defaultPaths`**

Add:

```js
referenceOut: path.join(projectRoot, '.betterref-reference'),
threeDOut: path.join(projectRoot, '.betterref-3d'),
threeDPlanPath: path.join(projectRoot, '.betterref-3d', '3d-asset-plan.json'),
hunyuanRequestPath: path.join(projectRoot, '.betterref-3d', 'hunyuan-request.json'),
threeDVerdictPath: path.join(projectRoot, '.betterref-3d', '3d-verdict.json')
```

- [ ] **Step 5: Block on 3D after PRD artifacts and before browser evidence**

After reading `summary` and `assetPlan`, add:

```js
if (assetPlan.threeDRequired || summary.threeDRequired) {
  artifacts.threeDPlanPath = paths.threeDPlanPath;
  artifacts.hunyuanRequestPath = paths.hunyuanRequestPath;
  steps.push({ name: '3d-handoff', status: 'blocked' });
  blockers.push({
    code: 'blocked_external_3d_generation',
    message: 'A Hunyuan 3D model is required. Generate the 3D model, attach evidence, and run betterref-3d --verify before final verification can pass.',
    nextAction: `betterref-reference --ref ${path.resolve(options.referencePath)} --out ${paths.referenceOut} --target ui,3d,hunyuan --json && betterref-3d --make-plan --analysis ${path.join(paths.referenceOut, 'reference-analysis.json')} --out ${paths.threeDOut} --format glb --json && betterref-3d --make-hunyuan-request --plan ${paths.threeDPlanPath} --out ${paths.threeDOut} --provider tencent --tencent-region ap-guangzhou --tencent-edition pro --tencent-model 3.1 --result-format GLB --enable-pbr true --face-count 50000 --json`
  });
}
```

Place this before the existing `if (blockers.length > 0)` return, so it exits with phase `3d` when only 3D blockers exist.

- [ ] **Step 6: Use phase `3d` when 3D blockers exist**

Change the blocker return:

```js
const phase = blockers.some((item) => item.code === 'blocked_external_3d_generation') ? '3d' : 'assets';
return finish({ options, paths, artifacts, steps, status: 'blocked', phase, exitCode: 3, blockers });
```

- [ ] **Step 7: Run run tests**

Run:

```bash
node --test test/run-cli.test.mjs
```

Expected: PASS.

- [ ] **Step 8: Commit Task 5**

Run:

```bash
git add lib/run.mjs test/run-cli.test.mjs
git commit -m "Block BetterRef runs on required 3D handoffs"
```

## Task 6: Skill, Reference Docs, And Agent-Team Contract

**Files:**
- Modify: `SKILL.md`
- Modify: `README.md`
- Modify: `agents/openai.yaml`
- Create: `references/reference-intelligence.md`
- Create: `references/reference-to-3d.md`
- Create: `references/hunyuan-tencent.md`
- Create: `references/agent-team.md`
- Modify: `references/pressure-tests.md`
- Modify: `references/hard-fail-ledger.md`
- Modify: `test/skill-contract.test.mjs`

- [ ] **Step 1: Add failing skill contract tests**

Append to `test/skill-contract.test.mjs`:

```js
test('SKILL.md documents reference intelligence, Hunyuan 3D, and expanded agent team', async () => {
  const skill = await readFile(skillPath, 'utf8');
  assert.match(skill, /Reference Intelligence/i);
  assert.match(skill, /betterref-reference/);
  assert.match(skill, /betterref-3d/);
  assert.match(skill, /Hunyuan 3D/i);
  assert.match(skill, /Tencent Cloud/i);
  assert.match(skill, /Expanded Agent Team/i);
  assert.match(skill, /3D model/i);
  assert.match(skill, /flat 2D billboard/i);
});

test('BetterRef ships reference intelligence and 3D guidance files', async () => {
  for (const relativePath of [
    'references/reference-intelligence.md',
    'references/reference-to-3d.md',
    'references/hunyuan-tencent.md',
    'references/agent-team.md'
  ]) {
    assert.equal(await fileExists(relativePath), true, `${relativePath} must exist`);
  }
});

test('pressure tests cover 3D and expanded-agent failure modes', async () => {
  const pressureTests = await readFile(path.join(repoRoot, 'references', 'pressure-tests.md'), 'utf8');
  for (const id of ['BR-PRESSURE-017', 'BR-PRESSURE-018', 'BR-PRESSURE-019', 'BR-PRESSURE-020']) {
    assert.match(pressureTests, new RegExp(id));
  }
  assert.match(pressureTests, /flat 2D billboard/i);
  assert.match(pressureTests, /Hunyuan/i);
  assert.match(pressureTests, /specialist confidence/i);
});
```

- [ ] **Step 2: Run skill tests to verify RED**

Run:

```bash
node --test test/skill-contract.test.mjs
```

Expected: FAIL because the new docs and skill text do not exist yet.

- [ ] **Step 3: Update `SKILL.md` command aliases**

Add aliases to the command table:

```markdown
| `use $betterref analyze reference` | Analyze a reference image into measured facts, uncertainties, visual checklist, 3D brief, and negative prompts. |
| `use $betterref 3d model` | Route modelable references into 3D asset plan, Hunyuan handoff, and 3D evidence verification. |
| `use $betterref agent team` | Use the tiered BetterRef Supervisor agent architecture for deep PRD/reference/3D work. |
```

Add quick decision rows:

```markdown
| Reference image supplied for deep copying | Run `betterref-reference` and require `reference-analysis.json` before planning. |
| Reference contains object/product/character/prop for 3D | Create 3D brief and run `betterref-3d` handoff. |
| Hunyuan 3D via Tencent Cloud requested | Use Space/Endpoint/custom adapter and record request/response metadata. |
| Work is PRD + visual + 3D | Use expanded tiered agent team; supervisor merges specialist reports. |
```

- [ ] **Step 4: Create `references/reference-intelligence.md`**

Use:

```markdown
# Reference Intelligence

Use this when BetterRef receives a visual reference image.

## Required outputs

- `reference-analysis.json`
- `visual-checklist.md`
- `negative-prompts.md`
- `3d-brief.md` when the reference has modelable object cues

## Reading layers

1. Pixel facts: size, crop, aspect ratio, bounds, swatches, visible text.
2. Design semantics: hierarchy, component roles, typography, brand mood.
3. 3D cues: silhouette, volumes, camera, material slots, texture zones.
4. Uncertainty: hidden sides, exact scale, topology, ambiguous material.

Facts must include confidence. Critical low-confidence facts block final pass or require an explicit assumption.
```

- [ ] **Step 5: Create `references/reference-to-3d.md`**

Use:

```markdown
# Reference To 3D

Use when a reference image contains an object, product, character, prop, mascot, game asset, or modelable logo object.

## 3D brief

Include silhouette, major volumes, visible proportions, camera angle, material slots, texture cues, target format, and known unknowns.

## Hard fails

- Flat 2D billboard pretending to be a 3D model.
- Missing mesh/load evidence.
- Missing turntable or multi-angle render evidence when fidelity matters.
- Material or texture mismatch hidden behind a high visual score.
- Export target missing or not loadable in the intended runtime.
```

- [ ] **Step 6: Create `references/hunyuan-tencent.md`**

Use:

```markdown
# Hunyuan 3D Through Tencent Cloud

BetterRef supports provider adapters instead of hardcoding one Tencent Cloud API shape.

## Providers

- `space`: Tencent Cloud API or Gradio-style call.
- `endpoint`: dedicated Tencent Cloud Inference Endpoint.
- `custom`: explicit wrapper URL.

## Required artifacts

- `hunyuan-request.json`
- `hunyuan-response.json`
- `3d-asset-plan.json`
- `3d-verdict.json`

Use `TENCENTCLOUD_SECRET_ID/TENCENTCLOUD_SECRET_KEY` from the environment or a secure connector. Never commit raw tokens.
```

- [ ] **Step 7: Create `references/agent-team.md`**

Use:

```markdown
# BetterRef Agent Team

Use a tiered team for PRD/reference/3D work.

## Tier 0

- BetterRef Supervisor

## Tier 1

- PRD Analyst
- Reference Analyst
- Implementation Planner
- QA Verifier

## Tier 2

- Typography Agent
- Color/Material Agent
- Layout Agent
- Asset Agent
- 3D Shape Agent
- Hunyuan API Agent
- 3D QA Agent
- Accessibility/UX Agent

## Tier 3

- Hard-Fail Auditor
- Spec Compliance Reviewer
- Code Quality Reviewer
- Evidence Integrity Agent

Every specialist report must include facts, evidence, confidence, uncertainties, recommended actions, and hard fails.
```

- [ ] **Step 8: Extend pressure tests**

Append to `references/pressure-tests.md`:

```markdown
## BR-PRESSURE-017 Flat 2D Billboard As 3D

Input: Hunyuan/3D deliverable is required, but the output is a plane with the reference image mapped onto it.

Required behavior: hard fail; model must include non-empty 3D geometry and multi-angle render evidence.

## BR-PRESSURE-018 Hunyuan Request Missing Provider Evidence

Input: a model file exists, but no `hunyuan-request.json`, provider type, Space/Endpoint URL, seed/settings, or response metadata exists.

Required behavior: final verdict hard fails until request and response metadata are recorded.

## BR-PRESSURE-019 3D Model Without Turntable Evidence

Input: GLB exists and loads, but only one pretty render is attached.

Required behavior: fail or revise when the task requires 3D fidelity; require front/side/three-quarter/turntable evidence.

## BR-PRESSURE-020 Specialist Report Without Confidence

Input: expanded agent team reports facts without confidence or evidence paths.

Required behavior: supervisor rejects the report and asks the specialist to return structured facts, confidence, uncertainties, and evidence.
```

- [ ] **Step 9: Extend hard-fail ledger**

Add a 3D section to `references/hard-fail-ledger.md`:

```markdown
## 3D Model Hard Fails

- `flat_billboard_as_3d`: reference image mapped to a plane instead of real model geometry.
- `3d_model_missing_load_evidence`: model file exists but no runtime load evidence exists.
- `3d_model_missing_mesh_stats`: no vertex/face/material counts for a passed model.
- `3d_model_missing_turntable`: no multi-angle or turntable evidence when fidelity is required.
- `hunyuan_missing_request_metadata`: Hunyuan output accepted without provider/request/response metadata.
```

- [ ] **Step 10: Update README and `agents/openai.yaml`**

Add concise README sections:

```markdown
## Reference Intelligence

Run `betterref-reference --ref reference.png --out .betterref-reference --target ui,3d,hunyuan` before planning deep reference-copy work.

## Hunyuan 3D

Use `betterref-3d` to create `3d-asset-plan.json`, `hunyuan-request.json`, and `3d-verdict.json`. BetterRef supports Space, Endpoint, and custom provider adapters.
```

Update `agents/openai.yaml` `short_description` to mention 3D:

```yaml
short_description: "Turn PRDs, visual references, and 3D model refs into measurable QA loops."
```

- [ ] **Step 11: Run skill contract tests**

Run:

```bash
node --test test/skill-contract.test.mjs
```

Expected: PASS.

- [ ] **Step 12: Commit Task 6**

Run:

```bash
git add SKILL.md README.md agents/openai.yaml references/reference-intelligence.md references/reference-to-3d.md references/hunyuan-tencent.md references/agent-team.md references/pressure-tests.md references/hard-fail-ledger.md test/skill-contract.test.mjs
git commit -m "Document BetterRef supervisor reference and 3D workflows"
```

## Task 7: Full Test Suite And Packaging Verification

**Files:**
- Modify only files required to fix tests from earlier tasks.

- [ ] **Step 1: Run full test suite**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Run CLI smoke commands**

Run:

```bash
node bin/betterref-reference.mjs --help
node bin/betterref-3d.mjs --help
node bin/betterref-verify.mjs --help
```

Expected: each command exits 0 and prints usage text.

- [ ] **Step 3: Check package metadata**

Run:

```bash
npm pack --dry-run
```

Expected: tarball preview includes `bin/betterref-reference.mjs`, `bin/betterref-3d.mjs`, `lib/reference.mjs`, `lib/threeD.mjs`, and new reference docs.

- [ ] **Step 4: Review git diff**

Run:

```bash
git status --short
git diff --stat
```

Expected: no unintended generated evidence directories are tracked.

- [ ] **Step 5: Commit any final fixes**

If Task 7 required fixes, commit only the touched implementation and test files:

```bash
git add package.json SKILL.md README.md agents/openai.yaml bin/betterref-reference.mjs bin/betterref-3d.mjs bin/betterref-verify.mjs lib/reference.mjs lib/threeD.mjs lib/verify.mjs lib/prd.mjs lib/run.mjs test/reference-cli.test.mjs test/three-d-cli.test.mjs test/verify-cli.test.mjs test/prd-cli.test.mjs test/run-cli.test.mjs test/skill-contract.test.mjs references/reference-intelligence.md references/reference-to-3d.md references/hunyuan-tencent.md references/agent-team.md references/pressure-tests.md references/hard-fail-ledger.md
git commit -m "Stabilize BetterRef supervisor verification"
```

Expected: commit succeeds or no changes remain.

## Self-Review Checklist

- Spec coverage:
  - Reference Intelligence Layer: Task 1 and Task 6.
  - Hunyuan 3D via Tencent Cloud adapter: Task 2, Task 4, Task 6.
  - 3D model evidence gates: Task 2, Task 3, Task 5.
  - Expanded tiered agent team: Task 6.
  - Final evidence gates: Task 3, Task 5, Task 7.
- TDD coverage: every code task starts with a failing test and expected RED command.
- Scope control: live Tencent Cloud API calls are not required in tests; adapter handoff artifacts are tested locally.
- Integration path: `betterref-prd` detects 3D needs, `betterref-run` blocks on 3D handoff, `betterref-verify` enforces 3D evidence.
