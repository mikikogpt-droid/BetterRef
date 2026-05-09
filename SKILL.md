---
name: betterref
description: Use when a user provides or references a visual target, screenshot, mockup, design reference, UI image, brand image, hero image, or says to make the result look the same, match the reference, be pixel-perfect, beautiful, premium, polished, cinematic, visually impressive, or needs screenshot-to-reference visual QA.
---

# BetterRef

## Overview

BetterRef is for reference-driven visual work. Treat the reference image as the source of truth and use every available tool needed to make the output match it as closely as possible.

The default goal is maximum visual fidelity, not code-native purity.

## Core Rules

- Preserve existing business logic and working behavior unless the user explicitly asks to change it.
- Match the reference's layout, proportions, spacing, typography, color, lighting, texture, depth, mood, and asset quality.
- Use all available tools that improve the result. If an asset is missing, find it, generate it, or build it.
- Use `imagegen` freely for raster assets, hero visuals, illustrations, glass/3D objects, premium backgrounds, mockups, textures, and any visual detail that CSS/SVG would only approximate.
- Use code-native HTML/CSS/SVG for deterministic UI structure: layout, panels, buttons, tabs, cards, forms, grids, and states.
- Do not invent design limitations that reduce fidelity or polish.
- Do not stop at "same vibe" when the request is to match a reference.

## Workflow

1. Identify the reference source.
   - Use attached images, local paths, browser screenshots, Figma/exported images, or user-provided URLs.
   - If the user says a reference exists but it is not available, search local context first; browse or ask only if the reference cannot be found.

2. Classify each part of the target.
   - UI shell/layout: implement with code.
   - Complex visual asset: generate or edit a raster asset with `imagegen`.
   - Existing brand/logo/icon asset: reuse the official/local asset when available.
   - Data/functionality: preserve the current implementation.

3. Extract measurable visual facts.
   - Match viewport size, aspect ratio, column widths, fixed bars, card sizes, radii, gaps, icon sizes, font sizes, and vertical rhythm.
   - Sample colors and shadows from the reference when practical.
   - Name any uncertainty before editing.

4. Build the visual layer.
   - Lock the macro layout first: top bar, rails, sidebars, content area, bottom bar.
   - Place generated/found raster assets where the reference uses rendered, photographic, glass, 3D, textured, or cinematic visuals.
   - Use CSS variables/tokens for repeated colors, spacing, radius, shadow, and transitions.

5. Verify visually.
   - Run the app or open the file in the browser.
   - Capture screenshots at the same viewport as the reference.
   - Produce a structured visual verdict before deciding the work is complete.
   - Fix mismatches from the verdict: scrollbars, clipping, wrong proportions, wrong spacing, wrong asset quality, text overflow, contrast, and font weight.

6. Report honestly.
   - State what matches, what still differs, and what was verified.
   - Do not claim "100%" unless screenshots support it.

## Visual Verdict Gate

Use a visual-verdict style gate whenever both a reference image and a current screenshot exist. The verdict is the quality signal that drives the next edit.

Return or internally track this shape:

```json
{
  "score": 0,
  "verdict": "revise",
  "category_match": false,
  "differences": ["..."],
  "suggestions": ["..."],
  "reasoning": "short explanation"
}
```

Rules:

- `score` is 0-100.
- `verdict` is `pass`, `revise`, or `fail`.
- `category_match` is true only when the output is the same class of UI/visual as the reference.
- `differences` must name concrete visual mismatches: layout, spacing, typography, colors, hierarchy, asset quality, clipping, scrollbars, or responsiveness.
- `suggestions` must be actionable edits tied to those differences.
- Target threshold is 90+. If `score < 90`, continue editing and capture a new screenshot before claiming completion.
- Use pixel diff or overlay tools as secondary aids when the mismatch is hard to localize; convert hotspots into `differences` and `suggestions`.

## Tool Selection

| Target | Preferred Tool |
|---|---|
| Enterprise UI shell, dashboard, IDE layout | HTML/CSS/component code |
| Glass orb, 3D pedestal, cinematic hero, premium illustration | `imagegen` |
| Photorealistic/product/texture/background asset | `imagegen` |
| Existing logo or brand mark | reuse local/official asset |
| Exact icons in UI controls | SVG/lucide/icon library |
| Pixel/layout verification | browser screenshot/Playwright/visual verdict/pixel diff |

## Red Flags

Stop and change approach when any of these happen:

- A CSS/SVG drawing is being used to imitate a complex rendered image.
- The output only matches the palette but not the layout proportions.
- The page has unexpected nested scrollbars, white scrollbars, clipping, or shifted scroll position.
- The hero or main visual is missing, cropped, flat, or obviously lower quality than the reference.
- The implementation is being judged by memory instead of a fresh screenshot.
- The verdict score is below 90 but the work is being described as done.
- The verdict lists vague differences without actionable next edits.
- The user asks "how is this the same?" or similar. Re-enter the workflow from measurement and verification.

## BetterRef Checklist

- [ ] Reference image is visible or located.
- [ ] Viewport and screenshot size are known.
- [ ] Macro layout proportions match before detail polish.
- [ ] Complex visuals use generated/found raster assets when appropriate.
- [ ] Fonts, weights, line heights, and Thai text rendering are checked.
- [ ] No accidental scrollbars, clipping, overlap, or overflow.
- [ ] Final screenshot was inspected against the reference.
- [ ] Visual verdict score is 90+ or remaining gaps are explicitly reported.
- [ ] Verdict differences and suggestions are concrete enough to drive the next edit.
- [ ] Remaining differences are stated plainly.

## Common Mistakes

| Mistake | Correction |
|---|---|
| "CSS can approximate this" | If the reference visual is rendered/glass/3D/cinematic, use `imagegen`. |
| "It has the same colors" | Match proportions, hierarchy, lighting, spacing, and asset quality too. |
| "The prompt said CSS/SVG-style" | If the user's goal is reference fidelity, raster assets are allowed when they improve the result. |
| "A small asset adds complexity" | Visual fidelity is the requirement; manage the asset cleanly instead of avoiding it. |
| "Looks good enough" | Capture a screenshot and compare against the reference before deciding. |
| "The verdict is subjective" | Use it as a structured loop: score, differences, suggestions, screenshot, next edit. |
