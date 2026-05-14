import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { bridgeChromeHandoff } from './chromeBridge.mjs';
import { captureChrome } from './chrome.mjs';
import { compareImages } from './diff.mjs';
import { runGuard } from './guard.mjs';
import { buildHyperframesQueue } from './hyperframes.mjs';
import { autoAttachAvailableGeneratedAssets, buildImagegenHandoff } from './imagegen.mjs';
import { compareLongPage } from './longpage.mjs';
import { buildPrdArtifacts } from './prd.mjs';
import { analyzeReference } from './reference.mjs';
import { make3DAssetPlan, makeHunyuanRequest, verify3D } from './threeD.mjs';
import { runAgentWorkflow } from './agents.mjs';
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
    /\bhunyuan.*\b3d\b|\b3d\b.*\bhunyuan\b/.test(provider) ||
    role === 'hunyuan-3d-model' ||
    ['glb', 'gltf', 'obj', 'usdz'].includes(targetFormat) ||
    /\.(?:glb|gltf|obj|usdz)(?:$|[?#])/.test(targetPath)
  );
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new BetterRefRunError(`Unable to read ${label}: ${error.message}`, 2);
  }
}

async function readOptionalJson(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw new BetterRefRunError(`Unable to read ${label}: ${error.message}`, 2);
  }
}

async function fileExists(filePath) {
  try {
    await readFile(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
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
    referenceOut: path.join(projectRoot, '.betterref-reference'),
    configOut: path.join(projectRoot, '.betterref.json'),
    browserOut: path.join(projectRoot, '.betterref'),
    imagegenOut: path.join(projectRoot, '.betterref-imagegen'),
    imagegenGeneratedDir: path.join(projectRoot, '.betterref-imagegen', 'generated'),
    imagegenStatusPath: path.join(projectRoot, '.betterref-imagegen', 'imagegen-status.json'),
    imagegenHandoffRequestPath: path.join(resolvedRunDir, 'imagegen-handoff-request.json'),
    imagegenHandoffPromptPath: path.join(resolvedRunDir, 'imagegen-handoff-prompt.md'),
    hyperframesOut: path.join(projectRoot, '.betterref-hyperframes'),
    agentsOut: path.join(projectRoot, '.betterref-agents'),
    threeDOut: path.join(projectRoot, '.betterref-3d'),
    threeDPlanPath: path.join(projectRoot, '.betterref-3d', '3d-asset-plan.json'),
    hunyuanRequestPath: path.join(projectRoot, '.betterref-3d', 'hunyuan-request.json'),
    hunyuanResponsePath: path.join(projectRoot, '.betterref-3d', 'hunyuan-response.json'),
    threeDEvidencePath: path.join(projectRoot, '.betterref-3d', '3d-evidence.json'),
    threeDVerdictPath: path.join(projectRoot, '.betterref-3d', '3d-verdict.json'),
    longPageOut: path.join(projectRoot, '.betterref-longpage'),
    chromeHandoffRequestPath: path.join(resolvedRunDir, 'chrome-handoff-request.json'),
    chromeHandoffPromptPath: path.join(resolvedRunDir, 'chrome-handoff-prompt.md'),
    runStatePath: path.join(resolvedRunDir, 'run-state.json'),
    nextActionsPath: path.join(resolvedRunDir, 'next-actions.md'),
    finalSummaryPath: path.join(resolvedRunDir, 'final-summary.json')
  };
}

function pendingAssets(assetPlan) {
  const assets = asArray(assetPlan.assets).filter((asset) => !isThreeDModelAsset(asset));
  return {
    imagegen: assets.filter((asset) => !isHyperframesAsset(asset) && !isPassStatus(asset.status || asset.state || asset.result)),
    hyperframes: assets.filter((asset) => isHyperframesAsset(asset) && !isPassStatus(asset.status || asset.state || asset.result))
  };
}

function hasThreeDRequirement({ summary, assetPlan }) {
  return Boolean(summary.threeDRequired) ||
    Boolean(assetPlan.threeDRequired) ||
    asArray(assetPlan.assets).some(isThreeDModelAsset);
}

function blockerPhase(blockers) {
  return blockers.some((item) => item.code === 'blocked_external_3d_generation') ? '3d' : 'assets';
}

function normalizeProjectPath(value, projectRoot) {
  if (!value) return '';
  const raw = String(value).replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
  if (!projectRoot) return raw;
  const resolved = path.isAbsolute(String(value)) ? path.resolve(String(value)) : path.resolve(projectRoot, String(value));
  const relative = path.relative(projectRoot, resolved).replace(/\\/g, '/').toLowerCase();
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    return relative;
  }
  return raw;
}

