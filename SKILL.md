---
name: betterref
description: Use when a user provides or references a visual target, screenshot, mockup, design reference, UI image, brand image, hero image, PRD PDF, or asks for pixel-perfect, premium, polished, cinematic, or reference-matched UI.
---

# BetterRef

BetterRef is a reference-driven visual implementation and QA contract. The reference is evidence for composition, hierarchy, typography, state, and asset quality; it is never permission to ship a screenshot, PDF render, or crop as the UI.

## Non-Negotiable Operating Contract

Before coding, state the real requirement, the target viewport/state, success criteria, assumptions, and verification evidence. If the request starts from a PRD, extract requirements first and treat visual score as supporting evidence only.

Every visual item must be classified before implementation:

| Item | Allowed implementation |
|---|---|
| Navigation, text, buttons, forms, cards, grids, layout, scroll | code-native UI |
| Logo or known brand asset | official/local asset |
| Glass, 3D, cinematic hero, textured background, premium raster | `imagegen` or sourced production asset |
| PDF render, screenshot, reference crop, Figma export | reference-only evidence |

Never call the result done when any hard-fail ledger item exists. A score of 98-100 still fails if the UI is fake, blurry, non-scrollable, clipped, in the wrong state, or made from the reference itself.

## Quick Decision Table

| Situation | Required path |
|---|---|
| PRD PDF supplied | Read/extract PRD, create requirement checklist, then use `references/prd-to-web.md`. |
| Reference is taller than viewport | Use `full_page_scroll_reference`; see `references/full-page-scroll.md`. |
| Complex rendered hero or premium raster | Use `imagegen` or a production asset, then verify scale/blend. |
| High BetterRef score | Run hard-fail ledger first; score is secondary. |
| Source imports reference/PDF/crop | Fail; replace with code-native UI or generated/source asset. |
| Asset rendered larger than native size | Fail; regenerate/source higher resolution or reduce display size. |
| Hero/premium raster looks soft | Use `autoAssetQuality` from browser evidence or explicit `assetQualityChecks`; fail if sharpness is below threshold. |

## PRD To Web Loop

1. Extract PRD requirements and visual references.
2. Build a checklist that separates product behavior, content, visual style, and assets.
3. Create phases with explicit pass criteria. Each phase must trace to PRD items.
4. Keep generated guard config and `asset-plan.json` intact; if PRD mentions hero/premium/raster assets, `betterref-prd` enables `autoAssetQuality` and creates imagegen/production-asset tasks.
5. Implement with code-native UI plus generated/sourced assets where required; mark asset plan items pass only after browser evidence and guard checks.
6. Capture fresh browser screenshots at the target viewport and mobile viewport.
7. Run BetterRef diff/capture and `betterref-guard`.
8. Mark phase complete only when PRD checklist passes, BetterRef verdict passes, and hard-fail ledger is empty.

Useful commands:

```bash
npx betterref-prd --pdf PRD.pdf --out .betterref-prd --config-out .betterref.json --url http://127.0.0.1:3000/ --ref reference.png
npx betterref-imagegen --asset-plan .betterref-prd/asset-plan.json --out .betterref-imagegen --json
npx betterref-chrome --endpoint http://127.0.0.1:9222 --url-match 127.0.0.1:3000 --out .betterref --full-page --section-screenshots --ref reference.png --regions both --html
npx betterref-longpage --ref reference.png --actual-full .betterref/chrome-full-page.png --browser-evidence .betterref/browser-evidence.json --out .betterref-longpage --crop-reference auto --html
npx betterref-guard --project . --report .betterref/report.json --config .betterref-prd/betterref.guard.json --browser-evidence .betterref/browser-evidence.json --out .betterref/guard-report.json
npx betterref-verify --report .betterref/report.json --guard .betterref/guard-report.json --longpage .betterref-longpage/longpage-report.json --prd .betterref-prd/prd-checklist.json --asset-plan .betterref-prd/asset-plan.json --project . --require guard,prd,longpage,assetplan --out .betterref/final-verdict.json --html .betterref/final-verdict.html --bundle .betterref/evidence-bundle.json
```

