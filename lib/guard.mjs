import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export class BetterRefGuardInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BetterRefGuardInputError';
  }
}

const DEFAULT_FORBIDDEN_PATTERNS = [
  'assets/reference',
  'assets\\\\reference',
  'homepage-reference',
  'fullpage-reference',
  'reference-desktop',
  'pdf-render',
  'pdfs/rendered',
  'pdfs\\\\rendered',
  '.betterref-prd'
];

const DEFAULT_SOURCE_EXTENSIONS = [
  '.astro',
  '.css',
  '.html',
  '.jsx',
  '.mdx',
  '.scss',
  '.svelte',
  '.ts',
  '.tsx',
  '.vue',
  '.js',
  '.mjs',
  '.cjs'
];

const DEFAULT_SOURCE_ROOTS = [
  'src',
  'app',
  'pages',
  'components',
  'styles',
  'public'
];

const IGNORED_DIRS = new Set([
  '.git',
  '.next',
  '.nuxt',
  '.svelte-kit',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'tmp'
]);

async function readJson(filePath, label) {
  if (!filePath) {
    return {};
  }

  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new BetterRefGuardInputError(`Could not read ${label} ${filePath}: ${error.message}`);
  }
}

function asArray(value) {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function normalizePatterns(patterns) {
  return asArray(patterns).map((pattern) => {
    if (pattern && typeof pattern === 'object') {
      return {
        raw: pattern.pattern,
        regex: new RegExp(String(pattern.pattern), pattern.flags || 'i')
      };
    }
    const raw = String(pattern);
    return {
      raw,
      regex: new RegExp(escapeRegExp(raw), 'i')
    };
  });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function collectSourceFiles(root, extensions, files = []) {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        await collectSourceFiles(fullPath, extensions, files);
      }
      continue;
    }

    if (extensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }
  return files;
}

async function pathExists(dirPath) {
  try {
    return (await stat(dirPath)).isDirectory();
  } catch {
    return false;
  }
}

async function selectSourceRoots(projectDir, config) {
  if (config.sourceRoots) {
    return asArray(config.sourceRoots).map((item) => path.resolve(projectDir, item));
  }

  const roots = [];
  for (const relative of DEFAULT_SOURCE_ROOTS) {
    const fullPath = path.join(projectDir, relative);
    if (await pathExists(fullPath)) {
      roots.push(fullPath);
    }
  }

  return roots.length > 0 ? roots : [projectDir];
}

