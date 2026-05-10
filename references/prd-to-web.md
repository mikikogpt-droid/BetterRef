# PRD To Web Reference

Use this when a PRD PDF, written product spec, Figma brief, or visual target is the input for a website or app.

## Required Artifacts

- `requirements.md`: product, content, interaction, visual, responsive, and asset requirements.
- `visual-checklist.md`: each visible area, target viewport, typography, asset class, and pass criteria.
- `prd-checklist.json`: machine-readable checklist consumed by `betterref-verify`.
- `.betterref.json`: viewport, regions, ignore areas, and thresholds.
- `betterref.guard.json`: hard-fail config for source scans, long-page mode, asset scaling, and auto raster quality when the PRD mentions hero/image/premium assets.
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
- Verification: commands, screenshots, selectors, section names, mobile states.

PDF pages, screenshots, and rendered PRD pages are evidence only. They cannot be shipped as page UI.

## Recommended Commands

```bash
npx betterref-prd --pdf PRD.pdf --out .betterref-prd --config-out .betterref.json --url http://127.0.0.1:3000/ --ref reference.png
npx betterref-chrome --endpoint http://127.0.0.1:9222 --url-match 127.0.0.1:3000 --out .betterref --full-page --section-screenshots --ref reference.png --regions both --html
npx betterref-longpage --ref reference.png --actual-full .betterref/chrome-full-page.png --browser-evidence .betterref/browser-evidence.json --out .betterref-longpage --crop-reference auto --html
npx betterref-guard --project . --report .betterref/report.json --config .betterref-prd/betterref.guard.json --browser-evidence .betterref/browser-evidence.json --out .betterref/guard-report.json
npx betterref-verify --report .betterref/report.json --guard .betterref/guard-report.json --longpage .betterref-longpage/longpage-report.json --prd .betterref-prd/prd-checklist.json --out .betterref/final-verdict.json --html .betterref/final-verdict.html --bundle .betterref/evidence-bundle.json
```

Use tool scores as evidence, not authority. If the PRD says the page must scroll, have working cards, or include a generated hero asset, a high visual score cannot pass a fake or missing implementation.

When PRD text mentions hero, mascot, image, raster, 3D, glass, cinematic, premium, texture, background, illustration, or rendered assets, `betterref-prd` enables `autoAssetQuality` in the generated guard config. That makes blurry local browser assets fail automatically once `browser-evidence.json` is captured.

## Benchmark Manifests

Keep pressure scenarios in a manifest and run them before publishing BetterRef changes:

```json
{
  "cases": [
    {
      "id": "screenshot-as-ui-pressure",
      "report": "fixtures/screenshot-as-ui/report.json",
      "guard": "fixtures/screenshot-as-ui/guard-report.json",
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
