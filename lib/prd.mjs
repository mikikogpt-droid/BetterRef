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

function makeRunbook({ configPath, summaryPath, referencePath, url }) {
  const reference = referencePath || 'path/to/reference.png';
  const targetUrl = url || 'http://127.0.0.1:3000/';
  return `# BetterRef PRD Runbook

## Inputs

- PRD summary: ${summaryPath}
- BetterRef config: ${configPath}

## Chrome Capture Loop

\`\`\`bash
betterref-chrome --endpoint http://127.0.0.1:9222 --url-match ${targetUrl} --out .betterref --ref ${reference} --regions both --html
\`\`\`

## Existing Screenshot Loop

\`\`\`bash
betterref-diff --ref ${reference} --actual path/to/current-screenshot.png --out .betterref --config ${configPath} --regions both --html
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
  const regions = inferRegions(text, viewport);
  const ignoreRegions = inferIgnoreRegions(text, viewport);
  const summaryPath = path.join(outDir, 'prd-summary.json');
  const requirementsPath = path.join(outDir, 'requirements.md');
  const checklistPath = path.join(outDir, 'visual-checklist.md');
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
  await writeFile(requirementsPath, requirementsMarkdown);
  await writeFile(checklistPath, checklistMarkdown);
  await writeFile(runbookPath, makeRunbook({ configPath, summaryPath, referencePath, url }));

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
      runbookPath,
      configPath
    }
  };
}
