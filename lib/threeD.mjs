import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const PASS_STATUSES = new Set(['pass', 'passed', 'complete', 'completed', 'ok']);
const PENDING_STATUSES = new Set(['pending', 'todo', 'blocked', 'missing', 'fail', 'failed']);
const ROBLOX_TRIANGLE_BUDGETS = {
  genericMeshPartMaxTriangles: 20000,
  accessoryMaxTriangles: 4000,
  avatarBodyTotalMaxTriangles: 10742
};

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

async function writeText(filePath, value) {
  try {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, value);
  } catch (error) {
    throw new BetterRef3DError(`Could not write file at ${filePath}: ${error.message}`);
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

function statusValue(status) {
  return String(status || '').trim();
}

function effectiveStatus(assetStatus, evidenceStatus) {
  return isPassStatus(evidenceStatus) ? evidenceStatus : assetStatus;
}

function providerTypes({ provider, endpoint, customUrl }) {
  const normalized = String(provider || 'space').trim().toLowerCase();
  if (!['space', 'endpoint', 'both', 'custom', 'tencent'].includes(normalized)) {
    throw new BetterRef3DError(`Unknown Hunyuan provider: ${provider}. Use space, endpoint, both, custom, or tencent.`);
  }
  if ((normalized === 'endpoint' || normalized === 'both') && !endpoint) {
    throw new BetterRef3DError('--endpoint is required for endpoint or both Hunyuan provider modes.');
  }
  if (normalized === 'custom' && !customUrl) {
    throw new BetterRef3DError('--custom-url is required for custom Hunyuan provider mode.');
  }
  if (normalized === 'both') return ['space', 'endpoint'];
  if (normalized === 'endpoint') return ['endpoint'];
  if (normalized === 'custom') return ['custom'];
  if (normalized === 'tencent') return ['tencent'];
  return ['space'];
}

function tencentEditionConfig(edition) {
  const normalized = String(edition || 'pro').trim().toLowerCase();
  if (normalized === 'pro') {
    return {
      edition: 'pro',
      submitAction: 'SubmitHunyuanTo3DProJob',
      queryAction: 'QueryHunyuanTo3DProJob'
    };
  }
  if (normalized === 'rapid') {
    return {
      edition: 'rapid',
      submitAction: 'SubmitHunyuanTo3DRapidJob',
      queryAction: 'QueryHunyuanTo3DRapidJob'
    };
  }
  throw new BetterRef3DError(`Unknown Tencent Hunyuan3D edition: ${edition}. Use pro or rapid.`);
}

function booleanOption(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  throw new BetterRef3DError(`Expected boolean value, got: ${value}`);
}

function integerOption(value, fallback, label) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BetterRef3DError(`${label} must be a positive integer.`);
  }
  return parsed;
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

