#!/usr/bin/env node
import { parseArgs, pick } from '../lib/args.mjs';
import { analyzeReference, BetterRefReferenceError } from '../lib/reference.mjs';

const usage = `Usage: betterref-reference --ref <reference.png> --out <dir> [options]

Required:
  --ref, --reference     Reference image path.
  --out                  Output directory for reference analysis artifacts.

Options:
  --target               Comma-separated targets: ui,3d,hunyuan.
  --json                 Print JSON result to stdout.
  --help                 Show this help.
`;

function failUsage(message) {
  if (message) console.error(message);
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
  if (!referencePath || !values.out) {
    failUsage('Missing required --ref or --out.');
  }

  try {
    const result = await analyzeReference({
      referencePath,
      outDir: values.out,
      target: values.target
    });
    if (flags.has('json')) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`[betterref-reference] analysis=${result.artifacts.analysisPath}`);
      console.log(`[betterref-reference] checklist=${result.artifacts.visualChecklistPath}`);
      console.log(`[betterref-reference] threeDBrief=${result.artifacts.threeDBriefPath}`);
    }
  } catch (error) {
    if (error instanceof BetterRefReferenceError) {
      console.error(error.message);
      process.exit(2);
    }
    console.error(`[betterref-reference] ${error.stack || error.message}`);
    process.exit(1);
  }
}

await main();
