import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { compareImages } from './diff.mjs';

export class BetterRefLongpageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BetterRefLongpageError';
  }
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new BetterRefLongpageError(`Could not read ${label} ${filePath}: ${error.message}`);
  }
}

function firstValue(value) {
  return Array.isArray(value) ? value.at(-1) : value;
}

function safeName(value) {
  return String(value || 'section')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'section';
}

function rowStats(data, width, y) {
  let r = 0;
  let g = 0;
  let b = 0;
  for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * 4;
    r += data[offset];
    g += data[offset + 1];
    b += data[offset + 2];
  }
  return [r / width, g / width, b / width];
}

function colorDistance(left, right) {
  return Math.sqrt(
    (left[0] - right[0]) ** 2 +
      (left[1] - right[1]) ** 2 +
      (left[2] - right[2]) ** 2
  );
}

function hasBrowserTrafficDots(data, width, height) {
  const maxY = Math.min(height, 48);
  const maxX = Math.min(width, 120);
  let red = 0;
  let yellow = 0;
  let green = 0;

  for (let y = 0; y < maxY; y += 1) {
    for (let x = 0; x < maxX; x += 1) {
      const offset = (y * width + x) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      if (r > 180 && g < 130 && b < 130) red += 1;
      if (r > 180 && g > 140 && b < 140) yellow += 1;
      if (g > 150 && r < 160 && b < 160) green += 1;
    }
  }

  return red > 8 && yellow > 8 && green > 8;
}

async function detectBrowserChromeCropY(referencePath) {
  const image = sharp(referencePath, { limitInputPixels: false }).ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  if (!hasBrowserTrafficDots(data, info.width, info.height)) {
    return 0;
  }

  const maxY = Math.min(info.height - 1, 140);
  for (let y = 24; y <= maxY; y += 1) {
    const distance = colorDistance(rowStats(data, info.width, y - 1), rowStats(data, info.width, y));
    if (distance >= 30) {
      return y;
    }
  }

  return 0;
}

async function prepareReference({ referencePath, outDir, cropMode }) {
  const metadata = await sharp(referencePath, { limitInputPixels: false }).metadata();
  const cropY = cropMode === 'auto' ? await detectBrowserChromeCropY(referencePath) : 0;
  const referenceCroppedPath = path.join(outDir, 'reference-cropped.png');
  const height = Math.max(1, metadata.height - cropY);
  await sharp(referencePath, { limitInputPixels: false })
    .extract({ left: 0, top: cropY, width: metadata.width, height })
    .png()
    .toFile(referenceCroppedPath);

  return {
    path: referenceCroppedPath,
    cropY,
    cropped: cropY > 0,
    originalDimensions: { width: metadata.width, height: metadata.height },
    croppedDimensions: { width: metadata.width, height }
  };
}

function normalizeClip(clip, referenceDimensions, sectionName) {
  const x = Math.round(Number(clip?.x ?? 0));
  const y = Math.round(Number(clip?.y ?? 0));
  const width = Math.round(Number(clip?.width));
  const height = Math.round(Number(clip?.height));
  for (const [key, value] of Object.entries({ x, y, width, height })) {
    if (!Number.isFinite(value)) {
      throw new BetterRefLongpageError(`${sectionName} has invalid clip.${key}.`);
    }
  }
  if (width <= 0 || height <= 0) {
    throw new BetterRefLongpageError(`${sectionName} clip must have positive width and height.`);
  }
  if (x < 0 || y < 0 || x + width > referenceDimensions.width || y + height > referenceDimensions.height) {
    throw new BetterRefLongpageError(`${sectionName} clip is outside the cropped reference bounds.`);
  }
  return { x, y, width, height };
}

async function cropReferenceSection({ referencePath, outPath, clip }) {
  await sharp(referencePath, { limitInputPixels: false })
    .extract({ left: clip.x, top: clip.y, width: clip.width, height: clip.height })
    .png()
    .toFile(outPath);
}

function sectionItems(evidence) {
  return Array.isArray(evidence.sectionScreenshotPaths) ? evidence.sectionScreenshotPaths : [];
}

