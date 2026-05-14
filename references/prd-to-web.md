# PRD To Web Reference

Use this when a PRD PDF, written product spec, Figma brief, or visual target is the input for a website or app.

## Required Artifacts

- `requirements.md`: product, content, interaction, visual, responsive, and asset requirements.
- `visual-checklist.md`: each visible area, target viewport, typography, asset class, and pass criteria.
- `prd-checklist.json`: machine-readable checklist consumed by `betterref-verify`.
- `asset-plan.json`: machine-readable generated/source asset plan with imagegen and HyperFrames prompts, target paths, native-size or CLI evidence requirements, and pass/pending status.
- `.betterref-run/run-state.json`, `.betterref-run/next-actions.md`, and `.betterref-run/final-summary.json`: hybrid orchestrator state and handoff trail from `betterref-run`.
- `.betterref-agents/supervisor-packet.json`, `.betterref-agents/run-log.md`, `.betterref-agents/reports/*.json`, and `.betterref-agents/supervisor-merge.json`: visible agent-team evidence for PRD/reference/3D work.
- `AGENTS.md`: project-root BetterRef/Karpathy/Superpowers contract generated only when `betterref-prd` receives `--project`.
- `.betterref.json`: viewport, regions, ignore areas, and thresholds.
- `betterref.guard.json`: hard-fail config for source scans, long-page mode, asset scaling, rendered asset coverage, and auto raster quality when the PRD mentions hero/image/premium assets.
- `.betterref/report.json`, `.betterref/browser-evidence.json`, `.betterref/guard-report.json`, `.betterref/final-verdict.json`, `.betterref/final-verdict.html`, and `.betterref/evidence-bundle.json`: final evidence.

## Phase Gate

A phase passes only when all are true:

- PRD checklist items assigned to the phase are complete.
- Real UI is code-native where deterministic UI is required.
- Complex static raster/3D/cinematic visuals are generated or sourced as production assets.
- Animated/cinematic motion visuals are rendered from HyperFrames and attached with passing lint/validate/inspect/render evidence.
- Fresh browser screenshots exist for desktop and mobile target states.
- Browser evidence exists for viewport, scroll, fonts, DOM text, interactive elements, console, and image scale.
- Hero, mascot, cinematic, premium, raster, or other image-heavy assets are checked by `autoAssetQuality` or explicit `assetQualityChecks`.
- Motion/video assets are visible in browser evidence as `<video>` or equivalent rendered media.
- BetterRef visual verdict passes the configured threshold.
- `betterref-guard` passes.
- No hard-fail ledger item remains.

## PRD Extraction Rules

Separate requirements before implementation:

- Product behavior: navigation, flows, forms, auth, payments, search, filtering, states.
- Content: copy, labels, pricing, game names, promotions, badges, legal text.
- Visual style: layout, hierarchy, colors, typography, animation, motion density.
- Asset needs: logo, hero, icons, game art, payments, social proof, static raster assets, and motion/video assets.
- Code-native visual behavior: sticky headers, hover zoom, border glow, parallax limits, responsive menus, and fallback-only rules. These belong in `prd-checklist.json`, not `asset-plan.json`.
- HyperFrames motion needs: animated hero loops, logo reveals, shader transitions, product-tour clips, WebM/MP4 assets. These belong in `asset-plan.json` as HyperFrames tasks, not imagegen tasks.
- Verification: commands, screenshots, selectors, section names, mobile states.

PDF pages, screenshots, and rendered PRD pages are evidence only. They cannot be shipped as page UI.

## Recommended Commands

Use `@chrome` first when the Codex Chrome Extension is connected. The browser truth source for PRD-to-web work should be the user's real Chrome state whenever available: selected tab, route, scroll, zoom, fonts, console/network, DOM boxes, full-page screenshot, and per-section screenshots. If the Chrome plugin skill is present but no explicit Chrome tool appears in the initial tool list, load the Chrome skill and discover `node_repl js`; the extension backend uses the bundled browser client through that runtime.

Fallback order for browser evidence:

