import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
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

function pendingAssets(plan) {
  return asArray(plan.assets).filter((asset) => !isPassStatus(asset.status || asset.state || asset.result));
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
- Minimum native size: ${request.minNativeWidth || 'n/a'}x${request.minNativeHeight || 'n/a'}
- Minimum sharpness: ${request.minSharpness || 'n/a'}
${request.acceptanceCriteria?.length ? `- Acceptance criteria:\n${request.acceptanceCriteria.map((item) => `  - ${item}`).join('\n')}\n` : ''}

\`\`\`text
${request.prompt}
\`\`\`
`;
  });

  return `# BetterRef Imagegen Requests

Use the built-in \`image_gen\` tool for every request below. Do not leave project assets under \`$CODEX_HOME\`; after generation, copy the selected output into the listed target path and run \`betterref-imagegen --attach <id>=<file>\`.

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
    const id = asset.id || `asset-${String(index + 1).padStart(3, '0')}`;
    return {
      id,
      tool: 'image_gen',
      mode: 'built-in',
      role: asset.role || null,
      phase: asset.phase || null,
      requirement: asset.requirement || null,
      targetPath: asset.targetPath || `public/betterref-assets/${id}.png`,
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
    requests
  };

  await mkdir(options.outDir, { recursive: true });
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
