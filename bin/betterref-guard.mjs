#!/usr/bin/env node
import { parseArgs, pick } from '../lib/args.mjs';
import { BetterRefGuardInputError, runGuard } from '../lib/guard.mjs';

const usage = `Usage: betterref-guard --report <report.json> [options]

Required:
  --report              BetterRef report JSON to audit.

Options:
  --project             Project directory to scan for reference-only assets used as UI.
  --config              Guard config JSON.
  --out                 Write guard report JSON.
  --json                Print guard report JSON to stdout.
  --help                Show this help.

Guard config fields:
  longReference: true
  targetViewport: { "width": 1440, "height": 900 }
  actualFullPageHeight: 1800
  forbiddenSourcePatterns: ["assets/reference", "homepage-reference", "pdf-render"]
  sourceExtensions: [".tsx", ".jsx", ".css"]
  renderedAssets: [{ "src": "/hero.png", "nativeWidth": 640, "nativeHeight": 360, "renderedWidth": 1280, "renderedHeight": 720 }]
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

  const reportPath = pick(values, 'report');
  if (!reportPath) {
    failUsage('Missing required --report.');
  }

  try {
    const report = await runGuard({
      reportPath,
      projectDir: values.project,
      configPath: values.config,
      outPath: values.out
    });

    if (flags.has('json')) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      const state = report.passed ? 'PASS' : 'FAIL';
      console.log(`[betterref-guard] ${state} hardFails=${report.hardFails.length}`);
      for (const hardFail of report.hardFails) {
        console.log(`[betterref-guard] ${hardFail.code}: ${hardFail.message}`);
      }
    }

    process.exit(report.passed ? 0 : 1);
  } catch (error) {
    if (error instanceof BetterRefGuardInputError) {
      console.error(error.message);
      process.exit(2);
    }
    console.error(`[betterref-guard] ${error.stack || error.message}`);
    process.exit(1);
  }
}

await main();