function isThreeDModelAsset(asset) {
  const tool = String(asset?.tool || '').toLowerCase();
  const implementation = String(asset?.implementation || '').toLowerCase();
  const provider = String(asset?.provider || asset?.modelProvider || '').toLowerCase();
  const role = String(asset?.role || '').toLowerCase();
  const targetFormat = String(asset?.targetFormat || asset?.outputFormat || '').toLowerCase();
  const targetPath = String(asset?.targetPath || asset?.path || asset?.file || '').toLowerCase();
  return (
    ['hunyuan3d', 'hunyuan-3d', 'three-d', '3d'].includes(tool) ||
    /\bhunyuan(?:-?3d)?\b/.test(implementation) ||
    /\b(?:hunyuan|huggingface|hugging face).*\b3d\b|\b3d\b.*\b(?:hunyuan|huggingface|hugging face)\b/.test(provider) ||
    role === 'hunyuan-3d-model' ||
    ['glb', 'gltf', 'obj', 'usdz'].includes(targetFormat) ||
    /\.(?:glb|gltf|obj|usdz)(?:$|[?#])/.test(targetPath)
  );
}

function uniqueStrings(values) {
  const unique = [];
  for (const value of values) {
    const text = String(value || '').trim();
    if (text && !unique.includes(text)) {
      unique.push(text);
    }
  }
  return unique;
}

function source3DAssets(assetPlan) {
  return asArray(assetPlan?.assets).filter(isThreeDModelAsset);
}

function planAssetFromReference({ sourceAsset = {}, analysis, index, format }) {
  const targetFormat = String(
    sourceAsset.targetFormat ||
      sourceAsset.outputFormat ||
      format ||
      analysis.objectCues?.targetFormat ||
      'glb'
  ).toLowerCase();
  const id = sourceAsset.id || `model-${String(index + 1).padStart(3, '0')}`;
  return {
    id,
    status: sourceAsset.status || 'pending',
    provider: sourceAsset.provider || 'hunyuan',
    sourceImage: sourceAsset.sourceImage || analysis.source || analysis.referencePath || null,
    targetFormat,
    targetPath: sourceAsset.targetPath || `public/betterref-assets/${id}.${targetFormat}`,
    requirement: sourceAsset.requirement || null,
    prompt: sourceAsset.prompt || defaultPrompt(analysis),
    silhouette: sourceAsset.silhouette || analysis.objectCues?.silhouette || null,
    materialSlots: asArray(sourceAsset.materialSlots).length > 0
      ? asArray(sourceAsset.materialSlots)
      : asArray(analysis.objectCues?.materialSlots),
    confidence: sourceAsset.confidence || analysis.objectCues?.confidence || 'low',
    uncertainties: asArray(sourceAsset.uncertainties).length > 0
      ? asArray(sourceAsset.uncertainties)
      : asArray(analysis.uncertainties),
    acceptanceCriteria: uniqueStrings([...asArray(sourceAsset.acceptanceCriteria), ...defaultCriteria()]),
    sourceAsset: sourceAsset.id
      ? {
          id: sourceAsset.id,
          targetPath: sourceAsset.targetPath || null
        }
      : null
  };
}

export async function make3DAssetPlan({ analysisPath, outDir, format, assetPlanPath } = {}) {
  if (!outDir) {
    throw new BetterRef3DError('Missing required --out for 3D asset plan.');
  }

  const analysis = await readJson(analysisPath, 'reference analysis');
  const sourcePlan = assetPlanPath ? await readJson(assetPlanPath, 'BetterRef asset plan') : null;
  const seededAssets = source3DAssets(sourcePlan);
  const targets = asArray(analysis.targets).map((item) => String(item).toLowerCase());
  const modelable = Boolean(
    seededAssets.length > 0 ||
      analysis.objectCues?.modelable ||
      targets.includes('3d') ||
      targets.includes('model') ||
      targets.includes('hunyuan')
  );
  const seed = seededAssets.length > 0 ? seededAssets : modelable ? [{}] : [];
  const assets = seed.map((sourceAsset, index) =>
    planAssetFromReference({ sourceAsset, analysis, index, format })
  );

  const plan = {
    schemaVersion: 'betterref.3d.asset.plan.v1',
    generatedAt: new Date().toISOString(),
    sourceAnalysisPath: path.resolve(analysisPath),
    sourceAssetPlanPath: assetPlanPath ? path.resolve(assetPlanPath) : null,
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
  customUrl,
  tencentEndpoint,
  tencentRegion,
  tencentEdition,
  tencentModel,
  resultFormat,
  enablePBR,
  faceCount
} = {}) {
  if (!outDir) {
    throw new BetterRef3DError('Missing required --out for Hunyuan request.');
  }

  const plan = await readJson(planPath, '3D asset plan');
  const providers = providerTypes({ provider, endpoint, customUrl });
  const usesTencentCloud = providers.includes('tencent');
  const usesHuggingFace = providers.some((item) => ['space', 'endpoint', 'custom'].includes(item));
  const assets = asArray(plan.assets).map((asset) => ({
    id: asset.id,
    provider: asset.provider || 'hunyuan',
    sourceImage: asset.sourceImage || null,
    targetFormat: asset.targetFormat || 'glb',
    targetPath: asset.targetPath || `public/betterref-assets/${asset.id || 'model'}.glb`,
    prompt: asset.prompt || '',
    acceptanceCriteria: asArray(asset.acceptanceCriteria),
    retry: {
      maxAttempts: 3,
      recordResponseMetadata: true
    }
  }));
  const requestPath = path.join(outDir, 'hunyuan-request.json');
  const request = {
    schemaVersion: 'betterref.hunyuan.request.v1',
    generatedAt: new Date().toISOString(),
    planPath: path.resolve(planPath),
    providers,
    assets,
    artifacts: {
      requestPath,
      expectedResponsePath: path.join(outDir, 'hunyuan-response.json')
    }
  };

  if (usesHuggingFace) {
    request.huggingFace = {
      space: space || 'tencent/Hunyuan3D-2',
      endpoint: endpoint || null,
      customUrl: customUrl || null
    };
    request.auth = {
      type: 'bearer',
      env: 'HF_TOKEN',
      available: Boolean(process.env.HF_TOKEN)
    };
  }

  if (usesTencentCloud) {
    const edition = tencentEditionConfig(tencentEdition);
    request.tencentCloud = {
      endpoint: tencentEndpoint || 'hunyuan3d.tencentcloudapi.com',
      region: tencentRegion || 'ap-guangzhou',
      edition: edition.edition,
      submitAction: edition.submitAction,
      queryAction: edition.queryAction,
      model: tencentModel || (edition.edition === 'pro' ? '3.1' : null),
      resultFormat: String(resultFormat || 'GLB').trim().toUpperCase(),
      enablePBR: booleanOption(enablePBR, edition.edition === 'pro'),
      faceCount: integerOption(faceCount, null, '--face-count')
    };
    request.auth = {
      type: 'tencentcloud-secret',
      env: ['TENCENTCLOUD_SECRET_ID', 'TENCENTCLOUD_SECRET_KEY'],
      available: Boolean(process.env.TENCENTCLOUD_SECRET_ID && process.env.TENCENTCLOUD_SECRET_KEY)
    };
  }

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

function pathKey(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
}

function metadataItems(source) {
  return [
    ...asArray(source?.assets),
    ...asArray(source?.models),
    ...asArray(source?.outputs)
  ];
}

function metadataMatchesAsset(item, asset) {
  if (!item || typeof item !== 'object') return false;
  const assetId = String(asset.id || '');
  const itemId = String(item.id || item.Id || item.assetId || item.AssetId || item.modelId || item.ModelId || '');
  if (assetId && itemId && assetId === itemId) return true;
  const assetTarget = pathKey(asset.targetPath);
  const itemTarget = pathKey(
    item.targetPath ||
      item.TargetPath ||
      item.modelPath ||
      item.ModelPath ||
      item.outputPath ||
      item.OutputPath ||
      item.generatedPath ||
      item.GeneratedPath
  );
  return Boolean(assetTarget && itemTarget && (assetTarget === itemTarget || itemTarget.endsWith(`/${assetTarget}`)));
}

function isHunyuanAsset(asset) {
  const provider = String(asset.provider || asset.modelProvider || '').toLowerCase();
  const implementation = String(asset.implementation || '').toLowerCase();
  const tool = String(asset.tool || '').toLowerCase();
  return provider === 'hunyuan' || tool.includes('hunyuan') || implementation.includes('hunyuan');
}

function hasRequestMetadata(source, asset) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return false;
  const hasProvider = asArray(source.providers).length > 0 ||
    Boolean(source.provider || source.huggingFace || source.tencentCloud || source.space || source.endpoint || source.customUrl);
  if (!hasProvider) return false;
  const items = metadataItems(source);
  return items.some((item) => metadataMatchesAsset(item, asset));
}

function isTencentMetadata(source, item) {
  const sourceProvider = String(source?.provider || source?.Provider || '').toLowerCase();
  const itemProvider = String(item?.provider || item?.Provider || '').toLowerCase();
  const providers = asArray(source?.providers || source?.Providers).map((value) => String(value).toLowerCase());
  return Boolean(source?.tencentCloud || providers.includes('tencent') || sourceProvider === 'tencent' || itemProvider === 'tencent');
}

function hasTencentResultFiles(item) {
  const resultFiles = [
    ...asArray(item?.resultFile3Ds),
    ...asArray(item?.ResultFile3Ds),
    ...asArray(item?.resultFiles),
    ...asArray(item?.ResultFiles)
  ];
  return resultFiles.length > 0;
}

function hasResponseMetadata(source, asset) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return false;
  const items = metadataItems(source);
  const candidates = items.filter((item) => metadataMatchesAsset(item, asset));
  return candidates.some((item) => {
    const status = String(item.status || item.Status || item.state || item.State || item.result || item.Result || '').trim();
    const statusOk = !status || isPassStatus(status) || status.toLowerCase() === 'done';
    if (isTencentMetadata(source, item)) {
      const tencentStatusOk = isPassStatus(status) || status.toLowerCase() === 'done';
      return tencentStatusOk && Boolean(
        item.jobId ||
          item.JobId ||
          item.requestId ||
          item.RequestId
      ) && hasTencentResultFiles(item);
    }
    return statusOk && Boolean(
      item.responseId ||
        item.ResponseId ||
        item.jobId ||
        item.JobId ||
        item.requestId ||
        item.RequestId ||
        item.provider ||
        item.Provider ||
        item.url ||
        item.Url ||
        item.outputUrl ||
        item.OutputUrl ||
        item.resultFile3Ds ||
        item.ResultFile3Ds ||
        item.modelPath ||
        item.ModelPath ||
        item.generatedPath ||
        item.GeneratedPath ||
        item.targetPath ||
        item.TargetPath ||
        source.generatedAt ||
        source.schemaVersion
    );
  });
}

function normalizedResultFile(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    return { url: value, type: path.extname(value).replace('.', '').toUpperCase() || null };
  }
  if (typeof value !== 'object') return null;
  const url = value.url || value.Url || value.uri || value.Uri || value.href || value.Href || value.path || value.Path;
  if (!url) return null;
  return {
    type: value.type || value.Type || value.format || value.Format || value.fileType || value.FileType || null,
    url,
    name: value.name || value.Name || value.fileName || value.FileName || null
  };
}

