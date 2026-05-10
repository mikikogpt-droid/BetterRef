import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

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

function getActualFullPageHeight(report, config) {
  return numericValue(
    config.actualFullPageHeight,
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

function checkReport({ report, config, hardFails }) {
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
  const actualFullPageHeight = getActualFullPageHeight(report, config);
  if (!actualFullPageHeight || !viewportHeight || actualFullPageHeight <= viewportHeight * 1.05) {
    hardFails.push({
      code: 'actual_page_missing_scroll_evidence',
      message: 'Long-page reference requires native full-page screenshot evidence taller than the viewport.'
    });
  }
}

function checkRenderedAssets({ report, config, hardFails }) {
  const maxScale = numericValue(config.maxNativeScaleRatio, 1.05);
  const assets = [
    ...asArray(config.renderedAssets),
    ...asArray(report.renderedAssets),
    ...asArray(report.assets?.rendered)
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

export async function runGuard(options) {
  const report = await readJson(options.reportPath, 'BetterRef report');
  const config = await readJson(options.configPath, 'BetterRef guard config');
  const projectDir = options.projectDir ? path.resolve(options.projectDir) : undefined;
  const hardFails = [];
  const warnings = [];
  const summary = {
    sourceFilesScanned: 0,
    renderedAssetsChecked: asArray(config.renderedAssets).length + asArray(report.renderedAssets).length
  };

  await scanSource({ projectDir, config, hardFails, warnings, summary });
  checkReport({ report, config, hardFails, warnings });
  checkRenderedAssets({ report, config, hardFails, warnings });

  const guardReport = {
    passed: hardFails.length === 0,
    hardFailPresent: hardFails.length > 0,
    hardFails,
    warnings,
    summary,
    inputs: {
      project: projectDir || null,
      report: options.reportPath ? path.resolve(options.reportPath) : null,
      config: options.configPath ? path.resolve(options.configPath) : null
    }
  };

  if (options.outPath) {
    await writeFile(options.outPath, JSON.stringify(guardReport, null, 2));
  }

  return guardReport;
}
