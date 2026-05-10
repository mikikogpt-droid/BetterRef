# PRD To Web Reference

Use this when a PRD PDF, written product spec, Figma brief, or visual target is the input for a website or app.

## Required Artifacts

- `requirements.md`: product, content, interaction, visual, responsive, and asset requirements.
- `visual-checklist.md`: each visible area, target viewport, typography, asset class, and pass criteria.
- `.betterref.json`: viewport, regions, ignore areas, and thresholds.
- `betterref.guard.json`: hard-fail config for source scans, long-page mode, and asset scaling.
- `.betterref/report.json` and `.betterref/guard-report.json`: final evidence.

## Phase Gate

A phase passes only when all are true:

- PRD checklist items assigned to the phase are complete.
- Real UI is code-native where deterministic UI is required.
- Complex raster/3D/cinematic visuals are generated or sourced as production assets.
- Fresh browser screenshots exist for desktop and mobile target states.
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
npx betterref-capture --url http://127.0.0.1:3000/ --ref reference.png --out .betterref --viewport 1440x900 --html
npx betterref-guard --project . --report .betterref/report.json --config betterref.guard.json --out .betterref/guard-report.json
```

Use tool scores as evidence, not authority. If the PRD says the page must scroll, have working cards, or include a generated hero asset, a high visual score cannot pass a fake or missing implementation.
