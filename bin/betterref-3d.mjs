#!/usr/bin/env node
import { parseArgs } from '../lib/args.mjs';
import {
  BetterRef3DError,
  make3DAssetPlan,
  makeHunyuanRequest,
  verify3D
} from '../lib/threeD.mjs';

const usage = `Usage: betterref-3d <mode> --out <dir> [options]

Modes:
  --make-plan              Create 3d-asset-plan.json from reference analysis.
  --make-hunyuan-request   Create hunyuan-request.json from a 3D asset plan.
  --verify                 Verify model files, mesh stats, and render evidence.

Required:
  --out                    Output directory for 3D artifacts.

Options:
  --analysis               reference-analysis.json for --make-plan.
  --plan                   3d-asset-plan.json for handoff or verify.
  --evidence               3d-evidence.json for --verify.
  --format                 Target 3D format for generated assets, default glb.
  --provider               Hunyuan provider: space, endpoint, both, or custom.
  --space                  Hugging Face Space id for space provider.
  --endpoint               Hugging Face Inference Endpoint URL.
  --custom-url             Custom Hunyuan wrapper URL.
  --project                Project directory for resolving model evidence paths.
  --json                   Print JSON result to stdout.
  --help                   Show this help.
`;

function failUsage(message) {
  if (message) {
    console.error(message);
  }
  console.error(usage);
  process.exit(2);
}

function hasMode(parsed, mode) {
  return parsed.flags.has(mode) || parsed.values[mode] !== undefined;
}

function requireValue(values, key, mode) {
  if (!values[key]) {
    failUsage(`Missing required --${key} for ${mode}.`);
  }
  return values[key];
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

  const modes = ['make-plan', 'make-hunyuan-request', 'verify'].filter((mode) => hasMode(parsed, mode));
  if (modes.length !== 1) {
    failUsage('Specify exactly one mode: --make-plan, --make-hunyuan-request, or --verify.');
  }
  if (!values.out) {
    failUsage('Missing required --out.');
  }

  try {
    let result;
    const mode = modes[0];
    if (mode === 'make-plan') {
      result = await make3DAssetPlan({
        analysisPath: requireValue(values, 'analysis', '--make-plan'),
        outDir: values.out,
        format: values.format
      });
    } else if (mode === 'make-hunyuan-request') {
      result = await makeHunyuanRequest({
        planPath: requireValue(values, 'plan', '--make-hunyuan-request'),
        outDir: values.out,
        provider: values.provider,
        space: values.space,
        endpoint: values.endpoint,
        customUrl: values['custom-url']
      });
    } else {
      result = await verify3D({
        planPath: requireValue(values, 'plan', '--verify'),
        evidencePath: values.evidence,
        outDir: values.out,
        projectDir: values.project
      });
    }

    if (flags.has('json')) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.schemaVersion === 'betterref.3d.plan.result.v1') {
      console.log(`[betterref-3d] plan=${result.artifacts.planPath}`);
    } else if (result.schemaVersion === 'betterref.hunyuan.request.v1') {
      console.log(`[betterref-3d] hunyuanRequest=${result.artifacts.requestPath}`);
    } else {
      console.log(`[betterref-3d] verdict=${result.verdict} blockingReasons=${result.blockingReasons.length}`);
    }

    if (mode === 'verify' && !result.passed) {
      process.exit(1);
    }
  } catch (error) {
    if (error instanceof BetterRef3DError) {
      console.error(error.message);
      process.exit(error.exitCode);
    }
    console.error(`[betterref-3d] ${error.stack || error.message}`);
    process.exit(1);
  }
}

await main();
