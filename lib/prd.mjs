import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFParse } from 'pdf-parse';

export class BetterRefPrdError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BetterRefPrdError';
  }
}

async function extractPdfText(pdfPath) {
  let parser;
  try {
    const data = await readFile(pdfPath);
    parser = new PDFParse({ data });
    const result = await parser.getText();
    return {
      text: result.text || '',
      pageCount: result.total || result.pages?.length || null
    };
  } catch (error) {
    throw new BetterRefPrdError(`Could not extract PRD PDF text from ${pdfPath}: ${error.message}`);
  } finally {
    await parser?.destroy?.();
  }
}

function lines(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function splitItems(value) {
  return String(value)
    .split(/[,;•|]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function findAfterLabel(text, label) {
  const pattern = new RegExp(`${label}\\s*[:\\-]\\s*([^\\n]+)`, 'i');
  return pattern.exec(text)?.[1]?.trim() || '';
}

function parseViewport(text, fallback) {
  const source = fallback || findAfterLabel(text, 'viewport');
  const match = /(\d{3,5})\s*x\s*(\d{3,5})/i.exec(source || text);
  if (!match) {
    return { width: 1440, height: 900, source: 'default' };
  }
  return { width: Number(match[1]), height: Number(match[2]), source: 'prd' };
}

function parseThresholds(text) {
  const thresholds = {};
  const specs = [
    ['minSsim', /min\s*ssim|minSsim/gi],
    ['maxChangedPercent', /max\s*changed\s*percent|maxChangedPercent/gi],
    ['maxMeanDiff', /max\s*mean\s*diff|maxMeanDiff/gi]
  ];

  for (const [name, labelPattern] of specs) {
    const label = labelPattern.source.replaceAll('\\s*', '\\s*');
    const match = new RegExp(`(?:${label})\\s*[:=]?\\s*(\\d+(?:\\.\\d+)?)`, 'i').exec(text);
    if (match) {
      thresholds[name] = Number(match[1]);
    }
  }

  return Object.keys(thresholds).length > 0
    ? thresholds
    : { maxChangedPercent: 16, maxMeanDiff: 4, minSsim: 0.98 };
}

function parseScreens(text) {
  const labeled = findAfterLabel(text, 'required screens') || findAfterLabel(text, 'screens');
  if (labeled) {
    return splitItems(labeled);
  }
  return lines(text)
    .filter((line) => /screen|page|flow|landing|admin|checkout|order/i.test(line))
    .slice(0, 8);
}

function parseRequirements(text) {
  const result = [];
  for (const label of ['summary', 'visual requirements', 'requirements', 'acceptance criteria']) {
    const value = findAfterLabel(text, label);
    if (value) {
      result.push(...splitItems(value));
    }
  }
  result.push(
    ...lines(text).filter((line) =>
      /must|should|required|requirement|visual|font|layout|responsive|mobile|desktop|asset|image|overlap|clip/i.test(line)
    )
  );
  return unique(result).slice(0, 40);
}

function parseHardFails(text) {
  const hardFailText = findAfterLabel(text, 'hard fail') || findAfterLabel(text, 'hard fails');
  const result = hardFailText ? splitItems(hardFailText) : [];
  result.push(
    ...lines(text)
      .filter((line) => /hard fail|no overlap|overflow|clip|not clip|must not|ห้าม|ทับ|ล้น/i.test(line))
      .map((line) => line.replace(/^hard fails?\s*[:\-]\s*/i, ''))
  );
  return unique(result).slice(0, 20);
}

function inferLongReference(text) {
  return /full[-\s]?page|long[-\s]?page|scroll|scrollable|footer|whole page|entire page/i.test(text);
}

function inferAssetQualityRequired(text, requirements = []) {
  const source = `${text}\n${requirements.join('\n')}`;
  return /hero|mascot|asset|image|raster|3d|glass|cinematic|premium|texture|background|illustration|rendered/i.test(source);
}

function unique(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const normalized = item.trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function classifyRequirement(item) {
  if (/button|form|flow|auth|payment|search|filter|navigation|click|interactive/i.test(item)) {
    return 'behavior';
  }
  if (/copy|label|price|pricing|game|promotion|badge|legal|content/i.test(item)) {
    return 'content';
  }
  if (/logo|hero|asset|image|icon|mascot|raster|3d|glass|cinematic/i.test(item)) {
    return 'asset';
  }
  if (/mobile|desktop|responsive|viewport|breakpoint/i.test(item)) {
    return 'responsive';
  }
  if (/hard fail|overlap|overflow|clip|must not|no horizontal/i.test(item)) {
    return 'hard-fail';
  }
  return 'visual';
}

function phaseForRequirement(item) {
  const value = item.toLowerCase();
  const phases = [
    ['header-hero', /header|nav|navbar|hero|landing|banner|mascot/],
    ['quick-topup', /top up|top-up|เติม|package|card/],
    ['popular-games', /popular|game|games|grid/],
    ['promotions', /promotion|promo|news|update|discount/],
    ['trust-payment', /security|ssl|payment|bank|wallet|trust/],
    ['footer', /footer|bottom/]
  ];
  return phases.find(([, pattern]) => pattern.test(value))?.[0] || 'global';
}

function slug(value) {
  return String(value || 'asset')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'asset';
}

function assetRoleForRequirement(item) {
  const value = item.toLowerCase();
  if (/logo|brand/.test(value)) {
    return 'brand-logo';
  }
  if (/icon/.test(value)) {
    return 'icon-set';
  }
  if (/background|texture/.test(value)) {
    return 'background-texture';
  }
  if (/mascot|character/.test(value)) {
    return 'hero-mascot';
  }
  if (/hero|3d|glass|cinematic|premium|rendered/.test(value)) {
    return 'cinematic-hero';
  }
  return 'raster-asset';
}

function makeAssetPrompt({ requirement, role, viewport }) {
  return [
    `Create a production-ready ONETAPGG ${role} asset for a ${viewportString(viewport)} web UI.`,
    `Requirement: ${requirement}`,
    'Style: premium gaming, neon purple and electric blue accents, sharp glass/3D depth, clean transparent or web-ready composition.',
    'Do not include browser chrome, UI text blocks, screenshots, PDF renders, watermarks, or reference-image borders.',
    'Leave room for code-native UI text and controls to be layered separately.'
  ].join(' ');
}

function makeAssetPlan({ requirements, viewport, assetQualityRequired }) {
  const assetRequirements = unique(requirements.filter((item) => classifyRequirement(item) === 'asset'));
  if (assetQualityRequired && assetRequirements.length === 0) {
    assetRequirements.push('Premium hero, image, raster, 3D, glass, cinematic, texture, or rendered asset mentioned by the PRD.');
  }

  const minNativeWidth = Math.max(viewport.width * 2, 1920);
  const minNativeHeight = Math.max(Math.round(viewport.height * 1.2), 1080);
  const assets = assetRequirements.map((requirement, index) => {
    const id = `asset-${String(index + 1).padStart(3, '0')}`;
    const role = assetRoleForRequirement(requirement);
    return {
      id,
      status: 'pending',
      phase: phaseForRequirement(requirement),
      role,
      requirement,
      implementation: 'imagegen-or-production-asset',
      targetPath: `public/betterref-assets/${slug(role)}-${String(index + 1).padStart(2, '0')}.png`,
      minNativeWidth,
      minNativeHeight,
      minSharpness: 20,
      prompt: makeAssetPrompt({ requirement, role, viewport }),
      acceptanceCriteria: [
        'Do not use PRD/PDF/reference crop or screenshot as the asset.',
        'Native asset dimensions must be at least the rendered browser size.',
        'Asset must pass BetterRef guard sharpness checks.',
        'UI text, buttons, cards, and layout remain code-native, not baked into the raster.',
        'Mark status pass only after fresh browser evidence and guard verification.'
      ]
    };
  });

  return {
    schemaVersion: 'betterref.asset.plan.v1',
    imagegenRequired: assetQualityRequired,
    assets
  };
}

function makePrdChecklist({ requirements, hardFailHints, screens, viewport, longReference }) {
  const sourceItems = unique([
    ...requirements,
    ...hardFailHints.map((item) => `Hard fail: ${item}`),
    ...screens.map((item) => `Screen required: ${item}`)
  ]);
  const items = sourceItems.map((item, index) => ({
    id: `prd-${String(index + 1).padStart(3, '0')}`,
    status: 'pending',
    category: classifyRequirement(item),
    phase: phaseForRequirement(item),
    requirement: item
  }));

  return {
    schemaVersion: 'betterref.prd.checklist.v1',
    viewport: viewportString(viewport),
    longReference,
    items
  };
}

function makeGuardConfig({ viewport, hardFailHints, longReference, assetQualityRequired }) {
  const config = {
    schemaVersion: 'betterref.guard.config.v1',
    longReference,
    targetViewport: {
      width: viewport.width,
      height: viewport.height
    },
    requireBrowserEvidence: true,
    requireDomText: true,
    minInteractiveElements: 1,
    maxNativeScaleRatio: 1.05,
    forbiddenSourcePatterns: [
      'assets/reference',
      'homepage-reference',
      'full-page-reference',
      'pdf-render',
      'figma-export',
      'reference-crop'
    ],
    sourceExtensions: ['.tsx', '.jsx', '.ts', '.js', '.css', '.html'],
    hardFailHints
  };
  if (assetQualityRequired) {
    config.minRenderedAssets = 1;
    config.autoAssetQuality = {
      enabled: true,
      minSharpness: 20,
      roots: ['public']
    };
  }
  return config;
}

function viewportString(viewport) {
  return `${viewport.width}x${viewport.height}`;
}

function region(name, x, y, width, height, weight = 1) {
  return {
    name,
    x: Math.max(0, Math.round(x)),
    y: Math.max(0, Math.round(y)),
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
    weight
  };
}

function inferRegions(text, viewport) {
  const lower = text.toLowerCase();
  const width = viewport.width;
  const height = viewport.height;
  const headerH = Math.round(height * 0.085);
  const regions = [];

  const addIf = (name, patterns, rect) => {
    if (patterns.some((pattern) => lower.includes(pattern))) {
      regions.push(region(name, ...rect));
    }
  };

  addIf('header', ['header', 'nav', 'navbar', 'navigation', 'เมนู'], [0, 0, width, headerH, 1.25]);
  addIf('hero', ['hero', 'landing', 'mascot', 'banner', 'ฮีโร่', 'หน้าแรก'], [0, headerH, width, height * 0.52, 1.5]);
  addIf('cards', ['card', 'cards', 'grid', 'เกม', 'package', 'popular', 'แพ็ก', 'รายการ'], [0, height * 0.58, width * 0.72, height * 0.32, 1.15]);
  addIf('news', ['news', 'update', 'ข่าว'], [width * 0.68, height * 0.54, width * 0.32, height * 0.22, 1]);
  addIf('security', ['security', 'ssl', 'pci', 'ปลอดภัย'], [width * 0.72, height * 0.72, width * 0.28, height * 0.2, 1]);
  addIf('footer', ['footer', 'ท้าย', 'bottom'], [0, height * 0.9, width, height * 0.1, 0.75]);

  if (regions.length === 0) {
    regions.push(
      region('header', 0, 0, width, headerH, 1),
      region('hero', 0, headerH, width, height * 0.52, 1),
      region('content', 0, height * 0.58, width, height * 0.34, 1)
    );
  }

  return uniqueRegions(regions);
}

function uniqueRegions(regions) {
  const seen = new Set();
  return regions.filter((item) => {
    if (seen.has(item.name)) {
      return false;
    }
    seen.add(item.name);
    return true;
  });
}

function inferIgnoreRegions(text, viewport) {
  const lower = text.toLowerCase();
  const ignores = [];
  if (/timestamp|time|clock|เวลา/.test(lower)) {
    ignores.push(region('timestamp', viewport.width - 180, 20, 150, 32, 1));
  }
  if (/cursor|pointer|เคอร์เซอร์/.test(lower)) {
    ignores.push(region('cursor', viewport.width / 2 - 24, viewport.height / 2 - 24, 48, 48, 1));
  }
  if (/ads?|advertisement|โฆษณา/.test(lower)) {
    ignores.push(region('ads', viewport.width - 320, 80, 300, 250, 1));
  }
  return ignores;
}

function markdownList(items) {
  return items.length > 0 ? items.map((item) => `- ${item}`).join('\n') : '- No explicit items found in PRD text.';
}

function makeRunbook({
  configPath,
  summaryPath,
  guardConfigPath,
  prdChecklistPath,
  assetPlanPath,
  referencePath,
  url,
  assetQualityRequired
}) {
  const reference = referencePath || 'path/to/reference.png';
  const targetUrl = url || 'http://127.0.0.1:3000/';
  const assetQualityNote = assetQualityRequired
    ? `
## Asset Quality Gate

The generated guard config enables \`autoAssetQuality\`. Browser evidence image URLs will be mapped back to local \`public\` assets and checked for sharpness; blurry hero/premium raster assets hard-fail even when visual score is high.
`
    : '';
  return `# BetterRef PRD Runbook

## Inputs

- PRD summary: ${summaryPath}
- BetterRef config: ${configPath}
- BetterRef guard config: ${guardConfigPath}
- PRD checklist: ${prdChecklistPath}
- Asset plan: ${assetPlanPath}
${assetQualityNote}

## Asset Generation Loop

\`\`\`bash
betterref-imagegen --asset-plan ${assetPlanPath} --out .betterref-imagegen --json
# Use built-in image_gen for each request in .betterref-imagegen/imagegen-requests.json.
# After generating a file, attach it back into the project and mark the asset pass:
betterref-imagegen --asset-plan ${assetPlanPath} --attach asset-001=path/to/generated.png --project . --json
\`\`\`

## Chrome Capture Loop

\`\`\`bash
betterref-chrome --endpoint http://127.0.0.1:9222 --url-match ${targetUrl} --out .betterref --full-page --section-screenshots --ref ${reference} --regions both --html
betterref-longpage --ref ${reference} --actual-full .betterref/chrome-full-page.png --browser-evidence .betterref/browser-evidence.json --out .betterref-longpage --crop-reference auto --html
\`\`\`

## Existing Screenshot Loop

\`\`\`bash
betterref-diff --ref ${reference} --actual path/to/current-screenshot.png --out .betterref --config ${configPath} --regions both --html
\`\`\`

## Guard And Final Verdict

\`\`\`bash
betterref-guard --project . --report .betterref/report.json --config ${guardConfigPath} --browser-evidence .betterref/browser-evidence.json --out .betterref/guard-report.json
betterref-verify --report .betterref/report.json --guard .betterref/guard-report.json --longpage .betterref-longpage/longpage-report.json --prd ${prdChecklistPath} --asset-plan ${assetPlanPath} --browser-evidence .betterref/browser-evidence.json --project . --require guard,prd,longpage,assetplan,browser --out .betterref/final-verdict.json --html .betterref/final-verdict.html --bundle .betterref/evidence-bundle.json
\`\`\`

## Patch Rule

Read \`.betterref/report.json\`, fix the highest-severity region first, capture again, and repeat until hard fails are gone.
`;
}

export async function buildPrdArtifacts(options) {
  const {
    pdfPath,
    outDir,
    configOut,
    viewport: viewportOption,
    referencePath,
    url
  } = options;

  if (!pdfPath) {
    throw new BetterRefPrdError('Missing --pdf.');
  }
  if (!outDir) {
    throw new BetterRefPrdError('Missing --out.');
  }

  await mkdir(outDir, { recursive: true });
  const { text, pageCount } = await extractPdfText(pdfPath);
  const viewport = parseViewport(text, viewportOption);
  const thresholds = parseThresholds(text);
  const requirements = parseRequirements(text);
  const hardFailHints = parseHardFails(text);
  const screens = parseScreens(text);
  const longReference = inferLongReference(text);
  const assetQualityRequired = inferAssetQualityRequired(text, requirements);
  const regions = inferRegions(text, viewport);
  const ignoreRegions = inferIgnoreRegions(text, viewport);
  const summaryPath = path.join(outDir, 'prd-summary.json');
  const requirementsPath = path.join(outDir, 'requirements.md');
  const checklistPath = path.join(outDir, 'visual-checklist.md');
  const prdChecklistPath = path.join(outDir, 'prd-checklist.json');
  const assetPlanPath = path.join(outDir, 'asset-plan.json');
  const guardConfigPath = path.join(outDir, 'betterref.guard.json');
  const runbookPath = path.join(outDir, 'betterref-runbook.md');
  const configPath = configOut || path.join(outDir, '.betterref.json');
  await mkdir(path.dirname(configPath), { recursive: true });

  const summary = {
    schemaVersion: 'betterref.prd.summary.v1',
    generatedAt: new Date().toISOString(),
    pdfPath,
    pageCount,
    viewport: viewportString(viewport),
    viewportSource: viewport.source,
    screens,
    requirements,
    hardFailHints,
    longReference,
    assetQualityRequired,
    thresholds,
    regions: regions.map((item) => item.name),
    ignoreRegions: ignoreRegions.map((item) => item.name),
    extractedTextPreview: text.slice(0, 4000)
  };
  const config = {
    viewport: viewportString(viewport),
    matchSize: 'strict',
    thresholds,
    regions,
    ignoreRegions,
    metadata: {
      generatedBy: 'betterref-prd',
      generatedAt: new Date().toISOString(),
      source: pdfPath,
      summaryPath
    }
  };
  const prdChecklist = makePrdChecklist({ requirements, hardFailHints, screens, viewport, longReference });
  const assetPlan = makeAssetPlan({ requirements, viewport, assetQualityRequired });
  const guardConfig = makeGuardConfig({ viewport, hardFailHints, longReference, assetQualityRequired });

  const requirementsMarkdown = `# PRD Requirements

## Screens

${markdownList(screens)}

## Requirements

${markdownList(requirements)}

## Hard Fail Hints

${markdownList(hardFailHints)}
`;
  const checklistMarkdown = `# BetterRef Visual Checklist

## Regions

${markdownList(regions.map((item) => `${item.name}: ${item.x},${item.y},${item.width},${item.height}`))}

## Hard Fails

${markdownList(hardFailHints)}

## Minimum Gates

- Same route, viewport, scroll position, and data state as the PRD reference.
- No incoherent overlap, clipping, or horizontal overflow.
- Typography and Thai glyphs must match the reference closely.
- Highest-severity BetterRef region must be patched first.
`;

  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await writeFile(guardConfigPath, `${JSON.stringify(guardConfig, null, 2)}\n`);
  await writeFile(prdChecklistPath, `${JSON.stringify(prdChecklist, null, 2)}\n`);
  await writeFile(assetPlanPath, `${JSON.stringify(assetPlan, null, 2)}\n`);
  await writeFile(requirementsPath, requirementsMarkdown);
  await writeFile(checklistPath, checklistMarkdown);
  await writeFile(
    runbookPath,
    makeRunbook({
      configPath,
      summaryPath,
      guardConfigPath,
      prdChecklistPath,
      assetPlanPath,
      referencePath,
      url,
      assetQualityRequired
    })
  );

  return {
    schemaVersion: 'betterref.prd.v1',
    generatedAt: new Date().toISOString(),
    pdfPath,
    viewport: viewportString(viewport),
    screens,
    requirements,
    hardFailHints,
    artifacts: {
      summaryPath,
      requirementsPath,
      checklistPath,
      prdChecklistPath,
      assetPlanPath,
      guardConfigPath,
      runbookPath,
      configPath
    }
  };
}
