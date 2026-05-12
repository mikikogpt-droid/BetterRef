import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export class BetterRefVerifyInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BetterRefVerifyInputError';
  }
}

async function readJson(filePath, label) {
  if (!filePath) {
    return null;
  }

  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new BetterRefVerifyInputError(`Could not read ${label} ${filePath}: ${error.message}`);
  }
}

function asArray(value) {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function isPassStatus(value) {
  return ['pass', 'passed', 'done', 'complete', 'completed', 'ok'].includes(normalizeStatus(value));
}

function numericValue(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) {
      return number;
    }
  }
  return undefined;
}

async function measureSharpness(filePath) {
  const { data, info } = await sharp(filePath).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  const width = Number(info.width || 0);
  const height = Number(info.height || 0);
  if (width < 3 || height < 3) {
    return 0;
  }

  let sum = 0;
  let sumSquares = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      const laplacian =
        -4 * data[index] +
        data[index - 1] +
        data[index + 1] +
        data[index - width] +
        data[index + width];
      sum += laplacian;
      sumSquares += laplacian * laplacian;
      count += 1;
    }
  }

  if (count === 0) {
    return 0;
  }
  const mean = sum / count;
  return sumSquares / count - mean * mean;
}

function parseRequiredEvidence(value) {
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
  const required = [];
  for (const item of asArray(value)) {
    for (const part of String(item || '').split(',')) {
      const key = normalizeStatus(part);
      if (!key) {
        continue;
      }
      const mapped = aliases.get(key);
      if (!mapped) {
        throw new BetterRefVerifyInputError(`Unsupported required evidence: ${part}`);
      }
      for (const evidence of mapped) {
        if (!required.includes(evidence)) {
          required.push(evidence);
        }
      }
    }
  }
  return required;
}

function visualVerdict(report) {
  const verdict = report?.verdict || {};
  const score = Number(verdict.score ?? report?.score ?? report?.global?.score ?? 0);
  const passed = report?.passed !== false && (verdict.verdict ? verdict.verdict === 'pass' : true);
  const hardFailPresent = Boolean(
    report?.hardFailPresent ||
      report?.hard_fail_present ||
      verdict.hardFailPresent ||
      verdict.hard_fail_present ||
      asArray(verdict.hardFailHints).length > 0 ||
      asArray(report?.hardFails).length > 0
  );

  return {
    passed,
    verdict: verdict.verdict || (passed ? 'pass' : 'revise'),
    score: Number.isFinite(score) ? score : 0,
    hardFailPresent
  };
}

function guardVerdict(report) {
  if (!report) {
    return {
      present: false,
      passed: true,
      hardFailPresent: false,
      hardFails: []
    };
  }

  const hardFails = asArray(report.hardFails);
  return {
    present: true,
    passed: report.passed !== false && !report.hardFailPresent && hardFails.length === 0,
    hardFailPresent: Boolean(report.hardFailPresent || hardFails.length > 0),
    hardFails
  };
}

function longPageVerdict(report) {
  if (!report) {
    return {
      present: false,
      passed: true,
      hardFailPresent: false,
      failedSections: []
    };
  }

  const sections = asArray(report.sections);
  const failedSections = sections.filter((section) => section.passed === false);
  const fullPage = report.fullPageStructure || report.fullPage;
  const fullPagePassed = fullPage ? fullPage.passed !== false : true;
  return {
    present: true,
    passed: report.passed !== false && fullPagePassed && failedSections.length === 0,
    hardFailPresent: Boolean(report.hardFailPresent || report.hard_fail_present || !fullPagePassed || failedSections.length > 0),
    fullPagePassed,
    score: Number(report.verdict?.score ?? report.summary?.score ?? fullPage?.score ?? report.score ?? 0),
    failedSections
  };
}

function prdCompliance(checklist) {
  if (!checklist) {
    return {
      present: false,
      total: 0,
      passed: 0,
      missing: [],
      score: 100
    };
  }

  const items = asArray(checklist.items || checklist.requirements || checklist.checklist);
  const missing = [];
  let passed = 0;

  for (const item of items) {
    if (isPassStatus(item.status || item.state || item.result)) {
      passed += 1;
      continue;
    }
    missing.push({
      id: item.id || item.name || item.requirement || `item-${missing.length + 1}`,
      status: item.status || item.state || item.result || 'missing',
      requirement: item.requirement || item.description || item.name || ''
    });
  }

  return {
    present: true,
    total: items.length,
    passed,
    missing,
    score: items.length === 0 ? 100 : Math.round((passed / items.length) * 100)
  };
}

function assetId(asset, index) {
  return asset.id || `asset-${String(index + 1).padStart(3, '0')}`;
}

function assetRequirement(asset) {
  return asset.requirement || asset.role || asset.targetPath || '';
}

function assetEvidencePath(asset) {
  return asset.generatedPath || asset.projectPath || asset.localPath || asset.path || asset.file;
}

function isHyperframesAsset(asset) {
  return (
    String(asset.tool || '').toLowerCase() === 'hyperframes' ||
    String(asset.implementation || '').toLowerCase().includes('hyperframes') ||
    asset.hyperframesRequired === true
  );
}

