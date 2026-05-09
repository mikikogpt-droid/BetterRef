#!/usr/bin/env node
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs, pick, numberValue } from '../lib/args.mjs';
import { compareImages } from '../lib/diff.mjs';

const usage = `Usage: betterref-capture --url <url> --out <dir> [options]

Required:
  --url                  Page URL to capture.
  --out                  Output directory for screenshot.png and optional diff report.

Options:
  --ref, --reference     Reference image path. If provided, capture is diffed immediately.
  --viewport <WxH>       Browser viewport. Default: 1440x900
  --device-scale <n>     Device scale factor. Default: 1
  --full-page            Capture the full page instead of the viewport.
  --wait-until <state>   Playwright goto wait state. Default: load
  --timeout <ms>         Navigation timeout. Default: 30000
  --max-changed <n>      Maximum changed pixel percent for diff. Default: 2
  --max-mean <n>         Maximum mean absolute RGB channel diff for diff. Default: 4
  --min-ssim <n>         Minimum SSIM perceptual score from 0 to 1. Default: 0.99
  --threshold <n>        Pixelmatch threshold from 0 to 1. Default: 0.1
  --config <path>        Optional .betterref.json config for diff.
  --regions <mode>       Region mode: auto, config, or both. Default: config if available, else auto
  --ignore-region <spec> Ignore dynamic region, format name,x,y,width,height. Repeatable.
  --html                 Write report.html when diffing.
  --json                 Print full JSON result to stdout.
  --help                 Show this help.
`;

function failUsage(message) {
  if (message) {
    console.error(message);
  }
  console.error(usage);
  process.exit(2);
}

function parseViewport(value) {
  const source = value || '1440x900';
  const match = /^(\d+)x(\d+)$/i.exec(source);
  if (!match) {
    throw new Error('--viewport must use WxH format, for example 1440x900');
  }
  return {
    width: Number(match[1]),
    height: Number(match[2])
  };
}

async function loadPlaywright() {
  if (process.env.BETTERREF_FORCE_NO_PLAYWRIGHT === '1') {
    console.error(
      'Install Playwright to use betterref-capture: npm install -D playwright && npx playwright install chromium'
    );
    process.exit(2);
  }

  try {
    return await import('playwright');
  } catch {
    console.error(
      'Install Playwright to use betterref-capture: npm install -D playwright && npx playwright install chromium'
    );
    process.exit(2);
  }
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    failUsage(error.message);
  }

  const { values, flags } = parsed;
  if (flags.has('help') || flags.has('h')) {
    console.log(usage);
    return;
  }

  const url = values.url;
  const outDir = values.out;
  if (!url || !outDir) {
    failUsage('Missing required --url or --out.');
  }

  let viewport;
  try {
    viewport = parseViewport(values.viewport);
  } catch (error) {
    failUsage(error.message);
  }

  const { chromium } = await loadPlaywright();
  await mkdir(outDir, { recursive: true });

  const screenshotPath = path.join(outDir, 'screenshot.png');
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: numberValue(values['device-scale'], 1, '--device-scale')
    });
    const page = await context.newPage();
    await page.goto(url, {
      waitUntil: values['wait-until'] || 'load',
      timeout: numberValue(values.timeout, 30000, '--timeout')
    });
    await page.screenshot({
      path: screenshotPath,
      fullPage: flags.has('full-page')
    });
    await context.close();
  } finally {
    await browser.close();
  }

  const referencePath = pick(values, 'ref', 'reference');
  const result = {
    schemaVersion: 'betterref.capture.v1',
    generatedAt: new Date().toISOString(),
    url,
    viewport,
    screenshotPath,
    diff: null
  };

  if (referencePath) {
    result.diff = await compareImages({
      referencePath,
      actualPath: screenshotPath,
      outDir,
      maxChangedPercent: numberValue(values['max-changed'], undefined, '--max-changed'),
      maxMeanDiff: numberValue(values['max-mean'], undefined, '--max-mean'),
      minSsim: numberValue(values['min-ssim'], undefined, '--min-ssim'),
      pixelThreshold: numberValue(values.threshold, undefined, '--threshold'),
      configPath: values.config,
      regionMode: values.regions,
      ignoreRegions: values['ignore-region'],
      html: flags.has('html')
    });
  }

  if (flags.has('json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`[betterref-capture] screenshot=${screenshotPath}`);
    if (result.diff) {
      console.log(`[betterref-capture] diff-report=${result.diff.artifacts.reportPath}`);
    }
  }

  process.exit(result.diff && !result.diff.passed ? 1 : 0);
}

await main();