function findSections(report) {
  for (const value of [
    report.sections,
    report.sectionScores,
    report.perSection,
    report.fullPage?.sections,
    report.verdict?.sections
  ]) {
    if (Array.isArray(value)) {
      return value;
    }
  }
  return [];
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

function getActualFullPageHeight(report, config, browserEvidence = {}) {
  return numericValue(
    config.actualFullPageHeight,
    browserEvidence.page?.scrollHeight,
    browserEvidence.viewport?.scrollHeight,
    browserEvidence.document?.scrollHeight,
    report.actualFullPageHeight,
    report.fullPage?.height,
    report.fullPage?.dimensions?.height,
    report.dimensions?.actualFullPage?.height,
    report.dimensions?.actualSourceFullPage?.height,
    report.dimensions?.actualSource?.height,
    report.dimensions?.actualCompared?.height
  );
}

function getViewportHeight(report, config) {
  return numericValue(
    config.targetViewport?.height,
    config.viewport?.height,
    report.viewport?.height,
    report.dimensions?.viewport?.height
  );
}

function hasReportedHardFail(report) {
  return Boolean(
    report.hardFailPresent ||
      report.hard_fail_present ||
      report.verdict?.hardFailPresent ||
      report.verdict?.hard_fail_present ||
      asArray(report.hardFails).length > 0 ||
      asArray(report.verdict?.hardFailHints).length > 0 ||
      asArray(report.verdict?.hard_fail_ledger).length > 0
  );
}

function hasPassingVisualReport(report) {
  if (report.passed === false) {
    return false;
  }
  const verdict = report.verdict?.verdict;
  if (verdict && verdict !== 'pass') {
    return false;
  }
  return true;
}

async function scanSource({ projectDir, config, hardFails, summary }) {
  if (!projectDir) {
    return;
  }

  const extensions = new Set(asArray(config.sourceExtensions || DEFAULT_SOURCE_EXTENSIONS).map((item) => String(item).toLowerCase()));
  const patterns = normalizePatterns(config.forbiddenSourcePatterns || DEFAULT_FORBIDDEN_PATTERNS);
  const roots = await selectSourceRoots(projectDir, config);
  summary.sourceRootsScanned = roots.map((root) => path.relative(projectDir, root) || '.');
  const files = [];
  for (const root of roots) {
    await collectSourceFiles(root, extensions, files);
  }
  summary.sourceFilesScanned = files.length;

  for (const filePath of files) {
    const text = await readFile(filePath, 'utf8');
    for (const pattern of patterns) {
      if (pattern.regex.test(text)) {
        hardFails.push({
          code: 'reference_asset_used_in_source',
          message: 'Implementation source references a screenshot, PDF render, or reference-only asset.',
          file: path.relative(projectDir, filePath),
          pattern: pattern.raw
        });
      }
    }
  }
}

function checkReport({ report, config, browserEvidence, hardFails }) {
  if (!hasPassingVisualReport(report)) {
    hardFails.push({
      code: 'visual_report_not_passed',
      message: 'The BetterRef visual report itself is not a pass.'
    });
  }

  if (hasReportedHardFail(report)) {
    hardFails.push({
      code: 'reported_hard_fail_present',
      message: 'The BetterRef report already contains hard-fail evidence.'
    });
  }

  const longReference =
    Boolean(config.longReference) ||
    report.mode === 'full_page_scroll_reference' ||
    numericValue(report.dimensions?.reference?.height) > numericValue(report.viewport?.height);

  if (!longReference) {
    return;
  }

  const expectedMode = config.expectedMode || 'full_page_scroll_reference';
  if (report.mode !== expectedMode) {
    hardFails.push({
      code: 'long_reference_missing_scroll_mode',
      message: `Long-page references must use ${expectedMode}, not ${report.mode || 'unknown'}.`
    });
  }

  if (findSections(report).length === 0) {
    hardFails.push({
      code: 'long_reference_missing_section_scores',
      message: 'Long-page references require per-section scores or section verdicts.'
    });
  }

  const viewportHeight = getViewportHeight(report, config);
  const actualFullPageHeight = getActualFullPageHeight(report, config, browserEvidence);
  if (!actualFullPageHeight || !viewportHeight || actualFullPageHeight <= viewportHeight * 1.05) {
    hardFails.push({
      code: 'actual_page_missing_scroll_evidence',
      message: 'Long-page reference requires native full-page screenshot evidence taller than the viewport.'
    });
  }
}

function checkRenderedAssets({ report, config, browserEvidence, hardFails }) {
  const maxScale = numericValue(config.maxNativeScaleRatio, 1.05);
  const assets = [
    ...asArray(config.renderedAssets),
    ...asArray(report.renderedAssets),
    ...asArray(report.assets?.rendered),
    ...asArray(browserEvidence.images),
    ...asArray(browserEvidence.assets?.rendered)
  ];

  for (const asset of assets) {
    const nativeWidth = numericValue(asset.nativeWidth, asset.naturalWidth, asset.width);
    const nativeHeight = numericValue(asset.nativeHeight, asset.naturalHeight, asset.height);
    const renderedWidth = numericValue(asset.renderedWidth, asset.cssWidth, asset.clientWidth);
    const renderedHeight = numericValue(asset.renderedHeight, asset.cssHeight, asset.clientHeight);
    if (!nativeWidth || !nativeHeight || !renderedWidth || !renderedHeight) {
      continue;
    }

    if (renderedWidth > nativeWidth * maxScale || renderedHeight > nativeHeight * maxScale) {
      hardFails.push({
        code: 'asset_scaled_beyond_native_size',
        message: 'Rendered asset is larger than its native dimensions and may be blurry.',
        asset
      });
    }
  }
}

function resolveAssetPath(asset, projectDir, configPath) {
  const assetPath = asset.path || asset.file || asset.localPath || asset.srcPath;
  if (!assetPath) {
    return undefined;
  }

  if (path.isAbsolute(assetPath)) {
    return assetPath;
  }

  const baseDir = projectDir || (configPath ? path.dirname(path.resolve(configPath)) : process.cwd());
  return path.resolve(baseDir, assetPath);
}

async function measureSharpness(filePath) {
  const { data, info } = await sharp(filePath).greyscale().raw().toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;
  if (!width || !height || width < 2 || height < 2) {
    return 0;
  }

  let total = 0;
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const current = data[y * width + x];
      if (x + 1 < width) {
        total += Math.abs(current - data[y * width + x + 1]);
        count += 1;
      }
      if (y + 1 < height) {
        total += Math.abs(current - data[(y + 1) * width + x]);
        count += 1;
      }
    }
  }

  return count === 0 ? 0 : total / count;
}

async function checkAssetQuality({ projectDir, configPath, config, report, browserEvidence, hardFails, summary }) {
  const checks = [
    ...asArray(config.assetQualityChecks),
    ...asArray(report.assetQualityChecks),
    ...asArray(browserEvidence.assetQualityChecks)
  ];
  summary.assetQualityChecks = checks.length;

  for (const asset of checks) {
    const minSharpness = numericValue(asset.minSharpness, config.minAssetSharpness);
    if (minSharpness === undefined) {
      continue;
    }

    const filePath = resolveAssetPath(asset, projectDir, configPath);
    if (!filePath) {
      hardFails.push({
        code: 'asset_quality_missing_path',
        message: 'Asset quality check requires a local image path.',
        asset
      });
      continue;
    }

    let sharpness;
    try {
      sharpness = await measureSharpness(filePath);
    } catch (error) {
      hardFails.push({
        code: 'asset_quality_unreadable',
        message: `Asset quality check could not read image: ${error.message}`,
        asset
      });
      continue;
    }

    if (sharpness < minSharpness) {
      hardFails.push({
        code: 'asset_quality_below_threshold',
        message: `Raster asset sharpness ${sharpness.toFixed(2)} is below the configured minimum ${minSharpness}.`,
        asset,
        measuredSharpness: Number(sharpness.toFixed(2)),
        minSharpness
      });
    }
  }
}

