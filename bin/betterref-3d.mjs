#!/usr/bin/env node
import { parseArgs } from '../lib/args.mjs';
import {
  BetterRef3DError,
  make3DAssetPlan,
  makeHunyuanRequest,
  makePostHunyuanRefinePlan,
  verify3D
} from '../lib/threeD.mjs';
import { autoRefine3D, uploadRobloxAsset } from '../lib/threeDProduction.mjs';

const usage = `Usage: betterref-3d <mode> --out <dir> [options]

Modes:
  --make-plan              Create 3d-asset-plan.json from reference analysis.
  --make-hunyuan-request   Create hunyuan-request.json from a 3D asset plan.
  --make-refine-plan       Create post-Hunyuan refinement plan and checklist.
  --auto-refine            Run or plan Blender-based post-Hunyuan refinement.
  --roblox-upload          Upload refined model through Roblox Open Cloud Assets API.
  --verify                 Verify model files, mesh stats, and render evidence.

Required:
  --out                    Output directory for 3D artifacts.

Options:
  --analysis               reference-analysis.json for --make-plan.
  --asset-plan             betterref-prd asset-plan JSON for preserving PRD 3D ids/targets.
  --plan                   3d-asset-plan.json for handoff or verify.
  --refine-plan            3d-refine-plan.json for --auto-refine.
  --evidence               3d-evidence.json for --verify.
  --hunyuan-request        Hunyuan request metadata JSON for --verify or --make-refine-plan.
  --hunyuan-response       Hunyuan response metadata JSON for --verify or --make-refine-plan.
  --asset-brief            BetterRef Asset Brief JSON for texture refs and Roblox gates.
  --blender                Blender executable path for --auto-refine.
  --dry-run                Plan auto-refine or Roblox upload without external execution.
  --asset-id               Asset id to upload when evidence has multiple assets.
  --model                  Model file path override for --roblox-upload.
  --creator-user-id        Roblox creator user id for Open Cloud upload.
  --creator-group-id       Roblox creator group id for Open Cloud upload.
  --display-name           Roblox asset display name.
  --description            Roblox asset description.
  --roblox-api-key         Roblox Open Cloud API key; otherwise ROBLOX_OPEN_CLOUD_API_KEY.
  --roblox-api-base        Roblox API base URL, default https://apis.roblox.com.
  --poll-interval-ms       Roblox operation poll interval, default 1000.
  --poll-attempts          Roblox operation poll attempts, default 30.
  --format                 Target 3D format for generated assets, default glb.
  --provider               Hunyuan provider; only tencent is supported.
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

  const modes = ['make-plan', 'make-hunyuan-request', 'make-refine-plan', 'auto-refine', 'roblox-upload', 'verify'].filter((mode) => hasMode(parsed, mode));
  if (modes.length !== 1) {
    failUsage('Specify exactly one mode: --make-plan, --make-hunyuan-request, --make-refine-plan, --auto-refine, --roblox-upload, or --verify.');
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
    } else if (mode === 'make-refine-plan') {
      result = await makePostHunyuanRefinePlan({
        planPath: requireValue(values, 'plan', '--make-refine-plan'),
        outDir: values.out,
        hunyuanResponsePath: requireValue(values, 'hunyuan-response', '--make-refine-plan'),
        hunyuanRequestPath: values['hunyuan-request'],
        evidencePath: values.evidence,
        assetBriefPath: values['asset-brief'],
        projectDir: values.project
      });
    } else if (mode === 'auto-refine') {
      result = await autoRefine3D({
        refinePlanPath: requireValue(values, 'refine-plan', '--auto-refine'),
        outDir: values.out,
        projectDir: values.project,
        evidencePath: values.evidence,
        blenderPath: values.blender,
        dryRun: flags.has('dry-run')
      });
    } else if (mode === 'roblox-upload') {
      result = await uploadRobloxAsset({
        evidencePath: requireValue(values, 'evidence', '--roblox-upload'),
        outDir: values.out,
        projectDir: values.project,
        assetId: values['asset-id'],
        modelPath: values.model,
        apiKey: values['roblox-api-key'],
        apiBase: values['roblox-api-base'],
        creatorUserId: values['creator-user-id'],
        creatorGroupId: values['creator-group-id'],
        displayName: values['display-name'],
        description: values.description,
        pollIntervalMs: values['poll-interval-ms'],
        pollAttempts: values['poll-attempts'],
        dryRun: flags.has('dry-run')
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
    } else if (result.schemaVersion === 'betterref.3d.refine.result.v1') {
      console.log(`[betterref-3d] refinePlan=${result.artifacts.refinePlanPath}`);
    } else if (result.schemaVersion === 'betterref.3d.auto_refine.result.v1') {
      console.log(`[betterref-3d] autoRefine=${result.status}`);
    } else if (result.schemaVersion === 'betterref.roblox.upload.result.v1') {
      console.log(`[betterref-3d] robloxUpload=${result.status}`);
    } else {
      console.log(`[betterref-3d] verdict=${result.verdict} blockingReasons=${result.blockingReasons.length}`);
    }

    if (mode === 'verify' && !result.passed) {
      process.exit(1);
    }
    if (mode === 'auto-refine' && result.status === 'blocked') {
      process.exit(3);
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
