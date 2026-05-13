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
  return `${asset.id} failed 3D verification.`;
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
