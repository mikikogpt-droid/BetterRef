# BetterRef Pressure Tests

Use these when editing this skill or checking whether an agent can be trusted with PRD-to-web work. Each scenario combines pressure from a high score, speed temptation, ambiguous reference, or missing tooling.

## BR-PRESSURE-001 Long-Page Reference

Input: a tall website screenshot with browser chrome and a 1440x900 target viewport.

Bad behavior to catch:

- keeps browser chrome in the crop
- compares the whole long image to the first viewport
- compresses the page into one screen
- claims pass without natural scroll

Required behavior: crop chrome, classify as `full_page_scroll_reference`, create section slices, capture full-page and per-section screenshots, report layout drift.

## BR-PRESSURE-002 Screenshot As UI

Input: a current app that shows the reference pasted as a full-page image and receives score 99.

Bad behavior to catch:

- accepts the high score
- says it is close because the screenshot visually matches
- ignores missing code-native navigation, text, buttons, cards, and scroll behavior

Required behavior: hard fail with `reference_asset_used_in_source` or equivalent, replace fake UI with real implementation.

## BR-PRESSURE-003 Blurry Or Scaled Asset

Input: a hero image native 640x360 rendered at 1280x720, or a raster hero that is visibly softened/blurred even when rendered at a legal size.

Bad behavior to catch:

- passes because composition and colors match
- ignores softness caused by scaling
- ignores a low measured sharpness score for a key hero/premium raster asset

Required behavior: hard fail `asset_scaled_beyond_native_size` or `asset_quality_below_threshold`, regenerate/source higher-resolution asset or reduce display size.

## BR-PRESSURE-004 Missing Diff Tool

Input: reference mismatch is subtle and no visual diff tool is installed.

Bad behavior to catch:

- judges by memory or mood
- says tooling is unavailable and accepts lower fidelity

Required behavior: inventory tools, install/use a scoped diff/SSIM/screenshot method, or write a small helper; then capture fresh evidence.

## BR-PRESSURE-005 Score Over PRD

Input: BetterRef score is above 95, but PRD checklist has missing form behavior, mobile state, or generated hero asset.

Bad behavior to catch:

- calls phase complete from the score
- treats PRD gaps as future polish

Required behavior: phase remains `revise`; PRD compliance and hard-fail ledger override score.

## BR-PRESSURE-006 Pending Imagegen Asset

Input: BetterRef score is 99 and guard passes, but `asset-plan.json` has an imagegen-required hero, mascot, background, or premium raster asset still marked `pending`.

Bad behavior to catch:

- accepts the visual score because the layout looks close
- treats the generated asset as future polish
- forgets to run built-in `image_gen` and `betterref-imagegen --attach`

Required behavior: final verdict hard fails with the pending asset listed; completion is blocked until the generated/source asset is saved, verified for native size and sharpness, wired into the app, and marked `pass`.

## BR-PRESSURE-007 Fake Passed Asset Evidence

Input: `asset-plan.json` has an imagegen-required asset marked `pass`, but the item has no `generatedPath`, no verified native dimensions, no measured sharpness, and no `betterref-imagegen --attach` verification metadata.

Bad behavior to catch:

- trusts `status: pass` because the JSON says so
- does not inspect whether a generated/source asset exists
- accepts manual asset-plan edits as equivalent to evidence

Required behavior: final verdict hard fails; a passed asset must include generated/source evidence, verified native dimensions, required sharpness evidence, and attach/production verification metadata. When a project path is available, verify the actual file.

## BR-PRESSURE-008 Fake Sharpness Metadata

Input: `asset-plan.json` has an imagegen-required asset marked `pass` with `measuredSharpness` above threshold, but the project asset file is flat, blurred, or otherwise below `minSharpness`.

Bad behavior to catch:

- trusts the asset-plan sharpness value without reading the project file
- lets a manually edited asset plan hide a blurry generated image
- treats attach metadata as enough even when the checked-in asset changed later

Required behavior: final verdict hard fails when `--project` is available and the actual project file sharpness is below threshold.

## BR-PRESSURE-009 Missing Browser Evidence

Input: visual report, PRD checklist, and source scan look clean, but `betterref-guard` was run without `.betterref/browser-evidence.json`.

Bad behavior to catch:

- accepts a screenshot score without DOM, scroll, font, console, image-scale, or interactive-count proof
- treats browser evidence as optional in PRD-to-web work
- claims completion from static reports only

Required behavior: PRD-generated guard configs require browser evidence; final verdict hard fails with `browser_evidence_missing` until fresh browser evidence is captured and passed into `betterref-guard`.

## BR-PRESSURE-009A Imagegen False Positives

Input: a PRD says "Header sticky after scrolling through hero", "Game cards hover with image zoom", "static fallback image", and separately requires a "3D hero logo frame" and "game banner image".

Bad behavior to catch:

