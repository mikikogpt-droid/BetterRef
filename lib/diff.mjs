import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import sharp from 'sharp';

export class BetterRefInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BetterRefInputError';
  }
}

async function loadImage(filePath) {
  const image = sharp(filePath, { limitInputPixels: false }).ensureAlpha();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  return {
    data,
    width: info.width,
    height: info.height,
    channels: info.channels
  };
}

function measureChannelDiff(reference, actual) {
  let total = 0;
  let max = 0;
  const pixelCount = reference.width * reference.height;

  for (let i = 0; i < pixelCount; i += 1) {
    const offset = i * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      const diff = Math.abs(reference.data[offset + channel] - actual.data[offset + channel]);
      total += diff;
      if (diff > max) {
        max = diff;
      }
    }
  }

  return {
    meanAbsoluteChannelDiff: total / (pixelCount * 3),
    maxChannelDiff: max
  };
}

function scoreFromMetrics(metrics) {
  const changedPenalty = metrics.changedPercent;
  const meanPenalty = (metrics.meanAbsoluteChannelDiff / 255) * 100;
  return Math.max(0, Math.round(100 - Math.max(changedPenalty, meanPenalty)));
}

function makeVerdict({ passed, metrics, dimensionMismatch }) {
  const score = dimensionMismatch ? 0 : scoreFromMetrics(metrics);
  const differences = [];
  const suggestions = [];

  if (dimensionMismatch) {
    differences.push('Reference and actual image dimensions differ.');
    suggestions.push('Capture the current screenshot with the same viewport and device scale as the reference.');
  }

  if (!passed && !dimensionMismatch) {
    differences.push('Pixel mismatch exceeds the configured BetterRef threshold.');
    suggestions.push('Inspect diff.png hotspots and patch the largest visible layout, typography, asset, or spacing mismatch first.');
  }

  return {
    score,
    verdict: passed ? 'pass' : 'revise',
    category_match: null,
    same_state: null,
    hard_fail_present: !passed,
    differences,
    suggestions,
    reasoning: passed
      ? 'Pixel diff is within the configured BetterRef thresholds.'
      : 'Pixel diff is outside the configured BetterRef thresholds.'
  };
}

export async function compareImages(options) {
  const {
    referencePath,
    actualPath,
    outDir,
    maxChangedPercent = 2,
    maxMeanDiff = 4,
    pixelThreshold = 0.1,
    diffFileName = 'diff.png',
    reportFileName = 'report.json'
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

  const reference = await loadImage(referencePath);
  const actual = await loadImage(actualPath);
  const dimensionMismatch = reference.width !== actual.width || reference.height !== actual.height;

  if (dimensionMismatch) {
    const metrics = {
      changedPixels: reference.width * reference.height,
      totalPixels: reference.width * reference.height,
      changedPercent: 100,
      meanAbsoluteChannelDiff: 255,
      maxChannelDiff: 255
    };
    const report = {
      schemaVersion: 'betterref.visual-diff.v1',
      generatedAt: new Date().toISOString(),
      referencePath,
      actualPath,
      dimensions: {
        reference: { width: reference.width, height: reference.height },
        actual: { width: actual.width, height: actual.height }
      },
      thresholds: { maxChangedPercent, maxMeanDiff, pixelThreshold },
      metrics,
      artifacts: {
        reportPath: path.join(outDir, reportFileName),
        diffPath: null
      },
      passed: false,
      verdict: makeVerdict({ passed: false, metrics, dimensionMismatch: true })
    };
    await writeFile(path.join(outDir, reportFileName), `${JSON.stringify(report, null, 2)}\n`);
    return report;
  }

  const diffPng = new PNG({ width: reference.width, height: reference.height });
  const changedPixels = pixelmatch(
    reference.data,
    actual.data,
    diffPng.data,
    reference.width,
    reference.height,
    { threshold: pixelThreshold }
  );
  const channelDiff = measureChannelDiff(reference, actual);
  const totalPixels = reference.width * reference.height;
  const changedPercent = totalPixels === 0 ? 0 : (changedPixels / totalPixels) * 100;
  const metrics = {
    changedPixels,
    totalPixels,
    changedPercent,
    meanAbsoluteChannelDiff: channelDiff.meanAbsoluteChannelDiff,
    maxChannelDiff: channelDiff.maxChannelDiff
  };
  const passed = changedPercent <= maxChangedPercent && metrics.meanAbsoluteChannelDiff <= maxMeanDiff;
  const diffPath = path.join(outDir, diffFileName);
  const reportPath = path.join(outDir, reportFileName);

  await writeFile(diffPath, PNG.sync.write(diffPng));

  const report = {
    schemaVersion: 'betterref.visual-diff.v1',
    generatedAt: new Date().toISOString(),
    referencePath,
    actualPath,
    dimensions: {
      reference: { width: reference.width, height: reference.height },
      actual: { width: actual.width, height: actual.height }
    },
    thresholds: { maxChangedPercent, maxMeanDiff, pixelThreshold },
    metrics,
    artifacts: { reportPath, diffPath },
    passed,
    verdict: makeVerdict({ passed, metrics, dimensionMismatch: false })
  };

  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
