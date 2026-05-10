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
| Glass, 3D, cinematic hero, textured background, premium raster still | `imagegen` or sourced production asset |
| Animated cinematic hero, motion logo, reveal, loop, WebM/MP4, shader transition | `hyperframes` composition rendered through `hyperframes-cli` |
| PDF render, screenshot, reference crop, Figma export | reference-only evidence |

Never call the result done when any hard-fail ledger item exists. A score of 98-100 still fails if the UI is fake, blurry, non-scrollable, clipped, in the wrong state, or made from the reference itself.

## Quick Decision Table

| Situation | Required path |
|---|---|
| PRD PDF supplied | Read/extract PRD, create requirement checklist, then use `references/prd-to-web.md`. |
| Reference is taller than viewport | Use `full_page_scroll_reference`; see `references/full-page-scroll.md`. |
| Complex rendered hero or premium raster | Use `imagegen` or a production asset, then verify scale/blend. |
| Animated/cinematic motion asset | Use `betterref-hyperframes`, then require HyperFrames lint/validate/inspect/render evidence and browser video evidence. |
| High BetterRef score | Run hard-fail ledger first; score is secondary. |
| Source imports reference/PDF/crop | Fail; replace with code-native UI or generated/source asset. |
| Asset rendered larger than native size | Fail; regenerate/source higher resolution or reduce display size. |
| Hero/premium raster looks soft | Use `autoAssetQuality` from browser evidence or explicit `assetQualityChecks`; fail if sharpness is below threshold. |
| Asset-heavy PRD renders only placeholders | Use `minRenderedAssets`; fail until real generated/source assets render. |
| Generated/source asset file exists but is not rendered | Fail; wire it into the actual UI and recapture browser evidence. |

## Start Project Command

When the user says `use $betterref start project`, `use BetterRef start project`, or an equivalent start-project phrase, expand it into this contract instead of asking them to paste a long prompt again:

1. Treat BetterRef as the project supervisor from the first turn.
2. Read the PRD and run `betterref-run` or `betterref-prd --project .` to create `.betterref-prd/*` and `AGENTS.md`.
3. Use `using-superpowers` and `karpathy-guidelines` together with this skill; prefer installed skill names or `CODEX_HOME`, not a machine-specific absolute path.
4. Classify every visual as `code-native UI`, `imagegen asset`, `HyperFrames asset`, `existing asset`, or `reference-only`.
5. Never ship a PDF render, screenshot, reference crop, or browser chrome as UI.
6. For 3D, glass, cinematic, hero, texture, or premium raster work, create an imagegen handoff and use built-in `image_gen`.
7. For motion, animated, WebM/MP4, cinematic reveal, or shader work, use HyperFrames with CLI and browser evidence.
8. Require fresh browser evidence before calling a phase complete.
9. Follow `.betterref-run/next-actions.md` until final verdict passes; never say 100% until PRD checklist, browser evidence, asset evidence, guard, and final verify all pass.

## Command Aliases

Treat these user phrases as BetterRef workflows:

| Alias | Expand to |
|---|---|
| `use $betterref start project` | Bootstrap PRD, `.betterref-prd/*`, `AGENTS.md`, asset plan, and next actions. |
| `use $betterref compare` | Compare current app/browser evidence to the reference and report score, hard fails, and fixes. |
| `use $betterref verify phase` | Check PRD phase criteria, browser evidence, asset evidence, guard, and final verdict before saying a phase is done. |
| `use $betterref fix visual mismatch` | Patch the largest measured mismatch first, then recapture and rerun evidence. |
| `use $betterref long page review` | Treat tall references as scroll maps and verify full-page plus section evidence. |
| `use $betterref hard fail audit` | Search source/evidence for screenshot-as-UI, PDF/reference reuse, blur, missing scroll, missing browser evidence, and fake passes. |
| `use $betterref imagegen assets` | Create or resume imagegen handoff, output slots, attach metadata, quality checks, and browser render verification. |
| `use $betterref motion assets` | Route animated/cinematic assets through HyperFrames with lint, validate, inspect, render, attach, and browser video evidence. |
| `use $betterref browser evidence` | Capture or ingest real browser evidence through `@chrome`, Chrome MCP, CDP, or Playwright fallback. |
| `use $betterref final gate` | Produce final verdict paths and fail if PRD, visual, guard, browser, asset, long-page, or hard-fail evidence is incomplete. |

## PRD To Web Loop