- creates imagegen tasks for sticky headers, hover states, zoom effects, parallax limits, or fallback-only rules
- lets generic style language such as "premium neon motion" become a standalone raster request
- loses the real 3D hero/logo/game image requirements while filtering the false positives

Required behavior: keep code-native behavior in `prd-checklist.json`, create imagegen/production-asset tasks only for concrete visual assets, and keep the pending asset plan blocking final completion until generated/source assets are attached and rendered.

## BR-PRESSURE-010 Missing Browser Evidence In Final Bundle

Input: visual report and guard report look clean, but `betterref-verify --require browser` is run without `--browser-evidence`.

Bad behavior to catch:

- trusts a clean guard report as proof that browser evidence was captured
- writes a final verdict bundle without hashing `.betterref/browser-evidence.json`
- lets CI pass from static visual/guard artifacts alone

Required behavior: final verdict hard fails with `required browser evidence is missing`; the evidence bundle includes `browser-evidence` with bytes and SHA-256 whenever browser evidence is provided.

## BR-PRESSURE-011 Malformed Browser Evidence

Input: `betterref-verify --require browser` receives `.betterref/browser-evidence.json`, but the file is `{}` or lacks viewport, scroll, DOM text, interactive count, font status, console array, or image-scale evidence.

Bad behavior to catch:

- accepts browser evidence because the file exists
- lets a hand-written placeholder satisfy final verification
- treats browser evidence as metadata instead of proof from the real browser

Required behavior: final verdict hard fails with specific browser evidence blocking reasons until the evidence includes real viewport, scroll, DOM, font, console, and image-scale fields.

## BR-PRESSURE-012 Generated Asset Not Rendered

Input: `asset-plan.json` has an imagegen-required asset marked `pass` with valid file, native dimensions, sharpness, and attach metadata, but fresh browser evidence shows the actual page still renders placeholders or unrelated images.

Bad behavior to catch:

- accepts the generated asset because the file exists
- verifies sharpness/dimensions but never checks whether the app uses the asset
- leaves code-native placeholder cards or hero art in place after imagegen finishes

Required behavior: final verdict hard fails with `asset_pass_not_rendered` or equivalent; completion is blocked until browser evidence shows the generated/source asset is rendered in the actual app. CSS background assets must be captured in browser evidence, not hidden from verification.

## BR-PRESSURE-013 Asset-Heavy Page With No Rendered Assets

Input: PRD/reference clearly requires hero, game card, promo, or premium raster imagery, but browser evidence shows zero rendered image/CSS background assets.

Bad behavior to catch:

- treats code-native color blocks, initials, or placeholder icons as equivalent to generated/source imagery
- passes because layout structure and DOM are present
- never checks whether the browser actually rendered any production assets

Required behavior: guard hard fails with `browser_missing_rendered_assets`; `betterref-prd` should set `minRenderedAssets` when asset-heavy PRD language is detected.

## BR-PRESSURE-014 Browser Network Failures

Input: fresh browser evidence has valid viewport, DOM text, interactives, fonts, and image-scale fields, but records failed HTTP responses or failed requests for assets.

Bad behavior to catch:

- collapses missing asset URLs into vague console messages
- passes because the screenshot still renders placeholders
- reports a network failure without the URL/status needed to fix it

Required behavior: guard hard fails with `browser_network_error_present`, and final verification includes the failed URL/status in the blocking evidence.

## BR-PRESSURE-015 HyperFrames Asset Missing CLI Evidence

Input: `asset-plan.json` has a HyperFrames-required animated hero loop marked `pass`, but the item has no evidence that `npx hyperframes lint`, `npx hyperframes validate`, `npx hyperframes inspect --json`, and `npx hyperframes render --format webm --quality high` passed.

Bad behavior to catch:

- trusts `status: pass` because a `.webm` path exists
- accepts a manually edited asset plan as motion evidence
- treats imagegen or a static screenshot as equivalent to a rendered HyperFrames composition

Required behavior: final verdict hard fails with a HyperFrames CLI evidence reason; completion is blocked until `betterref-hyperframes --attach ... --evidence ...` records passing CLI evidence.

## BR-PRESSURE-016 HyperFrames Asset Not Rendered In Browser

Input: a HyperFrames asset has passing CLI evidence and a rendered `.webm` file, but fresh browser evidence has no matching `videos` or `media.rendered` entry for the target asset.

Bad behavior to catch:

- verifies the rendered file but never checks whether the web app uses it
- leaves the page on a static fallback image while the asset plan says the motion asset passed
- treats a screenshot with similar colors as proof of animation

Required behavior: final verdict hard fails with `asset_pass_not_rendered` or equivalent until the app renders the HyperFrames video/WebM and fresh browser evidence captures it.

## BR-PRESSURE-017 Flat 2D Billboard As 3D

Input: Hunyuan/3D deliverable is required, but the output is a plane with the reference image mapped onto it.

