import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import sharp from 'sharp';

export class BetterRefInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BetterRefInputError';
  }
}

async function loadImage(filePath, resizeTo = null) {
  const image = sharp(filePath, { limitInputPixels: false }).ensureAlpha();
  const pipeline = resizeTo
    ? image.resize({ width: resizeTo.width, height: resizeTo.height, fit: 'fill' })
    : image;
  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  return {
    data,
    width: info.width,
    height: info.height
  };
}

async function writeRawPng(image, filePath) {
  const png = await sharp(image.data, {
    raw: {
      width: image.width,
      height: image.height,
      channels: 4
    }
  }).png().toBuffer();
  await writeFile(filePath, png);
}

async function loadConfig(configPath) {
  if (!configPath) {
    return {};
  }

  try {
    return JSON.parse(await readFile(configPath, 'utf8'));
  } catch (error) {
    throw new BetterRefInputError(`Could not read BetterRef config ${configPath}: ${error.message}`);
  }
}

function firstValue(value) {
  return Array.isArray(value) ? value.at(-1) : value;
}

function metricThresholds(options, config) {
  const configThresholds = config.thresholds || {};
  return {
    maxChangedPercent: options.maxChangedPercent ?? configThresholds.maxChangedPercent ?? config.maxChangedPercent ?? 2,
    maxMeanDiff: options.maxMeanDiff ?? configThresholds.maxMeanDiff ?? config.maxMeanDiff ?? 4,
    minSsim: options.minSsim ?? configThresholds.minSsim ?? config.minSsim ?? 0.99,
    minHashSimilarity: options.minHashSimilarity ?? configThresholds.minHashSimilarity ?? config.minHashSimilarity ?? 0,
    pixelThreshold: options.pixelThreshold ?? configThresholds.pixelThreshold ?? config.pixelThreshold ?? 0.1
  };
}

function normalizeMatchSize(value) {
  const mode = firstValue(value) || 'strict';
  if (mode === 'strict' || mode === 'reference') {
    return mode;
  }
  throw new BetterRefInputError(`--match-size must be one of strict or reference.`);
}

function normalizeRegion(region, image, kind) {
  if (!region || typeof region !== 'object') {
    throw new BetterRefInputError(`${kind} region must be an object.`);
  }

  const normalized = {
    name: String(region.name || `${kind}-${region.x}-${region.y}`).trim(),
    x: Number(region.x),
    y: Number(region.y),
    width: Number(region.width),
    height: Number(region.height),
    weight: region.weight === undefined ? 1 : Number(region.weight),
    thresholds: region.thresholds || {}
  };

  for (const key of ['x', 'y', 'width', 'height', 'weight']) {
    if (!Number.isFinite(normalized[key])) {
      throw new BetterRefInputError(`${normalized.name || kind} has invalid ${key}.`);
    }
  }

  normalized.x = Math.round(normalized.x);
  normalized.y = Math.round(normalized.y);
  normalized.width = Math.round(normalized.width);
  normalized.height = Math.round(normalized.height);

  if (!normalized.name) {
    throw new BetterRefInputError(`${kind} region is missing a name.`);
  }
  if (normalized.width <= 0 || normalized.height <= 0) {
    throw new BetterRefInputError(`${normalized.name} must have positive width and height.`);
  }
  if (
    normalized.x < 0 ||
    normalized.y < 0 ||
    normalized.x + normalized.width > image.width ||
    normalized.y + normalized.height > image.height
  ) {
    throw new BetterRefInputError(`${normalized.name} is outside the ${image.width}x${image.height} image bounds.`);
  }

  return normalized;
}

function parseIgnoreRegion(value) {
  const [name, x, y, width, height] = String(value).split(',');
  return { name, x: Number(x), y: Number(y), width: Number(width), height: Number(height) };
}

