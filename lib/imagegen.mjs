import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export class BetterRefImagegenError extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.name = 'BetterRefImagegenError';
    this.exitCode = exitCode;
  }
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new BetterRefImagegenError(`Could not read ${label} ${filePath}: ${error.message}`);
  }
}

function asArray(value) {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function isPassStatus(value) {
  return ['pass', 'passed', 'done', 'complete', 'completed', 'ok'].includes(String(value || '').trim().toLowerCase());
}

function isHyperframesAsset(asset) {
  return (
    String(asset.tool || '').toLowerCase() === 'hyperframes' ||
    String(asset.implementation || '').toLowerCase().includes('hyperframes') ||
    asset.hyperframesRequired === true
  );
}

function pendingAssets(plan) {
  return asArray(plan.assets).filter((asset) => !isHyperframesAsset(asset) && !isPassStatus(asset.status || asset.state || asset.result));
}

function toPosix(value) {
  return String(value || '').replace(/\\/g, '/');
}

function assetId(asset, index) {
  return asset.id || `asset-${String(index + 1).padStart(3, '0')}`;
}

function generatedDir(outDir) {
  return path.join(outDir, 'generated');
}

function outputSlotFor({ id, outDir }) {
  return path.join(generatedDir(outDir), `${id}.png`);
}

function attachCommandFor({ assetPlanPath, id, outputSlot, projectDir }) {
  return `betterref-imagegen --asset-plan ${path.resolve(assetPlanPath)} --attach ${id}=${outputSlot} --project ${projectDir ? path.resolve(projectDir) : '.'} --json`;
}

function autoAttachCommandFor({ assetPlanPath, outDir, projectDir }) {
  return `betterref-imagegen --asset-plan ${path.resolve(assetPlanPath)} --auto-attach-dir ${generatedDir(outDir)} --project ${projectDir ? path.resolve(projectDir) : '.'} --json`;
}

function normalizeBrowserPath(value) {
  if (!value) {
    return null;
  }
  let result = toPosix(value).replace(/^\/+/, '');
  if (result.startsWith('public/')) {
    result = result.slice('public/'.length);
  }
  return result || null;
}

function publicUrlCandidates(targetPath) {
  const normalized = normalizeBrowserPath(targetPath);
  if (!normalized) {
    return [];
  }
  return [
    `/${normalized}`,
    normalized,
    `/_next/image?url=${encodeURIComponent(`/${normalized}`)}`
  ];
}

function renderBuiltInPrompt(asset) {
  return [
    'Use case: stylized-concept',
    `Asset type: BetterRef project asset for ${asset.targetPath || 'project asset'}`,
    `Primary request: ${asset.prompt || asset.requirement || asset.role || 'Generate the required production raster asset.'}`,
    'Style/medium: premium production bitmap asset suitable for a polished web UI',
    `Composition/framing: satisfy the asset role ${asset.role || 'raster-asset'} with clean usable edges and enough safe area for code-native UI overlays`,
    `Target minimum native size: ${asset.minNativeWidth || 'project-required'}x${asset.minNativeHeight || 'project-required'}`,
    'Constraints: Use the built-in image_gen tool. Do not include browser chrome, UI text blocks, screenshots, PDF renders, watermarks, reference-image borders, or baked-in buttons/cards.',
    'Avoid: blurry output, low-resolution scaling, fake UI screenshots, in-image navigation, in-image body copy, visible bitmap boxes, and unintended logos.',
    'Post-generation: move or copy the selected output into the targetPath in the project, then run betterref-imagegen --attach to verify and mark the asset pass.'
  ].join('\n');
}

function renderPromptsMarkdown(queue) {
  const sections = queue.requests.map((request) => {
    return `## ${request.id}

- Tool: built-in \`image_gen\`
- Role: ${request.role || 'n/a'}
- Phase: ${request.phase || 'n/a'}
- Target path: \`${request.targetPath}\`
- Output slot: \`${request.outputSlot}\`
- Minimum native size: ${request.minNativeWidth || 'n/a'}x${request.minNativeHeight || 'n/a'}
- Minimum sharpness: ${request.minSharpness || 'n/a'}
- Attach command: \`${request.attachCommand}\`
${request.acceptanceCriteria?.length ? `- Acceptance criteria:\n${request.acceptanceCriteria.map((item) => `  - ${item}`).join('\n')}\n` : ''}

\`\`\`text
${request.prompt}
\`\`\`
`;
  });

  return `# BetterRef Imagegen Requests

Use the built-in \`image_gen\` tool for every request below. Do not leave project assets under \`$CODEX_HOME\`; after generation, copy the selected output into the listed output slot, then attach it with \`betterref-imagegen --auto-attach-dir ${generatedDir(queue.outDir)} --project . --json\` or the per-asset attach command.

${sections.join('\n')}
`;
}

export async function buildImagegenQueue(options) {
  if (!options.assetPlanPath) {
    throw new BetterRefImagegenError('Missing --asset-plan.');
  }
  if (!options.outDir) {
    throw new BetterRefImagegenError('Missing --out for imagegen request output.');
  }

  const plan = await readJson(options.assetPlanPath, 'asset plan');
  const requests = pendingAssets(plan).map((asset, index) => {
    const id = assetId(asset, index);
    const outputSlot = outputSlotFor({ id, outDir: options.outDir });
    const targetPath = asset.targetPath || `public/betterref-assets/${id}.png`;
    return {
      id,
      tool: 'image_gen',
      mode: 'built-in',
      role: asset.role || null,
      phase: asset.phase || null,
      requirement: asset.requirement || null,
      targetPath,
      outputSlot,
      attachCommand: attachCommandFor({
        assetPlanPath: options.assetPlanPath,
        id,
        outputSlot,
        projectDir: options.projectDir
      }),
      autoAttachCommand: autoAttachCommandFor({
        assetPlanPath: options.assetPlanPath,
        outDir: options.outDir,
        projectDir: options.projectDir
      }),
      wireIntoAppReminder: `After attach, wire ${targetPath} into the actual app and recapture browser evidence. A generated file alone is not a pass.`,
      publicUrlCandidates: publicUrlCandidates(targetPath),
      minNativeWidth: asset.minNativeWidth || null,
      minNativeHeight: asset.minNativeHeight || null,
      minSharpness: asset.minSharpness || null,
      acceptanceCriteria: asArray(asset.acceptanceCriteria),
      prompt: renderBuiltInPrompt({ ...asset, id })
    };
  });

  const queue = {
    schemaVersion: 'betterref.imagegen.queue.v1',
    generatedAt: new Date().toISOString(),
    assetPlanPath: path.resolve(options.assetPlanPath),
    outDir: path.resolve(options.outDir),
    generatedDir: generatedDir(options.outDir),
    requests
  };

  await mkdir(options.outDir, { recursive: true });
  await mkdir(generatedDir(options.outDir), { recursive: true });
  await writeFile(path.join(options.outDir, 'imagegen-requests.json'), `${JSON.stringify(queue, null, 2)}\n`);
  await writeFile(path.join(options.outDir, 'imagegen-prompts.md'), renderPromptsMarkdown(queue));
  return queue;
}

function parseAttachment(value) {
  const [id, ...rest] = String(value || '').split('=');
  const filePath = rest.join('=');
  if (!id || !filePath) {
    throw new BetterRefImagegenError(`Invalid --attach value: ${value}`);
  }
  return { id, filePath };
}

async function measureSharpness(filePath) {
  const { data, info } = await sharp(filePath).greyscale().raw().toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;
  if (!width || !height || width < 2 || height < 2) {
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

function resolveTargetPath({ targetPath, projectDir }) {
  if (!targetPath) {
    throw new BetterRefImagegenError('Asset is missing targetPath.');
  }
  if (path.isAbsolute(targetPath)) {
    return targetPath;
  }
  return path.resolve(projectDir || process.cwd(), targetPath);
}

export async function attachGeneratedAssets(options) {
  if (!options.assetPlanPath) {
    throw new BetterRefImagegenError('Missing --asset-plan.');
  }
  const attachments = asArray(options.attach).map(parseAttachment);
  if (attachments.length === 0) {
    throw new BetterRefImagegenError('Missing --attach.');
  }

  const plan = await readJson(options.assetPlanPath, 'asset plan');
  const assets = asArray(plan.assets);
  const attached = [];

  for (const attachment of attachments) {
    const asset = assets.find((item) => item.id === attachment.id);
    if (!asset) {
      throw new BetterRefImagegenError(`Asset ${attachment.id} was not found in the asset plan.`);
    }

    const sourcePath = path.resolve(attachment.filePath);
    const metadata = await sharp(sourcePath).metadata();
    const nativeWidth = metadata.width || 0;
    const nativeHeight = metadata.height || 0;
    if (asset.minNativeWidth && nativeWidth < asset.minNativeWidth) {
      throw new BetterRefImagegenError(`Asset ${attachment.id} width ${nativeWidth} is below ${asset.minNativeWidth}.`, 1);
    }
    if (asset.minNativeHeight && nativeHeight < asset.minNativeHeight) {
      throw new BetterRefImagegenError(`Asset ${attachment.id} height ${nativeHeight} is below ${asset.minNativeHeight}.`, 1);
    }

    const measuredSharpness = Number((await measureSharpness(sourcePath)).toFixed(2));
    if (asset.minSharpness && measuredSharpness < asset.minSharpness) {
      throw new BetterRefImagegenError(
        `Asset ${attachment.id} sharpness ${measuredSharpness} is below ${asset.minSharpness}.`,
        1
      );
    }

    const targetPath = resolveTargetPath({ targetPath: asset.targetPath, projectDir: options.projectDir });
    await mkdir(path.dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);

    asset.status = 'pass';
    asset.generatedPath = path.relative(options.projectDir || process.cwd(), targetPath).replace(/\\/g, '/');
    asset.sourcePath = sourcePath;
    asset.nativeWidth = nativeWidth;
    asset.nativeHeight = nativeHeight;
    asset.measuredSharpness = measuredSharpness;
    asset.verifiedAt = new Date().toISOString();
    asset.verification = 'betterref-imagegen attach';

    attached.push({
      id: attachment.id,
      targetPath: asset.generatedPath,
      nativeWidth,
      nativeHeight,
      measuredSharpness
    });
  }

  plan.assets = assets;
  await writeFile(options.assetPlanPath, `${JSON.stringify(plan, null, 2)}\n`);

  return {
    schemaVersion: 'betterref.imagegen.attach.v1',
    generatedAt: new Date().toISOString(),
    assetPlanPath: path.resolve(options.assetPlanPath),
    attached
  };
}

async function findGeneratedAssetFile(directory, id) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
  const candidates = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => {
      const lower = name.toLowerCase();
      return (
        lower === `${id.toLowerCase()}.png` ||
        lower === `${id.toLowerCase()}.jpg` ||
        lower === `${id.toLowerCase()}.jpeg` ||
        lower === `${id.toLowerCase()}.webp` ||
        lower === `${id.toLowerCase()}.avif` ||
        lower.startsWith(`${id.toLowerCase()}-`) ||
        lower.startsWith(`${id.toLowerCase()}_`)
      );
    })
    .sort();
  return candidates[0] ? path.join(directory, candidates[0]) : null;
}

async function fileExists(filePath) {
  if (!filePath) {
    return false;
  }
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function assetEvidencePath(asset) {
  return asset.generatedPath || asset.projectPath || asset.localPath || asset.path || asset.file;
}

function resolveProjectPath(filePath, projectDir) {
  if (!filePath) {
    return null;
  }
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  if (!projectDir) {
    return null;
  }
  return path.resolve(projectDir, filePath);
}

function renderedSourceValues(asset) {
  const values = [];
  for (const key of ['src', 'currentSrc', 'url', 'href', 'backgroundImage', 'cssBackgroundImage']) {
    if (asset?.[key]) {
      values.push(asset[key]);
      const pattern = /url\((['"]?)(.*?)\1\)/gi;
      let match;
      while ((match = pattern.exec(String(asset[key])))) {
        if (match[2]) {
          values.push(match[2]);
        }
      }
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
  if (!browserEvidence) {
    return null;
  }
  const expected = [
    asset.generatedPath,
    asset.targetPath,
    assetEvidencePath(asset),
    ...publicUrlCandidates(asset.targetPath)
  ].map(normalizeBrowserPath).filter(Boolean);
  if (expected.length === 0) {
    return true;
  }
  const actualPaths = renderedBrowserPaths(browserEvidence);
  return expected.some((expectedPath) => [...actualPaths].some((actualPath) => (
    actualPath === expectedPath ||
    actualPath.endsWith(`/${expectedPath}`) ||
    expectedPath.endsWith(`/${actualPath}`)
  )));
}

async function qualityFailure({ filePath, asset }) {
  if (!filePath || !(await fileExists(filePath))) {
    return null;
  }
  try {
    const metadata = await sharp(filePath).metadata();
    const width = Number(metadata.width || 0);
    const height = Number(metadata.height || 0);
    const minNativeWidth = Number(asset.minNativeWidth || 0);
    const minNativeHeight = Number(asset.minNativeHeight || 0);
    const minSharpness = Number(asset.minSharpness || 0);
    if (minNativeWidth && width < minNativeWidth) {
      return `width ${width} is below ${minNativeWidth}`;
    }
    if (minNativeHeight && height < minNativeHeight) {
      return `height ${height} is below ${minNativeHeight}`;
    }
    if (minSharpness) {
      const sharpness = Number((await measureSharpness(filePath)).toFixed(2));
      if (sharpness < minSharpness) {
        return `sharpness ${sharpness} is below ${minSharpness}`;
      }
    }
    return null;
  } catch (error) {
    return `asset file is unreadable: ${error.message}`;
  }
}

export async function analyzeImagegenStatus(options) {
  if (!options.assetPlanPath) {
    throw new BetterRefImagegenError('Missing --asset-plan.');
  }

  const plan = await readJson(options.assetPlanPath, 'asset plan');
  const browserEvidence = options.browserEvidencePath
    ? await readJson(options.browserEvidencePath, 'browser evidence')
    : null;
  const outDir = options.outDir || path.dirname(options.assetPlanPath);
  const generatedDirectory = options.generatedDir || generatedDir(outDir);
  const assets = asArray(plan.assets).filter((asset) => !isHyperframesAsset(asset));
  const items = [];
  const counts = {};

  for (const [index, asset] of assets.entries()) {
    const id = assetId(asset, index);
    const status = asset.status || asset.state || asset.result || 'pending';
    const generatedFile = await findGeneratedAssetFile(path.resolve(generatedDirectory), id);
    const projectFile = resolveProjectPath(assetEvidencePath(asset), options.projectDir);
    const fallbackProjectTarget = resolveProjectPath(asset.targetPath, options.projectDir);
    let state = 'pending';
    let message = 'asset has not been generated yet';
    const qualityPath = generatedFile || projectFile || fallbackProjectTarget;
    const qualityMessage = await qualityFailure({ filePath: qualityPath, asset });

    if (qualityMessage) {
      state = 'asset_quality_failed';
      message = qualityMessage;
    } else if (!isPassStatus(status) && generatedFile) {
      state = 'generated_not_attached';
      message = 'generated file exists in the output slot but has not been attached to the asset plan';
    } else if (isPassStatus(status)) {
      const rendered = assetRenderedInBrowser(asset, browserEvidence);
      if (rendered === false) {
        state = 'attached_not_rendered';
        message = 'asset is attached but fresh browser evidence does not render it';
      } else if (rendered === true) {
        state = 'pass';
        message = 'asset is attached and rendered in browser evidence';
      } else {
        state = 'attached_waiting_browser';
        message = 'asset is attached; browser evidence is still required before final pass';
      }
    }

    counts[state] = (counts[state] || 0) + 1;
    items.push({
      id,
      status: state,
      assetPlanStatus: status,
      role: asset.role || null,
      targetPath: asset.targetPath || null,
      outputSlot: outputSlotFor({ id, outDir }),
      generatedFile: generatedFile ? path.resolve(generatedFile) : null,
      projectFile: projectFile || fallbackProjectTarget || null,
      publicUrlCandidates: publicUrlCandidates(asset.targetPath),
      message
    });
  }

  const report = {
    schemaVersion: 'betterref.imagegen.status.v1',
    generatedAt: new Date().toISOString(),
    assetPlanPath: path.resolve(options.assetPlanPath),
    generatedDir: path.resolve(generatedDirectory),
    browserEvidencePath: options.browserEvidencePath ? path.resolve(options.browserEvidencePath) : null,
    counts,
    items
  };

  if (options.outPath) {
    await mkdir(path.dirname(options.outPath), { recursive: true });
    await writeFile(options.outPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

function renderImagegenHandoffPrompt({ request, queue, status }) {
  const sections = queue.requests.map((item) => `## ${item.id}

- Role: ${item.role || 'n/a'}
- Target path: \`${item.targetPath}\`
- Output slot: \`${item.outputSlot}\`
- Attach command: \`${item.attachCommand}\`
- Browser URLs to verify: ${item.publicUrlCandidates.map((value) => `\`${value}\``).join(', ') || 'n/a'}

\`\`\`text
${item.prompt}
\`\`\`
`).join('\n');

  return `# BetterRef Imagegen Handoff Prompt

Use the built-in \`image_gen\` tool for each request. Do not call an API/CLI fallback unless the user explicitly asks for it.

Save or copy each selected generated image to its output slot under:

\`${request.generatedDir}\`

Then run:

\`\`\`bash
${request.autoAttachCommand}
\`\`\`

Do not leave project assets only under \`$CODEX_HOME/generated_images\`. Do not mark \`asset-plan.json\` pass by hand. Final pass requires attach metadata plus fresh browser evidence that renders the target asset.

Current status counts:

\`\`\`json
${JSON.stringify(status.counts, null, 2)}
\`\`\`

${sections}
`;
}

export async function buildImagegenHandoff(options) {
  const queue = await buildImagegenQueue(options);
  const statusPath = path.join(options.outDir, 'imagegen-status.json');
  const status = await analyzeImagegenStatus({
    assetPlanPath: options.assetPlanPath,
    outDir: options.outDir,
    generatedDir: options.generatedDir || queue.generatedDir,
    projectDir: options.projectDir,
    browserEvidencePath: options.browserEvidencePath,
    outPath: statusPath
  });
  const request = {
    schemaVersion: 'betterref.imagegen.handoff.v1',
    generatedAt: new Date().toISOString(),
    assetPlanPath: path.resolve(options.assetPlanPath),
    queuePath: path.join(options.outDir, 'imagegen-requests.json'),
    promptsPath: path.join(options.outDir, 'imagegen-prompts.md'),
    statusPath,
    generatedDir: generatedDir(options.outDir),
    autoAttachCommand: autoAttachCommandFor({
      assetPlanPath: options.assetPlanPath,
      outDir: options.outDir,
      projectDir: options.projectDir
    }),
    requests: queue.requests
  };

  if (options.requestOutPath) {
    await mkdir(path.dirname(options.requestOutPath), { recursive: true });
    await writeFile(options.requestOutPath, `${JSON.stringify(request, null, 2)}\n`);
  }
  if (options.promptOutPath) {
    await mkdir(path.dirname(options.promptOutPath), { recursive: true });
    await writeFile(options.promptOutPath, renderImagegenHandoffPrompt({ request, queue, status }));
  }

  return { request, queue, status };
}

export async function autoAttachAvailableGeneratedAssets(options) {
  if (!options.assetPlanPath) {
    throw new BetterRefImagegenError('Missing --asset-plan.');
  }
  if (!options.autoAttachDir) {
    throw new BetterRefImagegenError('Missing --auto-attach-dir.');
  }

  const plan = await readJson(options.assetPlanPath, 'asset plan');
  const attach = [];
  for (const asset of pendingAssets(plan)) {
    const id = asset.id;
    if (!id) {
      continue;
    }
    const filePath = await findGeneratedAssetFile(path.resolve(options.autoAttachDir), id);
    if (filePath) {
      attach.push(`${id}=${filePath}`);
    }
  }

  if (attach.length === 0) {
    return {
      schemaVersion: 'betterref.imagegen.attach.v1',
      generatedAt: new Date().toISOString(),
      assetPlanPath: path.resolve(options.assetPlanPath),
      attached: []
    };
  }

  return attachGeneratedAssets({
    assetPlanPath: options.assetPlanPath,
    attach,
    projectDir: options.projectDir
  });
}

export async function autoAttachGeneratedAssets(options) {
  if (!options.assetPlanPath) {
    throw new BetterRefImagegenError('Missing --asset-plan.');
  }
  if (!options.autoAttachDir) {
    throw new BetterRefImagegenError('Missing --auto-attach-dir.');
  }

  const plan = await readJson(options.assetPlanPath, 'asset plan');
  const missing = [];
  const attach = [];
  for (const asset of pendingAssets(plan)) {
    const id = asset.id;
    if (!id) {
      missing.push('asset-without-id');
      continue;
    }
    const filePath = await findGeneratedAssetFile(path.resolve(options.autoAttachDir), id);
    if (!filePath) {
      missing.push(id);
      continue;
    }
    attach.push(`${id}=${filePath}`);
  }

  if (missing.length > 0) {
    throw new BetterRefImagegenError(`Missing generated files for asset ids: ${missing.join(', ')}.`, 1);
  }
  if (attach.length === 0) {
    throw new BetterRefImagegenError('No pending assets found to auto-attach.', 1);
  }

  return attachGeneratedAssets({
    assetPlanPath: options.assetPlanPath,
    attach,
    projectDir: options.projectDir
  });
}
