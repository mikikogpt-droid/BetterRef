# Hard-Fail Ledger

The hard-fail ledger is the authority that numeric scores cannot override.

## Ledger Codes

| Code | Failure |
|---|---|
| `reference_asset_used_in_source` | Source uses screenshot, PDF render, Figma export, full-page reference, or crop as shipped UI. |
| `reported_hard_fail_present` | BetterRef report already contains hard-fail evidence. |
| `visual_report_not_passed` | Visual report is not pass. |
| `long_reference_missing_scroll_mode` | Long reference was not handled as `full_page_scroll_reference`. |
| `long_reference_missing_section_scores` | Long reference lacks per-section verdicts. |
| `actual_page_missing_scroll_evidence` | No native full-page screenshot taller than the viewport. |
| `asset_scaled_beyond_native_size` | Rendered image is larger than its native dimensions. |

## Guard Config Example

```json
{
  "longReference": true,
  "targetViewport": { "width": 1440, "height": 900 },
  "actualFullPageHeight": 1780,
  "forbiddenSourcePatterns": [
    "assets/reference",
    "homepage-reference",
    "pdf-render",
    "figma-export"
  ],
  "sourceExtensions": [".tsx", ".jsx", ".css", ".html"],
  "renderedAssets": [
    {
      "selector": ".hero img",
      "src": "/assets/hero.png",
      "nativeWidth": 1920,
      "nativeHeight": 1080,
      "renderedWidth": 900,
      "renderedHeight": 520
    }
  ]
}
```

Run:

```bash
npx betterref-guard --project . --report .betterref/report.json --config betterref.guard.json --out .betterref/guard-report.json
```

If guard fails, the phase fails even when the pixel score is high.