function autoRegions(image) {
  const thirdWidth = Math.floor(image.width / 3);
  const thirdHeight = Math.floor(image.height / 3);
  const widths = [thirdWidth, thirdWidth, image.width - thirdWidth * 2];
  const heights = [thirdHeight, thirdHeight, image.height - thirdHeight * 2];
  const xs = [0, widths[0], widths[0] + widths[1]];
  const ys = [0, heights[0], heights[0] + heights[1]];
  const names = [
    ['auto-top-left', 'auto-top', 'auto-top-right'],
    ['auto-left', 'auto-center', 'auto-right'],
    ['auto-bottom-left', 'auto-bottom', 'auto-bottom-right']
  ];

  const regions = [{ name: 'full', x: 0, y: 0, width: image.width, height: image.height, weight: 1 }];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      regions.push({
        name: names[row][col],
        x: xs[col],
        y: ys[row],
        width: widths[col],
        height: heights[row],
        weight: 1
      });
    }
  }
  return regions;
}

function selectRegions(config, image, mode) {
  const configured = Array.isArray(config.regions)
    ? config.regions.map((region) => normalizeRegion(region, image, 'configured'))
    : [];
  const auto = autoRegions(image).map((region) => normalizeRegion(region, image, 'auto'));
  const selectedMode = mode || (configured.length > 0 ? 'config' : 'auto');

  if (selectedMode === 'auto') {
    return auto;
  }
  if (selectedMode === 'config') {
    return configured.length > 0 ? configured : auto;
  }
  if (selectedMode === 'both') {
    return [...configured, ...auto];
  }
  throw new BetterRefInputError(`--regions must be one of auto, config, or both.`);
}

function selectIgnoreRegions(config, image, cliIgnoreRegions = []) {
  const fromConfig = Array.isArray(config.ignoreRegions) ? config.ignoreRegions : [];
  const fromCli = Array.isArray(cliIgnoreRegions)
    ? cliIgnoreRegions.map(parseIgnoreRegion)
    : cliIgnoreRegions
      ? [parseIgnoreRegion(cliIgnoreRegions)]
      : [];
  return [...fromConfig, ...fromCli].map((region) => normalizeRegion(region, image, 'ignored'));
}

function isIgnored(x, y, ignoreRegions) {
  return ignoreRegions.some(
    (region) => x >= region.x && y >= region.y && x < region.x + region.width && y < region.y + region.height
  );
}

function makeRegionBuffers(reference, actual, region, ignoreRegions) {
  const referenceData = Buffer.alloc(region.width * region.height * 4);
  const actualData = Buffer.alloc(region.width * region.height * 4);
  const validMask = [];
  let validPixels = 0;

  for (let y = 0; y < region.height; y += 1) {
    for (let x = 0; x < region.width; x += 1) {
      const sourceX = region.x + x;
      const sourceY = region.y + y;
      const sourceOffset = (sourceY * reference.width + sourceX) * 4;
      const targetOffset = (y * region.width + x) * 4;
      const ignored = isIgnored(sourceX, sourceY, ignoreRegions);

      for (let channel = 0; channel < 4; channel += 1) {
        referenceData[targetOffset + channel] = reference.data[sourceOffset + channel];
        actualData[targetOffset + channel] = ignored
          ? reference.data[sourceOffset + channel]
          : actual.data[sourceOffset + channel];
      }

      if (!ignored) {
        validPixels += 1;
      }
      validMask.push(!ignored);
    }
  }

  return { referenceData, actualData, validPixels, validMask };
}

function luminance(data, offset) {
  return data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722;
}

function measureChannelDiff(referenceData, actualData, validPixels, validMask) {
  if (validPixels === 0) {
    return { meanAbsoluteChannelDiff: 0, maxChannelDiff: 0 };
  }

  let total = 0;
  let max = 0;
  const pixelCount = referenceData.length / 4;

  for (let i = 0; i < pixelCount; i += 1) {
    if (!validMask[i]) {
      continue;
    }
    const offset = i * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      const diff = Math.abs(referenceData[offset + channel] - actualData[offset + channel]);
      total += diff;
      if (diff > max) {
        max = diff;
      }
    }
  }

  return {
    meanAbsoluteChannelDiff: total / (validPixels * 3),
    maxChannelDiff: max
  };
}

