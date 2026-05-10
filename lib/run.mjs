import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { captureChrome } from './chrome.mjs';
import { runGuard } from './guard.mjs';
import { buildHyperframesQueue } from './hyperframes.mjs';
import { buildImagegenQueue } from './imagegen.mjs';
import { compareLongPage } from './longpage.mjs';
import { buildPrdArtifacts } from './prd.mjs';
import { verifyFinal } from './verify.mjs';

export class BetterRefRunError extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.name = 'BetterRefRunError';
    this.exitCode = exitCode;
  }
}

function isPassStatus(value) {
  return ['pass', 'passed', 'complete', 'completed', true].includes(value);
}

function isHyperframesAsset(asset) {
  return asset?.tool === 'hyperframes' || /hyperframes|webm|mp4|motion|animated/i.test(
    `${asset?.implementation || ''} ${asset?.targetPath || ''} ${asset?.role || ''}`
  );
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new BetterRefRunError(`Unable to read ${label}: ${error.message}`, 2);
  }
}

function asArray(value) {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function defaultPaths(projectDir, runDir) {
  const projectRoot = path.resolve(projectDir);
  const resolvedRunDir = path.resolve(runDir || path.join(projectRoot, '.betterref-run'));
  return {
    projectRoot,
    runDir: resolvedRunDir,
    prdOut: path.join(projectRoot, '.betterref-prd'),
    configOut: path.join(projectRoot, '.betterref.json'),
    browserOut: path.join(projectRoot, '.betterref'),
    imagegenOut: path.join(projectRoot, '.betterref-imagegen'),
    hyperframesOut: path.join(projectRoot, '.betterref-hyperframes'),
    longPageOut: path.join(projectRoot, '.betterref-longpage'),
    runStatePath: path.join(resolvedRunDir, 'run-state.json'),
    nextActionsPath: path.join(resolvedRunDir, 'next-actions.md'),
    finalSummaryPath: path.join(resolvedRunDir, 'final-summary.json')
  };
}

function pendingAssets(assetPlan) {
  const assets = asArray(assetPlan.assets);
  return {
    imagegen: assets.filter((asset) => !isHyperframesAsset(asset) && !isPassStatus(asset.status || asset.state || asset.result)),
    hyperframes: assets.filter((asset) => isHyperframesAsset(asset) && !isPassStatus(asset.status || asset.state || asset.result))
  };
}

function renderNextActions(result) {
  const lines = [
    '# BetterRef Run Next Actions',
    '',
    `- Status: ${result.status}`,
    `- Phase: ${result.phase}`,
    `- Exit code: ${result.exitCode}`,
    ''
  ];

  if (result.blockers.length === 0) {
    lines.push('No blocking action remains in this run.');
  } else {
    for (const blocker of result.blockers) {
      lines.push(`## ${blocker.code}`);
      lines.push('');
      lines.push(blocker.message);
      lines.push('');
      if (blocker.nextAction) {
        lines.push('```bash');
        lines.push(blocker.nextAction);
        lines.push('```');
        lines.push('');
      }
    }
  }

  if (result.artifacts.imagegenQueuePath) {
    lines.push('## Imagegen handoff');
    lines.push('');
    lines.push(`Use built-in image_gen for requests in \`${result.artifacts.imagegenQueuePath}\`, save outputs to target paths, then attach them:`);
    lines.push('');
    lines.push('```bash');
    lines.push(`betterref-imagegen --asset-plan ${result.artifacts.assetPlanPath} --attach asset-001=path/to/generated.png --project ${result.inputs.project} --json`);
    lines.push('```');
    lines.push('');
  }

  if (result.artifacts.hyperframesQueuePath) {
    lines.push('## HyperFrames handoff');
    lines.push('');
    lines.push(`Create and render requests in \`${result.artifacts.hyperframesQueuePath}\`, then attach passing CLI evidence:`);
    lines.push('');
    lines.push('```bash');
    lines.push('npx hyperframes lint hyperframes/asset-001');
    lines.push('npx hyperframes validate hyperframes/asset-001');
    lines.push('npx hyperframes inspect --json hyperframes/asset-001');
    lines.push('npx hyperframes render --format webm --quality high --output path/to/asset-001.webm hyperframes/asset-001');
    lines.push(`betterref-hyperframes --asset-plan ${result.artifacts.assetPlanPath} --attach asset-001=path/to/asset-001.webm --evidence path/to/hyperframes-evidence.json --project ${result.inputs.project} --json`);
    lines.push('```');
    lines.push('');
  }

  if (result.phase === 'browser') {
    lines.push('## Browser evidence handoff');
    lines.push('');
    lines.push('Use @chrome when connected, or expose Chrome DevTools Protocol and rerun with --endpoint.');
    lines.push('');
    lines.push('```bash');
    lines.push(`betterref-chrome --endpoint http://127.0.0.1:9222 --url-match ${result.inputs.url || '<target-url>'} --out ${result.artifacts.browserOut} --full-page --section-screenshots --ref ${result.inputs.reference} --regions both --html`);
    lines.push('```');
    lines.push('');
    lines.push('Expected evidence: `.betterref/browser-evidence.json`, `.betterref/chrome-full-page.png`, and section screenshots.');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

async function writeRunArtifacts(result, paths) {
  await mkdir(paths.runDir, { recursive: true });
  await writeFile(paths.runStatePath, `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(paths.nextActionsPath, renderNextActions(result));
  await writeFile(paths.finalSummaryPath, `${JSON.stringify({
    schemaVersion: 'betterref.run.summary.v1',
    status: result.status,
    phase: result.phase,
    exitCode: result.exitCode,
    blockers: result.blockers,
    artifacts: result.artifacts,
    finalVerdict: result.finalVerdict || null
  }, null, 2)}\n`);
}

function resultBase({ options, paths, artifacts, steps }) {
  return {
    schemaVersion: 'betterref.run.v1',
    generatedAt: new Date().toISOString(),
    inputs: {
      pdf: path.resolve(options.pdfPath),
      project: paths.projectRoot,
      reference: path.resolve(options.referencePath),
      url: options.url || null,
      endpoint: options.endpoint || null
    },
    artifacts: {
      runStatePath: paths.runStatePath,
      nextActionsPath: paths.nextActionsPath,
      finalSummaryPath: paths.finalSummaryPath,
      prdOut: paths.prdOut,
      browserOut: paths.browserOut,
      ...artifacts
    },
    steps
  };
}

async function finish({ options, paths, artifacts, steps, status, phase, exitCode, blockers = [], finalVerdict = null }) {
  const result = {
    ...resultBase({ options, paths, artifacts, steps }),
    status,
    phase,
    exitCode,
    blockers,
    finalVerdict
  };
  await writeRunArtifacts(result, paths);
  return result;
}

function validateOptions(options) {
  if (!options.pdfPath) {
    throw new BetterRefRunError('Missing --pdf.');
  }
  if (!options.projectDir) {
    throw new BetterRefRunError('Missing --project.');
  }
  if (!options.referencePath) {
    throw new BetterRefRunError('Missing --ref.');
  }
}

export async function runBetterRef(options) {
  validateOptions(options);

  const paths = defaultPaths(options.projectDir, options.runDir);
  const artifacts = {};
  const steps = [];

  await mkdir(paths.runDir, { recursive: true });

  const prd = await buildPrdArtifacts({
    pdfPath: options.pdfPath,
    outDir: paths.prdOut,
    configOut: paths.configOut,
    projectDir: paths.projectRoot,
    viewport: options.viewport,
    referencePath: options.referencePath,
    url: options.url
  });
  Object.assign(artifacts, {
    ...prd.artifacts,
    configPath: prd.artifacts.configPath,
    guardConfigPath: prd.artifacts.guardConfigPath
  });
  steps.push({ name: 'prd', status: 'completed', artifacts: prd.artifacts });

  const summary = await readJson(prd.artifacts.summaryPath, 'PRD summary');
  const assetPlan = await readJson(prd.artifacts.assetPlanPath, 'asset plan');
  const pending = pendingAssets(assetPlan);
  const blockers = [];

  if (pending.imagegen.length > 0) {
    const queue = await buildImagegenQueue({
      assetPlanPath: prd.artifacts.assetPlanPath,
      outDir: paths.imagegenOut
    });
    artifacts.imagegenQueuePath = path.join(paths.imagegenOut, 'imagegen-requests.json');
    steps.push({ name: 'imagegen-queue', status: 'blocked', requests: queue.requests.length });
    blockers.push({
      code: 'blocked_external_asset_generation',
      message: `${queue.requests.length} imagegen asset request(s) must be generated with built-in image_gen and attached before verification can pass.`,
      nextAction: `betterref-imagegen --asset-plan ${prd.artifacts.assetPlanPath} --attach asset-001=path/to/generated.png --project ${paths.projectRoot} --json`
    });
  }

  if (pending.hyperframes.length > 0) {
    const queue = await buildHyperframesQueue({
      assetPlanPath: prd.artifacts.assetPlanPath,
      outDir: paths.hyperframesOut
    });
    artifacts.hyperframesQueuePath = path.join(paths.hyperframesOut, 'hyperframes-requests.json');
    steps.push({ name: 'hyperframes-queue', status: 'blocked', requests: queue.requests.length });
    blockers.push({
      code: 'blocked_external_asset_generation',
      message: `${queue.requests.length} HyperFrames asset request(s) must be rendered and attached with passing CLI evidence before verification can pass.`,
      nextAction: `betterref-hyperframes --asset-plan ${prd.artifacts.assetPlanPath} --attach asset-001=path/to/asset-001.webm --evidence path/to/hyperframes-evidence.json --project ${paths.projectRoot} --json`
    });
  }

  if (blockers.length > 0) {
    return finish({ options, paths, artifacts, steps, status: 'blocked', phase: 'assets', exitCode: 3, blockers });
  }

  if (!options.endpoint) {
    return finish({
      options,
      paths,
      artifacts,
      steps,
      status: 'blocked',
      phase: 'browser',
      exitCode: 3,
      blockers: [{
        code: 'blocked_browser_evidence',
        message: 'No Chrome/CDP endpoint was provided. Use @chrome or rerun with --endpoint to capture browser evidence.',
        nextAction: `betterref-run --pdf ${path.resolve(options.pdfPath)} --project ${paths.projectRoot} --ref ${path.resolve(options.referencePath)} --url ${options.url || '<target-url>'} --endpoint http://127.0.0.1:9222 --json`
      }]
    });
  }

  let chrome;
  try {
    chrome = await captureChrome({
      endpoint: options.endpoint,
      outDir: paths.browserOut,
      urlMatch: options.url,
      selectors: options.selector,
      waitMs: options.waitMs || 0,
      referencePath: options.referencePath,
      mergeConfigPath: paths.configOut,
      regionMode: 'both',
      html: options.html !== false,
      matchSize: 'strict',
      fullPage: true,
      sectionScreenshots: true
    });
  } catch (error) {
    return finish({
      options,
      paths,
      artifacts,
      steps,
      status: 'blocked',
      phase: 'browser',
      exitCode: 3,
      blockers: [{
        code: 'blocked_browser_evidence',
        message: `Chrome/CDP capture did not complete: ${error.message}`,
        nextAction: `Confirm @chrome is connected or Chrome is running with CDP, then rerun betterref-run with --endpoint ${options.endpoint}.`
      }]
    });
  }

  Object.assign(artifacts, {
    screenshotPath: chrome.artifacts.screenshotPath,
    fullPageScreenshotPath: chrome.artifacts.fullPageScreenshotPath,
    browserEvidencePath: chrome.artifacts.browserEvidencePath,
    reportPath: chrome.artifacts.reportPath,
    chromeConfigPath: chrome.artifacts.configPath,
    sectionScreenshotPaths: chrome.artifacts.sectionScreenshotPaths
  });
  steps.push({ name: 'browser-capture', status: 'completed', artifacts: chrome.artifacts });

  let longPage = null;
  if (summary.longReference) {
    longPage = await compareLongPage({
      referencePath: options.referencePath,
      actualFullPath: chrome.artifacts.fullPageScreenshotPath,
      browserEvidencePath: chrome.artifacts.browserEvidencePath,
      outDir: paths.longPageOut,
      cropReference: 'auto',
      html: options.html !== false,
      matchSize: 'strict'
    });
    artifacts.longPageReportPath = longPage.artifacts.reportPath;
    steps.push({ name: 'longpage', status: longPage.passed ? 'completed' : 'failed', artifacts: longPage.artifacts });
  }

  const guardReportPath = path.join(paths.browserOut, 'guard-report.json');
  const guard = await runGuard({
    projectDir: paths.projectRoot,
    reportPath: chrome.artifacts.reportPath,
    configPath: prd.artifacts.guardConfigPath,
    browserEvidencePath: chrome.artifacts.browserEvidencePath,
    outPath: guardReportPath
  });
  artifacts.guardReportPath = guardReportPath;
  steps.push({ name: 'guard', status: guard.passed ? 'completed' : 'failed', artifacts: { guardReportPath } });

  const required = ['guard', 'prd', 'browser', 'assetplan'];
  if (summary.longReference) {
    required.push('longpage');
  }

  const finalVerdictPath = path.join(paths.browserOut, 'final-verdict.json');
  const finalHtmlPath = path.join(paths.browserOut, 'final-verdict.html');
  const evidenceBundlePath = path.join(paths.browserOut, 'evidence-bundle.json');
  const finalVerdict = await verifyFinal({
    reportPath: chrome.artifacts.reportPath,
    guardPath: guardReportPath,
    prdPath: prd.artifacts.prdChecklistPath,
    longPagePath: summary.longReference ? longPage?.artifacts.reportPath : undefined,
    assetPlanPath: prd.artifacts.assetPlanPath,
    browserEvidencePath: chrome.artifacts.browserEvidencePath,
    projectDir: paths.projectRoot,
    outPath: finalVerdictPath,
    htmlPath: finalHtmlPath,
    bundlePath: evidenceBundlePath,
    requiredEvidence: required.join(',')
  });
  Object.assign(artifacts, {
    finalVerdictPath,
    finalHtmlPath,
    evidenceBundlePath
  });
  steps.push({ name: 'verify', status: finalVerdict.passed ? 'completed' : 'failed', artifacts: { finalVerdictPath, finalHtmlPath, evidenceBundlePath } });

  return finish({
    options,
    paths,
    artifacts,
    steps,
    status: finalVerdict.verdict,
    phase: 'final',
    exitCode: finalVerdict.passed ? 0 : 1,
    blockers: [],
    finalVerdict
  });
}