Do not use final-pass resizing to make screenshots agree. For final verification, compare native target viewport screenshots and report layout drift instead of squeezing images.
For PRD/full-page verification, require the expected evidence with `--require guard,prd,longpage,assetplan`; missing evidence, pending assets, and fake-passed assets without attach metadata are hard fails.
Use built-in `image_gen` for each request from `.betterref-imagegen/imagegen-requests.json`, then run `betterref-imagegen --attach <asset-id>=<file> --project .` so the asset plan records generated path, native size, sharpness, timestamp, and verification metadata before final verification. Do not manually flip asset status to `pass`.

## Hard-Fail Ledger

The verdict must be `fail` or `revise` if any item is true:

- Current/reference roles are unclear or the state differs: viewport, route, selected tab, scroll, data, browser zoom, or loaded font.
- A screenshot, PDF render, Figma export, full-page reference, or crop is used as shipped UI.
- A long-page reference is judged from only the first viewport.
- The page should scroll but does not naturally scroll.
- Browser or OS chrome remains inside the web reference crop.
- Typography changes hierarchy, Thai glyph style, line breaks, clipping, or text rhythm.
- Important content is clipped, overlapped, hidden, or blocked.
- A complex hero/raster asset is visibly lower quality, has rectangular edges, wrong crop, weak lighting/depth, low measured sharpness, or blurred scaling.
- Rendered asset dimensions exceed native image dimensions.
- The report uses a high score to override a PRD gap or real UI defect.
- No fresh screenshot from the actual app was used.

See `references/hard-fail-ledger.md` for expanded examples and guard config.

## Full-Page Scroll References

If a reference image is taller than the target viewport, treat it as a map of a scrollable page, not as one screen to fit into the viewport.

Minimum section plan:

- header + hero
- primary action or quick-start area
- main product/game/content list
- promotions or secondary content
- process/how-it-works
- trust/payment/social proof
- footer

Capture both a native full-page screenshot and section/viewport screenshots. Compare section slices at native width. Report height differences as layout drift. Details: `references/full-page-scroll.md`.

## Tool Use

Start with local assets, project scripts, browser tools, DOM measurement, screenshot capture, pixel/SSIM diff, image dimensions, asset sharpness checks, fonts, and icon libraries. If a measured gap remains, create or install scoped tooling, or use `imagegen` for complex raster work. Name the gap before adding a tool.

Chrome MCP or browser automation can establish route, viewport, scroll, console, font, image scale, DOM text, interactive count, and DOM box truth. `betterref-chrome --full-page --section-screenshots` writes `.betterref/browser-evidence.json`, `.betterref/chrome-full-page.png`, and `.betterref/sections/*.png`; `betterref-guard` can use `autoAssetQuality` to map browser image URLs back to local `public` assets for sharpness checks. `betterref-longpage` auto-crops browser chrome from the reference and diffs full-page plus sections. Pass browser evidence and long-page report into `betterref-guard`/`betterref-verify` so browser hard fails cannot be hidden by a high pixel score.

Use `betterref-eval` for benchmark suites. A pressure fixture should declare the expected verdict, then fail CI if the actual verdict changes in a way that lets fake UI, blurred assets, missing browser evidence, missing scroll, pending or fake-passed imagegen assets, or PRD gaps pass.

## Final Report

A completion claim must include:

- PRD/checklist status.
- Reference source and current screenshot source.
- Viewport/device scale and same-state status.
- Visual verdict with score, pass/revise/fail, and hard-fail status.
- BetterRef report path, guard report path, asset plan path, final JSON verdict path, final HTML verdict path, and evidence bundle path.
- Top remaining differences and next edits when score is below pass.
- Tool inventory and escalations used.

Do not say "100%" unless all PRD criteria, visual criteria, and hard-fail ledger items are verified.

## Pressure Tests

Use `references/pressure-tests.md` when editing or validating this skill. The required scenarios cover long-page screenshots, screenshot-as-UI, blurry scaled assets, missing browser evidence, missing diff tooling, PRD compliance being overruled by score, and pending or fake-passed imagegen assets.
