#!/usr/bin/env node
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
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
  --match-size <mode>    strict or reference. Default: strict
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
    const requireFromProject = createRequire(path.join(process.cwd(), 'package.json'));
    return requireFromProject('playwright');
  } catch {
    // Fall through to bundled/hoisted resolution.
  }

  try {
    return await import('playwright');
  } catch {
    console.error(
      'Install Playwright to use betterref-capture in this project: npm install -D playwright && npx playwright install chromium'
    );
    process.exit(2);
  }
}

async function collectBrowserEvidence(page, { screenshotPath, fullPageScreenshotPath }) {
  const evidence = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const images = Array.from(document.images || []).map((image) => {
      const rect = image.getBoundingClientRect();
      return {
        src: image.currentSrc || image.src || '',
        alt: image.alt || '',
        naturalWidth: image.naturalWidth || 0,
        naturalHeight: image.naturalHeight || 0,
        renderedWidth: rect.width || image.clientWidth || 0,
        renderedHeight: rect.height || image.clientHeight || 0
      };
    });
    const cssUrlPattern = /url\((['"]?)(.*?)\1\)/gi;
    const backgroundImages = Array.from(document.querySelectorAll('*')).flatMap((element) => {
      const style = getComputedStyle(element);
      const backgroundImage = style.backgroundImage || '';
      if (!backgroundImage || backgroundImage === 'none') return [];
      const rect = element.getBoundingClientRect();
      const results = [];
      let match;
      while ((match = cssUrlPattern.exec(backgroundImage))) {
        if (!match[2] || /^(data|blob|about):/i.test(match[2])) continue;
        results.push({
          src: match[2],
          backgroundImage,
          alt: '',
          naturalWidth: 0,
          naturalHeight: 0,
          renderedWidth: rect.width || 0,
          renderedHeight: rect.height || 0,
          sourceType: 'css-background',
          tagName: element.tagName
        });
      }
      return results;
    });
    const interactiveSelector = 'a,button,input,select,textarea,[role="button"],[tabindex]:not([tabindex="-1"])';
    return {
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        deviceScaleFactor: window.devicePixelRatio || 1,
        scrollHeight: Math.max(doc?.scrollHeight || 0, body?.scrollHeight || 0),
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        url: location.href,
        title: document.title
      },
      page: {
        scrollWidth: Math.max(doc?.scrollWidth || 0, body?.scrollWidth || 0),
        scrollHeight: Math.max(doc?.scrollHeight || 0, body?.scrollHeight || 0),
        clientWidth: doc?.clientWidth || window.innerWidth,
        clientHeight: doc?.clientHeight || window.innerHeight,
        bodyTextLength: (body?.innerText || body?.textContent || '').trim().length,
        interactiveCount: document.querySelectorAll(interactiveSelector).length
      },
      fonts: {
        ready: document.fonts ? document.fonts.status === 'loaded' : true,
        status: document.fonts ? document.fonts.status : 'unsupported'
      },
      images,
      assets: {
        rendered: backgroundImages
      }
    };
  });

  return {
    ...evidence,
    console: Array.isArray(page.__betterrefConsole) ? page.__betterrefConsole : [],
    screenshotPath,
    fullPageScreenshotPath
  };
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
  const browserEvidencePath = path.join(outDir, 'browser-evidence.json');
  const fullPage = flags.has('full-page');
  const browser = await chromium.launch({ headless: true });
  let browserEvidence;
  try {
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: numberValue(values['device-scale'], 1, '--device-scale')
    });
    const page = await context.newPage();
    page.__betterrefConsole = [];
    page.on('console', (message) => {
      page.__betterrefConsole.push({
        type: message.type(),
        text: message.text()
      });
    });
    page.on('pageerror', (error) => {
      page.__betterrefConsole.push({
        type: 'error',
        text: error.message
      });
    });
    await page.goto(url, {
      waitUntil: values['wait-until'] || 'load',
      timeout: numberValue(values.timeout, 30000, '--timeout')
    });
    await page.screenshot({
      path: screenshotPath,
      fullPage
    });
    browserEvidence = await collectBrowserEvidence(page, {
      screenshotPath,
      fullPageScreenshotPath: fullPage ? screenshotPath : null
    });
    await writeFile(browserEvidencePath, `${JSON.stringify(browserEvidence, null, 2)}\n`);
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
    browserEvidencePath,
    fullPageScreenshotPath: fullPage ? screenshotPath : null,
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
      matchSize: values['match-size'],
      ignoreRegions: values['ignore-region'],
      html: flags.has('html')
    });
  }

  if (flags.has('json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`[betterref-capture] screenshot=${screenshotPath}`);
    console.log(`[betterref-capture] browser-evidence=${browserEvidencePath}`);
    if (result.diff) {
      console.log(`[betterref-capture] diff-report=${result.diff.artifacts.reportPath}`);
    }
  }

  process.exit(result.diff && !result.diff.passed ? 1 : 0);
}

await main();
