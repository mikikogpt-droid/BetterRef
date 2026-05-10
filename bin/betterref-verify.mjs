#!/usr/bin/env node
import { parseArgs, pick } from '../lib/args.mjs';
import { BetterRefVerifyInputError, verifyFinal } from '../lib/verify.mjs';

const usage = `Usage: betterref-verify --report <report.json> [options]

Required:
  --report              BetterRef visual report JSON.

Options:
  --guard               betterref-guard report JSON.
  --prd                 PRD checklist JSON with items[].status.
  --longpage            betterref-longpage report JSON.
  --asset-plan          betterref-prd asset-plan JSON.
  --out                 Write final verdict JSON.
  --html                Write final verdict HTML report.
  --bundle              Write evidence bundle JSON with artifact hashes.
  --require             Required evidence list: guard,prd,longpage or all.
  --json                Print final verdict JSON to stdout.
  --help                Show this help.
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
    const report = await verifyFinal({
      reportPath,
      guardPath: values.guard,
      prdPath: values.prd,
      longPagePath: values.longpage,
      assetPlanPath: values['asset-plan'],
      outPath: values.out,
      htmlPath: values.html,
      bundlePath: values.bundle,
      requiredEvidence: values.require
    });

    if (flags.has('json')) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`[betterref-verify] ${report.verdict.toUpperCase()} hardFail=${report.hardFailPresent}`);
      for (const reason of report.blockingReasons) {
        console.log(`[betterref-verify] ${reason}`);
      }
    }

    process.exit(report.passed ? 0 : 1);
  } catch (error) {
    if (error instanceof BetterRefVerifyInputError) {
      console.error(error.message);
      process.exit(2);
    }
    console.error(`[betterref-verify] ${error.stack || error.message}`);
    process.exit(1);
  }
}

await main();
