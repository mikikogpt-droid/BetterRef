#!/usr/bin/env node
import { parseArgs, pick } from '../lib/args.mjs';
import { BetterRefEvalInputError, runEval } from '../lib/eval.mjs';

const usage = `Usage: betterref-eval --manifest <manifest.json> [options]

Required:
  --manifest            Benchmark manifest with cases[].

Options:
  --out                 Write eval report JSON.
  --json                Print eval report JSON to stdout.
  --help                Show this help.

Manifest case shape:
  { "id": "long-page-pressure", "report": "report.json", "guard": "guard.json", "prd": "prd.json", "longpage": "longpage-report.json", "assetPlan": "asset-plan.json", "browserEvidence": "browser-evidence.json", "project": ".", "require": "guard,prd,longpage,assetplan,browser", "expect": { "verdict": "fail", "hardFailPresent": true, "blockingReasonIncludes": ["long-page section hero"] } }
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

  const manifestPath = pick(values, 'manifest');
  if (!manifestPath) {
    failUsage('Missing required --manifest.');
  }

  try {
    const report = await runEval({
      manifestPath,
      outPath: values.out
    });

    if (flags.has('json')) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      const state = report.passed ? 'PASS' : 'FAIL';
      console.log(`[betterref-eval] ${state} matched=${report.summary.matched}/${report.summary.total}`);
      for (const item of report.cases.filter((entry) => !entry.matched)) {
        console.log(`[betterref-eval] ${item.id}: ${item.mismatches.join('; ')}`);
      }
    }

    process.exit(report.passed ? 0 : 1);
  } catch (error) {
    if (error instanceof BetterRefEvalInputError) {
      console.error(error.message);
      process.exit(2);
    }
    console.error(`[betterref-eval] ${error.stack || error.message}`);
    process.exit(1);
  }
}

await main();
