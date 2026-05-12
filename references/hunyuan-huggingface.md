# Hunyuan 3D Through Hugging Face

BetterRef supports provider adapters instead of hardcoding one Hugging Face API shape.

## Providers

- `space`: Hugging Face Space or Gradio-style call.
- `endpoint`: dedicated Hugging Face Inference Endpoint.
- `custom`: explicit wrapper URL.

## Required artifacts

- `hunyuan-request.json`
- `hunyuan-response.json`
- `3d-asset-plan.json`
- `3d-verdict.json`

Use `HF_TOKEN` from the environment or a secure connector. Never commit raw tokens.
