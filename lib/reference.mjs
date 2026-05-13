import { mkdir, readFile, writeFile } from 'node:fs/promises';
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

async function readJson(filePath, label) {
  if (!filePath) {
    throw new BetterRefReferenceError(`Missing ${label} path.`);
  }
  let raw;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    throw new BetterRefReferenceError(`Could not read ${label} JSON at ${filePath}: ${error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new BetterRefReferenceError(`Could not parse ${label} JSON at ${filePath}: ${error.message}`);
  }
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

function packReferences(pack) {
  return asArray(pack?.references).filter((item) => item && typeof item === 'object');
}

function referencePurpose(ref) {
  return `${ref.role || ''} ${ref.purpose || ''} ${ref.type || ''}`.trim().toLowerCase();
}

function referencePath(ref, packDir) {
  const value = ref.path || ref.file || ref.source || ref.url;
  if (!value) return null;
  return path.isAbsolute(value) || /^[a-z]+:\/\//i.test(value) ? value : path.resolve(packDir, value);
}

function meshScore(ref, index) {
  const purpose = referencePurpose(ref);
  let score = 0;
  if (/\bmain\b/.test(purpose)) score += 50;
  if (/\bmesh\b/.test(purpose)) score += 40;
  if (/\bshape\b|\bsilhouette\b|\bfront\b/.test(purpose) || /\bfront\b/i.test(ref.view || '')) score += 20;
  if (/\btexture\b|\bmaterial\b|\bcolor\b/.test(purpose)) score -= 40;
  return score - index;
}

function selectMeshReference(refs, packDir) {
  const scored = refs
    .map((ref, index) => ({ ref, index, score: meshScore(ref, index), resolvedPath: referencePath(ref, packDir) }))
    .filter((item) => item.resolvedPath);
  if (scored.length === 0) {
    throw new BetterRefReferenceError('Reference pack must include at least one reference with a path.');
  }
  scored.sort((a, b) => b.score - a.score);
  return scored[0];
}

function textureReferences(refs, selectedMesh, packDir) {
  return refs
    .map((ref, index) => ({ ref, index, resolvedPath: referencePath(ref, packDir) }))
    .filter((item) => item.index !== selectedMesh.index && item.resolvedPath)
    .filter((item) => {
      const purpose = referencePurpose(item.ref);
      return /\btexture\b|\bmaterial\b|\bcolor\b|\bpbr\b|\bsurface\b/.test(purpose) || item.ref.materialSlot;
    })
    .map((item) => ({
      id: item.ref.id || `texture-ref-${String(item.index + 1).padStart(2, '0')}`,
      path: item.resolvedPath,
      role: item.ref.role || 'texture',
      purpose: item.ref.purpose || 'material',
      materialSlot: item.ref.materialSlot || item.ref.slot || 'surface-detail',
      notes: item.ref.notes || null,
      workflowTargets: asArray(item.ref.workflow || item.ref.workflowTargets).length > 0
        ? asArray(item.ref.workflow || item.ref.workflowTargets).map((value) => String(value).trim()).filter(Boolean)
        : ['Blender', 'Substance', 'artist']
    }));
}

function robloxGate(targetPlatform, targetUse) {
  if (String(targetPlatform || '').toLowerCase() !== 'roblox') return null;
  return {
    targetUse: targetUse || 'generic-prop',
    qualityPrinciple: 'looks high quality in Roblox, not high-poly everywhere',
    triangleBudgets: {
      genericMeshPartMaxTriangles: 20000,
      accessoryMaxTriangles: 4000,
      avatarBodyTotalMaxTriangles: 10742
    },
    requiredEvidence: [
      'low-poly mesh at or below the target triangle budget',
      'baked texture, normal, and PBR/SurfaceAppearance evidence',
      'Roblox Studio import evidence',
      'in-engine preview render evidence'
    ]
  };
}

function buildAssetBrief({ pack, packPath, targets }) {
  const packDir = path.dirname(path.resolve(packPath));
  const refs = packReferences(pack);
  const selectedMesh = selectMeshReference(refs, packDir);
  const meshRef = selectedMesh.ref;
  const textures = textureReferences(refs, selectedMesh, packDir);
  const targetPlatform = String(pack.targetPlatform || pack.platform || '').toLowerCase() || null;
  const roblox = robloxGate(targetPlatform, pack.targetUse || pack.assetType);
  const assetId = pack.assetId || pack.id || 'asset-001';
  const materialSlots = [...new Set(textures.map((item) => item.materialSlot).filter(Boolean))];
  const acceptanceGates = [
    'main mesh likeness must be judged against the selected mesh reference, not texture-only references',
    'texture/material likeness must be judged against separated texture references',
    'Tencent mesh generation must use one clean main image unless a multi-view mesh pass is explicitly planned',
    'baked texture and material evidence is required before final pass'
  ];
  if (roblox) {
    acceptanceGates.push(
      'Roblox-ready low-poly mesh must pass triangle budget before final pass',
      'Roblox Studio import and in-engine preview evidence are required'
    );
  }

  return {
    schemaVersion: 'betterref.asset.brief.v1',
    generatedAt: new Date().toISOString(),
    sourcePackPath: path.resolve(packPath),
    assetId,
    targetPlatform,
    targetUse: pack.targetUse || null,
    targets,
    meshReference: {
      id: meshRef.id || `mesh-ref-${String(selectedMesh.index + 1).padStart(2, '0')}`,
      path: selectedMesh.resolvedPath,
      role: meshRef.role || 'main',
      purpose: meshRef.purpose || 'mesh',
      view: meshRef.view || null,
      notes: meshRef.notes || null,
      tencentMeshInput: true,
      selectionReason: 'Selected as the clean main mesh reference for silhouette, proportions, and Tencent mesh generation.'
    },
    textureReferences: textures,
    materialSlots,
    pipeline: [
      'Reference Pack',
      'BetterRef Asset Brief',
      'Tencent mesh generation from one main image',
      'Texture/material workflow from separated texture references',
      roblox ? 'Roblox-ready low-poly, baked texture, and import gate' : 'Runtime-ready final 3D gate'
    ],
    roblox,
    acceptanceGates,
    handoff: {
      tencentMesh: {
        inputImage: selectedMesh.resolvedPath,
        instruction: 'Use this image for mesh shape only. Do not mix texture-only references into the mesh generation input.'
      },
      textureWorkflow: {
        inputs: textures,
        instruction: 'Use texture references for Blender, Substance, texture edit, or artist work after the mesh pass.'
      }
    }
  };
}

function renderAssetBrief(brief) {
  return `# BetterRef Asset Brief

- Asset: ${brief.assetId}
- Target platform: ${brief.targetPlatform || 'unspecified'}
- Target use: ${brief.targetUse || 'unspecified'}

## Tencent Mesh Input

- Reference: ${brief.meshReference.path}
- ID: ${brief.meshReference.id}
- View: ${brief.meshReference.view || 'unspecified'}
- Reason: ${brief.meshReference.selectionReason}

Use this image for silhouette, proportions, and primary mesh generation. Keep texture-only references out of the mesh prompt unless a multi-view mesh pass is explicitly planned.

## Texture References

${brief.textureReferences.map((item) => `- ${item.id}: ${item.path} (${item.materialSlot}) via ${item.workflowTargets.join(', ')}`).join('\n') || '- No separate texture references provided.'}

## Roblox Quality Gate

${brief.roblox ? `- Principle: ${brief.roblox.qualityPrinciple}
- Generic MeshPart max triangles: ${brief.roblox.triangleBudgets.genericMeshPartMaxTriangles}
- Accessory max triangles: ${brief.roblox.triangleBudgets.accessoryMaxTriangles}
- Avatar body total max triangles: ${brief.roblox.triangleBudgets.avatarBodyTotalMaxTriangles}` : '- No Roblox target platform requested.'}

## Acceptance Gates

${brief.acceptanceGates.map((item) => `- ${item}`).join('\n')}
`;
}

function renderTextureHandoff(brief) {
  return `# BetterRef Texture Reference Handoff

Texture refs are separated from the Tencent mesh image so Blender, Substance, texture edit, or artist work can preserve material quality without distorting the mesh.

## Texture Inputs

${brief.textureReferences.map((item) => `- ${item.id}
  - Path: ${item.path}
  - Material slot: ${item.materialSlot}
  - Workflow: ${item.workflowTargets.join(', ')}
  - Notes: ${item.notes || 'none'}`).join('\n') || '- No texture references provided.'}

## Required Output Evidence

- baked texture maps or material slots
- normal/PBR evidence when required
- preview render against the mesh
${brief.roblox ? '- Roblox Studio import and in-engine preview render' : '- runtime viewer preview render'}
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

export async function analyzeReferencePack(options) {
  const { packPath, outDir, target } = options;
  if (!packPath) throw new BetterRefReferenceError('Missing --pack.');
  if (!outDir) throw new BetterRefReferenceError('Missing --out.');

  await mkdir(outDir, { recursive: true });
  const pack = await readJson(packPath, 'reference pack');
  const targets = parseTargets(target || pack.targets || '3d,hunyuan');
  const brief = buildAssetBrief({ pack, packPath, targets });
  const assetBriefPath = path.join(outDir, 'asset-brief.json');
  const assetBriefMarkdownPath = path.join(outDir, 'asset-brief.md');
  const textureHandoffPath = path.join(outDir, 'texture-refs.md');

  await writeFile(assetBriefPath, `${JSON.stringify(brief, null, 2)}\n`);
  await writeFile(assetBriefMarkdownPath, renderAssetBrief(brief));
  await writeFile(textureHandoffPath, renderTextureHandoff(brief));

  return {
    schemaVersion: 'betterref.reference.pack.result.v1',
    generatedAt: new Date().toISOString(),
    packPath,
    targets,
    artifacts: {
      assetBriefPath,
      assetBriefMarkdownPath,
      textureHandoffPath
    },
    assetBrief: brief
  };
}
