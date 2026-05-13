#!/usr/bin/env node
import { parseArgs, pick } from '../lib/args.mjs';
import { analyzeReference, analyzeReferencePack, BetterRefReferenceError } from '../lib/reference.mjs';

const usage = `Usage: betterref-reference (--ref <reference.png> | --pack <reference-pack.json>) --out <dir> [options]

Required:
  --ref, --reference     Reference image path.
  --pack                 Reference pack JSON for Asset Brief generation.
  --out                  Output directory for reference analysis artifacts.

Options:
  --target               Comma-separated targets: ui,3d,hunyuan,roblox.
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
  const packPath = values.pack;
  if ((!referencePath && !packPath) || !values.out) {
    failUsage('Missing required --ref/--pack or --out.');
  }
  if (referencePath && packPath) {
    failUsage('Use either --ref or --pack, not both.');
  }

  try {
    const result = packPath
      ? await analyzeReferencePack({
          packPath,
          outDir: values.out,
          target: values.target
        })
      : await analyzeReference({
          referencePath,
          outDir: values.out,
          target: values.target
        });
    if (flags.has('json')) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.schemaVersion === 'betterref.reference.pack.result.v1') {
      console.log(`[betterref-reference] assetBrief=${result.artifacts.assetBriefPath}`);
      console.log(`[betterref-reference] textureRefs=${result.artifacts.textureHandoffPath}`);
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