function sameTargetPath(left, right, projectRoot) {
  const a = normalizeProjectPath(left, projectRoot);
  const b = normalizeProjectPath(right, projectRoot);
  return Boolean(a && b && (a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`)));
}

function matchingVerdictAsset(assets, required, projectRoot) {
  return assets.find((asset) => {
    if (asset.id && required.id && asset.id === required.id) return true;
    return sameTargetPath(asset.targetPath || asset.modelPath, required.targetPath, projectRoot);
  });
}

function isHunyuanPlanAsset(asset) {
  return String(asset?.provider || '').toLowerCase() === 'hunyuan' ||
    String(asset?.tool || '').toLowerCase().includes('hunyuan') ||
    String(asset?.implementation || '').toLowerCase().includes('hunyuan');
}

async function hasNonEmptyFile(filePath, projectRoot) {
  if (!filePath) return false;
  const resolved = path.isAbsolute(String(filePath)) ? String(filePath) : path.resolve(projectRoot || process.cwd(), String(filePath));
  try {
    const buffer = await readFile(resolved);
    return buffer.length > 0;
  } catch {
    return false;
  }
}

async function isStrictPassing3DAsset(asset, required, projectRoot) {
  if (!asset || typeof asset !== 'object' || asset.passed !== true) return false;
  if (required?.targetPath && !sameTargetPath(asset.targetPath, required.targetPath, projectRoot)) return false;
  if (required?.targetPath && !(await hasNonEmptyFile(required.targetPath, projectRoot))) return false;
  if (asset.targetPathExists === false) return false;
  if (!isPassStatus(asset.status)) return false;
  if (!asset.modelPath || asset.modelExists !== true) return false;
  if (!(await hasNonEmptyFile(asset.modelPath, projectRoot))) return false;
  if (asset.meshStatsPresent !== true) return false;
  if (asset.renderEvidencePresent !== true) return false;
  if (asset.materialEvidenceRequired === true && asset.materialEvidencePresent !== true) return false;
  const hunyuanRequired = isHunyuanPlanAsset(required || asset) || asset.hunyuanMetadataRequired === true;
  if (hunyuanRequired && asset.signedTencentGlobalApiPresent !== true) return false;
  if (hunyuanRequired && asset.requestMetadataPresent !== true) return false;
  if (hunyuanRequired && asset.responseMetadataPresent !== true) return false;
  return asArray(asset.failures).length === 0;
}

async function isPassingThreeDVerdict(
  verdict,
  { plan, projectRoot, evidencePath, hunyuanRequestPath, hunyuanResponsePath } = {}
) {
  if (!verdict || typeof verdict !== 'object' || Array.isArray(verdict)) return false;
  if (verdict.schemaVersion !== 'betterref.3d.verdict.v1') return false;
  if (verdict.passed !== true || verdict.verdict !== 'pass') return false;
  if (verdict.hardFailPresent || verdict.hard_fail_present || asArray(verdict.blockingReasons).length > 0) return false;

  const assets = asArray(verdict.assets);
  if (assets.length === 0) return false;
  const requiredAssets = asArray(plan?.assets);
  if (evidencePath && !(await fileExists(evidencePath))) return false;
  if (!evidencePath) return false;
  if (hunyuanRequestPath && !(await fileExists(hunyuanRequestPath))) return false;
  if (requiredAssets.some(isHunyuanPlanAsset) && (!hunyuanResponsePath || !(await fileExists(hunyuanResponsePath)))) {
    return false;
  }

  for (const required of requiredAssets) {
    const asset = matchingVerdictAsset(assets, required, projectRoot);
    if (!(await isStrictPassing3DAsset(asset, required, projectRoot))) {
      return false;
    }
  }

  for (const asset of assets) {
    if (!(await isStrictPassing3DAsset(asset, null, projectRoot))) {
      return false;
    }
  }
  return true;
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
    lines.push(`Use built-in image_gen for requests in \`${result.artifacts.imagegenQueuePath}\`, save outputs to the generated slots, then attach them.`);
    if (result.artifacts.imagegenHandoffRequestPath) {
      lines.push(`Imagegen handoff request: \`${result.artifacts.imagegenHandoffRequestPath}\``);
    }
    if (result.artifacts.imagegenHandoffPromptPath) {
      lines.push(`Imagegen handoff prompt: \`${result.artifacts.imagegenHandoffPromptPath}\``);
    }
    if (result.artifacts.imagegenStatusPath) {
      lines.push(`Imagegen status: \`${result.artifacts.imagegenStatusPath}\``);
    }
    lines.push('');
    lines.push('```bash');
    lines.push(`betterref-imagegen --asset-plan ${result.artifacts.assetPlanPath} --auto-attach-dir ${result.artifacts.imagegenGeneratedDir || '.betterref-imagegen/generated'} --project ${result.inputs.project} --json`);
    lines.push('```');
    lines.push('');
    lines.push('After attach, wire the target asset path into the app and recapture browser evidence. A generated file alone is not a pass.');
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

  if (result.artifacts.threeDPlanPath) {
    lines.push('## Hunyuan 3D handoff');
    lines.push('');
    lines.push('Generate the model through signed Tencent HY 3D Global API, record request metadata and ResultFile3Ds, then attach mesh and turntable evidence before browser verification.');
    lines.push('');
    lines.push(`3D asset plan: \`${result.artifacts.threeDPlanPath}\``);
    if (result.artifacts.hunyuanRequestPath) {
      lines.push(`Hunyuan request: \`${result.artifacts.hunyuanRequestPath}\``);
    }
    if (result.artifacts.hunyuanResponsePath) {
      lines.push(`Hunyuan response metadata: \`${result.artifacts.hunyuanResponsePath}\``);
    }
    if (result.artifacts.threeDVerdictPath) {
      lines.push(`3D verdict: \`${result.artifacts.threeDVerdictPath}\``);
    }
    if (result.artifacts.agentMergePath) {
      lines.push(`Agent merge: \`${result.artifacts.agentMergePath}\``);
      lines.push(`Inspect visible agent status: \`betterref-agents --status --out ${result.artifacts.agentsOut || path.dirname(result.artifacts.agentMergePath)} --json\``);
    }
    lines.push('');
    lines.push('```bash');
    if (result.artifacts.agentsOut) {
      lines.push(`betterref-agents --status --out ${result.artifacts.agentsOut} --json`);
    }
    lines.push(`betterref-reference --ref ${result.inputs.reference} --out ${result.artifacts.referenceOut || '.betterref-reference'} --target ui,3d,hunyuan --json`);
    lines.push(`betterref-3d --make-plan --analysis ${path.join(result.artifacts.referenceOut || '.betterref-reference', 'reference-analysis.json')} --asset-plan ${result.artifacts.assetPlanPath || '.betterref-prd/asset-plan.json'} --out ${result.artifacts.threeDOut || path.dirname(result.artifacts.threeDPlanPath)} --format glb --json`);
    lines.push(`betterref-3d --make-hunyuan-request --plan ${result.artifacts.threeDPlanPath} --out ${result.artifacts.threeDOut || path.dirname(result.artifacts.threeDPlanPath)} --provider tencent --tencent-endpoint hunyuan.intl.tencentcloudapi.com --tencent-region ap-singapore --tencent-edition rapid --result-format GLB --enable-pbr true --json`);
    lines.push('If Tencent env vars are absent on this workstation, use Blender MCP panel Hunyuan official API credentials to submit the same signed Global request directly; do not use Blender MCP legacy/domestic generation as the final source.');
    lines.push(`betterref-3d --verify --plan ${result.artifacts.threeDPlanPath} --evidence ${result.artifacts.threeDEvidencePath || path.join(path.dirname(result.artifacts.threeDPlanPath), '3d-evidence.json')} --hunyuan-request ${result.artifacts.hunyuanRequestPath || path.join(path.dirname(result.artifacts.threeDPlanPath), 'hunyuan-request.json')} --hunyuan-response ${result.artifacts.hunyuanResponsePath || path.join(path.dirname(result.artifacts.threeDPlanPath), 'hunyuan-response.json')} --project ${result.inputs.project} --out ${result.artifacts.threeDOut || path.dirname(result.artifacts.threeDPlanPath)} --json`);
    lines.push('```');
    lines.push('');
  }

  if (result.phase === 'browser') {
    lines.push('## Browser evidence handoff');
    lines.push('');
    lines.push('Use @chrome when connected, provide a Chrome handoff JSON, or expose Chrome DevTools Protocol and rerun with --endpoint.');
    if (result.artifacts.chromeHandoffRequestPath) {
      lines.push('');
      lines.push(`Chrome handoff request: \`${result.artifacts.chromeHandoffRequestPath}\``);
    }
    if (result.artifacts.chromeHandoffPromptPath) {
      lines.push(`Chrome handoff prompt: \`${result.artifacts.chromeHandoffPromptPath}\``);
    }
    lines.push('');
    lines.push('```bash');
    lines.push(`betterref-chrome --endpoint http://127.0.0.1:9222 --url-match ${result.inputs.url || '<target-url>'} --out ${result.artifacts.browserOut} --full-page --section-screenshots --ref ${result.inputs.reference} --regions both --html`);
    lines.push('```');
    lines.push('');
    lines.push('After @chrome writes `.betterref-run/chrome-handoff.json`, rerun with `--browser-handoff .betterref-run/chrome-handoff.json`.');
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
      endpoint: options.endpoint || null,
      browserHandoff: options.browserHandoffPath ? path.resolve(options.browserHandoffPath) : null
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

function renderChromeHandoffRequest({ options, paths, prdArtifacts }) {
  return {
    schemaVersion: 'betterref.chrome.handoff.request.v1',
    generatedAt: new Date().toISOString(),
    sourceOrder: ['@chrome', 'Chrome MCP', 'Chrome CDP', 'Playwright'],
    target: {
      url: options.url || null,
      project: paths.projectRoot,
      reference: path.resolve(options.referencePath),
      prdChecklistPath: prdArtifacts.prdChecklistPath || null
    },
    required: {
      screenshots: {
        viewport: 'Required. Native viewport screenshot from the real Chrome tab.',
        fullPage: 'Required for long-page references; recommended for all PRD-to-web runs.',
        sections: 'Recommended. Named section screenshots for header/hero/content/footer evidence.'
      },
      metadata: [
        'viewport width/height/deviceScaleFactor',
        'page url/title/scrollHeight/bodyTextLength/interactiveCount',
        'fonts readiness',
        'console entries',
        'network errors',
        'images natural/rendered sizes',
        'videos rendered sizes',
        'DOM elements and bounding boxes'
      ]
    },
    output: {
      expectedPath: path.join(paths.runDir, 'chrome-handoff.json'),
      rerunCommand: `betterref-run --pdf ${path.resolve(options.pdfPath)} --project ${paths.projectRoot} --ref ${path.resolve(options.referencePath)} --url ${options.url || '<target-url>'} --browser-handoff ${path.join(paths.runDir, 'chrome-handoff.json')} --json`
    },
    example: {
      source: { tool: '@chrome' },
      screenshots: {
        viewport: 'chrome-viewport.png',
        fullPage: 'chrome-full-page.png',
        sections: [
          { name: 'hero', selector: '[data-betterref="hero"]', path: 'sections/hero.png' }
        ]
      },
      viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
      page: {
        url: options.url || 'http://127.0.0.1:3000/',
        title: 'App',
        scrollHeight: 1600,
        bodyTextLength: 1000,
        interactiveCount: 8
      },
      fonts: { ready: true, status: 'loaded' },
      console: [],
      network: { errors: [] },
      images: [],
      videos: [],
      elements: [
        { name: 'hero', selector: '[data-betterref="hero"]', boundingBox: { x: 0, y: 80, width: 1440, height: 520 } }
      ]
    }
  };
}

function renderChromeHandoffPrompt(request) {
  return `# BetterRef Chrome Handoff Prompt

Use the connected @chrome plugin or Chrome MCP against the real browser tab for:

- URL: ${request.target.url || '<target-url>'}
- Project: ${request.target.project}
- Reference: ${request.target.reference}

Capture and save:

- native viewport screenshot
- full-page screenshot when the page scrolls or the reference is a long-page reference
- section screenshots for meaningful UI sections when selectors are available
- viewport, page URL/title, scroll height, body text length, interactive count
- font readiness, console entries, network failures
- image/video natural and rendered sizes
- DOM boxes for named sections/components

Write the result as JSON at:

\`${request.output.expectedPath}\`

The handoff must include real screenshot file paths. Relative screenshot paths are resolved from the handoff JSON directory. Metadata-only evidence is a hard fail.

Then rerun:

\`\`\`bash
${request.output.rerunCommand}
\`\`\`
`;
}

async function writeChromeHandoffArtifacts({ options, paths, artifacts, prdArtifacts }) {
  const request = renderChromeHandoffRequest({ options, paths, prdArtifacts });
  await mkdir(paths.runDir, { recursive: true });
  await writeFile(paths.chromeHandoffRequestPath, `${JSON.stringify(request, null, 2)}\n`);
  await writeFile(paths.chromeHandoffPromptPath, renderChromeHandoffPrompt(request));
  artifacts.chromeHandoffRequestPath = paths.chromeHandoffRequestPath;
  artifacts.chromeHandoffPromptPath = paths.chromeHandoffPromptPath;
  return request;
}

async function writeThreeDHandoffArtifacts({ options, paths, artifacts }) {
  const reference = await analyzeReference({
    referencePath: options.referencePath,
    outDir: paths.referenceOut,
    target: 'ui,3d,hunyuan'
  });
  const plan = await make3DAssetPlan({
    analysisPath: reference.artifacts.analysisPath,
    outDir: paths.threeDOut,
    format: 'glb',
    assetPlanPath: artifacts.assetPlanPath
  });
  const request = await makeHunyuanRequest({
    planPath: plan.artifacts.planPath,
    outDir: paths.threeDOut,
    provider: 'tencent',
    tencentEndpoint: 'hunyuan.intl.tencentcloudapi.com',
    tencentRegion: 'ap-singapore',
    tencentEdition: 'rapid',
    resultFormat: 'GLB',
    enablePBR: true
  });
  const responsePath = (await fileExists(paths.hunyuanResponsePath)) ? paths.hunyuanResponsePath : undefined;
  let verdict = await readOptionalJson(paths.threeDVerdictPath, '3D verdict');
  const existingPassed = await isPassingThreeDVerdict(verdict, {
    plan: plan.plan,
    projectRoot: paths.projectRoot,
    evidencePath: paths.threeDEvidencePath,
    hunyuanRequestPath: request.artifacts.requestPath,
    hunyuanResponsePath: responsePath
  });
  if (!existingPassed) {
    verdict = await verify3D({
      planPath: plan.artifacts.planPath,
      evidencePath: (await fileExists(paths.threeDEvidencePath)) ? paths.threeDEvidencePath : undefined,
      outDir: paths.threeDOut,
      projectDir: paths.projectRoot,
      hunyuanRequestPath: request.artifacts.requestPath,
      hunyuanResponsePath: responsePath
    });
  }
  const passed = await isPassingThreeDVerdict(verdict, {
    plan: plan.plan,
    projectRoot: paths.projectRoot,
    evidencePath: paths.threeDEvidencePath,
    hunyuanRequestPath: request.artifacts.requestPath,
    hunyuanResponsePath: responsePath
  });

  Object.assign(artifacts, {
    referenceOut: paths.referenceOut,
    referenceAnalysisPath: reference.artifacts.analysisPath,
    threeDOut: paths.threeDOut,
    threeDPlanPath: plan.artifacts.planPath,
    hunyuanRequestPath: request.artifacts.requestPath,
    hunyuanResponsePath: paths.hunyuanResponsePath,
    threeDEvidencePath: paths.threeDEvidencePath,
    threeDVerdictPath: paths.threeDVerdictPath
  });

  return { reference, plan, request, verdict, passed };
}

async function writeAgentArtifacts({ options, paths, artifacts, task }) {
  const agents = await runAgentWorkflow({
    task,
    outDir: paths.agentsOut,
    projectDir: paths.projectRoot,
    assetId: 'model-001',
    runtimeMode: 'structured',
    inputs: [
      options.pdfPath,
      options.referencePath,
      artifacts.assetPlanPath,
      artifacts.threeDPlanPath,
      artifacts.hunyuanRequestPath,
      artifacts.threeDVerdictPath
    ].filter(Boolean)
  });
  Object.assign(artifacts, {
    agentsOut: paths.agentsOut,
    agentSupervisorPacketPath: agents.artifacts.supervisorPacketPath,
    agentRunLogPath: agents.artifacts.runLogPath,
    agentReportsDir: agents.artifacts.reportsDir,
    agentMergePath: agents.artifacts.supervisorMergePath
  });
  return agents;
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
  let assetPlan = await readJson(prd.artifacts.assetPlanPath, 'asset plan');
  const blockers = [];
  const threeDRequired = hasThreeDRequirement({ summary, assetPlan });
  if (threeDRequired) {
    const handoff = await writeThreeDHandoffArtifacts({ options, paths, artifacts });
    const agentTask = [
      'PRD PDF reference pack Tencent Hunyuan 3D Roblox asset evidence.',
      summary.summary || '',
      handoff.plan?.plan?.assets?.map((asset) => asset.requirement || asset.targetPath || asset.id).join(' ') || ''
    ].join(' ');
    const agents = await writeAgentArtifacts({ options, paths, artifacts, task: agentTask });
    steps.push({
      name: '3d-handoff',
      status: handoff.passed ? 'completed' : 'blocked',
      assets: handoff.plan.plan.assets.length,
      providers: handoff.request.providers,
      artifacts: {
        referenceAnalysisPath: artifacts.referenceAnalysisPath,
        threeDPlanPath: artifacts.threeDPlanPath,
        hunyuanRequestPath: artifacts.hunyuanRequestPath,
        hunyuanResponsePath: artifacts.hunyuanResponsePath,
        threeDVerdictPath: artifacts.threeDVerdictPath,
        agentMergePath: artifacts.agentMergePath
      }
    });
    steps.push({
      name: 'agent-team',
      status: agents.merge.passed ? 'completed' : 'blocked',
      artifacts: {
        agentSupervisorPacketPath: artifacts.agentSupervisorPacketPath,
        agentRunLogPath: artifacts.agentRunLogPath,
        agentReportsDir: artifacts.agentReportsDir,
        agentMergePath: artifacts.agentMergePath
      }
    });
    if (!handoff.passed) {
      blockers.push({
        code: 'blocked_external_3d_generation',
        message: 'A Hunyuan 3D model is required. Generate it through Tencent HY 3D Global Rapid, record response metadata, attach mesh/render evidence, and rerun 3D verification before browser verification can pass.',
        nextAction: [
          `betterref-agents --status --out ${paths.agentsOut} --json`,
          `betterref-reference --ref ${path.resolve(options.referencePath)} --out ${paths.referenceOut} --target ui,3d,hunyuan --json`,
          `betterref-3d --make-plan --analysis ${path.join(paths.referenceOut, 'reference-analysis.json')} --asset-plan ${prd.artifacts.assetPlanPath} --out ${paths.threeDOut} --format glb --json`,
          `betterref-3d --make-hunyuan-request --plan ${paths.threeDPlanPath} --out ${paths.threeDOut} --provider tencent --tencent-endpoint hunyuan.intl.tencentcloudapi.com --tencent-region ap-singapore --tencent-edition rapid --result-format GLB --enable-pbr true --json`,
          `betterref-3d --verify --plan ${paths.threeDPlanPath} --evidence ${paths.threeDEvidencePath} --hunyuan-request ${paths.hunyuanRequestPath} --hunyuan-response ${paths.hunyuanResponsePath} --project ${paths.projectRoot} --out ${paths.threeDOut} --json`
        ].join('\n')
      });
    }
  }
  let autoAttachError = null;
  const firstPending = pendingAssets(assetPlan);
  if (firstPending.imagegen.length > 0) {
    try {
      const autoAttach = await autoAttachAvailableGeneratedAssets({
        assetPlanPath: prd.artifacts.assetPlanPath,
        autoAttachDir: paths.imagegenGeneratedDir,
        projectDir: paths.projectRoot
      });
      if (autoAttach.attached.length > 0) {
        artifacts.imagegenAutoAttach = autoAttach;
        steps.push({ name: 'imagegen-auto-attach', status: 'completed', attached: autoAttach.attached.length });
        assetPlan = await readJson(prd.artifacts.assetPlanPath, 'asset plan');
      }
    } catch (error) {
      autoAttachError = error;
    }
  }
  const pending = pendingAssets(assetPlan);

  if (pending.imagegen.length > 0 || autoAttachError) {
    const handoff = await buildImagegenHandoff({
      assetPlanPath: prd.artifacts.assetPlanPath,
      outDir: paths.imagegenOut,
      requestOutPath: paths.imagegenHandoffRequestPath,
      promptOutPath: paths.imagegenHandoffPromptPath,
      projectDir: paths.projectRoot
    });
    const queue = handoff.queue;
    artifacts.imagegenQueuePath = path.join(paths.imagegenOut, 'imagegen-requests.json');
    artifacts.imagegenGeneratedDir = paths.imagegenGeneratedDir;
    artifacts.imagegenStatusPath = paths.imagegenStatusPath;
    artifacts.imagegenHandoffRequestPath = paths.imagegenHandoffRequestPath;
    artifacts.imagegenHandoffPromptPath = paths.imagegenHandoffPromptPath;
    steps.push({
      name: 'imagegen-queue',
      status: 'blocked',
      requests: queue.requests.length,
      statusCounts: handoff.status.counts
    });
    blockers.push({
      code: 'blocked_external_asset_generation',
      message: autoAttachError
        ? `Imagegen output was found but could not be attached: ${autoAttachError.message}`
        : `${queue.requests.length} imagegen asset request(s) must be generated with built-in image_gen into ${paths.imagegenGeneratedDir} and attached before verification can pass.`,
      nextAction: `betterref-imagegen --asset-plan ${prd.artifacts.assetPlanPath} --auto-attach-dir ${paths.imagegenGeneratedDir} --project ${paths.projectRoot} --json`
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
    return finish({ options, paths, artifacts, steps, status: 'blocked', phase: blockerPhase(blockers), exitCode: 3, blockers });
  }

  if (!options.endpoint && !options.browserHandoffPath) {
    await writeChromeHandoffArtifacts({ options, paths, artifacts, prdArtifacts: prd.artifacts });
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
        message: 'No Chrome/CDP endpoint or Chrome handoff was provided. Use @chrome/Chrome MCP to create the handoff, or rerun with --endpoint to capture browser evidence.',
        nextAction: `betterref-run --pdf ${path.resolve(options.pdfPath)} --project ${paths.projectRoot} --ref ${path.resolve(options.referencePath)} --url ${options.url || '<target-url>'} --browser-handoff ${path.join(paths.runDir, 'chrome-handoff.json')} --json`
      }]
    });
  }

  let chrome;
  if (options.browserHandoffPath) {
    try {
      const bridged = await bridgeChromeHandoff({
        inputPath: options.browserHandoffPath,
        outDir: paths.browserOut,
        configOutPath: path.join(paths.browserOut, '.betterref.json'),
        mergeConfigPath: paths.configOut,
        matchSize: 'strict'
      });
      const diff = await compareImages({
        referencePath: options.referencePath,
        actualPath: bridged.screenshotPath,
        outDir: paths.browserOut,
        configPath: bridged.configPath,
        regionMode: 'both',
        html: options.html !== false,
        matchSize: 'strict'
      });
      chrome = {
        schemaVersion: 'betterref.run.browser_handoff.v1',
        source: bridged.source,
        artifacts: {
          screenshotPath: bridged.screenshotPath,
          fullPageScreenshotPath: bridged.fullPageScreenshotPath,
          sectionScreenshotPaths: bridged.sectionScreenshotPaths,
          browserEvidencePath: bridged.browserEvidencePath,
          domBoxesPath: bridged.domBoxesPath,
          configPath: bridged.configPath,
          reportPath: diff.artifacts.reportPath,
          htmlPath: diff.artifacts.htmlPath
        },
        diff
      };
    } catch (error) {
      await writeChromeHandoffArtifacts({ options, paths, artifacts, prdArtifacts: prd.artifacts });
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
          message: `Chrome handoff could not be used: ${error.message}`,
          nextAction: `Regenerate ${options.browserHandoffPath} with real @chrome screenshots, then rerun betterref-run with --browser-handoff ${options.browserHandoffPath}.`
        }]
      });
    }
  } else {
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
      await writeChromeHandoffArtifacts({ options, paths, artifacts, prdArtifacts: prd.artifacts });
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
  }

  if (summary.longReference && !chrome.artifacts.fullPageScreenshotPath) {
    await writeChromeHandoffArtifacts({ options, paths, artifacts, prdArtifacts: prd.artifacts });
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
        message: 'Long-page PRD/reference verification requires a real full-page Chrome screenshot in the handoff.',
        nextAction: `Regenerate the Chrome handoff with screenshots.fullPage, then rerun betterref-run --browser-handoff ${options.browserHandoffPath || path.join(paths.runDir, 'chrome-handoff.json')}.`
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
  if (threeDRequired) {
    required.push('3d');
    required.push('agents');
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
    threeDPath: threeDRequired ? paths.threeDVerdictPath : undefined,
    agentMergePath: threeDRequired ? artifacts.agentMergePath : undefined,
    projectDir: paths.projectRoot,
    outPath: finalVerdictPath,
    htmlPath: finalHtmlPath,
    bundlePath: evidenceBundlePath,
    requiredEvidence: required.join(',')
  });
  const finalBlockers = [];
  if (!finalVerdict.passed && finalVerdict.blockingReasons?.some((item) => /not rendered in browser evidence/i.test(item))) {
    finalBlockers.push({
      code: 'blocked_generated_asset_not_rendered',
      message: 'A generated/source asset is attached but fresh browser evidence does not render it.',
      nextAction: 'Wire the asset targetPath into the app UI, recapture browser evidence, then rerun betterref-run.'
    });
  }
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
    blockers: finalBlockers,
    finalVerdict
  });
}
