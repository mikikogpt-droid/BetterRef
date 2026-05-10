#!/usr/bin/env node
import { parseArgs } from '../lib/args.mjs';
import {
  attachHyperframesAssets,
  BetterRefHyperframesError,
  buildHyperframesQueue
} from '../lib/hyperframes.mjs';

const usage = `Usage: betterref-hyperframes --asset-plan <asset-plan.json> [options]

Required:
  --asset-plan          betterref-prd asset-plan JSON.

Options:
  --out                 Write HyperFrames request queue and runbook.
  --attach              Attach a rendered file as <asset-id>=<file>.
  --evidence            HyperFrames CLI evidence JSON with lint/validate/inspect/render results.
  --project             Project directory for resolving relative target paths.
  --json                Print JSON result to stdout.
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
  if (!values['asset-plan']) {
    failUsage('Missing required --asset-plan.');
  }

  try {
    const result = values.attach
      ? await attachHyperframesAssets({
          assetPlanPath: values['asset-plan'],
          attach: values.attach,
          evidencePath: values.evidence,
          projectDir: values.project
        })
      : await buildHyperframesQueue({
          assetPlanPath: values['asset-plan'],
          outDir: values.out
        });

    if (flags.has('json')) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.schemaVersion === 'betterref.hyperframes.queue.v1') {
      console.log(`[betterref-hyperframes] requests=${result.requests.length}`);
    } else {
      console.log(`[betterref-hyperframes] attached=${result.attached.length}`);
    }
  } catch (error) {
    if (error instanceof BetterRefHyperframesError) {
      console.error(error.message);
      process.exit(error.exitCode);
    }
    console.error(`[betterref-hyperframes] ${error.stack || error.message}`);
    process.exit(1);
  }
}

await main();