function resultFilesFromMetadataItem(item) {
  return [
    ...asArray(item?.resultFile3Ds),
    ...asArray(item?.ResultFile3Ds),
    ...asArray(item?.resultFiles),
    ...asArray(item?.ResultFiles),
    ...asArray(item?.outputUrls),
    ...asArray(item?.OutputUrls),
    item?.outputUrl,
    item?.OutputUrl,
    item?.url,
    item?.Url
  ]
    .map(normalizedResultFile)
    .filter(Boolean);
}

function responseMetadataForAsset(source, asset) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const item = metadataItems(source).find((candidate) => metadataMatchesAsset(candidate, asset));
  if (!item) return null;
  return {
    provider: isTencentMetadata(source, item)
      ? 'tencent'
      : String(item.provider || item.Provider || source.provider || source.Provider || 'hunyuan').toLowerCase(),
    status: item.status || item.Status || item.state || item.State || null,
    jobId: item.jobId || item.JobId || null,
    requestId: item.requestId || item.RequestId || source.requestId || source.RequestId || null,
    resultFiles: resultFilesFromMetadataItem(item)
  };
}

function isRobloxTarget(asset, assetBrief) {
  const values = [
    asset?.targetPlatform,
    asset?.platform,
    asset?.runtime,
    asset?.targetRuntime,
    assetBrief?.targetPlatform,
    assetBrief?.platform,
    ...asArray(asset?.targets),
    ...asArray(asset?.acceptanceCriteria)
  ];
  return values.some((value) => /\broblox\b/i.test(String(value || '')));
}