function checkBrowserEvidence({ browserEvidence, config, hardFails }) {
  if (!browserEvidence || Object.keys(browserEvidence).length === 0) {
    return;
  }

  const longReference = Boolean(config.longReference);
  const viewportHeight = numericValue(
    config.targetViewport?.height,
    browserEvidence.viewport?.height,
    browserEvidence.page?.clientHeight
  );
  const scrollHeight = numericValue(
    browserEvidence.page?.scrollHeight,
    browserEvidence.viewport?.scrollHeight,
    browserEvidence.document?.scrollHeight
  );
  if (longReference && (!scrollHeight || !viewportHeight || scrollHeight <= viewportHeight * 1.05)) {
    hardFails.push({
      code: 'browser_missing_scroll_evidence',
      message: 'Browser evidence does not show a naturally scrollable page for a long reference.'
    });
  }

  const fonts = browserEvidence.fonts || {};
  const unsupportedFontStatus = fonts.status === 'unsupported';
  if (fonts.ready === false || (fonts.status && fonts.status !== 'loaded' && !unsupportedFontStatus)) {
    hardFails.push({
      code: 'browser_fonts_not_ready',
      message: 'Browser evidence shows fonts were not ready/loaded during capture.',
      fonts
    });
  }

  const consoleEntries = [
    ...asArray(browserEvidence.console),
    ...asArray(browserEvidence.consoleErrors),
    ...asArray(browserEvidence.errors)
  ];
  const consoleErrors = consoleEntries.filter((entry) => {
    if (typeof entry === 'string') {
      return true;
    }
    return ['error', 'exception', 'assert'].includes(String(entry.type || entry.level || '').toLowerCase());
  });
  if (consoleErrors.length > 0 && config.failOnConsoleErrors !== false) {
    hardFails.push({
      code: 'browser_console_error_present',
      message: 'Browser evidence contains console errors.',
      count: consoleErrors.length,
      sample: consoleErrors.slice(0, 3)
    });
  }

  const bodyTextLength = numericValue(
    browserEvidence.page?.bodyTextLength,
    browserEvidence.dom?.bodyTextLength,
    browserEvidence.text?.length
  );
  if (config.requireDomText && (!bodyTextLength || bodyTextLength <= 0)) {
    hardFails.push({
      code: 'browser_missing_dom_text',
      message: 'Browser evidence has no DOM text, which can indicate screenshot-as-UI or canvas-only output.'
    });
  }

  const interactiveCount = numericValue(
    browserEvidence.page?.interactiveCount,
    browserEvidence.dom?.interactiveCount
  );
  const minInteractiveElements = numericValue(config.minInteractiveElements);
  if (minInteractiveElements !== undefined && (!interactiveCount || interactiveCount < minInteractiveElements)) {
    hardFails.push({
      code: 'browser_missing_interactive_elements',
      message: `Browser evidence has fewer interactive elements than required (${interactiveCount || 0}/${minInteractiveElements}).`
    });
  }
}

export async function runGuard(options) {
  const report = await readJson(options.reportPath, 'BetterRef report');
  const config = await readJson(options.configPath, 'BetterRef guard config');
  const browserEvidence = await readJson(options.browserEvidencePath, 'BetterRef browser evidence');
  const projectDir = options.projectDir ? path.resolve(options.projectDir) : undefined;
  const hardFails = [];
  const warnings = [];
  const summary = {
    sourceFilesScanned: 0,
    renderedAssetsChecked:
      asArray(config.renderedAssets).length +
      asArray(report.renderedAssets).length +
      asArray(browserEvidence.images).length +
      asArray(browserEvidence.assets?.rendered).length,
    browserEvidencePresent: Boolean(options.browserEvidencePath)
  };

  await scanSource({ projectDir, config, hardFails, warnings, summary });
  checkReport({ report, config, browserEvidence, hardFails, warnings });
  checkRenderedAssets({ report, config, browserEvidence, hardFails, warnings });
  await checkAssetQuality({ projectDir, configPath: options.configPath, config, report, browserEvidence, hardFails, warnings, summary });
  checkBrowserEvidence({ browserEvidence, config, hardFails, warnings });

  const guardReport = {
    passed: hardFails.length === 0,
    hardFailPresent: hardFails.length > 0,
    hardFails,
    warnings,
    summary,
    inputs: {
      project: projectDir || null,
      report: options.reportPath ? path.resolve(options.reportPath) : null,
      config: options.configPath ? path.resolve(options.configPath) : null,
      browserEvidence: options.browserEvidencePath ? path.resolve(options.browserEvidencePath) : null
    }
  };

  if (options.outPath) {
    await writeFile(options.outPath, JSON.stringify(guardReport, null, 2));
  }

  return guardReport;
}
