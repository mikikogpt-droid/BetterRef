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
| `asset_quality_below_threshold` | Raster asset is blurrier or lower-detail than the configured sharpness threshold. |
| `asset_quality_missing_path` | Configured asset quality check has no local image path. |
| `asset_quality_unreadable` | Configured asset quality image cannot be read. |
| `browser_evidence_missing` | Guard config requires fresh browser evidence, but no browser-evidence file was provided. |
| `browser_missing_scroll_evidence` | Browser evidence shows a long-page reference is being checked against a non-scrollable page. |
| `browser_fonts_not_ready` | Browser evidence shows fonts were not ready during capture. |
| `browser_console_error_present` | Browser evidence contains console errors or exceptions. |
| `browser_network_error_present` | Browser evidence contains failed HTTP responses or failed requests with URL/status details. |
| `browser_missing_dom_text` | Guard requires DOM text but browser evidence shows none. |
| `browser_missing_interactive_elements` | Guard requires interactive elements but browser evidence shows too few. |
| `browser_missing_rendered_assets` | Asset-heavy PRD/browser config requires production image assets, but browser evidence shows too few rendered assets. |
| `asset_pass_missing_hyperframes_evidence` | A HyperFrames asset is marked pass without passing lint, validate, inspect, and render evidence. |
| `asset_pass_not_rendered` | A generated/source/HyperFrames asset is marked pass but fresh browser evidence does not show it rendered in the actual app. |

## Guard Config Example

```json
{
  "longReference": true,
  "targetViewport": { "width": 1440, "height": 900 },
  "actualFullPageHeight": 1780,
  "requireBrowserEvidence": true,
  "requireDomText": true,
  "minInteractiveElements": 1,
  "minRenderedAssets": 1,
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
  ],
  "assetQualityChecks": [
    {
      "path": "public/assets/hero.png",
      "role": "hero",
      "minSharpness": 20
    }
  ],
  "autoAssetQuality": {
    "enabled": true,
    "minSharpness": 20,
    "roots": ["public"]
  }
}
```

`autoAssetQuality` uses `browser-evidence.json` image URLs and checks matching local files under `public` by default. It skips unresolved external/CDN/data/blob images instead of hard-failing them; add explicit `assetQualityChecks` for assets that cannot be mapped from browser evidence. HyperFrames/video assets are verified from the asset plan's CLI evidence plus `browser-evidence.json` `videos` or `media.rendered` entries, not from raster sharpness checks.

## 3D Model Hard Fails

Current `betterref-3d` evidence codes include `asset_pending`, `missing_model_file`, `missing_target_model_file`, `missing_mesh_stats`, `missing_render_evidence`, `missing_material_evidence`, `missing_hunyuan_request_metadata`, `missing_hunyuan_response_metadata`, `missing_post_hunyuan_refinement`, `roblox_triangle_budget_exceeded`, and `missing_roblox_import_evidence`.

- Flat 2D billboard as 3D: fail as `missing_mesh_stats` or `missing_render_evidence` unless the evidence proves non-empty geometry from multiple angles.
- Missing runtime/load proof: fail as `missing_model_file` when no non-empty model path is verified.
- Missing mesh stats: fail as `missing_mesh_stats`; passed models need vertex/face/material counts.
- Missing turntable/multi-angle proof: fail as `missing_render_evidence` when fidelity requires multi-angle render evidence.
- Missing Hunyuan request/response metadata: treat as an evidence-integrity hard fail and do not accept the model until provider/request/response metadata is recorded.
- Raw Hunyuan/Tencent output accepted as final: fail as `missing_post_hunyuan_refinement` until Blender/manual refinement evidence exists.
- Roblox triangle budget exceeded: fail as `roblox_triangle_budget_exceeded`; raw high-poly output is not Roblox-ready.
- Missing Roblox upload/import proof: fail as `missing_roblox_import_evidence` until Open Cloud upload evidence or Studio import/preview evidence exists.

Run:

```bash
npx betterref-guard --project . --report .betterref/report.json --config betterref.guard.json --out .betterref/guard-report.json
npx betterref-guard --project . --report .betterref/report.json --config betterref.guard.json --browser-evidence .betterref/browser-evidence.json --out .betterref/guard-report.json
```

If guard fails, the phase fails even when the pixel score is high.