function targetUseForAsset(asset, assetBrief) {
  return String(asset?.targetUse || asset?.useCase || assetBrief?.targetUse || '').trim().toLowerCase();
}

function triangleBudgetForAsset(asset, assetBrief) {
  if (!isRobloxTarget(asset, assetBrief)) return null;
  const budgets = {
    ...ROBLOX_TRIANGLE_BUDGETS,
    ...(assetBrief?.roblox?.triangleBudgets || {}),
    ...(asset?.roblox?.triangleBudgets || {}),
    ...(asset?.triangleBudgets || {})
  };
  const targetUse = targetUseForAsset(asset, assetBrief);
  if (/\baccessor(?:y|ies)\b/.test(targetUse)) {
    return {
      targetUse: targetUse || 'accessory',
      maxTriangles: Number(budgets.accessoryMaxTriangles || ROBLOX_TRIANGLE_BUDGETS.accessoryMaxTriangles),
      source: 'accessoryMaxTriangles'
    };
  }
  if (/\b(?:avatar|body)\b/.test(targetUse)) {
    return {
      targetUse: targetUse || 'avatar-body',
      maxTriangles: Number(budgets.avatarBodyTotalMaxTriangles || ROBLOX_TRIANGLE_BUDGETS.avatarBodyTotalMaxTriangles),
      source: 'avatarBodyTotalMaxTriangles'
    };
  }
  return {
    targetUse: targetUse || 'generic-meshpart',
    maxTriangles: Number(budgets.genericMeshPartMaxTriangles || ROBLOX_TRIANGLE_BUDGETS.genericMeshPartMaxTriangles),
    source: 'genericMeshPartMaxTriangles'
  };
}

function meshStats(item) {
  const statsValue = item.meshStats || item.mesh || item.geometry || {};
  const vertexCount = Number(statsValue.vertexCount ?? statsValue.vertices ?? statsValue.vertex_count ?? 0);
  const triangleCount = Number(
    statsValue.triangleCount ??
      statsValue.triangles ??
      statsValue.faceCount ??
      statsValue.faces ??
      statsValue.face_count ??
      0
  );
  return {
    vertexCount: Number.isFinite(vertexCount) ? vertexCount : 0,
    triangleCount: Number.isFinite(triangleCount) ? triangleCount : 0
  };
}

function triangleBudgetVerdict(asset, item, assetBrief) {
  const budget = triangleBudgetForAsset(asset, assetBrief);
  if (!budget) return null;
  const stats = meshStats(item);
  const measuredTriangles = stats.triangleCount > 0 ? stats.triangleCount : null;
  return {
    ...budget,
    measuredTriangles,
    passed: measuredTriangles === null ? false : measuredTriangles <= budget.maxTriangles
  };
}

function requiresPostHunyuanRefinement(asset, assetBrief) {
  if (!isHunyuanAsset(asset)) return false;
  if (isRobloxTarget(asset, assetBrief)) return true;
  const criteria = asArray(asset?.acceptanceCriteria).join(' ');
  return /\b(?:post-?hunyuan|retopo|decimat|baked?|low-?poly|roblox-ready)\b/i.test(criteria);
}

function hasPostHunyuanRefinementEvidence(item) {
  const evidence = item.refinementEvidence || item.postHunyuanRefinement || item.refinement || item.optimizationEvidence;
  if (evidence === true) return true;
  if (Array.isArray(evidence)) return evidence.length > 0;
  if (!evidence || typeof evidence !== 'object') return false;
  const bakedMaps = asArray(evidence.bakedMaps || evidence.bakes || evidence.textureBakes);
  return Boolean(
    evidence.retopo ||
      evidence.decimate ||
      evidence.decimated ||
      evidence.optimized ||
      evidence.lowPoly ||
      evidence.finalModelPath ||
      bakedMaps.length > 0
  );
}