function isThreeDModelAsset(asset) {
  const tool = String(asset.tool || '').toLowerCase();
  const implementation = String(asset.implementation || '').toLowerCase();
  const provider = String(asset.provider || asset.modelProvider || '').toLowerCase();
  const role = String(asset.role || '').toLowerCase();
  const targetFormat = String(asset.targetFormat || asset.outputFormat || '').toLowerCase();
  const targetPath = String(asset.targetPath || asset.path || asset.file || '').toLowerCase();
  return (
    ['hunyuan3d', 'hunyuan-3d', 'three-d', '3d'].includes(tool) ||
    /\bhunyuan(?:-?3d)?\b/.test(implementation) ||
    /\b(?:hunyuan|huggingface|hugging face).*\b3d\b|\b3d\b.*\b(?:hunyuan|huggingface|hugging face)\b/.test(provider) ||
    role === 'hunyuan-3d-model' ||
    ['glb', 'gltf', 'obj', 'usdz'].includes(targetFormat) ||
    /\.(?:glb|gltf|obj|usdz)(?:$|[?#])/.test(targetPath)
  );
}

function normalizeProjectPathValue(value, projectDir) {
  if (!value) return '';
  const raw = String(value).replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  if (!projectDir) return raw;
  const resolved = path.isAbsolute(String(value)) ? path.resolve(String(value)) : path.resolve(projectDir, String(value));
  const relative = path.relative(projectDir, resolved).replace(/\\/g, '/').toLowerCase();
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    return relative;
  }
  return raw;
}

function sameThreeDTarget(left, right, projectDir) {
  const a = normalizeProjectPathValue(left, projectDir);
  const b = normalizeProjectPathValue(right, projectDir);
  return Boolean(a && b && (a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`)));
}

function threeDRequirements(plan) {
  return asArray(plan?.assets).filter(isThreeDModelAsset);
}

function assetPlanRequiresThreeD(plan) {
  return Boolean(plan?.threeDRequired) || threeDRequirements(plan).length > 0;
}

function matchingThreeDAsset(assets, required, projectDir) {
  return assets.find((asset) => {
    if (asset.id && required.id && asset.id === required.id) return true;
    return sameThreeDTarget(asset.targetPath || asset.modelPath, required.targetPath, projectDir);
  });
}

async function verdictModelFileExists(asset, projectDir) {
  const resolvedPath = resolveEvidencePath(asset.modelPath, projectDir);
  if (!resolvedPath) {
    return false;
  }
  try {
    const fileStat = await stat(resolvedPath);
    return fileStat.isFile() && fileStat.size > 0;
  } catch {
    return false;
  }
}

async function projectTargetFileExists(targetPath, projectDir) {
  if (!targetPath || !projectDir) {
    return false;
  }
  try {
    const fileStat = await stat(path.resolve(projectDir, targetPath));
    return fileStat.isFile() && fileStat.size > 0;
  } catch {
    return false;
  }
}

function threeDAssetNeedsHunyuanMetadata(asset, required) {
  const source = required || asset || {};
  return asset?.hunyuanMetadataRequired === true ||
    String(source.provider || '').toLowerCase() === 'hunyuan' ||
    String(source.tool || '').toLowerCase().includes('hunyuan') ||
    String(source.implementation || '').toLowerCase().includes('hunyuan');
}

async function validateThreeDAssetProof(asset, { required, projectDir } = {}) {
  const id = asset?.id || required?.id || 'unknown';
  const reasons = [];
  if (!asset || typeof asset !== 'object') {
    return [`3D verdict does not cover PRD model ${id}`];
  }
  if (required?.targetPath && !sameThreeDTarget(asset.targetPath, required.targetPath, projectDir)) {
    reasons.push(`3D verdict does not cover PRD model ${id} at ${required.targetPath}`);
  }
  if (required?.targetPath) {
    const targetFileExists = projectDir
      ? await projectTargetFileExists(required.targetPath, projectDir)
      : asset.targetPathExists === true;
    if (!targetFileExists) {
      reasons.push(`3D asset ${id} target path file evidence is missing or empty`);
    }
  }
  if (asset.passed !== true) {
    reasons.push(`3D asset ${id} is not marked passed`);
  }
  if (!isPassStatus(asset.status)) {
    reasons.push(`3D asset ${id} is missing completed status evidence`);
  }
  if (!asset.modelPath || asset.modelExists !== true) {
    reasons.push(`3D asset ${id} is missing model file evidence`);
  } else if (!(await verdictModelFileExists(asset, projectDir))) {
    reasons.push(`3D asset ${id} model file evidence is missing or empty`);
  }
  if (asset.targetPathExists === false) {
    reasons.push(`3D asset ${id} target path file evidence is missing or empty`);
  }
  if (asset.meshStatsPresent !== true) {
    reasons.push(`3D asset ${id} is missing mesh stats evidence`);
  }
  if (asset.renderEvidencePresent !== true) {
    reasons.push(`3D asset ${id} is missing render or turntable evidence`);
  }
  if (asset.materialEvidenceRequired === true && asset.materialEvidencePresent !== true) {
    reasons.push(`3D asset ${id} is missing material/texture evidence`);
  }
  if (threeDAssetNeedsHunyuanMetadata(asset, required) && asset.requestMetadataPresent !== true) {
    reasons.push(`3D asset ${id} is missing Hunyuan request metadata`);
  }
  if (threeDAssetNeedsHunyuanMetadata(asset, required) && asset.responseMetadataPresent !== true) {
    reasons.push(`3D asset ${id} is missing Hunyuan response metadata`);
  }
  for (const failure of asArray(asset.failures)) {
    if (failure?.message) {
      reasons.push(failure.message);
    }
  }
  return reasons;
}

function normalizeBrowserPath(value) {
  if (!value) {
    return undefined;
  }
  let result = String(value).replace(/\\/g, '/').replace(/^\/+/, '');
  if (result.startsWith('public/')) {
    result = result.slice('public/'.length);
  }
  return result || undefined;
}

function extractAssetPathVariants(asset) {
  const variants = new Set();
  for (const value of [
    asset.generatedPath,
    asset.projectPath,
    asset.targetPath,
    asset.localPath,
    asset.path,
    asset.file,
    asset.src,
    asset.url
  ]) {
    const normalized = normalizeBrowserPath(value);
    if (normalized) {
      variants.add(normalized);
    }
  }
  return variants;
}

function extractCssUrls(value) {
  const urls = [];
  const pattern = /url\((['"]?)(.*?)\1\)/gi;
  let match;
  while ((match = pattern.exec(String(value || '')))) {
    if (match[2]) {
      urls.push(match[2]);
    }
  }
  return urls;
}

function renderedSourceValues(asset) {
  const values = [];
  for (const key of ['src', 'currentSrc', 'url', 'href', 'backgroundImage', 'cssBackgroundImage']) {
    if (asset?.[key]) {
      values.push(asset[key]);
      values.push(...extractCssUrls(asset[key]));
    }
  }
  return values;
}

function renderedBrowserPaths(browserEvidence) {
  const paths = new Set();
  const renderedAssets = [
    ...asArray(browserEvidence?.images),
    ...asArray(browserEvidence?.videos),
    ...asArray(browserEvidence?.media?.rendered),
    ...asArray(browserEvidence?.assets?.rendered),
    ...asArray(browserEvidence?.backgroundImages)
  ];

  for (const asset of renderedAssets) {
    for (const value of renderedSourceValues(asset)) {
      if (/^(data|blob|about):/i.test(String(value))) {
        continue;
      }

      try {
        const parsed = new URL(value, 'http://localhost');
        const directPath = normalizeBrowserPath(decodeURIComponent(parsed.pathname || ''));
        if (directPath) {
          paths.add(directPath);
        }

        const optimizedUrl = parsed.searchParams.get('url');
        const optimizedPath = normalizeBrowserPath(optimizedUrl ? decodeURIComponent(optimizedUrl) : '');
        if (optimizedPath) {
          paths.add(optimizedPath);
        }
      } catch {
        const normalized = normalizeBrowserPath(value);
        if (normalized) {
          paths.add(normalized);
        }
      }
    }
  }

  return paths;
}

function assetRenderedInBrowser(asset, browserEvidence) {
  if (!browserEvidence || Object.keys(browserEvidence).length === 0) {
    return true;
  }
  if (asset.renderRequired === false || asset.requiresRenderedEvidence === false) {
    return true;
  }

  const expectedPaths = extractAssetPathVariants(asset);
  if (expectedPaths.size === 0) {
    return true;
  }

  const actualPaths = renderedBrowserPaths(browserEvidence);
  for (const expected of expectedPaths) {
    for (const actual of actualPaths) {
      if (actual === expected || actual.endsWith(`/${expected}`) || expected.endsWith(`/${actual}`)) {
        return true;
      }
    }
  }

  return false;
}

function resolveEvidencePath(assetPath, projectDir) {
  if (!assetPath) {
    return undefined;
  }
  if (path.isAbsolute(assetPath)) {
    return assetPath;
  }
  if (!projectDir) {
    return undefined;
  }
  return path.resolve(projectDir, assetPath);
}

function hyperframesCommandPassed(command) {
  return command?.passed === true || command?.status === 'pass' || command?.exitCode === 0;
}

function validateHyperframesEvidence(asset, addInvalid) {
  const evidence = asset.hyperframesEvidence || asset.motionEvidence;
  if (!evidence || typeof evidence !== 'object') {
    addInvalid('hyperframes_pass_missing_cli_evidence', 'lacks HyperFrames CLI evidence');
    return;
  }
  const commands = evidence.commands || {};
  for (const name of ['lint', 'validate', 'inspect', 'render']) {
    if (!hyperframesCommandPassed(commands[name])) {
      addInvalid('hyperframes_pass_failed_cli_evidence', `has missing or failed HyperFrames ${name} evidence`);
    }
  }
}

async function validatePassedAsset(asset, index, options) {
  const id = assetId(asset, index);
  const invalid = [];
  const addInvalid = (code, message) => {
    invalid.push({
      id,
      status: asset.status || asset.state || asset.result || 'pass',
      code,
      message,
      requirement: assetRequirement(asset)
    });
  };

  const evidencePath = assetEvidencePath(asset);
  const hyperframes = isHyperframesAsset(asset);
  if (!evidencePath) {
    addInvalid('asset_pass_missing_evidence', 'lacks generated/source asset evidence');
  }
  if (!asset.verifiedAt || !asset.verification) {
    addInvalid('asset_pass_missing_verification', 'lacks verification metadata from betterref-imagegen attach or an equivalent production-asset check');
  }

  const nativeWidth = numericValue(asset.nativeWidth, asset.width);
  const nativeHeight = numericValue(asset.nativeHeight, asset.height);
  const minNativeWidth = numericValue(asset.minNativeWidth);
  const minNativeHeight = numericValue(asset.minNativeHeight);
  const minSharpness = numericValue(asset.minSharpness);
  const measuredSharpness = numericValue(asset.measuredSharpness);

  if (hyperframes) {
    validateHyperframesEvidence(asset, addInvalid);
  }

  if (!hyperframes && (!nativeWidth || !nativeHeight)) {
    addInvalid('asset_pass_missing_native_dimensions', 'lacks verified native dimensions');
  }
  if (!hyperframes && minNativeWidth !== undefined && (!nativeWidth || nativeWidth < minNativeWidth)) {
    addInvalid('asset_pass_width_below_minimum', `native width ${nativeWidth || 0} is below ${minNativeWidth}`);
  }
  if (!hyperframes && minNativeHeight !== undefined && (!nativeHeight || nativeHeight < minNativeHeight)) {
    addInvalid('asset_pass_height_below_minimum', `native height ${nativeHeight || 0} is below ${minNativeHeight}`);
  }
  if (!hyperframes && minSharpness !== undefined && (measuredSharpness === undefined || measuredSharpness < minSharpness)) {
    addInvalid('asset_pass_sharpness_below_minimum', `measured sharpness ${measuredSharpness ?? 'missing'} is below ${minSharpness}`);
  }

  const resolvedPath = resolveEvidencePath(evidencePath, options.projectDir);
  if (options.projectDir && !resolvedPath) {
    addInvalid('asset_pass_unresolvable_path', 'has no project-resolvable generated/source asset path');
  }
  if (resolvedPath) {
    try {
      if (hyperframes) {
        const fileStat = await stat(resolvedPath);
        if (!fileStat.isFile() || fileStat.size <= 0) {
          addInvalid('hyperframes_file_empty', 'rendered HyperFrames asset file is empty or not a file');
        }
      } else {
        const metadata = await sharp(resolvedPath).metadata();
        if (nativeWidth && Number(metadata.width || 0) !== nativeWidth) {
          addInvalid('asset_file_width_mismatch', `claimed native width ${nativeWidth} does not match file width ${metadata.width || 0}`);
        }
        if (nativeHeight && Number(metadata.height || 0) !== nativeHeight) {
          addInvalid('asset_file_height_mismatch', `claimed native height ${nativeHeight} does not match file height ${metadata.height || 0}`);
        }
        if (minNativeWidth !== undefined && Number(metadata.width || 0) < minNativeWidth) {
          addInvalid('asset_file_width_below_minimum', `file width ${metadata.width || 0} is below ${minNativeWidth}`);
        }
        if (minNativeHeight !== undefined && Number(metadata.height || 0) < minNativeHeight) {
          addInvalid('asset_file_height_below_minimum', `file height ${metadata.height || 0} is below ${minNativeHeight}`);
        }
        if (minSharpness !== undefined) {
          const actualSharpness = Number((await measureSharpness(resolvedPath)).toFixed(2));
          if (actualSharpness < minSharpness) {
            addInvalid('asset_file_sharpness_below_minimum', `actual file sharpness ${actualSharpness} is below ${minSharpness}`);
          }
        }
      }
    } catch (error) {
      addInvalid('asset_pass_file_unreadable', `generated/source asset file is unreadable: ${error.message}`);
    }
  }

  if (!assetRenderedInBrowser(asset, options.browserEvidence)) {
    addInvalid('asset_pass_not_rendered', 'is not rendered in browser evidence');
  }

  return invalid;
}

async function assetPlanVerdict(plan, options = {}) {
  if (!plan) {
    return {
      present: false,
      passed: true,
      hardFailPresent: false,
      imagegenRequired: false,
      total: 0,
      passedCount: 0,
      pending: [],
      invalid: []
    };
  }

  const assets = asArray(plan.assets);
  const genericAssetEntries = assets
    .map((asset, index) => ({ asset, index }))
    .filter(({ asset }) => !isThreeDModelAsset(asset));
  const genericAssets = genericAssetEntries.map(({ asset }) => asset);
  const pending = genericAssetEntries
    .filter(({ asset }) => !isPassStatus(asset.status || asset.state || asset.result))
    .map(({ asset, index }) => ({
      id: assetId(asset, index),
      status: asset.status || asset.state || asset.result || 'pending',
      requirement: assetRequirement(asset)
    }));
  const invalid = [];
  for (const { asset, index } of genericAssetEntries) {
    if (isPassStatus(asset.status || asset.state || asset.result)) {
      invalid.push(...(await validatePassedAsset(asset, index, options)));
    }
  }
  const invalidIds = new Set(invalid.map((item) => item.id));
  const hyperframesRequired = Boolean(genericAssets.some(isHyperframesAsset) || (plan.hyperframesRequired && (assets.length === 0 || genericAssets.length > 0)));
  const imagegenRequired = Boolean(genericAssets.some((asset) => !isHyperframesAsset(asset)) || (plan.imagegenRequired && (assets.length === 0 || genericAssets.length > 0)));
  const assetPlanRequired = imagegenRequired || hyperframesRequired || genericAssets.length > 0;
  const emptyRequiredPlan = assetPlanRequired && genericAssets.length === 0;
  const passedCount = genericAssetEntries.filter(({ asset, index }) => {
    const status = asset.status || asset.state || asset.result;
    return isPassStatus(status) && !invalidIds.has(assetId(asset, index));
  }).length;

  return {
    present: true,
    passed: pending.length === 0 && invalid.length === 0 && !emptyRequiredPlan,
    hardFailPresent: pending.length > 0 || invalid.length > 0 || emptyRequiredPlan,
    imagegenRequired,
    hyperframesRequired,
    total: genericAssets.length,
    passedCount,
    pending,
    invalid,
    emptyRequiredPlan
  };
}

function requiredEvidenceVerdict(required, parts) {
  const missing = [];
  if (required.includes('guard') && !parts.guard.present) {
    missing.push('guard');
  }
  if (required.includes('prd') && !parts.prd.present) {
    missing.push('prd');
  }
  if (required.includes('longpage') && !parts.longPage.present) {
    missing.push('longpage');
  }
  if (required.includes('assetplan') && !parts.assetPlan.present) {
    missing.push('assetplan');
  }
  if (required.includes('browser') && !parts.browserEvidence.present) {
    missing.push('browser');
  }
  if (required.includes('3d') && !parts.threeD.present) {
    missing.push('3d');
  }
  return {
    required,
    missing,
    passed: missing.length === 0
  };
}

function requiredEvidenceLabel(item) {
  if (item === 'prd') {
    return 'PRD';
  }
  if (item === 'longpage') {
    return 'long-page';
  }
  if (item === 'assetplan') {
    return 'asset-plan';
  }
  if (item === 'browser') {
    return 'browser';
  }
  if (item === '3d') {
    return '3D';
  }
  return item;
}

function browserEvidenceVerdict(report) {
  if (!report) {
    return {
      present: false,
      passed: true,
      hardFailPresent: false,
      invalid: []
    };
  }

  const invalid = [];
  const addInvalid = (code, message) => invalid.push({ code, message });
  const sourceTool = normalizeStatus(report.source?.tool || report.tool || report.generatedBy);
  const isChromeSourced = /chrome/.test(sourceTool) || sourceTool === '@chrome';
  const screenshotEvidence = [
    report.screenshotPath,
    report.viewportScreenshotPath,
    report.screenshots?.viewport,
    report.currentScreenshotPath,
    report.actualPath
  ].filter(Boolean);
  if (isChromeSourced && screenshotEvidence.length === 0) {
    addInvalid('browser_evidence_screenshot_missing', 'screenshot evidence is missing; metadata-only browser evidence is not allowed');
  }

  const viewportWidth = Number(report.viewport?.width);
  const viewportHeight = Number(report.viewport?.height);
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0 || !Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    addInvalid('browser_evidence_viewport_invalid', 'viewport is missing or invalid');
  }

  const scrollHeight = Number(report.page?.scrollHeight);
  if (!Number.isFinite(scrollHeight) || scrollHeight <= 0) {
    addInvalid('browser_evidence_scroll_height_invalid', 'scroll height is missing or zero');
  }

  const bodyTextLength = Number(report.page?.bodyTextLength);
  if (!Number.isFinite(bodyTextLength) || bodyTextLength <= 0) {
    addInvalid('browser_evidence_dom_text_missing', 'DOM text length is missing or zero');
  }

  const interactiveCount = Number(report.page?.interactiveCount);
  if (!Number.isFinite(interactiveCount) || interactiveCount < 0) {
    addInvalid('browser_evidence_interactive_count_missing', 'interactive count is missing or invalid');
  }

  if (!report.fonts || (!('ready' in report.fonts) && !report.fonts.status)) {
    addInvalid('browser_evidence_font_status_missing', 'font readiness evidence is missing');
  } else if (report.fonts.ready === false) {
    addInvalid('browser_evidence_fonts_not_ready', 'fonts are not ready');
  }

  if (!Array.isArray(report.console)) {
    addInvalid('browser_evidence_console_missing', 'console evidence is missing');
  } else {
    for (const item of report.console) {
      const level = normalizeStatus(item?.type || item?.level || item?.severity);
      if (level === 'error') {
        addInvalid('browser_evidence_console_error', 'console contains error evidence');
        break;
      }
    }
  }

  if (!Array.isArray(report.images)) {
    addInvalid('browser_evidence_image_scale_missing', 'image scale evidence is missing');
  }

  const networkErrors = [
    ...asArray(report.network?.errors),
    ...asArray(report.networkErrors)
  ];
  if (networkErrors.length > 0) {
    const sample = networkErrors[0] || {};
    const target = sample.url ? ` for ${sample.url}` : '';
    const status = sample.status ? ` status ${sample.status}` : '';
    addInvalid('browser_evidence_network_error', `network contains failed request${target}${status}`);
  }

  return {
    present: true,
    passed: invalid.length === 0,
    hardFailPresent: invalid.length > 0,
    invalid
  };
}

async function threeDVerdict(report, options = {}) {
  if (!options.supplied && !report) {
    return {
      present: false,
      passed: true,
      hardFailPresent: false,
      blockingReasons: []
    };
  }

  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    return {
      present: true,
      passed: false,
      verdict: 'fail',
      hardFailPresent: true,
      blockingReasons: ['3D verdict is missing required pass fields'],
      assets: []
    };
  }

  const blockingReasons = [...asArray(report.blockingReasons)];
  const hasRequiredPassFields = Object.hasOwn(report, 'passed') && Object.hasOwn(report, 'verdict');
  const hasValidPassFields = typeof report.passed === 'boolean' && typeof report.verdict === 'string';
  if (!hasRequiredPassFields || !hasValidPassFields) {
    blockingReasons.push('3D verdict is missing required pass fields');
  }
  if (report.schemaVersion !== 'betterref.3d.verdict.v1') {
    blockingReasons.push('3D verdict schemaVersion is not betterref.3d.verdict.v1');
  }

  const assets = asArray(report.assets);
  if (report.passed === true && assets.length === 0) {
    blockingReasons.push('3D verdict has no verified model assets');
  }

  const requiredModels = threeDRequirements(options.assetPlan);
  const validatedAssets = new Set();
  for (const required of requiredModels) {
    const asset = matchingThreeDAsset(assets, required, options.projectDir);
    if (!asset) {
      blockingReasons.push(`3D verdict does not cover PRD model ${required.id || 'unknown'} at ${required.targetPath || 'unknown target'}`);
      continue;
    }
    validatedAssets.add(asset);
    blockingReasons.push(...(await validateThreeDAssetProof(asset, { required, projectDir: options.projectDir })));
  }
  for (const asset of assets) {
    if (!validatedAssets.has(asset)) {
      blockingReasons.push(...(await validateThreeDAssetProof(asset, { projectDir: options.projectDir })));
    }
  }

  const passed =
    report.passed === true &&
    report.verdict === 'pass' &&
    !report.hardFailPresent &&
    !report.hard_fail_present &&
    blockingReasons.length === 0;

  return {
    present: true,
    passed,
    verdict: report.verdict || (passed ? 'pass' : 'fail'),
    hardFailPresent: !passed,
    blockingReasons,
    assets
  };
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return char;
    }
  });
}

function renderList(items) {
  if (items.length === 0) {
    return '<li>None</li>';
  }
  return items.map((item) => `<li>${escapeHtml(item)}</li>`).join('\n');
}

function renderHardFails(report) {
  const hardFails = report.guard.hardFails.map((hardFail) => {
    const code = hardFail.code || hardFail.type || hardFail.id || 'unknown';
    const message = hardFail.message || hardFail.reason || '';
    return `${code}${message ? `: ${message}` : ''}`;
  });
  return renderList(hardFails);
}

function renderMissingPrd(report) {
  const missing = report.prdCompliance.missing.map((item) => {
    const detail = item.requirement ? ` - ${item.requirement}` : '';
    return `${item.id} (${item.status})${detail}`;
  });
  return renderList(missing);
}

function renderFailedSections(report) {
  const sections = report.longPage.failedSections.map((section) => {
    const name = section.name || section.id || 'unknown';
    const score = Number.isFinite(Number(section.score)) ? ` score ${section.score}` : '';
    return `long-page section ${name} did not pass${score}`;
  });
  return renderList(sections);
}

function renderPendingAssets(report) {
  const pending = report.assetPlan.pending.map((asset) => {
    const requirement = asset.requirement ? ` - ${asset.requirement}` : '';
    return `asset plan item ${asset.id} is ${asset.status}${requirement}`;
  });
  const invalid = report.assetPlan.invalid.map((asset) => {
    const requirement = asset.requirement ? ` - ${asset.requirement}` : '';
    return `asset plan item ${asset.id} ${asset.message}${requirement}`;
  });
  return renderList([...pending, ...invalid]);
}

function renderFinalHtml(report) {
  const status = report.verdict.toUpperCase();
  const statusClass = report.passed ? 'pass' : report.hardFailPresent ? 'fail' : 'revise';
  const longPageScore = Number.isFinite(Number(report.longPage.score)) ? report.longPage.score : 'n/a';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>BetterRef Final Verdict</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #0d1020;
      --panel: #151a2d;
      --text: #f5f7fb;
      --muted: #aab3ca;
      --border: #2a3352;
      --pass: #33d17a;
      --revise: #f5c542;
      --fail: #ff5c7a;
    }
    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    main {
      max-width: 1120px;
      margin: 0 auto;
      padding: 32px 20px 48px;
    }
    h1, h2 {
      margin: 0;
      letter-spacing: 0;
    }
    h1 {
      font-size: 34px;
    }
    h2 {
      font-size: 18px;
    }
    .summary, .section {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px;
      margin-top: 18px;
    }
    .status {
      display: inline-flex;
      align-items: center;
      min-height: 36px;
      padding: 0 12px;
      border-radius: 6px;
      font-weight: 700;
      color: #0d1020;
      background: var(--revise);
    }
    .status.pass { background: var(--pass); }
    .status.fail { background: var(--fail); color: #fff; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 12px;
      margin-top: 16px;
    }
    .metric {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px;
    }
    .label {
      color: var(--muted);
      font-size: 13px;
    }
    .value {
      margin-top: 4px;
      font-size: 24px;
      font-weight: 700;
    }
    ul {
      padding-left: 20px;
      margin: 12px 0 0;
    }
    code {
      color: var(--text);
      background: rgba(255, 255, 255, 0.08);
      border-radius: 4px;
      padding: 2px 5px;
    }
    .inputs {
      display: grid;
      gap: 6px;
      overflow-wrap: anywhere;
    }
  </style>
</head>
<body>
  <main>
    <div class="summary">
      <h1>BetterRef Final Verdict</h1>
      <p><span class="status ${statusClass}">${escapeHtml(status)}</span></p>
      <div class="grid">
        <div class="metric"><div class="label">Visual Score</div><div class="value">${escapeHtml(report.visual.score)}</div></div>
        <div class="metric"><div class="label">PRD Compliance</div><div class="value">${escapeHtml(report.prdCompliance.score)}%</div></div>
        <div class="metric"><div class="label">Long-Page Score</div><div class="value">${escapeHtml(longPageScore)}</div></div>
        <div class="metric"><div class="label">Asset Plan</div><div class="value">${escapeHtml(report.assetPlan.passedCount)}/${escapeHtml(report.assetPlan.total)}</div></div>
        <div class="metric"><div class="label">Hard Fail</div><div class="value">${report.hardFailPresent ? 'YES' : 'NO'}</div></div>
      </div>
    </div>
    <section class="section">
      <h2>Blocking Reasons</h2>
      <ul>${renderList(report.blockingReasons)}</ul>
    </section>
    <section class="section">
      <h2>Guard Hard Fails</h2>
      <ul>${renderHardFails(report)}</ul>
    </section>
    <section class="section">
      <h2>PRD Compliance</h2>
      <p>${escapeHtml(report.prdCompliance.passed)} of ${escapeHtml(report.prdCompliance.total)} items passed.</p>
      <ul>${renderMissingPrd(report)}</ul>
    </section>
    <section class="section">
      <h2>Long-Page Sections</h2>
      <ul>${renderFailedSections(report)}</ul>
    </section>
    <section class="section">
      <h2>Asset Plan</h2>
      <ul>${renderPendingAssets(report)}</ul>
    </section>
    <section class="section">
      <h2>Inputs</h2>
      <div class="inputs">
        <code>report: ${escapeHtml(report.inputs.report || '')}</code>
        <code>guard: ${escapeHtml(report.inputs.guard || '')}</code>
        <code>prd: ${escapeHtml(report.inputs.prd || '')}</code>
        <code>browserEvidence: ${escapeHtml(report.inputs.browserEvidence || '')}</code>
        <code>longPage: ${escapeHtml(report.inputs.longPage || '')}</code>
        <code>assetPlan: ${escapeHtml(report.inputs.assetPlan || '')}</code>
        <code>threeD: ${escapeHtml(report.inputs.threeD || '')}</code>
        <code>html: ${escapeHtml(report.inputs.html || '')}</code>
      </div>
    </section>
  </main>
</body>
</html>
`;
}

async function describeArtifact(kind, filePath) {
  if (!filePath) {
    return {
      kind,
      path: null,
      present: false
    };
  }

  const resolved = path.resolve(filePath);
  try {
    const [contents, info] = await Promise.all([readFile(resolved), stat(resolved)]);
    return {
      kind,
      path: resolved,
      present: true,
      bytes: info.size,
      sha256: createHash('sha256').update(contents).digest('hex')
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        kind,
        path: resolved,
        present: false
      };
    }
    throw error;
  }
}

function summarizeBrowserEvidence(browserEvidence) {
  return {
    present: browserEvidence.present,
    passed: browserEvidence.passed,
    hardFailPresent: browserEvidence.hardFailPresent,
    invalidCount: browserEvidence.invalid.length,
    invalid: browserEvidence.invalid
  };
}

function summarizeAssetPlan(assetPlan) {
  return {
    present: assetPlan.present,
    passed: assetPlan.passed,
    hardFailPresent: assetPlan.hardFailPresent,
    imagegenRequired: assetPlan.imagegenRequired,
    hyperframesRequired: assetPlan.hyperframesRequired,
    total: assetPlan.total,
    passedCount: assetPlan.passedCount,
    pendingCount: assetPlan.pending.length,
    invalidCount: assetPlan.invalid.length,
    emptyRequiredPlan: assetPlan.emptyRequiredPlan,
    pending: assetPlan.pending,
    invalid: assetPlan.invalid
  };
}

function summarizeThreeD(threeD) {
  return {
    present: threeD.present,
    passed: threeD.passed,
    hardFailPresent: threeD.hardFailPresent,
    blockingReasons: threeD.blockingReasons
  };
}

async function buildEvidenceBundle(report, options) {
  const artifactInputs = [
    ['visual-report', options.reportPath],
    ['guard-report', options.guardPath],
    ['prd-checklist', options.prdPath],
    ['browser-evidence', options.browserEvidencePath],
    ['long-page-report', options.longPagePath],
    ['asset-plan', options.assetPlanPath],
    ['3d-verdict', options.threeDPath],
    ['final-verdict-json', options.outPath],
    ['final-verdict-html', options.htmlPath]
  ];
  const artifacts = [];
  for (const [kind, filePath] of artifactInputs) {
    const artifact = await describeArtifact(kind, filePath);
    if (artifact.path) {
      artifacts.push(artifact);
    }
  }

  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    verdict: {
      passed: report.passed,
      verdict: report.verdict,
      hardFailPresent: report.hardFailPresent,
      visualScore: report.visual.score,
      prdScore: report.prdCompliance.score,
      longPageScore: report.longPage.present ? report.longPage.score : null,
      assetPlanPassed: report.assetPlan.passed,
      threeDPassed: report.threeD.passed
    },
    inputs: report.inputs,
    requiredEvidence: report.requiredEvidence,
    browserEvidence: summarizeBrowserEvidence(report.browserEvidence),
    assetPlan: summarizeAssetPlan(report.assetPlan),
    threeD: summarizeThreeD(report.threeD),
    blockingReasons: report.blockingReasons,
    artifacts
  };
}

export async function verifyFinal(options) {
  const visualReport = await readJson(options.reportPath, 'BetterRef report');
  const guardReport =
    options.guardReport !== undefined
      ? options.guardReport
      : await readJson(options.guardPath, 'BetterRef guard report');
  const prdChecklist = await readJson(options.prdPath, 'PRD checklist');
  const longPageReport = await readJson(options.longPagePath, 'BetterRef long-page report');
  const assetPlanReport = await readJson(options.assetPlanPath, 'BetterRef asset plan');
  const browserEvidenceReport = await readJson(options.browserEvidencePath, 'BetterRef browser evidence');
  const threeDReport = await readJson(options.threeDPath, 'BetterRef 3D verdict');
  if (!visualReport) {
    throw new BetterRefVerifyInputError('Missing required BetterRef report.');
  }

  const visual = visualVerdict(visualReport);
  const guard = guardVerdict(guardReport);
  const prd = prdCompliance(prdChecklist);
  const longPage = longPageVerdict(longPageReport);
  const assetPlan = await assetPlanVerdict(assetPlanReport, {
    projectDir: options.projectDir ? path.resolve(options.projectDir) : undefined,
    browserEvidence: browserEvidenceReport
  });
  const browserEvidence = browserEvidenceVerdict(browserEvidenceReport);
  const threeD = await threeDVerdict(threeDReport, {
    supplied: Boolean(options.threeDPath),
    assetPlan: assetPlanReport,
    projectDir: options.projectDir ? path.resolve(options.projectDir) : undefined
  });
  const requiredItems = parseRequiredEvidence(options.requiredEvidence);
  if (assetPlanRequiresThreeD(assetPlanReport) && !requiredItems.includes('3d')) {
    requiredItems.push('3d');
  }
  const requiredEvidence = requiredEvidenceVerdict(requiredItems, {
    guard,
    prd,
    longPage,
    assetPlan,
    browserEvidence,
    threeD
  });
  const blockingReasons = [];

  if (!visual.passed) {
    blockingReasons.push(`visual report is ${visual.verdict}`);
  }
  if (visual.score < 95) {
    blockingReasons.push(`visual score ${visual.score} is below 95`);
  }
  if (visual.hardFailPresent) {
    blockingReasons.push('visual report contains hard-fail evidence');
  }
  if (!guard.passed) {
    for (const hardFail of guard.hardFails) {
      blockingReasons.push(`guard hard fail ${hardFail.code || 'unknown'}: ${hardFail.message || ''}`.trim());
    }
    if (guard.hardFails.length === 0) {
      blockingReasons.push('guard report did not pass');
    }
  }
  for (const item of prd.missing) {
    blockingReasons.push(`PRD item ${item.id} is ${item.status}`);
  }
  if (!longPage.passed) {
    if (!longPage.fullPagePassed) {
      blockingReasons.push('long-page full-page structure did not pass');
    }
    for (const section of longPage.failedSections) {
      blockingReasons.push(`long-page section ${section.name || 'unknown'} did not pass`);
    }
    if (longPage.failedSections.length === 0 && longPage.fullPagePassed) {
      blockingReasons.push('long-page report did not pass');
    }
  }
  for (const item of requiredEvidence.missing) {
    blockingReasons.push(`required ${requiredEvidenceLabel(item)} evidence is missing`);
  }
  if (!browserEvidence.passed) {
    for (const item of browserEvidence.invalid) {
      blockingReasons.push(`browser evidence ${item.message}`);
    }
  }
  if (!threeD.passed) {
    for (const reason of threeD.blockingReasons) {
      blockingReasons.push(reason);
    }
    if (threeD.blockingReasons.length === 0) {
      blockingReasons.push('3D verdict did not pass');
    }
  }
  if (!assetPlan.passed) {
    if (assetPlan.emptyRequiredPlan) {
      blockingReasons.push('asset plan requires imagegen or production assets but has no asset items');
    }
    for (const item of assetPlan.pending) {
      blockingReasons.push(`asset plan item ${item.id} is ${item.status}`);
    }
    for (const item of assetPlan.invalid) {
      blockingReasons.push(`asset plan item ${item.id} ${item.message}`);
    }
  }

  const hardFailPresent = Boolean(
    visual.hardFailPresent ||
      guard.hardFailPresent ||
      longPage.hardFailPresent ||
      assetPlan.hardFailPresent ||
      browserEvidence.hardFailPresent ||
      threeD.hardFailPresent ||
      requiredEvidence.missing.length > 0
  );
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
  const verdict = passed ? 'pass' : hardFailPresent ? 'fail' : 'revise';
  const finalReport = {
    passed,
    verdict,
    hardFailPresent,
    visual,
    guard,
    longPage,
    assetPlan,
    browserEvidence,
    threeD,
    requiredEvidence,
    prdCompliance: prd,
    blockingReasons,
    inputs: {
      report: options.reportPath ? path.resolve(options.reportPath) : null,
      guard: options.guardPath ? path.resolve(options.guardPath) : null,
      prd: options.prdPath ? path.resolve(options.prdPath) : null,
      longPage: options.longPagePath ? path.resolve(options.longPagePath) : null,
      assetPlan: options.assetPlanPath ? path.resolve(options.assetPlanPath) : null,
      browserEvidence: options.browserEvidencePath ? path.resolve(options.browserEvidencePath) : null,
      threeD: options.threeDPath ? path.resolve(options.threeDPath) : null,
      project: options.projectDir ? path.resolve(options.projectDir) : null,
      html: options.htmlPath ? path.resolve(options.htmlPath) : null
    }
  };

  if (options.outPath) {
    await writeFile(options.outPath, JSON.stringify(finalReport, null, 2));
  }
  if (options.htmlPath) {
    await writeFile(options.htmlPath, renderFinalHtml(finalReport));
  }
  if (options.bundlePath) {
    const bundle = await buildEvidenceBundle(finalReport, options);
    await writeFile(options.bundlePath, JSON.stringify(bundle, null, 2));
  }

  return finalReport;
}