1. `@chrome` / Chrome plugin extension backend.
2. Chrome MCP server, when exposed.
3. `betterref-chrome` through Chrome CDP.
4. `betterref-capture` through project-local Playwright.

```bash
npx betterref-run --pdf PRD.pdf --project . --url http://127.0.0.1:3000/ --ref reference.png --endpoint http://127.0.0.1:9222 --json
npx betterref-prd --pdf PRD.pdf --out .betterref-prd --project . --config-out .betterref.json --url http://127.0.0.1:3000/ --ref reference.png
npx betterref-imagegen --asset-plan .betterref-prd/asset-plan.json --out .betterref-imagegen --json
npx betterref-imagegen --asset-plan .betterref-prd/asset-plan.json --auto-attach-dir .betterref-imagegen/generated --project . --json
npx betterref-hyperframes --asset-plan .betterref-prd/asset-plan.json --out .betterref-hyperframes --json
# After authoring/rendering HyperFrames and collecting passing lint/validate/inspect/render evidence:
npx betterref-hyperframes --asset-plan .betterref-prd/asset-plan.json --attach asset-001=path/to/rendered.webm --evidence path/to/hyperframes-evidence.json --project . --json
# When evidence comes from @chrome or Chrome MCP handoff JSON:
npx betterref-chrome-bridge --input .betterref/chrome-handoff.json --out .betterref --config-out .betterref.json --json
npx betterref-chrome --endpoint http://127.0.0.1:9222 --url-match 127.0.0.1:3000 --out .betterref --full-page --section-screenshots --ref reference.png --regions both --html
# No-CDP local alternative when Playwright is installed in the project:
npx betterref-capture --url http://127.0.0.1:3000 --out .betterref --ref reference.png --viewport 1440x900 --full-page --section-screenshots --html
npx betterref-longpage --ref reference.png --actual-full .betterref/chrome-full-page.png --browser-evidence .betterref/browser-evidence.json --out .betterref-longpage --crop-reference auto --html
npx betterref-guard --project . --report .betterref/report.json --config .betterref-prd/betterref.guard.json --browser-evidence .betterref/browser-evidence.json --out .betterref/guard-report.json
npx betterref-verify --report .betterref/report.json --guard .betterref/guard-report.json --longpage .betterref-longpage/longpage-report.json --prd .betterref-prd/prd-checklist.json --asset-plan .betterref-prd/asset-plan.json --browser-evidence .betterref/browser-evidence.json --project . --require guard,prd,longpage,assetplan,browser --out .betterref/final-verdict.json --html .betterref/final-verdict.html --bundle .betterref/evidence-bundle.json
```

If you use `betterref-capture --full-page` instead of `betterref-chrome`, pass `.betterref/screenshot.png` as `--actual-full` to `betterref-longpage`. Add repeated `--selector name=css` entries when the app has stable section selectors, for example `--selector hero=[data-betterref="hero"] --selector footer=footer`.
If you use `@chrome`, export the tab handoff as `.betterref/chrome-handoff.json`, run `betterref-chrome-bridge`, and pass the generated `.betterref/browser-evidence.json` through guard and final verification.

`betterref-run` is the preferred first command for new PRD-to-web work. It runs every local BetterRef step that has enough evidence and exits `3` with `.betterref-run/next-actions.md` when it needs external action such as built-in `image_gen`, HyperFrames CLI render evidence, or real browser evidence from `@chrome`/CDP.

Use tool scores as evidence, not authority. If the PRD says the page must scroll, have working cards, include a generated hero asset, or include an animated motion asset, a high visual score cannot pass a fake or missing implementation.
Use `--require guard,prd,longpage,assetplan,browser` and pass `--browser-evidence .betterref/browser-evidence.json` in final PRD verification so omitted browser evidence and pending generated/source assets fail instead of silently passing.

When the PRD requires 3D or a named agent team, include visible agent evidence. `betterref-run` creates `.betterref-agents/*` during 3D runs; final verification should add `--agent-merge .betterref-agents/supervisor-merge.json --require agents` or use `--require all`.

