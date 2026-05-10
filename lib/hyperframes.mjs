import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class BetterRefHyperframesError extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.name = 'BetterRefHyperframesError';
    this.exitCode = exitCode;
  }
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new BetterRefHyperframesError(`Could not read ${label} ${filePath}: ${error.message}`);
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

function pendingHyperframesAssets(plan) {
  return asArray(plan.assets).filter((asset) => isHyperframesAsset(asset) && !isPassStatus(asset.status || asset.state || asset.result));
}

function renderRequest(asset, index) {
  const id = asset.id || `asset-${String(index + 1).padStart(3, '0')}`;
  return {
    id,
    tool: 'hyperframes',
    mode: 'composition-render',
    role: asset.role || null,
    phase: asset.phase || null,
    requirement: asset.requirement || null,
    targetPath: asset.targetPath || `public/betterref-assets/${id}.webm`,
    compositionDir: asset.compositionDir || `hyperframes/${id}`,
    outputFormat: asset.outputFormat || 'webm',
    commands: asArray(asset.hyperframesCommands).length > 0
      ? asArray(asset.hyperframesCommands)
      : [
          'npx hyperframes lint',
          'npx hyperframes validate',
          'npx hyperframes inspect --json',
          'npx hyperframes render --format webm --quality high'
        ],
    acceptanceCriteria: asArray(asset.acceptanceCriteria),
    prompt: asset.prompt || asset.requirement || 'Build the required HyperFrames motion asset.'
  };
}

function renderRunbook(queue) {
  const sections = queue.requests.map((request) => `## ${request.id}

- Tool: \`hyperframes\` + \`hyperframes-cli\`
- Role: ${request.role || 'n/a'}
- Phase: ${request.phase || 'n/a'}
- Composition dir: \`${request.compositionDir}\`
- Target path: \`${request.targetPath}\`
- Format: ${request.outputFormat}
${request.acceptanceCriteria.length ? `- Acceptance criteria:\n${request.acceptanceCriteria.map((item) => `  - ${item}`).join('\n')}\n` : ''}

\`\`\`text
${request.prompt}
\`\`\`

\`\`\`bash
npx hyperframes lint ${request.compositionDir}
npx hyperframes validate ${request.compositionDir}
npx hyperframes inspect --json ${request.compositionDir}
npx hyperframes render --format ${request.outputFormat} --quality high --output path/to/${request.id}.${request.outputFormat} ${request.compositionDir}
betterref-hyperframes --asset-plan ${queue.assetPlanPath} --attach ${request.id}=path/to/${request.id}.${request.outputFormat} --evidence path/to/hyperframes-evidence.json --project . --json
\`\`\`
`);

  return `# BetterRef HyperFrames Requests

Use \`hyperframes:hyperframes\` to author each composition and \`hyperframes:hyperframes-cli\` to lint, validate, inspect, and render. Do not mark an asset pass until the rendered file is attached with passing CLI evidence.

${sections.join('\n')}
`;
}

export async function buildHyperframesQueue(options) {
  if (!options.assetPlanPath) {
    throw new BetterRefHyperframesError('Missing --asset-plan.');
  }
  if (!options.outDir) {
    throw new BetterRefHyperframesError('Missing --out for HyperFrames request output.');
  }

  const plan = await readJson(options.assetPlanPath, 'asset plan');
  const requests = pendingHyperframesAssets(plan).map(renderRequest);
  const queue = {
    schemaVersion: 'betterref.hyperframes.queue.v1',
    generatedAt: new Date().toISOString(),
    assetPlanPath: path.resolve(options.assetPlanPath),
    requests
  };

  await mkdir(options.outDir, { recursive: true });
  await writeFile(path.join(options.outDir, 'hyperframes-requests.json'), `${JSON.stringify(queue, null, 2)}\n`);
  await writeFile(path.join(options.outDir, 'hyperframes-runbook.md'), renderRunbook(queue));
  return queue;
}