function robloxEvidenceValues(item) {
  const evidence = item.robloxImportEvidence || item.robloxEvidence || item.robloxPreview || item.robloxStudioEvidence;
  if (evidence === true) return [true];
  if (typeof evidence === 'string') return [evidence];
  if (Array.isArray(evidence)) return evidence;
  if (!evidence || typeof evidence !== 'object') return [];
  return [
    evidence.previewPath,
    evidence.screenshotPath,
    evidence.placePath,
    evidence.studioPlace,
    evidence.importLog,
    evidence.imported === true ? true : null
  ].filter(Boolean);
}

async function hasRobloxImportEvidence(item, projectDir) {
  const values = robloxEvidenceValues(item);
  if (values.length === 0) return false;
  const pathValues = values.filter((value) => typeof value === 'string');
  if (pathValues.length === 0) return values.some((value) => value === true);
  for (const evidencePath of pathValues) {
    if (!(await nonEmptyFile(resolveProjectPath(evidencePath, projectDir)))) return false;
  }
  return true;
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
  const stats = meshStats(item);
  return stats.vertexCount > 0 && stats.triangleCount > 0;
}

function renderEvidenceValues(item) {
  return [
    ...asArray(item.renders),
    ...asArray(item.renderEvidence),
    ...asArray(item.turntable),
    ...asArray(item.turntableEvidence),
    item.turntablePath,
    item.renderPath,
    item.previewPath
  ].filter(Boolean);
}

async function hasRenderEvidence(item, projectDir) {
  const renders = [
    ...asArray(item.renders),
    ...asArray(item.renderEvidence),
    ...asArray(item.turntable),
    ...asArray(item.turntableEvidence)
  ].filter(Boolean);
  const pathLikeValues = renderEvidenceValues(item).filter((value) => typeof value === 'string');
  if (pathLikeValues.length > 0) {
    for (const renderPath of pathLikeValues) {
      if (!(await nonEmptyFile(resolveProjectPath(renderPath, projectDir)))) return false;
    }
    return true;
  }
  return renders.length > 0 || Boolean(item.turntablePath || item.renderPath || item.previewPath);
}

function requiresMaterialEvidence(asset) {
  const criteria = asArray(asset.acceptanceCriteria).join(' ');
  return asArray(asset.materialSlots).length > 0 || /\b(?:material|texture|pbr)\b/i.test(criteria);
}

function hasMaterialEvidence(item) {
  const evidence = item.materialEvidence || item.materials || item.textures;
  if (evidence === true) return true;
  if (Array.isArray(evidence)) return evidence.length > 0;
  if (!evidence || typeof evidence !== 'object') return false;
  return Object.values(evidence).some((value) => {
    if (Array.isArray(value)) return value.length > 0;
    return Boolean(value);
  });
}

function failure(code, asset, message) {
  return {
    code,
    assetId: asset.id,
    message
  };
}

function blockingReason(code, asset) {
  if (code === 'asset_pending') return `${asset.id} is pending.`;
  if (code === 'missing_model_file') return `${asset.id} is missing model file.`;
  if (code === 'missing_target_model_file') return `${asset.id} is missing model file at the planned target path.`;
  if (code === 'missing_mesh_stats') return `${asset.id} is missing mesh stats.`;
  if (code === 'missing_render_evidence') return `${asset.id} is missing render or turntable evidence.`;
  if (code === 'missing_material_evidence') return `${asset.id} is missing material/texture evidence.`;
  if (code === 'missing_hunyuan_request_metadata') return `${asset.id} is missing Hunyuan request metadata.`;
  if (code === 'missing_hunyuan_response_metadata') return `${asset.id} is missing Hunyuan response metadata.`;
  if (code === 'missing_post_hunyuan_refinement') return `${asset.id} is missing post-Hunyuan refinement evidence.`;
  if (code === 'roblox_triangle_budget_exceeded') return `${asset.id} exceeds the Roblox triangle budget.`;
  if (code === 'missing_roblox_import_evidence') return `${asset.id} is missing Roblox import evidence.`;
  return `${asset.id} failed 3D verification.`;
}

function textureReferencesForAsset(assetBrief, asset) {
  const refs = [
    ...asArray(assetBrief?.textureReferences),
    ...asArray(assetBrief?.handoff?.textureWorkflow?.inputs)
  ];
  const materialSlots = asArray(asset?.materialSlots).map((item) => String(item).toLowerCase());
  if (materialSlots.length === 0) return refs;
  const matched = refs.filter((ref) => materialSlots.includes(String(ref.materialSlot || '').toLowerCase()));
  return matched.length > 0 ? matched : refs;
}

function targetPlatformForAsset(asset, assetBrief) {
  if (isRobloxTarget(asset, assetBrief)) return 'roblox';
  return String(asset?.targetPlatform || asset?.platform || assetBrief?.targetPlatform || 'runtime').toLowerCase();
}

function requiredRefineEvidence(asset, assetBrief) {
  const required = ['modelPath', 'meshStats', 'refinementEvidence'];
  if (requiresMaterialEvidence(asset) || textureReferencesForAsset(assetBrief, asset).length > 0) {
    required.push('materialEvidence');
  }
  required.push('turntableEvidence');
  if (isRobloxTarget(asset, assetBrief)) {
    required.push('robloxImportEvidence');
  }
  return required;
}

