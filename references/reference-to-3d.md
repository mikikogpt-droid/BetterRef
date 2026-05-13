# Reference To 3D

Use when a reference image contains an object, product, character, prop, mascot, game asset, or modelable logo object.

## 3D brief

Include silhouette, major volumes, visible proportions, camera angle, material slots, texture cues, target format, and known unknowns.

## Asset Brief from Reference Pack

When multiple refs describe one game asset, first create an Asset Brief:

- Main mesh reference: one clean image for Tencent mesh generation.
- Texture references: separate material/color/surface refs for Blender, Substance, texture edit, or artist work.
- Roblox target: treat Hunyuan output as high-poly source, then retopo/decimate and bake detail into texture/normal/PBR maps.

## Reference Scoring

Score every candidate reference before handoff:

```json
{
  "imageId": "main-front",
  "meshSuitabilityScore": 0,
  "textureSuitabilityScore": 0,
  "ambiguityScore": 0,
  "hiddenSides": ["back", "left"],
  "uncertaintyPolicy": "single-view refs must not invent hidden sides; request more refs or mark accepted assumptions"
}
```

- `meshSuitabilityScore`: 0-10 for silhouette, full object visibility, clean crop, and low occlusion.
- `textureSuitabilityScore`: 0-10 for material/color/surface usefulness; high texture score does not make it a mesh input.
- `ambiguityScore`: 0-10 where higher means more hidden geometry, occlusion, or stylized uncertainty.
- `hiddenSides`: name unseen sides and details. A single-view reference must not invent backs, underside, internal parts, exact scale, or topology.
- `uncertaintyPolicy`: if hidden details affect likeness or Roblox fit, block final pass until more refs or explicit accepted assumptions exist.

## Hard fails

- Flat 2D billboard pretending to be a 3D model.
- Missing mesh/load evidence.
- Missing turntable or multi-angle render evidence when fidelity matters.
- Material or texture mismatch hidden behind a high visual score.
- Texture refs mixed into mesh generation in a way that distorts shape or silhouette.
- Raw Hunyuan/Tencent output accepted as final Roblox asset without post-Hunyuan refinement, triangle-budget, baked texture, import, and preview evidence.
- Export target missing or not loadable in the intended runtime.
- Single-view reference treated as complete proof of all sides, exact topology, or material layout.
