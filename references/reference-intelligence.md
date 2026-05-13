# Reference Intelligence

Use this when BetterRef receives a visual reference image.

Use `betterref-reference --pack reference-pack.json` when BetterRef receives a Reference Pack with multiple images for one asset.

## Required outputs

- `reference-analysis.json`
- `visual-checklist.md`
- `negative-prompts.md`
- `3d-brief.md` when the reference has modelable object cues
- `asset-brief.json` and `asset-brief.md` when using a Reference Pack
- `texture-refs.md` when texture/material refs are separated from mesh refs

## Reading layers

1. Pixel facts: size, crop, aspect ratio, bounds, swatches, visible text.
2. Design semantics: hierarchy, component roles, typography, brand mood.
3. 3D cues: silhouette, volumes, camera, material slots, texture zones.
4. Uncertainty: hidden sides, exact scale, topology, ambiguous material.

Facts must include confidence. Critical low-confidence facts block final pass or require an explicit assumption.

## Reference Pack rules

- Select exactly one clean main image for Tencent mesh generation unless a multi-view mesh pass is explicitly planned.
- Keep texture, color, material, surface, and PBR refs separate for Blender, Substance, texture edit, or artist work.
- The Asset Brief must name mesh likeness gates separately from texture/material likeness gates.
- For Roblox, quality means low-poly with baked texture/normal/PBR evidence, not raw high-poly output.