function refineActionsForAsset(asset, assetBrief) {
  const actions = [
    {
      id: 'download_tencent_result',
      title: 'Download Tencent result',
      detail: 'Fetch the GLB/texture outputs from ResultFile3Ds and keep the provider metadata.'
    },
    {
      id: 'place_target_model',
      title: 'Place final model at target path',
      detail: `Save the working/final GLB to ${asset.targetPath || 'the planned target path'}.`
    },
    {
      id: 'inspect_mesh_stats',
      title: 'Inspect mesh stats',
      detail: 'Record vertex, triangle/face, material, and texture counts before quality judgement.'
    },
    {
      id: 'retopo_or_decimate',
      title: 'Retopo or decimate',
      detail: 'Treat the raw Hunyuan mesh as source material and create a runtime-ready low-poly final.'
    },
    {
      id: 'bake_texture_maps',
      title: 'Bake texture maps',
      detail: 'Bake/author base color, normal, and PBR or SurfaceAppearance maps from the separated texture refs.'
    },
    {
      id: 'render_turntable',
      title: 'Render turntable evidence',
      detail: 'Capture front, side, three-quarter, and/or turntable evidence from the final mesh.'
    }
  ];
  if (isRobloxTarget(asset, assetBrief)) {
    actions.push({
      id: 'roblox_import_preview',
      title: 'Roblox import preview',
      detail: 'Import the final asset into Roblox Studio and capture in-engine preview/import evidence.'
    });
  }
  actions.push({
    id: 'rerun_betterref_verify',
    title: 'Rerun BetterRef verification',
    detail: 'Run betterref-3d --verify with the final 3D evidence before the asset can pass.'
  });
  return actions;
}

function renderRefineChecklist(refinePlan) {
  const lines = [
    '# Post-Hunyuan Refinement Plan',
    '',
    'Raw Hunyuan output is source material. It is not a final pass until refinement, texture, runtime, and BetterRef verification evidence exist.',
    ''
  ];

  for (const asset of refinePlan.assets) {
    lines.push(`## ${asset.id}`);
    lines.push('');
    lines.push(`- Target path: ${asset.targetPath || 'unknown'}`);
    lines.push(`- Target platform: ${asset.targetPlatform}`);
    if (asset.triangleBudget) {
      lines.push(`- Roblox triangle budget: ${asset.triangleBudget.maxTriangles} (${asset.triangleBudget.source})`);
    }
    if (asset.source.resultFiles.length > 0) {
      lines.push('- Tencent result files:');
      for (const file of asset.source.resultFiles) {
        lines.push(`  - ${file.type || 'file'}: ${file.url}`);
      }
    } else {
      lines.push('- Tencent result files: missing; query provider output before refinement.');
    }
    if (asset.textureReferences.length > 0) {
      lines.push('- Texture refs:');
      for (const ref of asset.textureReferences) {
        lines.push(`  - ${ref.id || ref.materialSlot || 'texture'}: ${ref.path || ref.url || 'unknown path'}`);
      }
    }
    lines.push('');
    lines.push('### Required Actions');
    for (const action of asset.actions) {
      lines.push(`- [ ] ${action.title}: ${action.detail}`);
    }
    lines.push('');
    lines.push('### Required Evidence');
    for (const item of asset.requiredEvidence) {
      lines.push(`- ${item}`);
    }
    lines.push('');
    lines.push('### Verify');
    lines.push(`\`${asset.verifyCommand}\``);
    lines.push('');
  }

  return `${lines.join('\n').trim()}\n`;
}

