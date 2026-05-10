# BetterRef Benchmarks

`betterref-eval.example.json` is intentionally runnable. It includes one clean case and four pressure cases that must not pass accidentally:

- `clean-prd-page`: code-native UI with complete PRD evidence.
- `screenshot-as-ui-pressure`: high visual score, but guard hard-fails reference reuse.
- `longpage-section-pressure`: high first-pass score, but long-page section comparison fails.
- `asset-quality-pressure`: high visual score, but guard hard-fails a blurry raster asset.
- `missing-mobile-prd-pressure`: no hard fail, but PRD evidence is incomplete, so the verdict is `revise`.

Run it from this directory with:

```bash
npx betterref-eval --manifest benchmarks/betterref-eval.example.json --json
```
