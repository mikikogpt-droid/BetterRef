# Reference To 3D

Use when a reference image contains an object, product, character, prop, mascot, game asset, or modelable logo object.

## 3D brief

Include silhouette, major volumes, visible proportions, camera angle, material slots, texture cues, target format, and known unknowns.

## Asset Brief from Reference Pack

When multiple refs describe one game asset, first create an Asset Brief:

- Main mesh reference: one clean image for Tencent mesh generation.
- Texture references: separate material/color/surface refs for Blender, Substance, texture edit, or artist work.
- Roblox target: treat Hunyuan output as high-poly source, then retopo/decimate and bake detail into texture/normal/PBR maps.

## Hard fails

- Flat 2D billboard pretending to be a 3D model.
- Missing mesh/load evidence.
- Missing turntable or multi-angle render evidence when fidelity matters.
- Material or texture mismatch hidden behind a high visual score.
- Texture refs mixed into mesh generation in a way that distorts shape or silhouette.
- Export target missing or not loadable in the intended runtime.
