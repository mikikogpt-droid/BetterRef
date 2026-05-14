# BetterRef Tooling Audit

Date: 2026-05-14
Skill path: `C:\Users\Miki\.codex\skills\betterref`

## Summary

BetterRef is installed from the skill repo and the local test suite passes. The 3D workflow is now locked to signed Tencent HY 3D Global API as the required model-generation source for BetterRef 3D/Roblox work.

## Verified Ready

| Area | Status | Evidence |
| --- | --- | --- |
| Node/npm package | Ready | `npm test` passes, 191/191 |
| Global BetterRef CLI link | Ready | `betterref@0.6.0 -> C:\Users\Miki\.codex\skills\betterref` |
| BetterRef CLI commands | Ready | `betterref-3d`, `betterref-run`, and `betterref-verify` are exposed in `C:\Users\Miki\AppData\Roaming\npm` |
| Built-in Codex image generation | Ready | Use built-in `image_gen` for raster/static generated assets |
| Blender MCP official API panel | Ready for workstation credential source | Use the Blender Hunyuan official API SecretId/SecretKey when shell env vars are absent; do not commit raw credentials |
| Roblox Studio | Present | Needed for final import/preview evidence when Open Cloud upload is unavailable |

## Required 3D Rule

All BetterRef 3D model work must use signed Tencent HY 3D Global API:

- Endpoint: `hunyuan.intl.tencentcloudapi.com`
- Region: `ap-singapore`
- Signed Tencent Cloud API 3.0 requests only
- Prefer Global Pro Model `3.1` for multi-view/latest-quality jobs
- Use Global Rapid for a single clean reference image when Pro/multi-view is not needed
- Preserve request metadata, response metadata, `ResultFile3Ds`, raw Tencent output, refinement evidence, and final verify output
- Do not use Blender MCP legacy/domestic Hunyuan calls, Hyper3D/Rodin, marketplace assets, or local procedural meshes as the final BetterRef 3D source

## Remaining Setup By Workflow

| Workflow | Current Finding | Impact |
| --- | --- | --- |
| Tencent credentials in shell | `TENCENTCLOUD_SECRET_ID` and `TENCENTCLOUD_SECRET_KEY` may be unset | The CLI request artifact records env availability; this workstation can use Blender MCP official API credentials for the actual signed Global API submission |
| Blender CLI automation | Requires Blender executable or running Blender context | Needed for automated post-Hunyuan refine/render evidence |
| Roblox import proof | Roblox Open Cloud env vars are not confirmed | If Open Cloud is unavailable, import the FBX/GLB in Roblox Studio and capture Studio screenshot/hierarchy evidence |
| HyperFrames motion assets | HyperFrames CLI must be installed per project when motion/video assets are required | Needed only for animated/cinematic WebM/MP4 deliverables |
| Playwright fallback | Install per target project if no Chrome/CDP/browser handoff is available | Browser evidence can still use connected Chrome tooling when available |

## Useful Commands

```powershell
Set-Location 'C:\Users\Miki\.codex\skills\betterref'
npm test
npm link
betterref-3d --help
```

```powershell
betterref-3d --make-hunyuan-request `
  --plan .betterref-3d\3d-asset-plan.json `
  --out .betterref-3d `
  --provider tencent `
  --tencent-endpoint hunyuan.intl.tencentcloudapi.com `
  --tencent-region ap-singapore `
  --tencent-edition pro `
  --tencent-model 3.1 `
  --result-format GLB `
  --enable-pbr true `
  --json
```

## Current Hard Blocker For Roblox Assets

BetterRef can create and verify the 3D handoff, Tencent metadata, model files, mesh stats, render evidence, material evidence, and post-Hunyuan refinement. A Roblox-targeted model still fails final BetterRef verification until Roblox import evidence exists from either:

- `betterref-3d --roblox-upload` with valid Roblox Open Cloud credentials, or
- manual Roblox Studio import/preview evidence captured through Studio/MCP.