1. Extract PRD requirements and visual references.
2. Build a checklist that separates product behavior, content, visual style, and assets.
3. Create phases with explicit pass criteria. Each phase must trace to PRD items.
4. Run `betterref-run` for the primary PRD-to-web gate, or `betterref-prd` with `--project .` when you only need bootstrap artifacts. `betterref-run` creates PRD artifacts, queues external asset work, captures browser evidence when a CDP endpoint is provided, ingests `@chrome`/Chrome MCP evidence with `--browser-handoff`, and writes auditable run-state/next-action artifacts instead of relying on the agent to remember every command.
5. Keep generated guard config and `asset-plan.json` intact; if PRD mentions static hero/premium/raster assets, `betterref-prd` enables `autoAssetQuality` and creates imagegen/production-asset tasks. If it mentions animated, cinematic motion, reveal, loop, video, WebM/MP4, shader transition, or HyperFrames, it creates HyperFrames tasks instead of imagegen tasks.
6. Implement with code-native UI plus generated/sourced/HyperFrames-rendered assets where required; mark asset plan items pass only after attach metadata, browser evidence, and guard checks.
7. Capture fresh browser screenshots at the target viewport and mobile viewport.
8. Run BetterRef diff/capture and `betterref-guard`.
9. Mark phase complete only when PRD checklist passes, BetterRef verdict passes, and hard-fail ledger is empty.

Useful commands:

```bash
npx betterref-run --pdf PRD.pdf --project . --url http://127.0.0.1:3000/ --ref reference.png --endpoint http://127.0.0.1:9222 --json
npx betterref-run --pdf PRD.pdf --project . --url http://127.0.0.1:3000/ --ref reference.png --browser-handoff .betterref-run/chrome-handoff.json --json
npx betterref-prd --pdf PRD.pdf --out .betterref-prd --project . --config-out .betterref.json --url http://127.0.0.1:3000/ --ref reference.png
npx betterref-imagegen --asset-plan .betterref-prd/asset-plan.json --out .betterref-imagegen --json
npx betterref-imagegen --asset-plan .betterref-prd/asset-plan.json --status --out .betterref-imagegen --project . --json
npx betterref-imagegen --asset-plan .betterref-prd/asset-plan.json --auto-attach-dir .betterref-imagegen/generated --project . --json
npx betterref-hyperframes --asset-plan .betterref-prd/asset-plan.json --out .betterref-hyperframes --json
npx betterref-chrome --endpoint http://127.0.0.1:9222 --url-match 127.0.0.1:3000 --out .betterref --full-page --section-screenshots --ref reference.png --regions both --html
npx betterref-longpage --ref reference.png --actual-full .betterref/chrome-full-page.png --browser-evidence .betterref/browser-evidence.json --out .betterref-longpage --crop-reference auto --html
npx betterref-guard --project . --report .betterref/report.json --config .betterref-prd/betterref.guard.json --browser-evidence .betterref/browser-evidence.json --out .betterref/guard-report.json
npx betterref-verify --report .betterref/report.json --guard .betterref/guard-report.json --longpage .betterref-longpage/longpage-report.json --prd .betterref-prd/prd-checklist.json --asset-plan .betterref-prd/asset-plan.json --browser-evidence .betterref/browser-evidence.json --project . --require guard,prd,longpage,assetplan,browser --out .betterref/final-verdict.json --html .betterref/final-verdict.html --bundle .betterref/evidence-bundle.json
```

