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

## Expected Agent Rule

The agent must fail or revise every scenario above. A pass answer is valid only when it names the hard fail, states why the score is insufficient, and gives the next concrete edit or verification step.
