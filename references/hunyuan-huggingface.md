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
- `3d-asset-plan.json`
- `3d-verdict.json`

For Hugging Face providers, use `HF_TOKEN` from the environment or a secure connector. Never commit raw tokens.

For Tencent Cloud verification, the response metadata must include matched asset records with job/request metadata and non-empty `ResultFile3Ds` or `resultFile3Ds`. A local model file alone is not enough.
