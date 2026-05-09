#!/usr/bin/env node
import { parseArgs, pick, numberValue } from '../lib/args.mjs';
import { BetterRefInputError, compareImages } from '../lib/diff.mjs';

const usage = `Usage: betterref-diff --ref <image> --actual <image> --out <dir> [options]

Required:
  --ref, --reference     Reference image path.
  --actual, --current    Current/actual screenshot path.
  --out                  Output directory for report.json and diff.png.

Options:
  --max-changed <n>      Maximum changed pixel percent. Default: 2
  --max-mean <n>         Maximum mean absolute RGB channel diff. Default: 4
  --min-ssim <n>         Minimum SSIM perceptual score from 0 to 1. Default: 0.99
  --threshold <n>        Pixelmatch threshold from 0 to 1. Default: 0.1
  --config <path>        Optional .betterref.json config.
  --regions <mode>       Region mode: auto, config, or both. Default: config if available, else auto
  --ignore-region <spec> Ignore dynamic region, format name,x,y,width,height. Repeatable.
  --html                 Write report.html.
  --json                 Print full JSON report to stdout.
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

  const referencePath = pick(values, 'ref', 'reference');
  const actualPath = pick(values, 'actual', 'current');
  if (!referencePath || !actualPath || !values.out) {
    failUsage('Missing required --ref, --actual, or --out.');
  }

  try {
    const report = await compareImages({
      referencePath,
      actualPath,
      outDir: values.out,
      maxChangedPercent: numberValue(values['max-changed'], undefined, '--max-changed'),
      maxMeanDiff: numberValue(values['max-mean'], undefined, '--max-mean'),
      minSsim: numberValue(values['min-ssim'], undefined, '--min-ssim'),
      pixelThreshold: numberValue(values.threshold, undefined, '--threshold'),
      configPath: values.config,
      regionMode: values.regions,
      ignoreRegions: values['ignore-region'],
      html: flags.has('html')
    });

    if (flags.has('json')) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      const state = report.passed ? 'PASS' : 'REVISE';
      console.log(
        `[betterref-diff] ${state} changed=${report.metrics.changedPercent.toFixed(4)}% ` +
          `mean=${report.metrics.meanAbsoluteChannelDiff.toFixed(4)} ` +
          `ssim=${report.metrics.ssim.toFixed(4)} score=${report.verdict.score}`
      );
      console.log(`[betterref-diff] report=${report.artifacts.reportPath}`);
      if (report.artifacts.diffPath) {
        console.log(`[betterref-diff] diff=${report.artifacts.diffPath}`);
      }
      if (report.artifacts.htmlPath) {
        console.log(`[betterref-diff] html=${report.artifacts.htmlPath}`);
      }
    }

    process.exit(report.passed ? 0 : 1);
  } catch (error) {
    if (error instanceof BetterRefInputError) {
      console.error(error.message);
      process.exit(2);
    }
    console.error(`[betterref-diff] ${error.stack || error.message}`);
    process.exit(1);
  }
}

await main();
