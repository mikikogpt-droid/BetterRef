# Full-Page Scroll Reference

Use `full_page_scroll_reference` when the reference is taller than the target viewport or clearly shows a whole webpage.

## Rules

- Crop browser, OS, Safari, Chrome, PDF viewer, and app chrome before comparison.
- Classify the cropped reference as long-page when height exceeds target viewport height.
- Treat the reference as a scroll map. Do not compress it into one viewport.
- Capture a native-width full-page screenshot from the actual app.
- Capture viewport screenshots at section scroll positions or element selectors.
- Compare sections at native width. If heights differ, report layout drift.
- Do not hide drift by stretching or squeezing images.

Use Chrome CDP capture when available:

```bash
npx betterref-chrome --endpoint http://127.0.0.1:9222 --url-match 127.0.0.1:3000 --out .betterref --full-page --section-screenshots --ref reference.png --regions both --html
npx betterref-longpage --ref reference.png --actual-full .betterref/chrome-full-page.png --browser-evidence .betterref/browser-evidence.json --out .betterref-longpage --crop-reference auto --html
```

This writes `.betterref/chrome-full-page.png`, `.betterref/sections/*.png`, `.betterref/chrome-dom-boxes.json`, `.betterref/browser-evidence.json`, and `.betterref-longpage/longpage-report.json`.

## Minimum Sections

- `header + hero`
- `quick-start / primary action`
- `main content / products / games`
- `promotions / secondary content`
- `how it works / process`
- `trust / payment / social proof`
- `footer`

Use stable selectors when possible, for example:

```json
{
  "mode": "full_page_scroll_reference",
  "targetViewport": { "width": 1440, "height": 900 },
  "sections": [
    { "name": "header + hero", "selector": "[data-betterref='hero']" },
    { "name": "quick-start", "selector": "#quick-topup" },
    { "name": "main content", "selector": "#popular-games" },
    { "name": "promotions", "selector": "#promotions" },
    { "name": "how it works", "selector": "#how-it-works" },
    { "name": "trust/payment", "selector": "#trust-payment" },
    { "name": "footer", "selector": "footer" }
  ]
}
```

## Final Evidence

The verdict must include:

- cropped reference dimensions
- target viewport
- actual native full-page screenshot dimensions
- full-page structure score
- per-section scores
- section height drift
- `.betterref-longpage/longpage-report.json`
- hard-fail ledger
- `betterref-guard` result

Pass is impossible when a long reference is scored against only the first viewport.