export async function compareLongPage(options) {
  const {
    referencePath,
    actualFullPath,
    browserEvidencePath,
    outDir,
    cropReference = 'auto',
    html = false
  } = options;

  if (!referencePath) throw new BetterRefLongpageError('Missing --ref.');
  if (!browserEvidencePath) throw new BetterRefLongpageError('Missing --browser-evidence.');
  if (!outDir) throw new BetterRefLongpageError('Missing --out.');

  await mkdir(outDir, { recursive: true });
  const evidence = await readJson(browserEvidencePath, 'browser evidence');
  const actualFull = actualFullPath || evidence.fullPageScreenshotPath;
  if (!actualFull) {
    throw new BetterRefLongpageError('Missing --actual-full and browser evidence has no fullPageScreenshotPath.');
  }

  const reference = await prepareReference({ referencePath, outDir, cropMode: firstValue(cropReference) || 'auto' });
  const fullPageOut = path.join(outDir, 'full-page');
  const fullPageReport = await compareImages({
    ...options,
    referencePath: reference.path,
    actualPath: actualFull,
    outDir: fullPageOut,
    reportFileName: 'report.json',
    htmlFileName: 'report.html',
    html
  });

  const referenceSectionDir = path.join(outDir, 'reference-sections');
  const sectionReportDir = path.join(outDir, 'section-reports');
  await mkdir(referenceSectionDir, { recursive: true });
  await mkdir(sectionReportDir, { recursive: true });

  const sections = [];
  for (const item of sectionItems(evidence)) {
    const name = safeName(item.name);
    const clip = normalizeClip(item.clip, reference.croppedDimensions, name);
    const referenceSlicePath = path.join(referenceSectionDir, `${name}.png`);
    const sectionOut = path.join(sectionReportDir, name);
    await cropReferenceSection({ referencePath: reference.path, outPath: referenceSlicePath, clip });
    const report = await compareImages({
      ...options,
      referencePath: referenceSlicePath,
      actualPath: item.path,
      outDir: sectionOut,
      reportFileName: 'report.json',
      htmlFileName: 'report.html',
      html
    });

    const drift = {
      width: report.dimensions.actual.width - report.dimensions.reference.width,
      height: report.dimensions.actual.height - report.dimensions.reference.height
    };
    sections.push({
      name,
      sourceName: item.name,
      selector: item.selector || null,
      passed: report.passed,
      score: report.verdict.score,
      referenceSlicePath,
      actualPath: item.path,
      reportPath: report.artifacts.reportPath,
      diffPath: report.artifacts.diffPath,
      clip,
      dimensionDrift: drift
    });
  }

  const passed = fullPageReport.passed && sections.length > 0 && sections.every((section) => section.passed);
  const report = {
    schemaVersion: 'betterref.longpage.v1',
    generatedAt: new Date().toISOString(),
    mode: 'full_page_scroll_reference',
    passed,
    hardFailPresent: !passed,
    referencePath,
    actualFullPath: actualFull,
    browserEvidencePath,
    referenceCrop: {
      cropY: reference.cropY,
      cropped: reference.cropped,
      originalDimensions: reference.originalDimensions,
      croppedDimensions: reference.croppedDimensions
    },
    fullPageStructure: {
      passed: fullPageReport.passed,
      score: fullPageReport.verdict.score,
      reportPath: fullPageReport.artifacts.reportPath,
      diffPath: fullPageReport.artifacts.diffPath,
      dimensions: fullPageReport.dimensions
    },
    sections,
    verdict: {
      verdict: passed ? 'pass' : 'fail',
      score: sections.length === 0
        ? 0
        : Math.round((fullPageReport.verdict.score + sections.reduce((total, section) => total + section.score, 0)) / (sections.length + 1)),
      hard_fail_present: !passed,
      hardFailHints: sections.length === 0 ? ['missing section screenshots'] : []
    },
    artifacts: {
      reportPath: path.join(outDir, 'longpage-report.json'),
      referenceCroppedPath: reference.path,
      fullPageReportPath: fullPageReport.artifacts.reportPath,
      referenceSectionDir,
      sectionReportDir
    }
  };

  await writeFile(report.artifacts.reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