Do not use final-pass resizing to make screenshots agree. For final verification, compare native target viewport screenshots and report layout drift instead of squeezing images.
For PRD/full-page verification, require the expected evidence with `--require guard,prd,longpage,assetplan,browser`; missing browser evidence, pending assets, fake-passed assets without attach metadata, and generated assets that are not rendered in browser evidence are hard fails.
`betterref-run` exit code `3` means the orchestrator is blocked by an external action such as built-in `image_gen`, HyperFrames CLI evidence, or real browser evidence. Read `.betterref-run/next-actions.md`, complete the handoff, then rerun. If no CDP endpoint is available, use `@chrome` or Chrome MCP to write `.betterref-run/chrome-handoff.json`, then rerun with `--browser-handoff`; metadata-only Chrome evidence without real screenshot file paths is a hard fail.
Use built-in `image_gen` for each request from `.betterref-imagegen/imagegen-requests.json` or `.betterref-run/imagegen-handoff-request.json`, then save/copy the selected output into the declared `.betterref-imagegen/generated/<asset-id>.*` output slot. Run `betterref-imagegen --status` to see pending, generated-not-attached, attached-not-rendered, and pass states, then run `betterref-imagegen --auto-attach-dir .betterref-imagegen/generated --project .` or the request-specific attach command so the asset plan records generated path, native size, sharpness, timestamp, and verification metadata. Do not leave project assets only under `$CODEX_HOME/generated_images`, do not manually flip asset status to `pass`, and do not call imagegen complete until fresh browser evidence renders the asset in the actual app.
Use HyperFrames for each request from `.betterref-hyperframes/hyperframes-requests.json`, then run `npx hyperframes lint`, `npx hyperframes validate`, `npx hyperframes inspect --json`, and `npx hyperframes render --format webm --quality high`. Attach the rendered file with `betterref-hyperframes --attach <asset-id>=<file> --evidence <hyperframes-evidence.json> --project .`. Do not mark a motion asset `pass` without that CLI evidence and fresh browser evidence showing the rendered video/WebM in the actual app.
When `--project .` is used, `betterref-prd` creates or updates `AGENTS.md` with a managed BetterRef contract. Preserve user/project instructions outside the managed block, and do not overwrite them.

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
- An animated/cinematic motion asset is faked as a static screenshot, lacks HyperFrames lint/validate/inspect/render evidence, or is not rendered as a video/WebM in fresh browser evidence.
- An asset-heavy PRD page has too few rendered production assets in browser evidence.
- Rendered asset dimensions exceed native image dimensions.
- A generated/source asset is marked pass but does not appear in fresh browser evidence from the actual app.
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

Start with local assets, project scripts, browser tools, DOM measurement, screenshot capture, pixel/SSIM diff, image dimensions, asset sharpness checks, fonts, icon libraries, `imagegen`, and HyperFrames. Use `imagegen` for complex static raster work. Use HyperFrames for animated/cinematic motion assets, reveal loops, shader transitions, or video/WebM deliverables. Name the gap before adding a tool.

Use `@chrome` first when it is connected; it is the real user-browser truth source. Chrome MCP or browser automation can establish route, viewport, scroll, console, font, image scale, DOM text, interactive count, DOM box truth, and real screenshot files. `betterref-run --browser-handoff .betterref-run/chrome-handoff.json` ingests that handoff and continues through diff, long-page, guard, and final verify. `betterref-chrome-bridge` converts `@chrome`/Chrome MCP handoff JSON into BetterRef browser evidence and regions, and rejects metadata-only handoffs without real viewport screenshot files. `betterref-chrome --full-page --section-screenshots` writes `.betterref/browser-evidence.json`, `.betterref/chrome-full-page.png`, and `.betterref/sections/*.png`; `betterref-guard` can use `autoAssetQuality` to map browser image URLs back to local `public` assets for sharpness checks. `betterref-longpage` auto-crops browser chrome from the reference and diffs full-page plus sections. Pass browser evidence and long-page report into `betterref-guard`/`betterref-verify` so browser hard fails cannot be hidden by a high pixel score. Final verification treats empty, malformed, or metadata-only Chrome browser evidence as a hard fail; a claim that Chrome was checked is not evidence.

Use `hyperframes-registry` only as an accelerator when a reusable block/component directly fits the required motion asset; registry blocks do not replace lint/validate/inspect/render evidence. Use `website-to-hyperframes` after the website exists when the deliverable is a promo/product-tour video from the built site, not as a substitute for PRD-to-web UI implementation.

Use `betterref-eval` for benchmark suites. A pressure fixture should declare the expected verdict, then fail CI if the actual verdict changes in a way that lets fake UI, blurred assets, missing browser evidence, missing scroll, pending or fake-passed imagegen/HyperFrames assets, or PRD gaps pass.

## Final Report

A completion claim must include:

- PRD/checklist status.
- Reference source and current screenshot source.
- Viewport/device scale and same-state status.
- Visual verdict with score, pass/revise/fail, and hard-fail status.
- BetterRef report path, guard report path, browser evidence path, asset plan path, final JSON verdict path, final HTML verdict path, and evidence bundle path.
- Imagegen and HyperFrames request/evidence paths when generated assets were required.
- Top remaining differences and next edits when score is below pass.
- Tool inventory and escalations used.

Do not say "100%" unless all PRD criteria, visual criteria, and hard-fail ledger items are verified.

## Pressure Tests

Use `references/pressure-tests.md` when editing or validating this skill. The required scenarios cover long-page screenshots, screenshot-as-UI, blurry scaled assets, missing browser evidence, missing diff tooling, PRD compliance being overruled by score, pending or fake-passed imagegen assets, and HyperFrames motion assets without CLI/browser evidence.