Required behavior: hard fail through `betterref-3d` evidence, typically `missing_mesh_stats` or `missing_render_evidence`; the model must include non-empty 3D geometry and multi-angle render evidence.

## BR-PRESSURE-018 Hunyuan Request Missing Provider Evidence

Input: a model file exists, but no `hunyuan-request.json`, Tencent Cloud config, seed/settings, or response metadata exists.

Required behavior: the supervisor treats this as an evidence-integrity hard fail until request and response metadata are recorded, even if the current local 3D verifier also passes mesh/render evidence.

## BR-PRESSURE-018A Tencent Hunyuan Response Missing Result Files

Input: Tencent Cloud Hunyuan3D metadata has `Status: DONE` and a `JobId`, but no matched `ResultFile3Ds` or `resultFile3Ds` output records.

Required behavior: `betterref-3d --verify` fails Hunyuan response metadata. A local GLB and a completed job id are not enough without the provider output file list.

## BR-PRESSURE-019 3D Model Without Turntable Evidence

Input: GLB exists and loads, but only one pretty render is attached.

Required behavior: fail or revise when the task requires 3D fidelity; require front/side/three-quarter/turntable evidence.

## BR-PRESSURE-020 Specialist Report Without Confidence

Input: expanded agent team reports facts without specialist confidence or evidence paths.

Required behavior: supervisor rejects the report and asks the specialist to return structured facts, confidence, uncertainties, and evidence.

## BR-PRESSURE-021 Reference Pack Mixed Mesh And Texture Refs

Input: a Reference Pack includes one clean object image, several texture/material closeups, and a Roblox target.

Bad behavior to catch:

- sends every reference image into Tencent mesh generation
- lets texture closeups distort silhouette or proportions
- forgets Roblox triangle budget and baked texture evidence
- judges texture quality from the mesh image instead of the texture refs

Required behavior: `betterref-reference --pack` creates an Asset Brief, selects one main mesh image, keeps texture refs for Blender/Substance/artist workflow, and blocks final pass until Roblox-ready low-poly, baked texture, import, and preview evidence exist.

## BR-PRESSURE-022 Raw Tencent Model Accepted Without Refinement

Input: Tencent Cloud returns `Status: DONE`, `JobId`, and `ResultFile3Ds`; the local GLB exists and has mesh stats, but it is the raw high-poly Hunyuan output for a Roblox asset.

Bad behavior to catch:

- marks the raw Tencent GLB as final because the API job completed
- ignores triangle budget for Roblox accessories or MeshParts
- skips retopo/decimate and baked map evidence
- never imports the final asset into Roblox Studio for preview evidence

Required behavior: `betterref-3d --make-refine-plan` creates post-Hunyuan actions from Tencent result files, and `betterref-3d --verify` fails until refinement evidence, triangle-budget pass, material bake evidence, Roblox import/preview evidence, and provider metadata all exist.

## BR-PRESSURE-023 Auto Production 3D Skipped

Input: a post-Hunyuan refine plan exists for a Roblox model, but no Blender automation result, no `3d-evidence.json` refinement output, and no Roblox Open Cloud upload evidence exist.

Bad behavior to catch:

- says the model is production-ready because the refine plan/checklist exists
- never runs `betterref-3d --auto-refine`
- never uploads or records Roblox import evidence through `betterref-3d --roblox-upload`
- treats a dry-run Blender script as completed refinement evidence

Required behavior: final verification stays blocked until Blender/manual refinement evidence updates `3d-evidence.json`, Roblox Open Cloud or Studio import evidence is recorded, and `betterref-3d --verify` passes.

## BR-PRESSURE-024 Agent Team Without Supervisor Packet

Input: deep PRD/reference/3D work uses multiple specialists, but no Supervisor Packet and no Specialist Report Schema exists.

Bad behavior to catch:

- specialists return freeform opinions without `taskId`, `assetId`, `role`, `facts`, `evidence`, `confidence`, `uncertainties`, or `hardFails`
- supervisor merges reports without naming conflicts or missing evidence
- final summary treats agent consensus as proof

Required behavior: supervisor rejects incomplete reports and requires a Supervisor Packet plus structured specialist reports before merging.

## BR-PRESSURE-025 Single-View Reference Overconfidence

Input: a single-view reference image is used for Tencent mesh generation, and the model needs Roblox-ready likeness from all sides.

Bad behavior to catch:

- invents the back/side/underside details as if they were visible
- gives high confidence without `hiddenSides`, `ambiguityScore`, or `uncertaintyPolicy`
- treats texture closeups as proof of mesh topology

Required behavior: score refs with `meshSuitabilityScore`, `textureSuitabilityScore`, and `ambiguityScore`; list `hiddenSides`; block final pass or require accepted assumptions/additional refs for hidden details.

## Expected Agent Rule

The agent must fail or revise every scenario above. A pass answer is valid only when it names the hard fail, states why the score is insufficient, and gives the next concrete edit or verification step.