export async function makePostHunyuanRefinePlan({
  planPath,
  outDir,
  hunyuanResponsePath,
  hunyuanRequestPath,
  assetBriefPath,
  evidencePath,
  projectDir
} = {}) {
  if (!outDir) {
    throw new BetterRef3DError('Missing required --out for post-Hunyuan refine plan.');
  }

  const plan = await readJson(planPath, '3D asset plan');
  const hunyuanResponse = await readJson(hunyuanResponsePath, 'Hunyuan response metadata');
  const assetBrief = assetBriefPath ? await readJson(assetBriefPath, 'BetterRef Asset Brief') : null;
  const evidence = evidencePath ? await readJson(evidencePath, '3D evidence') : null;
  const refinePlanPath = path.join(outDir, '3d-refine-plan.json');
  const checklistPath = path.join(outDir, '3d-refine-checklist.md');
  const evidenceDefaultPath = evidencePath || path.join(outDir, '3d-evidence.json');
  const assets = asArray(plan.assets).map((asset) => {
    const source = responseMetadataForAsset(hunyuanResponse, asset) || {
      provider: 'unknown',
      status: null,
      jobId: null,
      requestId: null,
      resultFiles: []
    };
    const platform = targetPlatformForAsset(asset, assetBrief);
    const targetUse = targetUseForAsset(asset, assetBrief) || null;
    const triangleBudget = triangleBudgetForAsset(asset, assetBrief);
    const verifyArgs = [
      'betterref-3d --verify',
      `--plan ${planPath}`,
      `--evidence ${evidenceDefaultPath}`,
      hunyuanRequestPath ? `--hunyuan-request ${hunyuanRequestPath}` : null,
      `--hunyuan-response ${hunyuanResponsePath}`,
      `--out ${outDir}`,
      projectDir ? `--project ${projectDir}` : null,
      '--json'
    ].filter(Boolean);

    return {
      id: asset.id,
      targetPath: asset.targetPath || null,
      targetFormat: asset.targetFormat || asset.outputFormat || 'glb',
      targetPlatform: platform,
      targetUse,
      source,
      triangleBudget,
      textureReferences: textureReferencesForAsset(assetBrief, asset),
      currentEvidence: evidence ? evidenceForAsset(asset, evidence) : null,
      actions: refineActionsForAsset(asset, assetBrief),
      requiredEvidence: requiredRefineEvidence(asset, assetBrief),
      verifyCommand: verifyArgs.join(' ')
    };
  });

  const refinePlan = {
    schemaVersion: 'betterref.3d.refine.plan.v1',
    generatedAt: new Date().toISOString(),
    planPath: path.resolve(planPath),
    hunyuanRequestPath: hunyuanRequestPath ? path.resolve(hunyuanRequestPath) : null,
    hunyuanResponsePath: path.resolve(hunyuanResponsePath),
    assetBriefPath: assetBriefPath ? path.resolve(assetBriefPath) : null,
    projectDir: projectDir ? path.resolve(projectDir) : null,
    principle: 'Raw Hunyuan output is source material; final pass requires refinement, texture, runtime, and verification evidence.',
    assets
  };
  await writeJson(refinePlanPath, refinePlan);
  await writeText(checklistPath, renderRefineChecklist(refinePlan));

  return {
    schemaVersion: 'betterref.3d.refine.result.v1',
    generatedAt: new Date().toISOString(),
    artifacts: { refinePlanPath, checklistPath },
    refinePlan
  };
}

