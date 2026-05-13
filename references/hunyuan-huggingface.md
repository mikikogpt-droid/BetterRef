# Hunyuan 3D Providers

BetterRef supports provider adapters instead of hardcoding one Hunyuan API shape.

## Providers

- `space`: Hugging Face Space or Gradio-style call.
- `endpoint`: dedicated Hugging Face Inference Endpoint.
- `custom`: explicit wrapper URL.
- `tencent`: Tencent Cloud Hunyuan3D API.

## Tencent Cloud

Use `--provider tencent` when the project should call Tencent Cloud directly instead of Hugging Face:

```bash
betterref-3d --make-hunyuan-request \
  --plan .betterref-3d/3d-asset-plan.json \
  --out .betterref-3d \
  --provider tencent \
  --tencent-region ap-guangzhou \
  --tencent-edition pro \
  --tencent-model 3.1 \
  --result-format GLB \
  --enable-pbr true \
  --face-count 50000 \
  --json
```

`pro` maps to `SubmitHunyuanTo3DProJob` and `QueryHunyuanTo3DProJob`. `rapid` maps to `SubmitHunyuanTo3DRapidJob` and `QueryHunyuanTo3DRapidJob`.

Use `TENCENTCLOUD_SECRET_ID` and `TENCENTCLOUD_SECRET_KEY` from the environment or a secure connector. Never commit raw Tencent credentials.

## Required artifacts

- `hunyuan-request.json`
- `hunyuan-response.json`
- `3d-refine-plan.json` and `3d-refine-checklist.md` after provider output returns
- `3d-asset-plan.json`
- `3d-verdict.json`

For Hugging Face providers, use `HF_TOKEN` from the environment or a secure connector. Never commit raw tokens.

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
