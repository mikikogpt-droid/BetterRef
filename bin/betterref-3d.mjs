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
  --asset-plan             betterref-prd asset-plan JSON for preserving PRD 3D ids/targets.
  --plan                   3d-asset-plan.json for handoff or verify.
  --evidence               3d-evidence.json for --verify.
  --hunyuan-request        Hunyuan request metadata JSON for --verify.
  --hunyuan-response       Hunyuan response metadata JSON for --verify.
  --format                 Target 3D format for generated assets, default glb.
  --provider               Hunyuan provider: space, endpoint, both, custom, or tencent.
  --space                  Hugging Face Space id for space provider.
  --endpoint               Hugging Face Inference Endpoint URL.
  --custom-url             Custom Hunyuan wrapper URL.
  --tencent-endpoint       Tencent Cloud Hunyuan3D endpoint host, default hunyuan3d.tencentcloudapi.com.
  --tencent-region         Tencent Cloud region, default ap-guangzhou.
  --tencent-edition        Tencent Hunyuan3D API edition: pro or rapid, default pro.
  --tencent-model          Tencent Hunyuan3D model version, default 3.1 for pro.
  --result-format          Tencent output format, default GLB.
  --enable-pbr             Tencent PBR material generation flag, default true for pro.
  --face-count             Tencent target face count when supported.
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
        format: values.format,
        assetPlanPath: values['asset-plan']
      });
    } else if (mode === 'make-hunyuan-request') {
      result = await makeHunyuanRequest({
        planPath: requireValue(values, 'plan', '--make-hunyuan-request'),
        outDir: values.out,
        provider: values.provider,
        space: values.space,
        endpoint: values.endpoint,
        customUrl: values['custom-url'],
        tencentEndpoint: values['tencent-endpoint'],
        tencentRegion: values['tencent-region'],
        tencentEdition: values['tencent-edition'],
        tencentModel: values['tencent-model'],
        resultFormat: values['result-format'],
        enablePBR: values['enable-pbr'],
        faceCount: values['face-count']
      });
    } else {
      result = await verify3D({
        planPath: requireValue(values, 'plan', '--verify'),
        evidencePath: values.evidence,
        outDir: values.out,
        projectDir: values.project,
        hunyuanRequestPath: values['hunyuan-request'],
        hunyuanResponsePath: values['hunyuan-response']
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
