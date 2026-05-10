# PRD To Web Reference

Use this when a PRD PDF, written product spec, Figma brief, or visual target is the input for a website or app.

## Required Artifacts

- `requirements.md`: product, content, interaction, visual, responsive, and asset requirements.
- `visual-checklist.md`: each visible area, target viewport, typography, asset class, and pass criteria.
- `prd-checklist.json`: machine-readable checklist consumed by `betterref-verify`.
- `asset-plan.json`: machine-readable generated/source asset plan with imagegen prompts, target paths, native-size minimums, and pass/pending status.
- `.betterref.json`: viewport, regions, ignore areas, and thresholds.
- `betterref.guard.json`: hard-fail config for source scans, long-page mode, asset scaling, rendered asset coverage, and auto raster quality when the PRD mentions hero/image/premium assets.
- `.betterref/report.json`, `.betterref/browser-evidence.json`, `.betterref/guard-report.json`, `.betterref/final-verdict.json`, `.betterref/final-verdict.html`, and `.betterref/evidence-bundle.json`: final evidence.

## Phase Gate

A phase passes only when all are true:

- PRD checklist items assigned to the phase are complete.
- Real UI is code-native where deterministic UI is required.
- Complex raster/3D/cinematic visuals are generated or sourced as production assets.
- Fresh browser screenshots exist for desktop and mobile target states.
- Browser evidence exists for viewport, scroll, fonts, DOM text, interactive elements, console, and image scale.
- Hero, mascot, cinematic, premium, raster, or other image-heavy assets are checked by `autoAssetQuality` or explicit `assetQualityChecks`.
- BetterRef visual verdict passes the configured threshold.
- `betterref-guard` passes.
- No hard-fail ledger item remains.

## PRD Extraction Rules

Separate requirements before implementation:

- Product behavior: navigation, flows, forms, auth, payments, search, filtering, states.
- Content: copy, labels, pricing, game names, promotions, badges, legal text.
- Visual style: layout, hierarchy, colors, typography, animation, motion density.
- Asset needs: logo, hero, icons, game art, payments, social proof.
- Code-native visual behavior: sticky headers, hover zoom, border glow, parallax limits, responsive menus, and fallback-only rules. These belong in `prd-checklist.json`, not `asset-plan.json`.
- Verification: commands, screenshots, selectors, section names, mobile states.

PDF pages, screenshots, and rendered PRD pages are evidence only. They cannot be shipped as page UI.

## Recommended Commands

```bash
npx betterref-prd --pdf PRD.pdf --out .betterref-prd --config-out .betterref.json --url http://127.0.0.1:3000/ --ref reference.png
npx betterref-imagegen --asset-plan .betterref-prd/asset-plan.json --out .betterref-imagegen --json
npx betterref-chrome --endpoint http://127.0.0.1:9222 --url-match 127.0.0.1:3000 --out .betterref --full-page --section-screenshots --ref reference.png --regions both --html
# No-CDP local alternative when Playwright is installed in the project:
npx betterref-capture --url http://127.0.0.1:3000 --out .betterref --ref reference.png --viewport 1440x900 --full-page --section-screenshots --html
npx betterref-longpage --ref reference.png --actual-full .betterref/chrome-full-page.png --browser-evidence .betterref/browser-evidence.json --out .betterref-longpage --crop-reference auto --html
npx betterref-guard --project . --report .betterref/report.json --config .betterref-prd/betterref.guard.json --browser-evidence .betterref/browser-evidence.json --out .betterref/guard-report.json
npx betterref-verify --report .betterref/report.json --guard .betterref/guard-report.json --longpage .betterref-longpage/longpage-report.json --prd .betterref-prd/prd-checklist.json --asset-plan .betterref-prd/asset-plan.json --browser-evidence .betterref/browser-evidence.json --project . --require guard,prd,longpage,assetplan,browser --out .betterref/final-verdict.json --html .betterref/final-verdict.html --bundle .betterref/evidence-bundle.json
```

If you use `betterref-capture --full-page` instead of `betterref-chrome`, pass `.betterref/screenshot.png` as `--actual-full` to `betterref-longpage`. Add repeated `--selector name=css` entries when the app has stable section selectors, for example `--selector hero=[data-betterref="hero"] --selector footer=footer`.

Use tool scores as evidence, not authority. If the PRD says the page must scroll, have working cards, or include a generated hero asset, a high visual score cannot pass a fake or missing implementation.
Use `--require guard,prd,longpage,assetplan,browser` and pass `--browser-evidence .betterref/browser-evidence.json` in final PRD verification so omitted browser evidence and pending generated/source assets fail instead of silently passing.

`betterref-prd` sets `requireBrowserEvidence: true` in the generated guard config. The final phase cannot pass from static screenshots, reports alone, or placeholder browser evidence; final verification requires browser evidence with viewport, scroll, DOM text, interactive count, font, console, and image-scale fields.

## Final Evidence Bundle

The final handoff artifact is `.betterref/evidence-bundle.json`. Treat it as the audit record for the phase, not as another optional report. It must be created by `betterref-verify --bundle` after the final browser capture and it should be committed or attached to CI artifacts when the project allows generated evidence files.

The bundle must include:

- `inputs`: absolute paths for the reports used to make the verdict.
- `requiredEvidence`: which evidence classes were required and which, if any, were missing.
- `browserEvidence`: pass/fail summary and invalid evidence count.
- `assetPlan`: generated/source asset summary including pending and invalid counts.
- `artifacts`: byte sizes and SHA-256 hashes for visual, guard, PRD, long-page, browser, asset-plan, final JSON, and final HTML evidence.
- `blockingReasons`: the exact reasons the phase is not passable.

A bundle with `verdict.passed: true` is only credible when `requiredEvidence.missing` is empty, `blockingReasons` is empty, `browserEvidence.passed` is true, `assetPlan.passed` is true, and every required artifact is present with a hash. If any one of those checks fails, continue implementation instead of reporting completion.

When PRD text mentions concrete hero, mascot, image, raster, 3D, glass, texture, background, illustration, or rendered asset work, `betterref-prd` enables `autoAssetQuality`, sets `minRenderedAssets`, and writes `asset-plan.json`. Each pending asset must be generated with `imagegen` or sourced as a production asset, saved to its target path, wired into the app, verified with browser evidence, and marked `pass` only after scale and sharpness checks pass. Generic style language such as "premium neon motion" is not by itself an imagegen task unless it is attached to a specific asset subject.
Use `betterref-imagegen --asset-plan ... --out .betterref-imagegen` to create built-in `image_gen` requests, then `betterref-imagegen --attach <asset-id>=<file> --project .` after generation so final verification can trust the asset plan. A manually edited `status: pass` is not evidence.

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