function parseAttachment(value) {
  const [id, ...rest] = String(value || '').split('=');
  const filePath = rest.join('=');
  if (!id || !filePath) {
    throw new BetterRefHyperframesError(`Invalid --attach value: ${value}`);
  }
  return { id, filePath };
}

function normalizeCommandEvidence(evidence) {
  const commands = evidence?.commands || {};
  return {
    lint: commands.lint,
    validate: commands.validate,
    inspect: commands.inspect,
    render: commands.render
  };
}

function commandPassed(command) {
  return command?.passed === true || command?.status === 'pass' || command?.exitCode === 0;
}

function assertPassingEvidence(evidence) {
  const commands = normalizeCommandEvidence(evidence);
  for (const [name, command] of Object.entries(commands)) {
    if (!commandPassed(command)) {
      throw new BetterRefHyperframesError(`HyperFrames ${name} evidence is missing or not passing.`, 1);
    }
  }
  return {
    ...evidence,
    commands
  };
}

function resolveTargetPath({ targetPath, projectDir }) {
  if (!targetPath) {
    throw new BetterRefHyperframesError('Asset is missing targetPath.');
  }
  if (path.isAbsolute(targetPath)) {
    return targetPath;
  }
  return path.resolve(projectDir || process.cwd(), targetPath);
}

export async function attachHyperframesAssets(options) {
  if (!options.assetPlanPath) {
    throw new BetterRefHyperframesError('Missing --asset-plan.');
  }
  if (!options.evidencePath) {
    throw new BetterRefHyperframesError('Missing --evidence.');
  }
  const attachments = asArray(options.attach).map(parseAttachment);
  if (attachments.length === 0) {
    throw new BetterRefHyperframesError('Missing --attach.');
  }

  const plan = await readJson(options.assetPlanPath, 'asset plan');
  const evidence = assertPassingEvidence(await readJson(options.evidencePath, 'HyperFrames evidence'));
  const assets = asArray(plan.assets);
  const attached = [];

  for (const attachment of attachments) {
    const asset = assets.find((item) => item.id === attachment.id);
    if (!asset) {
      throw new BetterRefHyperframesError(`Asset ${attachment.id} was not found in the asset plan.`);
    }
    if (!isHyperframesAsset(asset)) {
      throw new BetterRefHyperframesError(`Asset ${attachment.id} is not a HyperFrames asset.`);
    }

    const sourcePath = path.resolve(attachment.filePath);
    const sourceStat = await stat(sourcePath);
    if (!sourceStat.isFile() || sourceStat.size <= 0) {
      throw new BetterRefHyperframesError(`HyperFrames output ${sourcePath} is empty or not a file.`, 1);
    }
    const targetPath = resolveTargetPath({ targetPath: asset.targetPath, projectDir: options.projectDir });
    await mkdir(path.dirname(targetPath), { recursive: true });
    await copyFile(sourcePath, targetPath);

    asset.status = 'pass';
    asset.generatedPath = path.relative(options.projectDir || process.cwd(), targetPath).replace(/\\/g, '/');
    asset.sourcePath = sourcePath;
    asset.bytes = sourceStat.size;
    asset.verifiedAt = new Date().toISOString();
    asset.verification = 'betterref-hyperframes attach';
    asset.hyperframesEvidence = {
      ...evidence,
      evidencePath: path.resolve(options.evidencePath)
    };

    attached.push({
      id: attachment.id,
      targetPath: asset.generatedPath,
      bytes: sourceStat.size
    });
  }

  plan.assets = assets;
  plan.hyperframesRequired = Boolean(plan.hyperframesRequired || assets.some(isHyperframesAsset));
  await writeFile(options.assetPlanPath, `${JSON.stringify(plan, null, 2)}\n`);

  return {
    schemaVersion: 'betterref.hyperframes.attach.v1',
    generatedAt: new Date().toISOString(),
    assetPlanPath: path.resolve(options.assetPlanPath),
    attached
  };
}
