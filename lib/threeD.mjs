import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const PASS_STATUSES = new Set(['pass', 'passed', 'complete', 'completed', 'ok']);
const PENDING_STATUSES = new Set(['pending', 'todo', 'blocked', 'missing', 'fail', 'failed']);

export class BetterRef3DError extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.name = 'BetterRef3DError';
    this.exitCode = exitCode;
  }
}

async function readJson(filePath, label) {
  if (!filePath) {
    throw new BetterRef3DError(`Missing ${label} path.`);
  }

  let raw;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    throw new BetterRef3DError(`Could not read ${label} JSON at ${filePath}: ${error.message}`);
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new BetterRef3DError(`Could not parse ${label} JSON at ${filePath}: ${error.message}`);
  }
}

async function writeJson(filePath, value) {
  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
  } catch (error) {
    throw new BetterRef3DError(`Could not write JSON at ${filePath}: ${error.message}`);
  }
}

function asArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

function isPassStatus(status) {
  return PASS_STATUSES.has(String(status || '').trim().toLowerCase());
}

function isPendingStatus(status) {
  const normalized = String(status || '').trim().toLowerCase();
  return !isPassStatus(normalized) && (normalized === '' || PENDING_STATUSES.has(normalized));
}

function providerTypes(provider) {
  const normalized = String(provider || 'space').trim().toLowerCase();
  if (normalized === 'both') return ['space', 'endpoint'];
  if (normalized === 'endpoint') return ['endpoint'];
  if (normalized === 'custom') return ['custom'];
  return ['space'];
}

function makeProvider(type, { space, endpoint, customUrl }) {
  if (type === 'space') {
    return {
      type,
      space: space || 'tencent/Hunyuan3D-2',
      transport: 'huggingface-space'
    };
  }
  if (type === 'endpoint') {
    return {
      type,
      endpoint: endpoint || null,
      transport: 'huggingface-inference-endpoint'
    };
  }
  return {
    type,
    url: customUrl || null,
    transport: 'custom-hunyuan-wrapper'
  };
}

function defaultCriteria() {
  return [
    'Do not use a flat 2D billboard or screenshot as a model.',
    'Model file must exist, be non-empty, and load in the intended runtime.',
    'Mesh stats must show non-empty geometry.',
    'Turntable or multi-angle render evidence is required.',
    'Material or texture evidence is required when the PRD/reference asks for material fidelity.'
  ];
}

function defaultPrompt(analysis) {
  const silhouette = analysis.objectCues?.silhouette || 'Generate a faithful 3D model from the visual reference.';
  const materials = asArray(analysis.objectCues?.materialSlots).join(', ') || 'base material zones';
  return `${silhouette} Preserve visible proportions, major volumes, and material slots: ${materials}.`;
}

export async function make3DAssetPlan({ analysisPath, outDir, format } = {}) {
  if (!outDir) {
    throw new BetterRef3DError('Missing required --out for 3D asset plan.');
  }

  const analysis = await readJson(analysisPath, 'reference analysis');
  const targets = asArray(analysis.targets).map((item) => String(item).toLowerCase());
  const modelable = Boolean(
    analysis.objectCues?.modelable ||
      targets.includes('3d') ||
      targets.includes('model') ||
      targets.includes('hunyuan')
  );
  const targetFormat = String(format || analysis.objectCues?.targetFormat || 'glb').toLowerCase();
  const assets = modelable
    ? [
        {
          id: 'model-001',
          status: 'pending',
          provider: 'hunyuan',
          sourceImage: analysis.source || analysis.referencePath || null,
          targetFormat,
          targetPath: `public/betterref-assets/model-001.${targetFormat}`,
          prompt: defaultPrompt(analysis),
          silhouette: analysis.objectCues?.silhouette || null,
          materialSlots: asArray(analysis.objectCues?.materialSlots),
          confidence: analysis.objectCues?.confidence || 'low',
          uncertainties: asArray(analysis.uncertainties),
          acceptanceCriteria: defaultCriteria()
        }
      ]
    : [];

  const plan = {
    schemaVersion: 'betterref.3d.asset.plan.v1',
    generatedAt: new Date().toISOString(),
    sourceAnalysisPath: path.resolve(analysisPath),
    threeDRequired: assets.length > 0,
    assets
  };
  const planPath = path.join(outDir, '3d-asset-plan.json');
  await writeJson(planPath, plan);

  return {
    schemaVersion: 'betterref.3d.plan.result.v1',
    generatedAt: new Date().toISOString(),
    artifacts: { planPath },
    plan
  };
}

