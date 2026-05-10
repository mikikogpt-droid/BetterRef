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
    ['all', ['guard', 'prd', 'longpage', 'assetplan']],
    ['guard', ['guard']],
    ['prd', ['prd']],
    ['checklist', ['prd']],
    ['longpage', ['longpage']],
    ['long-page', ['longpage']],
    ['assetplan', ['assetplan']],
    ['asset-plan', ['assetplan']]
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

  if (!nativeWidth || !nativeHeight) {
    addInvalid('asset_pass_missing_native_dimensions', 'lacks verified native dimensions');
  }
  if (minNativeWidth !== undefined && (!nativeWidth || nativeWidth < minNativeWidth)) {
    addInvalid('asset_pass_width_below_minimum', `native width ${nativeWidth || 0} is below ${minNativeWidth}`);
  }
  if (minNativeHeight !== undefined && (!nativeHeight || nativeHeight < minNativeHeight)) {
    addInvalid('asset_pass_height_below_minimum', `native height ${nativeHeight || 0} is below ${minNativeHeight}`);
  }
  if (minSharpness !== undefined && (measuredSharpness === undefined || measuredSharpness < minSharpness)) {
    addInvalid('asset_pass_sharpness_below_minimum', `measured sharpness ${measuredSharpness ?? 'missing'} is below ${minSharpness}`);
  }

  const resolvedPath = resolveEvidencePath(evidencePath, options.projectDir);
  if (options.projectDir && !resolvedPath) {
    addInvalid('asset_pass_unresolvable_path', 'has no project-resolvable generated/source asset path');
  }
  if (resolvedPath) {
    try {
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
    } catch (error) {
      addInvalid('asset_pass_file_unreadable', `generated/source asset file is unreadable: ${error.message}`);
    }
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
  const pending = assets
    .filter((asset) => !isPassStatus(asset.status || asset.state || asset.result))
    .map((asset, index) => ({
      id: assetId(asset, index),
      status: asset.status || asset.state || asset.result || 'pending',
      requirement: assetRequirement(asset)
    }));
  const invalid = [];
  for (const [index, asset] of assets.entries()) {
    if (isPassStatus(asset.status || asset.state || asset.result)) {
      invalid.push(...(await validatePassedAsset(asset, index, options)));
    }
  }
  const imagegenRequired = Boolean(plan.imagegenRequired || assets.length > 0);
  const emptyRequiredPlan = imagegenRequired && assets.length === 0;

  return {
    present: true,
    passed: pending.length === 0 && invalid.length === 0 && !emptyRequiredPlan,
    hardFailPresent: pending.length > 0 || invalid.length > 0 || emptyRequiredPlan,
    imagegenRequired,
    total: assets.length,
    passedCount: assets.length - pending.length - invalid.length,
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
  return item;
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
        <code>longPage: ${escapeHtml(report.inputs.longPage || '')}</code>
        <code>assetPlan: ${escapeHtml(report.inputs.assetPlan || '')}</code>
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

async function buildEvidenceBundle(report, options) {
  const artifactInputs = [
    ['visual-report', options.reportPath],
    ['guard-report', options.guardPath],
    ['prd-checklist', options.prdPath],
    ['long-page-report', options.longPagePath],
    ['asset-plan', options.assetPlanPath],
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
      assetPlanPassed: report.assetPlan.passed
    },
    blockingReasons: report.blockingReasons,
    artifacts
  };
}

export async function verifyFinal(options) {
  const visualReport = await readJson(options.reportPath, 'BetterRef report');
  const guardReport = await readJson(options.guardPath, 'BetterRef guard report');
  const prdChecklist = await readJson(options.prdPath, 'PRD checklist');
  const longPageReport = await readJson(options.longPagePath, 'BetterRef long-page report');
  const assetPlanReport = await readJson(options.assetPlanPath, 'BetterRef asset plan');
  if (!visualReport) {
    throw new BetterRefVerifyInputError('Missing required BetterRef report.');
  }

  const visual = visualVerdict(visualReport);
  const guard = guardVerdict(guardReport);
  const prd = prdCompliance(prdChecklist);
  const longPage = longPageVerdict(longPageReport);
  const assetPlan = await assetPlanVerdict(assetPlanReport, {
    projectDir: options.projectDir ? path.resolve(options.projectDir) : undefined
  });
  const requiredEvidence = requiredEvidenceVerdict(parseRequiredEvidence(options.requiredEvidence), {
    guard,
    prd,
    longPage,
    assetPlan
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
      requiredEvidence.missing.length > 0
  );
  const passed =
    blockingReasons.length === 0 &&
    visual.passed &&
    guard.passed &&
    longPage.passed &&
    assetPlan.passed &&
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
    requiredEvidence,
    prdCompliance: prd,
    blockingReasons,
    inputs: {
      report: options.reportPath ? path.resolve(options.reportPath) : null,
      guard: options.guardPath ? path.resolve(options.guardPath) : null,
      prd: options.prdPath ? path.resolve(options.prdPath) : null,
      longPage: options.longPagePath ? path.resolve(options.longPagePath) : null,
      assetPlan: options.assetPlanPath ? path.resolve(options.assetPlanPath) : null,
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