`betterref-prd --project .` creates or updates `AGENTS.md` with a managed contract that forces future agents to read `using-superpowers`, `karpathy-guidelines`, and `betterref` before non-trivial PRD-to-web work. Existing project instructions outside the managed block are preserved. `betterref-prd` also sets `requireBrowserEvidence: true` in the generated guard config. The final phase cannot pass from static screenshots, reports alone, or placeholder browser evidence; final verification requires browser evidence with viewport, scroll, DOM text, interactive count, font, console, and image-scale fields.

## Final Evidence Bundle

The final handoff artifact is `.betterref/evidence-bundle.json`. Treat it as the audit record for the phase, not as another optional report. It must be created by `betterref-verify --bundle` after the final browser capture and it should be committed or attached to CI artifacts when the project allows generated evidence files.

The bundle must include:

- `inputs`: absolute paths for the reports used to make the verdict.
- `requiredEvidence`: which evidence classes were required and which, if any, were missing.
- `browserEvidence`: pass/fail summary and invalid evidence count.
- `assetPlan`: generated/source asset summary including pending, invalid, imagegen-required, and HyperFrames-required counts.
- `artifacts`: byte sizes and SHA-256 hashes for visual, guard, PRD, long-page, browser, asset-plan, final JSON, and final HTML evidence.
- `blockingReasons`: the exact reasons the phase is not passable.

A bundle with `verdict.passed: true` is only credible when `requiredEvidence.missing` is empty, `blockingReasons` is empty, `browserEvidence.passed` is true, `assetPlan.passed` is true, and every required artifact is present with a hash. If any one of those checks fails, continue implementation instead of reporting completion.

When PRD text mentions concrete static hero, mascot, image, raster, 3D, glass, texture, background, illustration, or rendered still-asset work, `betterref-prd` enables `autoAssetQuality`, sets `minRenderedAssets`, and writes `asset-plan.json`. Each pending static asset must be generated with `imagegen` or sourced as a production asset, saved to its target path, wired into the app, verified with browser evidence, and marked `pass` only after scale and sharpness checks pass. Generic style language such as "premium neon motion" is not by itself an imagegen task unless it is attached to a specific asset subject.
Use `betterref-imagegen --asset-plan ... --out .betterref-imagegen` to create built-in `image_gen` requests. After generation, either run `betterref-imagegen --attach <asset-id>=<file> --project .` or save generated files as `.betterref-imagegen/generated/<asset-id>.*` and run `betterref-imagegen --auto-attach-dir .betterref-imagegen/generated --project .`. A manually edited `status: pass` is not evidence.

When PRD text mentions animated, motion, reveal, loop, WebM/MP4, shader transition, video, or HyperFrames work, `betterref-prd` routes the item to HyperFrames. Use `betterref-hyperframes --asset-plan ... --out .betterref-hyperframes` to create the request queue, author/render the composition with HyperFrames, run `npx hyperframes lint`, `npx hyperframes validate`, `npx hyperframes inspect --json`, and `npx hyperframes render --format webm --quality high`, then attach the rendered asset with `betterref-hyperframes --attach <asset-id>=<file> --evidence <hyperframes-evidence.json> --project .`. A manually edited `status: pass` or a video file without CLI evidence is not evidence.

## Benchmark Manifests

Keep pressure scenarios in a manifest and run them before publishing BetterRef changes:

```json
{
  "cases": [
    {
      "id": "imagegen-pending-pressure",
      "report": "fixtures/imagegen-pending/report.json",
      "guard": "fixtures/imagegen-pending/guard-report.json",
      "assetPlan": "fixtures/imagegen-pending/asset-plan.json",
      "browserEvidence": "fixtures/imagegen-pending/browser-evidence.json",
      "require": "assetplan,browser",
      "expect": { "verdict": "fail", "hardFailPresent": true }
    }
  ]
}
```

Run:

```bash
npx betterref-eval --manifest benchmarks/betterref-eval.json --out .betterref/eval-report.json
```

Use `benchmarks/betterref-eval.example.json` as the starting shape for project-specific fixtures. Replace the paths with real reports generated from your own pressure cases.
