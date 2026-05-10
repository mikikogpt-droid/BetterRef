#!/usr/bin/env node
import { parseArgs } from '../lib/args.mjs';
import {
  attachGeneratedAssets,
  autoAttachGeneratedAssets,
  BetterRefImagegenError,
  buildImagegenQueue
} from '../lib/imagegen.mjs';

const usage = `Usage: betterref-imagegen --asset-plan <asset-plan.json> [options]

Required:
  --asset-plan          betterref-prd asset-plan JSON.

Options:
  --out                 Write built-in image_gen request queue and prompt markdown.
  --attach              Attach a generated file as <asset-id>=<file>.
  --auto-attach-dir     Attach generated files named <asset-id>.* from a directory.
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
    let result;
    if (values['auto-attach-dir']) {
      result = await autoAttachGeneratedAssets({
        assetPlanPath: values['asset-plan'],
        autoAttachDir: values['auto-attach-dir'],
        projectDir: values.project
      });
    } else if (values.attach) {
      result = await attachGeneratedAssets({
        assetPlanPath: values['asset-plan'],
        attach: values.attach,
        projectDir: values.project
      });
    } else {
      result = await buildImagegenQueue({
        assetPlanPath: values['asset-plan'],
        outDir: values.out
      });
    }

    if (flags.has('json')) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.schemaVersion === 'betterref.imagegen.queue.v1') {
      console.log(`[betterref-imagegen] requests=${result.requests.length}`);
    } else {
      console.log(`[betterref-imagegen] attached=${result.attached.length}`);
    }
  } catch (error) {
    if (error instanceof BetterRefImagegenError) {
      console.error(error.message);
      process.exit(error.exitCode);
    }
    console.error(`[betterref-imagegen] ${error.stack || error.message}`);
    process.exit(1);
  }
}

await main();