export async function makeHunyuanRequest({
  planPath,
  outDir,
  provider = 'space',
  space,
  endpoint,
  customUrl
} = {}) {
  if (!outDir) {
    throw new BetterRef3DError('Missing required --out for Hunyuan request.');
  }

  const plan = await readJson(planPath, '3D asset plan');
  const providers = providerTypes(provider).map((type) => makeProvider(type, { space, endpoint, customUrl }));
  const assets = asArray(plan.assets).map((asset) => ({
    id: asset.id,
    provider: asset.provider || 'hunyuan',
    prompt: asset.prompt || '',
    input: {
      sourceImage: asset.sourceImage || null,
      planPath
    },
    output: {
      targetFormat: asset.targetFormat || 'glb',
      targetPath: asset.targetPath || `public/betterref-assets/${asset.id || 'model'}.glb`
    },
    acceptanceCriteria: asArray(asset.acceptanceCriteria),
    retry: {
      maxAttempts: 3,
      recordResponseMetadata: true
    }
  }));
  const requestPath = path.join(outDir, 'hunyuan-request.json');
  const request = {
    schemaVersion: 'betterref.3d.hunyuan.request.v1',
    generatedAt: new Date().toISOString(),
    planPath: path.resolve(planPath),
    providers,
    auth: {
      type: 'bearer',
      envVar: 'HF_TOKEN',
      available: Boolean(process.env.HF_TOKEN)
    },
    assets,
    artifacts: {
      requestPath,
      expectedResponsePath: path.join(outDir, 'hunyuan-response.json')
    }
  };

  await writeJson(requestPath, request);
  return request;
}

function evidenceItems(evidence) {
  if (Array.isArray(evidence.assets)) return evidence.assets;
  if (Array.isArray(evidence.models)) return evidence.models;
  return [];
}

function evidenceForAsset(asset, evidence) {
  return evidenceItems(evidence).find((item) => item.id === asset.id || item.assetId === asset.id) || {};
}

function resolveProjectPath(filePath, projectDir) {
  if (!filePath) return null;
  return path.isAbsolute(filePath) ? filePath : path.resolve(projectDir || process.cwd(), filePath);
}

async function nonEmptyFile(filePath) {
  try {
    const info = await stat(filePath);
    return info.isFile() && info.size > 0;
  } catch {
    return false;
  }
}

function hasMeshStats(item) {
  const statsValue = item.meshStats || item.mesh || item.geometry;
  if (!statsValue || typeof statsValue !== 'object') return false;
  const vertexCount = Number(statsValue.vertexCount ?? statsValue.vertices ?? statsValue.vertex_count ?? 0);
  const faceCount = Number(statsValue.faceCount ?? statsValue.faces ?? statsValue.triangles ?? statsValue.triangleCount ?? 0);
  return vertexCount > 0 && faceCount > 0;
}

function hasRenderEvidence(item) {
  const renders = [
    ...asArray(item.renders),
    ...asArray(item.renderEvidence),
    ...asArray(item.turntable),
    ...asArray(item.turntableEvidence)
  ].filter(Boolean);
  if (renders.length > 0) return true;
  return Boolean(item.turntablePath || item.renderPath || item.previewPath);
}

function failure(code, asset, message) {
  return {
    code,
    assetId: asset.id,
    message
  };
}

export async function verify3D({ planPath, evidencePath, outDir, projectDir } = {}) {
  if (!outDir) {
    throw new BetterRef3DError('Missing required --out for 3D verification.');
  }

  const plan = await readJson(planPath, '3D asset plan');
  const evidence = await readJson(evidencePath, '3D evidence');
  const failures = [];
  const assets = asArray(plan.assets);
  const checkedAssets = [];

  for (const asset of assets) {
    const item = evidenceForAsset(asset, evidence);
    const combinedStatus = item.status || asset.status;
    const modelPath = item.modelPath || item.generatedPath || item.outputPath || asset.generatedPath;
    const resolvedModelPath = resolveProjectPath(modelPath, projectDir);
    const modelExists = resolvedModelPath ? await nonEmptyFile(resolvedModelPath) : false;

    if (isPendingStatus(asset.status) || isPendingStatus(item.status)) {
      failures.push(failure('asset_pending', asset, `3D asset ${asset.id} is not marked complete.`));
    }
    if (isPassStatus(combinedStatus) && !modelExists) {
      failures.push(failure('missing_model_file', asset, `3D asset ${asset.id} is passing but has no non-empty model file.`));
    }
    if (!isPassStatus(combinedStatus) && !modelExists) {
      failures.push(failure('missing_model_file', asset, `3D asset ${asset.id} has no non-empty model file.`));
    }
    if (!hasMeshStats(item)) {
      failures.push(failure('missing_mesh_stats', asset, `3D asset ${asset.id} is missing non-empty mesh stats.`));
    }
    if (!hasRenderEvidence(item)) {
      failures.push(failure('missing_render_evidence', asset, `3D asset ${asset.id} is missing render or turntable evidence.`));
    }

    checkedAssets.push({
      id: asset.id,
      status: combinedStatus || 'missing',
      modelPath: resolvedModelPath,
      modelExists,
      meshStatsPresent: hasMeshStats(item),
      renderEvidencePresent: hasRenderEvidence(item)
    });
  }

  const pass = failures.length === 0;
  const verdict = {
    schemaVersion: 'betterref.3d.verdict.v1',
    generatedAt: new Date().toISOString(),
    status: pass ? 'pass' : 'fail',
    pass,
    planPath: path.resolve(planPath),
    evidencePath: path.resolve(evidencePath),
    checkedAssets,
    failures
  };
  const verdictPath = path.join(outDir, '3d-verdict.json');
  await writeJson(verdictPath, verdict);

  return {
    ...verdict,
    artifacts: { verdictPath }
  };
}
