#!/usr/bin/env node
import { parseArgs, pick, numberValue } from '../lib/args.mjs';
import { BetterRefLongpageError, compareLongPage } from '../lib/longpage.mjs';

const usage = `Usage: betterref-longpage --ref <reference> --browser-evidence <browser-evidence.json> --out <dir> [options]

Required:
  --ref, --reference       Long-page reference image.
  --browser-evidence       Browser evidence JSON from betterref-chrome.
  --out                    Output directory for cropped reference, section diffs, and longpage-report.json.

Options:
  --actual-full <path>      Full-page actual screenshot. Defaults to browserEvidence.fullPageScreenshotPath.
  --crop-reference <mode>   auto or none. Default: auto.
  --max-changed <n>         Maximum changed pixel percent for each diff.
  --max-mean <n>            Maximum mean absolute RGB channel diff for each diff.
  --min-ssim <n>            Minimum SSIM perceptual score from 0 to 1.
  --threshold <n>           Pixelmatch threshold from 0 to 1.
  --match-size <mode>       strict or reference. Default: strict.
  --html                   Write HTML reports for full page and sections.
  --json                   Print full JSON report to stdout.
  --help                   Show this help.
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

  const referencePath = pick(values, 'ref', 'reference');
  if (!referencePath || !values['browser-evidence'] || !values.out) {
    failUsage('Missing required --ref, --browser-evidence, or --out.');
  }

  try {
    const report = await compareLongPage({
      referencePath,
      actualFullPath: values['actual-full'],
      browserEvidencePath: values['browser-evidence'],
      outDir: values.out,
      cropReference: values['crop-reference'],
      maxChangedPercent: numberValue(values['max-changed'], undefined, '--max-changed'),
      maxMeanDiff: numberValue(values['max-mean'], undefined, '--max-mean'),
      minSsim: numberValue(values['min-ssim'], undefined, '--min-ssim'),
      pixelThreshold: numberValue(values.threshold, undefined, '--threshold'),
      matchSize: values['match-size'],
      html: flags.has('html')
    });

    if (flags.has('json')) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      const state = report.passed ? 'PASS' : 'FAIL';
      console.log(`[betterref-longpage] ${state} score=${report.verdict.score} sections=${report.sections.length}`);
      console.log(`[betterref-longpage] report=${report.artifacts.reportPath}`);
      console.log(`[betterref-longpage] reference-cropped=${report.artifacts.referenceCroppedPath}`);
    }

    process.exit(report.passed ? 0 : 1);
  } catch (error) {
    if (error instanceof BetterRefLongpageError) {
      console.error(error.message);
      process.exit(2);
    }
    console.error(`[betterref-longpage] ${error.stack || error.message}`);
    process.exit(1);
  }
}

await main();
