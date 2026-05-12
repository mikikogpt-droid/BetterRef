import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const sharpReadOptions = { limitInputPixels: false };

export class BetterRefReferenceError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BetterRefReferenceError';
  }
}

function asArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : String(value).split(',');
}

function parseTargets(value) {
  const targets = asArray(value)
    .map((item) => String(item).trim().toLowerCase())
    .filter(Boolean);
  return targets.length > 0 ? [...new Set(targets)] : ['ui'];
}

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}

function aspectRatio(width, height) {
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}

async function swatches(imagePath) {
  const { dominant } = await sharp(imagePath, sharpReadOptions).stats();
  const dominantHex = `#${[dominant.r, dominant.g, dominant.b]
    .map((item) => Math.round(item).toString(16).padStart(2, '0'))
    .join('')}`;
  const palette = await sharp(imagePath, sharpReadOptions)
    .resize(8, 8, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const colors = new Map();

  for (let index = 0; index < palette.data.length; index += palette.info.channels) {
    const r = palette.data[index];
    const g = palette.data[index + 1];
    const b = palette.data[index + 2];
    const key = `#${[r, g, b].map((item) => item.toString(16).padStart(2, '0')).join('')}`;
    colors.set(key, (colors.get(key) || 0) + 1);
  }

  return [
    { role: 'dominant', hex: dominantHex, confidence: 'high' },
    ...[...colors.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([hex, count]) => ({ role: 'sampled', hex, count, confidence: 'medium' }))
  ];
}

function makeAnalysis({ imagePath, metadata, targets, colorSwatches }) {
  const modelable = targets.includes('3d') || targets.includes('model') || targets.includes('hunyuan');
  return {
    schemaVersion: 'betterref.reference.analysis.v1',
    generatedAt: new Date().toISOString(),
    source: path.resolve(imagePath),
    targets,
    image: {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      channels: metadata.channels,
      hasAlpha: Boolean(metadata.hasAlpha)
    },
    pixelFacts: {
      aspectRatio: aspectRatio(metadata.width, metadata.height),
      orientation: metadata.width >= metadata.height ? 'landscape' : 'portrait',
      visibleViewport: `${metadata.width}x${metadata.height}`
    },
    color: {
      swatches: colorSwatches
    },
    designSemantics: {
      confidence: 'medium',
      notes: [
        'Reference analysis is deterministic and should be augmented by a specialist visual agent before final pass.',
        'Use browser or image-processing measurement for exact layout and typography decisions.'
      ]
    },
    objectCues: {
      modelable,
      confidence: modelable ? 'medium' : 'low',
      silhouette: modelable
        ? 'Extract major silhouette and volume boundaries before Hunyuan generation.'
        : 'No 3D target requested.',
      materialSlots: modelable ? ['base-color', 'surface-finish', 'detail-texture'] : []
    },
    uncertainties: [
      {
        unknown: 'Hidden sides and back view',
        impact: 'Blocks exact 3D pass when the deliverable requires all sides.',
        need: 'Provide side/back reference or accept an explicit assumption.'
      },
      {
        unknown: 'Exact physical scale',
        impact: 'Model may load at the wrong size in Three.js/model-viewer.',
        need: 'Provide target dimensions or runtime scale.'
      }
    ]
  };
}

function renderChecklist(analysis) {
  return `# BetterRef Visual Checklist

- Reference: ${analysis.source}
- Size: ${analysis.image.width}x${analysis.image.height}
- Aspect ratio: ${analysis.pixelFacts.aspectRatio}
- Orientation: ${analysis.pixelFacts.orientation}
- Dominant color: ${analysis.color.swatches[0]?.hex || 'unknown'}
- Targets: ${analysis.targets.join(', ')}

## Required Checks

- Match visible composition and crop before judging polish.
- Preserve high-confidence color and layout facts.
- Report uncertainty separately from facts.
- Do not use the reference image, PDF render, or screenshot as shipped UI.
`;
}

function render3DBrief(analysis) {
  return `# BetterRef 3D Brief

## Source

- Reference: ${analysis.source}
- Image size: ${analysis.image.width}x${analysis.image.height}
- Modelable: ${analysis.objectCues.modelable}
- Confidence: ${analysis.objectCues.confidence}

## Silhouette

${analysis.objectCues.silhouette}

## Material Slots

${analysis.objectCues.materialSlots.map((item) => `- ${item}`).join('\n') || '- No 3D material slots requested.'}

## Known Unknowns

${analysis.uncertainties.map((item) => `- ${item.unknown}: ${item.impact} Need: ${item.need}`).join('\n')}
`;
}

function renderNegativePrompts() {
  return `# BetterRef Negative Prompts

- Do not create a flat billboard pretending to be a 3D model.
- Do not bake browser chrome, UI panels, large text blocks, screenshots, or PDF renders into the asset.
- Do not ignore the reference silhouette, color zones, or material cues.
- Do not claim hidden sides are accurate without side/back reference evidence.
`;
}

export async function analyzeReference(options) {
  const { referencePath, outDir, target } = options;
  if (!referencePath) throw new BetterRefReferenceError('Missing --ref.');
  if (!outDir) throw new BetterRefReferenceError('Missing --out.');

  await mkdir(outDir, { recursive: true });
  let metadata;
  try {
    metadata = await sharp(referencePath, sharpReadOptions).metadata();
  } catch (error) {
    throw new BetterRefReferenceError(`Could not read reference image ${referencePath}: ${error.message}`);
  }

  if (!metadata.width || !metadata.height) {
    throw new BetterRefReferenceError(`Reference image ${referencePath} has invalid dimensions.`);
  }

  const targets = parseTargets(target);
  const analysis = makeAnalysis({
    imagePath: referencePath,
    metadata,
    targets,
    colorSwatches: await swatches(referencePath)
  });
  const analysisPath = path.join(outDir, 'reference-analysis.json');
  const visualChecklistPath = path.join(outDir, 'visual-checklist.md');
  const threeDBriefPath = path.join(outDir, '3d-brief.md');
  const negativePromptsPath = path.join(outDir, 'negative-prompts.md');

  await writeFile(analysisPath, `${JSON.stringify(analysis, null, 2)}\n`);
  await writeFile(visualChecklistPath, renderChecklist(analysis));
  await writeFile(threeDBriefPath, render3DBrief(analysis));
  await writeFile(negativePromptsPath, renderNegativePrompts());

  return {
    schemaVersion: 'betterref.reference.v1',
    generatedAt: new Date().toISOString(),
    referencePath,
    targets,
    artifacts: {
      analysisPath,
      visualChecklistPath,
      threeDBriefPath,
      negativePromptsPath
    }
  };
}
