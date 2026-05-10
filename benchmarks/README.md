# BetterRef Benchmarks

`betterref-eval.example.json` is intentionally runnable. It includes two clean cases and fourteen pressure cases that must not pass accidentally:

- `clean-prd-page`: code-native UI with complete PRD and browser evidence.
- `screenshot-as-ui-pressure`: high visual score, but guard hard-fails reference reuse.
- `longpage-section-pressure`: high first-pass score, but long-page section comparison fails.
- `longpage-mode-object-clean`: full-page report mode metadata is emitted as an object and the benchmark runs `betterref-guard` from `guardConfig`.
- `missing-browser-evidence-pressure`: high visual score, but required browser evidence is missing.
- `verify-missing-browser-evidence-pressure`: visual and guard evidence look clean, but final verification requires browser evidence and must fail when it is absent.
- `malformed-browser-evidence-pressure`: browser evidence file exists, but lacks viewport, DOM, font, console, and image-scale proof.
- `asset-quality-pressure`: high visual score, but guard hard-fails a blurry raster asset.
- `imagegen-pending-pressure`: high visual score and clean guard, but the required imagegen asset is still pending.
- `imagegen-fake-pass-pressure`: high visual score and clean guard, but the asset was marked pass without attach evidence.
- `imagegen-missing-file-pressure`: the asset plan metadata looks complete, but the project asset file is missing.
- `imagegen-dimension-mismatch-pressure`: the asset plan metadata claims dimensions that do not match the project asset file.
- `imagegen-file-sharpness-pressure`: the asset plan metadata claims a sharp asset, but the project asset file is flat/blurry.
- `imagegen-not-rendered-pressure`: the generated asset file verifies, but browser evidence shows the app is still rendering a placeholder instead.
- `missing-rendered-assets-pressure`: an asset-heavy PRD page has browser evidence, but no rendered production assets at all.
- `missing-mobile-prd-pressure`: no hard fail, but PRD evidence is incomplete, so the verdict is `revise`.

Each pressure case asserts both the verdict and at least one expected blocking-reason substring, so a case cannot pass by failing for an unrelated reason.

Use `guardConfig` in a manifest case when the benchmark should execute guard logic instead of trusting a static `guard-report.json`. This is useful for schema compatibility and dogfood regressions where the runner itself must prove it still catches or accepts the right evidence.

Run it from this directory with:

```bash
npx betterref-eval --manifest benchmarks/betterref-eval.example.json --json
```