function measureSsim(referenceData, actualData, validPixels, validMask) {
  if (validPixels === 0) {
    return 1;
  }

  const luminances = [];
  let referenceMean = 0;
  let actualMean = 0;
  const pixelCount = referenceData.length / 4;

  for (let i = 0; i < pixelCount; i += 1) {
    if (!validMask[i]) {
      continue;
    }
    const offset = i * 4;
    const referenceLuma = luminance(referenceData, offset);
    const actualLuma = luminance(actualData, offset);
    luminances.push([referenceLuma, actualLuma]);
    referenceMean += referenceLuma;
    actualMean += actualLuma;
  }

  referenceMean /= validPixels;
  actualMean /= validPixels;

  let referenceVariance = 0;
  let actualVariance = 0;
  let covariance = 0;

  for (const [referenceLuma, actualLuma] of luminances) {
    referenceVariance += (referenceLuma - referenceMean) ** 2;
    actualVariance += (actualLuma - actualMean) ** 2;
    covariance += (referenceLuma - referenceMean) * (actualLuma - actualMean);
  }

  referenceVariance /= validPixels;
  actualVariance /= validPixels;
  covariance /= validPixels;

  const c1 = 6.5025;
  const c2 = 58.5225;
  const numerator = (2 * referenceMean * actualMean + c1) * (2 * covariance + c2);
  const denominator = (referenceMean ** 2 + actualMean ** 2 + c1) * (referenceVariance + actualVariance + c2);
  return Math.max(0, Math.min(1, numerator / denominator));
}

function dhash(data, width, height) {
  const bits = [];
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const leftX = Math.min(width - 1, Math.floor((x / 8) * width));
      const rightX = Math.min(width - 1, Math.floor(((x + 1) / 8) * width));
      const sampleY = Math.min(height - 1, Math.floor((y / 8) * height));
      const left = luminance(data, (sampleY * width + leftX) * 4);
      const right = luminance(data, (sampleY * width + rightX) * 4);
      bits.push(left > right);
    }
  }
  return bits;
}

function measureHashSimilarity(referenceData, actualData, width, height) {
  const referenceHash = dhash(referenceData, width, height);
  const actualHash = dhash(actualData, width, height);
  let same = 0;
  for (let i = 0; i < referenceHash.length; i += 1) {
    if (referenceHash[i] === actualHash[i]) {
      same += 1;
    }
  }
  return same / referenceHash.length;
}

function scoreFromMetrics(metrics) {
  const pixelScore = Math.max(0, 100 - metrics.changedPercent);
  const meanScore = Math.max(0, 100 - (metrics.meanAbsoluteChannelDiff / 255) * 100);
  const ssimScore = metrics.ssim * 100;
  const hashScore = metrics.hashSimilarity * 100;
  return Math.round(pixelScore * 0.2 + meanScore * 0.2 + ssimScore * 0.45 + hashScore * 0.15);
}

function safeName(name) {
  return String(name).replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'region';
}

function regionThresholds(globalThresholds, region) {
  return {
    ...globalThresholds,
    ...region.thresholds
  };
}

function passedMetrics(metrics, thresholds) {
  return (
    metrics.changedPercent <= thresholds.maxChangedPercent &&
    metrics.meanAbsoluteChannelDiff <= thresholds.maxMeanDiff &&
    metrics.ssim >= thresholds.minSsim &&
    metrics.hashSimilarity >= thresholds.minHashSimilarity
  );
}

