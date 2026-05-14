# Reference To 3D

Use when a reference image contains an object, product, character, prop, mascot, game asset, or modelable logo object.

## Tencent-only production rule

For BetterRef production 3D, the model source must be Tencent Hunyuan3D through signed Tencent HY 3D Global API. Use the official Global Pro 3.1 path first (`hunyuan.intl.tencentcloudapi.com`, `SubmitHunyuanTo3DProJob`) when multiple reference angles exist or the user asks for the latest/best model quality. Use Global Rapid only for single-view fallback or when Pro is unavailable. Do not replace a failed or unavailable Tencent job with a local procedural model, Blender reconstruction, Hyper3D/Rodin output, Sketchfab asset, Roblox generated mesh, or other provider and call it complete.

If Tencent submit/poll fails, billing is unavailable, credentials are missing, or the response has no matched `ResultFile3Ds`, the 3D task is blocked. If `hunyuan3d.tencentcloudapi.com` returns `ResourceUnavailable.NotExist`, retry the official Global endpoint before declaring Tencent unavailable. Keep any local blockout or procedural mesh clearly labeled as non-final concept evidence only.

## 3D brief

Include silhouette, major volumes, visible proportions, camera angle, material slots, texture cues, target format, and known unknowns.

## Asset Brief from Reference Pack

When multiple refs describe one game asset, first create an Asset Brief:

- Main mesh reference: one clean image for Tencent mesh generation.
- Multi-view mesh references: when front/back/left/right/top or 45-degree refs exist, send them through Tencent Pro 3.1 `MultiViewImages` rather than forcing Rapid single-image.
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
- Missing signed Tencent HY 3D Global request metadata or use of the domestic `hunyuan3d.tencentcloudapi.com` endpoint.
- Non-Tencent mesh accepted as the final BetterRef 3D model.
- Missing mesh/load evidence.
- Missing turntable or multi-angle render evidence when fidelity matters.
- Material or texture mismatch hidden behind a high visual score.
- Texture refs mixed into mesh generation in a way that distorts shape or silhouette.
- Raw Hunyuan/Tencent output accepted as final Roblox asset without post-Hunyuan refinement, triangle-budget, baked texture, import, and preview evidence.
- Export target missing or not loadable in the intended runtime.
- Single-view reference treated as complete proof of all sides, exact topology, or material layout.