export async function verify3D({
  planPath,
  evidencePath,
  outDir,
  projectDir,
  hunyuanRequestPath,
  hunyuanResponsePath
} = {}) {
  if (!outDir) {
    throw new BetterRef3DError('Missing required --out for 3D verification.');
  }

  const plan = await readJson(planPath, '3D asset plan');
  const evidence = evidencePath ? await readJson(evidencePath, '3D evidence') : {};
  const hunyuanRequest = hunyuanRequestPath ? await readJson(hunyuanRequestPath, 'Hunyuan request metadata') : null;
  const hunyuanResponse = hunyuanResponsePath ? await readJson(hunyuanResponsePath, 'Hunyuan response metadata') : null;
  const blockingReasons = [];
  const assets = asArray(plan.assets);
  const checkedAssets = [];

  for (const asset of assets) {
    const item = evidenceForAsset(asset, evidence);
    const combinedStatus = effectiveStatus(asset.status, item.status);
    const modelPath = item.modelPath || item.generatedPath || item.outputPath || asset.generatedPath;
    const resolvedModelPath = resolveProjectPath(modelPath, projectDir);
    const modelExists = resolvedModelPath ? await nonEmptyFile(resolvedModelPath) : false;
    const targetModelPath = resolveProjectPath(asset.targetPath, projectDir);
    const targetPathExists = targetModelPath ? await nonEmptyFile(targetModelPath) : false;
    const renderEvidencePresent = await hasRenderEvidence(item, projectDir);
    const materialEvidenceRequired = requiresMaterialEvidence(asset);
    const materialEvidencePresent = hasMaterialEvidence(item);
    const hunyuanMetadataRequired = isHunyuanAsset(asset);
    const refinementEvidenceRequired = requiresPostHunyuanRefinement(asset);
    const postHunyuanRefinementPresent = hasPostHunyuanRefinementEvidence(item);
    const robloxImportEvidenceRequired = isRobloxTarget(asset);
    const robloxImportEvidencePresent = await hasRobloxImportEvidence(item, projectDir);
    const triangleBudget = triangleBudgetVerdict(asset, item);
    const requestMetadataSources = [
      hunyuanRequest,
      evidence.hunyuanRequest,
      evidence.requestMetadata,
      evidence.providerRequest,
      item.hunyuanRequest,
      item.requestMetadata,
      item.providerRequest
    ];
    const responseMetadataSources = [
      hunyuanResponse,
      evidence.hunyuanResponse,
      evidence.responseMetadata,
      evidence.providerResponse,
      item.hunyuanResponse,
      item.responseMetadata,
      item.providerResponse
    ];
    const requestMetadataPresent = !hunyuanMetadataRequired ||
      requestMetadataSources.some((source) => hasRequestMetadata(source, asset));
    const responseMetadataPresent = !hunyuanMetadataRequired ||
      responseMetadataSources.some((source) => hasResponseMetadata(source, asset));
    const assetFailures = [];

    if (statusValue(item.status) && !isPassStatus(item.status)) {
      assetFailures.push(
        failure(
          'evidence_status_incomplete',
          { ...asset, evidenceStatus: item.status },
          `3D asset ${asset.id} evidence status ${item.status} is not complete.`
        )
      );
    }
    if (isPendingStatus(combinedStatus)) {
      assetFailures.push(failure('asset_pending', asset, `3D asset ${asset.id} is not marked complete.`));
    }
    if (isPassStatus(combinedStatus) && !modelExists) {
      assetFailures.push(failure('missing_model_file', asset, `3D asset ${asset.id} is passing but has no non-empty model file.`));
    }
    if (!isPassStatus(combinedStatus) && !modelExists) {
      assetFailures.push(failure('missing_model_file', asset, `3D asset ${asset.id} has no non-empty model file.`));
    }
    if (asset.targetPath && !targetPathExists) {
      assetFailures.push(failure('missing_target_model_file', asset, `3D asset ${asset.id} has no non-empty model file at ${asset.targetPath}.`));
    }
    if (!hasMeshStats(item)) {
      assetFailures.push(failure('missing_mesh_stats', asset, `3D asset ${asset.id} is missing non-empty mesh stats.`));
    }
    if (!renderEvidencePresent) {
      assetFailures.push(failure('missing_render_evidence', asset, `3D asset ${asset.id} is missing render or turntable evidence.`));
    }
    if (materialEvidenceRequired && !materialEvidencePresent) {
      assetFailures.push(failure('missing_material_evidence', asset, `3D asset ${asset.id} is missing material or texture evidence.`));
    }
    if (refinementEvidenceRequired && !postHunyuanRefinementPresent) {
      assetFailures.push(failure('missing_post_hunyuan_refinement', asset, `3D asset ${asset.id} is missing post-Hunyuan refinement evidence.`));
    }
    if (triangleBudget && triangleBudget.measuredTriangles !== null && !triangleBudget.passed) {
      assetFailures.push(
        failure(
          'roblox_triangle_budget_exceeded',
          asset,
          `3D asset ${asset.id} has ${triangleBudget.measuredTriangles} triangles, above Roblox budget ${triangleBudget.maxTriangles}.`
        )
      );
    }
    if (robloxImportEvidenceRequired && !robloxImportEvidencePresent) {
      assetFailures.push(failure('missing_roblox_import_evidence', asset, `3D asset ${asset.id} is missing Roblox import evidence.`));
    }
    if (!requestMetadataPresent) {
      assetFailures.push(failure('missing_hunyuan_request_metadata', asset, `3D asset ${asset.id} is missing Hunyuan request metadata.`));
    }
    if (!responseMetadataPresent) {
      assetFailures.push(failure('missing_hunyuan_response_metadata', asset, `3D asset ${asset.id} is missing Hunyuan response metadata.`));
    }

    blockingReasons.push(
      ...assetFailures.map((item) =>
        item.code === 'evidence_status_incomplete' ? item.message : blockingReason(item.code, asset)
      )
    );

    checkedAssets.push({
      id: asset.id,
      status: combinedStatus || 'missing',
      provider: asset.provider || null,
      targetFormat: asset.targetFormat || null,
      targetPath: asset.targetPath || null,
      passed: assetFailures.length === 0,
      modelPath: resolvedModelPath,
      modelExists,
      targetModelPath,
      targetPathExists,
      meshStatsPresent: hasMeshStats(item),
      renderEvidencePresent,
      materialEvidenceRequired,
      materialEvidencePresent,
      hunyuanMetadataRequired,
      requestMetadataPresent,
      responseMetadataPresent,
      refinementEvidenceRequired,
      postHunyuanRefinementPresent,
      robloxImportEvidenceRequired,
      robloxImportEvidencePresent,
      triangleBudget,
      failures: assetFailures
    });
  }

  const passed = blockingReasons.length === 0;
  const verdict = {
    schemaVersion: 'betterref.3d.verdict.v1',
    generatedAt: new Date().toISOString(),
    passed,
    verdict: passed ? 'pass' : 'fail',
    hardFailPresent: !passed,
    assets: checkedAssets,
    blockingReasons,
    inputs: {
      planPath: path.resolve(planPath),
      evidencePath: evidencePath ? path.resolve(evidencePath) : null,
      hunyuanRequestPath: hunyuanRequestPath ? path.resolve(hunyuanRequestPath) : null,
      hunyuanResponsePath: hunyuanResponsePath ? path.resolve(hunyuanResponsePath) : null,
      projectDir: projectDir ? path.resolve(projectDir) : null
    }
  };
  const verdictPath = path.join(outDir, '3d-verdict.json');
  const result = {
    ...verdict,
    artifacts: { verdictPath }
  };
  await writeJson(verdictPath, result);

  return result;
}