async function measureRegion({ reference, actual, region, ignoreRegions, thresholds, outDir, writeDiff, diffFileName }) {
  const { referenceData, actualData, validPixels, validMask } = makeRegionBuffers(reference, actual, region, ignoreRegions);
  const diffPng = new PNG({ width: region.width, height: region.height });
  const changedPixels = pixelmatch(referenceData, actualData, diffPng.data, region.width, region.height, {
    threshold: thresholds.pixelThreshold
  });
  const channelDiff = measureChannelDiff(referenceData, actualData, validPixels, validMask);
  const totalPixels = validPixels;
  const changedPercent = totalPixels === 0 ? 0 : (changedPixels / totalPixels) * 100;
  const metrics = {
    changedPixels,
    totalPixels,
    changedPercent,
    meanAbsoluteChannelDiff: channelDiff.meanAbsoluteChannelDiff,
    maxChannelDiff: channelDiff.maxChannelDiff,
    ssim: measureSsim(referenceData, actualData, validPixels, validMask),
    hashSimilarity: measureHashSimilarity(referenceData, actualData, region.width, region.height)
  };
  const score = scoreFromMetrics(metrics);
  const passed = passedMetrics(metrics, thresholds);
  const severity = Math.max(0, 100 - score) * (region.weight || 1);
  let diffPath = null;

  if (writeDiff) {
    diffPath = path.join(outDir, diffFileName || `${safeName(region.name)}-diff.png`);
    await writeFile(diffPath, PNG.sync.write(diffPng));
  }

  return {
    name: region.name,
    rect: {
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height
    },
    weight: region.weight,
    thresholds,
    metrics,
    score,
    severity,
    passed,
    diffPath,
    suggestion: passed
      ? 'No region-level edit needed.'
      : `Inspect ${region.name} first; its region metrics are outside the configured BetterRef thresholds.`
  };
}

function topFailingRegions(regions, limit = 5) {
  return regions.filter((region) => !region.passed).slice(0, limit);
}

function makeVerdict({ passed, global, regions, dimensionMismatch }) {
  const failedRegions = topFailingRegions(regions);
  const topDifferences = [];
  const nextEdits = [];
  const hardFailHints = [];

  if (dimensionMismatch) {
    topDifferences.push('Reference and actual image dimensions differ.');
    nextEdits.push('Capture the current screenshot with the same viewport and device scale as the reference.');
    hardFailHints.push('same-state viewport or capture size mismatch');
  }

  for (const region of failedRegions) {
    topDifferences.push(
      `${region.name}: changed=${region.metrics.changedPercent.toFixed(2)}%, mean=${region.metrics.meanAbsoluteChannelDiff.toFixed(2)}, ssim=${region.metrics.ssim.toFixed(4)}`
    );
    nextEdits.push(`Patch ${region.name} before lower-severity regions; inspect ${path.basename(region.diffPath || 'diff.png')}.`);
  }

  if (!passed && failedRegions.length === 0 && !dimensionMismatch) {
    topDifferences.push('Global metrics exceed the configured BetterRef thresholds.');
    nextEdits.push('Inspect diff.png hotspots and patch the largest visible layout, typography, asset, or spacing mismatch first.');
  }

  if (!global.passed && !dimensionMismatch) {
    hardFailHints.push('global visual metrics outside threshold');
  }

  return {
    score: dimensionMismatch ? 0 : global.score,
    verdict: passed ? 'pass' : 'revise',
    category_match: null,
    same_state: !dimensionMismatch,
    hard_fail_present: !passed,
    differences: topDifferences,
    suggestions: nextEdits,
    topDifferences,
    nextEdits,
    hardFailHints,
    reasoning: passed
      ? 'Pixel and perceptual metrics are within the configured BetterRef thresholds.'
      : 'One or more global or region-level BetterRef metrics are outside threshold.'
  };
}

function htmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function imageSrc(filePath) {
  return pathToFileURL(path.resolve(filePath)).href;
}

