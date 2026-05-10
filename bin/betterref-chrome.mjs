#!/usr/bin/env node
import { parseArgs, numberValue } from '../lib/args.mjs';
import { BetterRefChromeError, captureChrome, listChromeTargets } from '../lib/chrome.mjs';

const usage = `Usage: betterref-chrome --out <dir> [options]

Required:
  --out                  Output directory for Chrome screenshot, DOM boxes, config, and optional diff.

Options:
  --endpoint <url>       Chrome DevTools endpoint. Default: http://127.0.0.1:9222
  --list                 List debuggable Chrome page targets and exit.
  --target-id <id>       Select a target by Chrome target id.
  --url-match <text>     Select the first target whose URL contains text.
  --title-match <text>   Select the first target whose title contains text.
  --selector <name=css>  DOM region selector. Repeatable. Defaults to common layout selectors.
  --wait-ms <n>          Wait before measuring/capturing. Default: 0
  --full-page            Also capture a native full-page screenshot.
  --section-screenshots  Also capture one screenshot per measured selector.
  --ref, --reference     Optional reference image path. If provided, diff immediately.
  --merge-config <path>  Existing .betterref.json to preserve thresholds and ignoreRegions.
  --regions <mode>       Diff region mode: auto, config, or both.
  --match-size <mode>    strict or reference. Default: strict
  --max-changed <n>      Maximum changed pixel percent for diff.
  --max-mean <n>         Maximum mean absolute RGB channel diff for diff.
  --min-ssim <n>         Minimum SSIM perceptual score from 0 to 1.
  --threshold <n>        Pixelmatch threshold from 0 to 1.
  --html                 Write report.html when diffing.
  --json                 Print JSON result to stdout.
  --help                 Show this help.
`;

function failUsage(message) {
  if (message) {
    console.error(message);
  }
  console.error(usage);
  process.exit(2);
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
  if (!values.out) {
    failUsage('Missing required --out.');
  }

  const endpoint = values.endpoint || 'http://127.0.0.1:9222';

  try {
    if (flags.has('list')) {
      const targets = await listChromeTargets(endpoint);
      const payload = { schemaVersion: 'betterref.chrome.targets.v1', endpoint, targets };
      if (flags.has('json')) {
        console.log(JSON.stringify(payload, null, 2));
      } else {
        for (const target of targets) {
          console.log(`${target.id}\t${target.title || ''}\t${target.url || ''}`);
        }
      }
      process.exit(0);
    }

    const result = await captureChrome({
      endpoint,
      outDir: values.out,
      targetId: values['target-id'],
      urlMatch: values['url-match'],
      titleMatch: values['title-match'],
      selectors: values.selector,
      waitMs: numberValue(values['wait-ms'], 0, '--wait-ms'),
      referencePath: values.ref || values.reference,
      mergeConfigPath: values['merge-config'],
      regionMode: values.regions,
      html: flags.has('html'),
      matchSize: values['match-size'],
      fullPage: flags.has('full-page'),
      sectionScreenshots: flags.has('section-screenshots'),
      maxChangedPercent: numberValue(values['max-changed'], undefined, '--max-changed'),
      maxMeanDiff: numberValue(values['max-mean'], undefined, '--max-mean'),
      minSsim: numberValue(values['min-ssim'], undefined, '--min-ssim'),
      pixelThreshold: numberValue(values.threshold, undefined, '--threshold')
    });

    if (flags.has('json')) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`[betterref-chrome] screenshot=${result.artifacts.screenshotPath}`);
      if (result.artifacts.fullPageScreenshotPath) {
        console.log(`[betterref-chrome] full-page=${result.artifacts.fullPageScreenshotPath}`);
      }
      for (const section of result.artifacts.sectionScreenshotPaths || []) {
        console.log(`[betterref-chrome] section=${section.name}:${section.path}`);
      }
      console.log(`[betterref-chrome] dom-boxes=${result.artifacts.domBoxesPath}`);
      console.log(`[betterref-chrome] config=${result.artifacts.configPath}`);
      if (result.diff) {
        console.log(`[betterref-chrome] diff-report=${result.diff.artifacts.reportPath}`);
      }
    }

    process.exit(result.diff && !result.diff.passed ? 1 : 0);
  } catch (error) {
    if (error instanceof BetterRefChromeError) {
      console.error(error.message);
      process.exit(2);
    }
    console.error(`[betterref-chrome] ${error.stack || error.message}`);
    process.exit(1);
  }
}

await main();
