# Tencent Hunyuan3D Provider

BetterRef uses Tencent Hunyuan3D as the only Hunyuan3D provider. Do not route production 3D jobs through alternate wrappers.

For 3D model requests, Tencent is not optional. If Tencent does not return a completed asset with matched `ResultFile3Ds`, the task is blocked. A local procedural mesh, Blender-only reconstruction, Hyper3D/Rodin result, Roblox generated mesh, downloaded marketplace model, or mock file may be useful as concept evidence, but it is not a BetterRef final model.

## Tencent HY 3D Global

Create the Tencent request metadata with:

```bash
betterref-3d --make-hunyuan-request \
  --plan .betterref-3d/3d-asset-plan.json \
  --out .betterref-3d \
  --provider tencent \
  --tencent-endpoint hunyuan.intl.tencentcloudapi.com \
  --tencent-region ap-singapore \
  --tencent-edition pro \
  --tencent-model 3.1 \
  --result-format GLB \
  --enable-pbr true \
  --json
```

Default to the official Tencent HY 3D Global Pro path with `Model: 3.1` when the user provides multiple view references or asks for the latest/best model quality. `pro` maps to `SubmitHunyuanTo3DProJob` and `QueryHunyuanTo3DProJob`; use `MultiViewImages[].ViewImageBase64` for side/back/top/45-degree refs after resizing inputs enough to keep the signed JSON request under Tencent's 10 MB limit.

Use Global Rapid only as a fallback when Pro is unavailable or the user supplies only one clean view. `rapid` maps to `SubmitHunyuanTo3DRapidJob` and `QueryHunyuanTo3DRapidJob`, but Rapid single-image output is not acceptable as final if it visibly melts the face, silhouette, armor, or required reference details.

Do not default to the old/domestic `hunyuan3d.tencentcloudapi.com` path for this workstation. That path can return `ResourceUnavailable.NotExist` / billing-service activation errors even when the Tencent Global Rapid API works with the same account.

Every Tencent submission must be a signed Tencent Cloud API 3.0 request to `https://hunyuan.intl.tencentcloudapi.com`. Use `TENCENTCLOUD_SECRET_ID` and `TENCENTCLOUD_SECRET_KEY` from the environment when available. On this workstation, if those env vars are absent, read the Blender MCP panel's Hunyuan official API `SecretId`/`SecretKey` and submit the signed Global API request directly. Do not fall back to Blender MCP legacy/domestic `generate_hunyuan3d_model` behavior when it returns `ResourceUnavailable.NotExist`. Never commit raw Tencent credentials.

## Required artifacts

- `hunyuan-request.json`
- `hunyuan-response.json`
- `3d-refine-plan.json` and `3d-refine-checklist.md` after provider output returns
- `3d-asset-plan.json`
- `3d-verdict.json`

For Tencent Cloud verification, the response metadata must include matched asset records with job/request metadata and non-empty `ResultFile3Ds` or `resultFile3Ds`. A local model file alone is not enough.

## Post-Hunyuan refinement

Run this after Tencent/Hunyuan returns provider output:

```bash
betterref-3d --make-refine-plan \
  --plan .betterref-3d/3d-asset-plan.json \
  --hunyuan-request .betterref-3d/hunyuan-request.json \
  --hunyuan-response .betterref-3d/hunyuan-response.json \
  --asset-brief .betterref-reference/asset-brief.json \
  --out .betterref-3d \
  --project . \
  --json
```

The refine plan treats raw Hunyuan output as source material, not final Roblox/game-ready art. For Roblox targets, final verification requires low-poly triangle-budget evidence, retopo/decimate or equivalent refinement evidence, baked texture/normal/PBR evidence, Roblox Studio import/preview evidence, and a rerun of `betterref-3d --verify`.

## Auto production 3D

Use Blender automation after the refine plan exists:

```bash
betterref-3d --auto-refine \
  --refine-plan .betterref-3d/3d-refine-plan.json \
  --out .betterref-3d \
  --project . \
  --blender "C:\Program Files\Blender Foundation\Blender 4.3\blender.exe" \
  --json
```

`--auto-refine` writes `blender/betterref-auto-refine.py`, imports the raw model, applies cleanup and decimation toward the Roblox triangle budget, exports the final GLB, renders turntable evidence, and updates `3d-evidence.json`. Use `--dry-run` when Blender is not installed to inspect the generated script and command.

Upload the refined model with Roblox Open Cloud:

```bash
betterref-3d --roblox-upload \
  --evidence .betterref-3d/3d-evidence.json \
  --out .betterref-3d \
  --project . \
  --asset-id model-001 \
  --creator-user-id 1234567 \
  --display-name "BetterRef Asset" \
  --json
```

Use `ROBLOX_OPEN_CLOUD_API_KEY` or `--roblox-api-key`. The upload step writes `robloxImportEvidence` into `3d-evidence.json`, then `betterref-3d --verify` can decide whether the model is passable.