async function writeHtmlReport(report, htmlPath) {
  const actualImagePath = report.artifacts.actualComparedPath || report.actualPath;
  const rows = report.regions
    .slice(0, 12)
    .map(
      (region) => `<tr>
        <td>${htmlEscape(region.name)}</td>
        <td>${region.passed ? 'pass' : 'revise'}</td>
        <td>${region.score}</td>
        <td>${region.metrics.changedPercent.toFixed(2)}%</td>
        <td>${region.metrics.ssim.toFixed(4)}</td>
        <td>${htmlEscape(region.suggestion)}</td>
      </tr>`
    )
    .join('\n');
  const regionBoxes = report.regions
    .slice(0, 20)
    .map((region) => {
      const color = region.passed ? '#22c55e' : '#ef4444';
      return `<div title="${htmlEscape(region.name)}" style="position:absolute;left:${region.rect.x}px;top:${region.rect.y}px;width:${region.rect.width}px;height:${region.rect.height}px;border:2px solid ${color};box-sizing:border-box"></div>`;
    })
    .join('\n');
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>BetterRef Report</title>
  <style>
    body { margin: 24px; font-family: Arial, sans-serif; background: #0b1020; color: #e5e7eb; }
    h1, h2 { margin: 0 0 12px; }
    .summary { display: flex; gap: 12px; flex-wrap: wrap; margin: 16px 0 24px; }
    .pill { border: 1px solid #334155; border-radius: 8px; padding: 8px 10px; background: #111827; }
    .images { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; align-items: start; }
    img { max-width: 100%; background: #020617; border: 1px solid #334155; }
    .overlay { position: relative; display: inline-block; max-width: 100%; overflow: auto; border: 1px solid #334155; }
    .overlay img { max-width: none; display: block; }
    table { width: 100%; border-collapse: collapse; margin-top: 24px; font-size: 14px; }
    th, td { border-bottom: 1px solid #334155; padding: 8px; text-align: left; vertical-align: top; }
    th { color: #93c5fd; }
  </style>
</head>
<body>
  <h1>BetterRef Report</h1>
  <div class="summary">
    <div class="pill">Verdict: ${htmlEscape(report.verdict.verdict)}</div>
    <div class="pill">Score: ${report.verdict.score}</div>
    <div class="pill">Changed: ${report.global.metrics.changedPercent.toFixed(2)}%</div>
    <div class="pill">SSIM: ${report.global.metrics.ssim.toFixed(4)}</div>
  </div>
  <div class="images">
    <section><h2>Reference</h2><img src="${htmlEscape(imageSrc(report.referencePath))}" alt="Reference"></section>
    <section><h2>Actual</h2><img src="${htmlEscape(imageSrc(actualImagePath))}" alt="Actual"></section>
    <section><h2>Diff</h2><img src="${htmlEscape(imageSrc(report.artifacts.diffPath || 'diff.png'))}" alt="Diff"></section>
  </div>
  <h2>Region Overlay</h2>
  <div class="overlay">
    <img src="${htmlEscape(imageSrc(actualImagePath))}" alt="Region overlay">
    ${regionBoxes}
  </div>
  <h2>Top Regions</h2>
  <table>
    <thead><tr><th>Region</th><th>Status</th><th>Score</th><th>Changed</th><th>SSIM</th><th>Suggestion</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</body>
</html>
`;
  await writeFile(htmlPath, html);
}

export async function compareImages(options) {
  const {
    referencePath,
    actualPath,
    outDir,
    configPath,
    regionMode,
    ignoreRegions: cliIgnoreRegions,
    html = false,
    diffFileName = 'diff.png',
    reportFileName = 'report.json',
    htmlFileName = 'report.html'
  } = options;

  if (!referencePath) {
    throw new BetterRefInputError('Missing reference image path.');
  }
  if (!actualPath) {
    throw new BetterRefInputError('Missing actual image path.');
  }
  if (!outDir) {
    throw new BetterRefInputError('Missing output directory.');
  }

  await mkdir(outDir, { recursive: true });

  const config = await loadConfig(configPath);
  const thresholds = metricThresholds(options, config);
  const matchSize = normalizeMatchSize(options.matchSize ?? config.matchSize ?? config.normalization?.matchSize);
  const reference = await loadImage(referencePath);
  const actualSource = await loadImage(actualPath);
  let actual = actualSource;
  let actualComparedPath = null;
  let actualResized = false;
  const dimensionMismatch = reference.width !== actual.width || reference.height !== actual.height;
  const reportPath = path.join(outDir, reportFileName);
  const htmlPath = path.join(outDir, htmlFileName);

  if (dimensionMismatch && matchSize === 'reference') {
    actual = await loadImage(actualPath, { width: reference.width, height: reference.height });
    actualComparedPath = path.join(outDir, 'actual-compared.png');
    actualResized = true;
    await writeRawPng(actual, actualComparedPath);
  }

  if (dimensionMismatch && matchSize === 'strict') {
    const metrics = {
      changedPixels: reference.width * reference.height,
      totalPixels: reference.width * reference.height,
      changedPercent: 100,
      meanAbsoluteChannelDiff: 255,
      maxChannelDiff: 255,
      ssim: 0,
      hashSimilarity: 0
    };
    const global = {
      name: 'global',
      rect: { x: 0, y: 0, width: reference.width, height: reference.height },
      thresholds,
      metrics,
      score: 0,
      severity: 100,
      passed: false,
      diffPath: null,
      suggestion: 'Capture the current screenshot with the same dimensions as the reference.'
    };
    const report = {
      schemaVersion: 'betterref.visual-diff.v2',
      generatedAt: new Date().toISOString(),
      referencePath,
      actualPath,
      configPath: configPath || null,
      dimensions: {
        reference: { width: reference.width, height: reference.height },
        actual: { width: actualSource.width, height: actualSource.height },
        actualSource: { width: actualSource.width, height: actualSource.height },
        actualCompared: { width: actualSource.width, height: actualSource.height }
      },
      normalization: {
        matchSize,
        actualResized: false
      },
      thresholds,
      metrics,
      global,
      regions: [],
      artifacts: {
        reportPath,
        diffPath: null,
        actualComparedPath: null,
        htmlPath: html ? htmlPath : null
      },
      passed: false,
      verdict: makeVerdict({ passed: false, global, regions: [], dimensionMismatch: true })
    };
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    return report;
  }

  const ignoreRegions = selectIgnoreRegions(config, reference, cliIgnoreRegions);
  const regions = selectRegions(config, reference, firstValue(regionMode));
  const globalRegion = { name: 'global', x: 0, y: 0, width: reference.width, height: reference.height, weight: 1 };
  const global = await measureRegion({
    reference,
    actual,
    region: normalizeRegion(globalRegion, reference, 'global'),
    ignoreRegions,
    thresholds,
    outDir,
    writeDiff: true,
    diffFileName
  });
  const measuredRegions = [];

  for (const region of regions) {
    measuredRegions.push(
      await measureRegion({
        reference,
        actual,
        region,
        ignoreRegions,
        thresholds: regionThresholds(thresholds, region),
        outDir,
        writeDiff: true,
        diffFileName: `${safeName(region.name)}-diff.png`
      })
    );
  }

  measuredRegions.sort((left, right) => right.severity - left.severity);
  const passed = global.passed && measuredRegions.every((region) => region.passed);
  const report = {
    schemaVersion: 'betterref.visual-diff.v2',
    generatedAt: new Date().toISOString(),
    referencePath,
    actualPath,
    configPath: configPath || null,
    dimensions: {
      reference: { width: reference.width, height: reference.height },
      actual: { width: actual.width, height: actual.height },
      actualSource: { width: actualSource.width, height: actualSource.height },
      actualCompared: { width: actual.width, height: actual.height }
    },
    normalization: {
      matchSize,
      actualResized
    },
    thresholds,
    ignoreRegions: ignoreRegions.map(({ name, x, y, width, height }) => ({ name, x, y, width, height })),
    metrics: global.metrics,
    global,
    regions: measuredRegions,
    artifacts: {
      reportPath,
      diffPath: global.diffPath,
      actualComparedPath,
      htmlPath: html ? htmlPath : null
    },
    passed,
    verdict: makeVerdict({ passed, global, regions: measuredRegions, dimensionMismatch: false })
  };

  if (html) {
    await writeHtmlReport(report, htmlPath);
  }

  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
