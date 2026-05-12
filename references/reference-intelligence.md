# Reference Intelligence

Use this when BetterRef receives a visual reference image.

## Required outputs

- `reference-analysis.json`
- `visual-checklist.md`
- `negative-prompts.md`
- `3d-brief.md` when the reference has modelable object cues

## Reading layers

1. Pixel facts: size, crop, aspect ratio, bounds, swatches, visible text.
2. Design semantics: hierarchy, component roles, typography, brand mood.
3. 3D cues: silhouette, volumes, camera, material slots, texture zones.
4. Uncertainty: hidden sides, exact scale, topology, ambiguous material.

Facts must include confidence. Critical low-confidence facts block final pass or require an explicit assumption.
