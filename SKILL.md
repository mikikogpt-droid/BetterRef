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
| 3D model from object/product/character/prop reference | Tencent-only path: `betterref-reference`, `betterref-3d`, Tencent `ResultFile3Ds`, then mesh evidence |
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
| Reference image supplied for deep copying | Run `betterref-reference` and require `reference-analysis.json` before planning. |
| Reference Pack supplied for 3D/game asset | Run `betterref-reference --pack` and require an Asset Brief that separates mesh and texture refs. |
| Reference contains object/product/character/prop for 3D | Create 3D brief and run `betterref-3d` handoff. |
| Hunyuan 3D requested | Tencent HY 3D Global only: prefer Pro 3.1 multi-view; Rapid fallback; require metadata/`ResultFile3Ds`; otherwise blocked. |
| Raw Hunyuan/Tencent model returned for Roblox | Run post-Hunyuan refine; require baked maps, Roblox import/preview, and rerun verify. |
| Auto production 3D requested | Run `--auto-refine`, `--roblox-upload`, then `--verify`. |
| Work is PRD + visual + 3D | Use Visible Agent Mode; supervisor merges reports. |

## Start Project Command

When the user says `use $betterref start project`, `use BetterRef start project`, or an equivalent start-project phrase, expand it into this contract instead of asking them to paste a long prompt again:

1. Treat BetterRef as the project supervisor from the first turn.
2. Read the PRD and run `betterref-run` or `betterref-prd --project .` to create `.betterref-prd/*` and `AGENTS.md`.
3. Use `using-superpowers` and `karpathy-guidelines` together with this skill; prefer installed skill names or `CODEX_HOME`, not a machine-specific absolute path.
4. Classify every visual as `code-native UI`, `imagegen asset`, `HyperFrames asset`, `existing asset`, or `reference-only`.
5. Never ship a PDF render, screenshot, reference crop, or browser chrome as UI.
6. For 3D-looking raster/hero art, glass, cinematic, texture, or premium stills, use `image_gen`; for real 3D model/mesh work, use signed Tencent HY 3D Global API and `ResultFile3Ds`.
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
| `use $betterref analyze reference` | Analyze a reference image into measured facts, uncertainties, visual checklist, 3D brief, and negative prompts. |
| `use $betterref 3d model` | Route modelable references into 3D asset plan, Hunyuan handoff, and 3D evidence verification. |
| `use $betterref agent team`, `use agents`, `ใช้ agents` | Use Visible Agent Mode. |

## Named 29-Agent Roster

For PRD/reference/3D work, use `references/agent-team.md` plus `betterref-agents`: risk-scoped by default, all 29 only on explicit full-roster request. Emit Context Pack, `parallel-by-team` dispatch, batched-wave spawn policy, concise JSON reports, cache reuse, merge, `runtimeMode`, and no-spawn notice. For OpenClaw external execution, use `--executor openclaw --write-mode scoped-write`; every job must include `allowedWritePaths` and return through BetterRef Supervisor merge.

## Reference Intelligence And 3D

Reference Intelligence starts with `betterref-reference`: analysis, checklist, negative prompts, 3D brief. 3D chain: Reference Pack -> Asset Brief -> Tencent main image -> signed Tencent HY 3D Global job -> refine plan -> auto-refine -> roblox-upload -> verify. Tencent only; require signed Global metadata, `ResultFile3Ds`, mesh/load evidence, triangle-budget/baked-material evidence, Roblox evidence, and no flat 2D billboard. Local procedural, Hyper3D/Rodin, or Blender-made meshes are never substitutes; if Tencent fails after the Global Rapid path is tried, stop blocked. Expanded Agent Team uses a Supervisor Packet and merges evidence/actions/hard fails. See `references/reference-intelligence.md`, `references/reference-to-3d.md`, `references/hunyuan-tencent.md`, and `references/agent-team.md`.

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

Use the detailed commands in README or `references/prd-to-web.md`.

Do not use final-pass resizing to make screenshots agree. For final verification, compare native target viewport screenshots and report layout drift instead of squeezing images.
For PRD/full-page verification, require the expected evidence with `--require guard,prd,longpage,assetplan,browser`; missing browser evidence, pending assets, fake-passed assets without attach metadata, and generated assets that are not rendered in browser evidence are hard fails.
`betterref-run` exit code `3` means the orchestrator is blocked by external `image_gen`, HyperFrames, Hunyuan, or browser evidence. Read `.betterref-run/next-actions.md`, complete the handoff, then rerun.
For imagegen, HyperFrames, and 3D assets, never mark an item `pass` until attach metadata, native evidence, and fresh browser evidence prove the generated asset renders in the actual app.
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
- A 3D/model task lacks signed Tencent HY 3D Global request metadata.
- A 3D/model task uses a non-Tencent mesh as final output instead of Tencent `ResultFile3Ds`.
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

Start with local assets, project scripts, browser tools, DOM measurement, screenshot capture, pixel/SSIM diff, image dimensions, asset sharpness checks, fonts, icon libraries, `imagegen`, and HyperFrames. Use `imagegen` for complex static raster work and HyperFrames for animated/cinematic motion assets. Name the gap before adding a tool.

Use `@chrome` first when connected; it is the real user-browser truth source. `betterref-run --browser-handoff`, `betterref-chrome-bridge`, `betterref-chrome`, and `betterref-longpage` handle browser evidence, regions, full-page/section captures, and long-page diffs. Pass browser evidence into `betterref-guard`/`betterref-verify`; empty, malformed, or metadata-only browser evidence is a hard fail.

Use `hyperframes-registry` only as an accelerator when a reusable block/component directly fits the required motion asset; registry blocks do not replace lint/validate/inspect/render evidence. Use `website-to-hyperframes` after the website exists when the deliverable is a promo/product-tour video from the built site, not as a substitute for PRD-to-web UI implementation.

Use `betterref-eval` for benchmark suites. A pressure fixture should declare the expected verdict, then fail CI if the actual verdict changes in a way that lets fake UI, blurred assets, missing browser evidence, missing scroll, pending or fake-passed imagegen/HyperFrames assets, or PRD gaps pass.

## Final Report

A completion claim must include:

- PRD/checklist status, reference/current screenshot source, and same-state viewport.
- Visual verdict with score, pass/revise/fail, hard-fail status, and top remaining differences.
- BetterRef report, guard report, browser evidence, asset plan, final JSON/HTML verdict, evidence bundle, and generated-asset evidence paths.
- Tool inventory and escalations used.

Do not say "100%" unless all PRD criteria, visual criteria, and hard-fail ledger items are verified.

## Pressure Tests

Use `references/pressure-tests.md` when editing or validating this skill. The required scenarios cover long-page screenshots, screenshot-as-UI, blurry scaled assets, missing browser evidence, missing diff tooling, PRD compliance being overruled by score, pending or fake-passed imagegen assets, and HyperFrames motion assets without CLI/browser evidence.
