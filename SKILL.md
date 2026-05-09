---
name: betterref
description: Use when a user provides or references a visual target, screenshot, mockup, design reference, UI image, brand image, hero image, or says to make the result look the same, match the reference, be pixel-perfect, beautiful, premium, polished, cinematic, visually impressive, or needs screenshot-to-reference visual QA with optional BetterRef CLI pixel diff/capture tooling.
---

# BetterRef

## Overview

BetterRef is for reference-driven visual work. Treat the reference image as the source of truth and use every available tool needed to make the output match it as closely as possible.

The default goal is maximum visual fidelity, not code-native purity. "Better than the reference" means the same composition and state with equal or higher polish, asset quality, readability, and finish. It does not mean redesigning away from the reference.

## Bundled CLI Tools

When this repository is available as a package, use the CLI before making a final visual claim:

```bash
npm install
npx betterref-diff --ref reference.png --actual screenshot.png --out .betterref
```

Use `betterref-diff` when both images already exist:

```bash
npx betterref-diff \
  --ref path/to/reference.png \
  --actual path/to/current-screenshot.png \
  --out .betterref \
  --config .betterref.json \
  --regions both \
  --html \
  --max-changed 2 \
  --max-mean 4 \
  --min-ssim 0.99
```

Use `betterref-chrome` when Chrome itself should be the capture source:

```bash
npx betterref-chrome \
  --endpoint http://127.0.0.1:9222 \
  --url-match 127.0.0.1:3000 \
  --out .betterref \
  --selector header=header \
  --selector hero='[data-betterref="hero"]' \
  --ref path/to/reference.png \
  --regions both \
  --html
```

If Chrome is not exposing a CDP endpoint, start a dedicated debugging profile before running the command:

```powershell
Start-Process "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" -ArgumentList '--remote-debugging-port=9222','--user-data-dir=C:\Temp\betterref-chrome'
```

Use `betterref-capture` when the current image must be captured from a URL first:

```bash
npm install -D playwright
npx playwright install chromium
npx betterref-capture \
  --url http://127.0.0.1:3000/ \
  --ref path/to/reference.png \
  --out .betterref \
  --config .betterref.json \
  --viewport 1440x900 \
  --match-size strict
```

Use `betterref-regions` when Chrome MCP or browser tooling can provide DOM bounding boxes:

```bash
npx betterref-regions \
  --input chrome-dom-boxes.json \
  --out .betterref.json \
  --threshold minSsim=0.98
```

Use `.betterref.json` for semantic regions and dynamic ignore areas:

```json
{
  "matchSize": "strict",
  "thresholds": { "maxChangedPercent": 2, "maxMeanDiff": 4, "minSsim": 0.99 },
  "regions": [{ "name": "hero", "x": 0, "y": 80, "width": 1440, "height": 520 }],
  "ignoreRegions": [{ "name": "timestamp", "x": 1200, "y": 24, "width": 120, "height": 24 }]
}
```

Read `.betterref/report.json`, inspect `.betterref/diff.png`, and open `.betterref/report.html` when generated. Use `global`, `regions`, `topDifferences`, `nextEdits`, and `hardFailHints` to drive the next patch. A nonzero exit from either CLI is a revise signal, not a pass. The CLI is supporting evidence only; hard fail gates still override numeric scores.

`--match-size reference` is a diagnostic mode for screenshots captured at a different output size. It resizes the actual screenshot to the reference dimensions, writes `actual-compared.png`, and records original versus compared dimensions in the report. Keep `strict` for final pass gates unless the mismatch is an intentional device-scale normalization.

## Chrome MCP Use

When a Google Chrome MCP server is installed and available, use it before or alongside BetterRef CLI for real-browser evidence:

- Capture the current Chrome tab when the user is looking at the target state. This avoids comparing against a different headless session.
- Inspect viewport, browser zoom, scroll position, route, selected UI state, loaded fonts, and console errors before scoring.
- Measure DOM bounding boxes for header, hero, panels, cards, grids, and controls, then map those boxes to BetterRef config regions.
- Prefer `betterref-regions` for that mapping. Save the Chrome MCP/browser measurement as JSON with `viewport` plus `elements`, `boxes`, `regions`, or `nodes`, then generate `.betterref.json`.
- Use Chrome MCP screenshots as `--actual` input for `betterref-diff`, then use `report.regions[]`, `topDifferences`, and `nextEdits` to decide the next patch.

Chrome MCP does not replace pixel/perceptual scoring. It makes the captured state and DOM measurements trustworthy; BetterRef then decides how far the screenshot is from the reference.

If Chrome MCP tools are not exposed in the current Codex session, use `betterref-chrome` as the direct Chrome fallback. It connects to Chrome CDP, selects the target tab, captures `chrome-screenshot.png`, measures DOM boxes, generates `.betterref.json`, and optionally runs `betterref-diff` in one command.

Supported region handoff shape:

```json
{
  "viewport": { "width": 1440, "height": 900 },
  "elements": [
    { "name": "header", "selector": "header", "boundingBox": { "x": 0, "y": 0, "width": 1440, "height": 80 } },
    { "name": "hero", "selector": "[data-betterref='hero']", "rect": { "left": 0, "top": 80, "right": 1440, "bottom": 560 } }
  ]
}
```

Then run `betterref-regions --input chrome-dom-boxes.json --out .betterref.json` before `betterref-diff --config .betterref.json --regions both --html`.

## Core Rules

- Preserve existing business logic and working behavior unless the user explicitly asks to change it.
- Match the reference's layout, proportions, spacing, typography, color, lighting, texture, depth, mood, and asset quality.
- Use all available tools that improve the result. If an asset is missing, find it, generate it, or build it.
- Start with local/project tools and assets. If they cannot close a measured visual gap, find, create, or install the right tool or asset with a clear reason and minimal blast radius.
- Use `imagegen` freely for raster assets, hero visuals, illustrations, glass/3D objects, premium backgrounds, mockups, textures, and any visual detail that CSS/SVG would only approximate.
- Use code-native HTML/CSS/SVG for deterministic UI structure: layout, panels, buttons, tabs, cards, forms, grids, and states.
- Do not invent design limitations that reduce fidelity or polish.
- Do not stop at "same vibe" when the request is to match a reference.
- Do not judge from memory or mood. Match the screenshot state, measure the layout, capture a new screenshot, and use the verdict gate.
- Any hard fail listed below overrides a high subjective score.

## Mandatory 14-Point BetterRef Gate

Before judging reference-matching work as complete, all 14 gates must be checked:

1. Identify current vs reference images clearly.
2. Match the same state before comparison: viewport, zoom, path, route, tab, scroll, folder, and data state.
3. Measure real layout instead of relying on vibes: sidebar, main workspace, right panel, hero, search card, KPI cards, and status bar.
4. Treat typography as a primary requirement: font family, Thai glyphs, weight, line-height, line breaks, and KPI numbers.
5. Focus on the largest visible mismatches first: title, chips, KPI cards, hero visual, clipping, and scrollbars.
6. Use `imagegen` freely when the target is glass, 3D, cinematic, textured, or raster-heavy instead of forcing CSS/SVG approximations.
7. Inventory available tools first: browser tooling, screenshots, DOM measurement, pixel sampling, image processing, fonts, icons, and dependencies.
8. Map every major visual gap to the tool or asset workflow that will close it.
9. If local tools are insufficient, find, create, or install scoped tooling such as pixel diff, SSIM, font inspection, background removal, or helper scripts.
10. Do not lower quality because a tool is missing when a reasonable tool can be found, generated, installed, or scripted.
11. Name the gap solved by every escalation and verify again with a fresh screenshot.
12. Produce a Visual Verdict: score, pass/revise/fail, hard-fail status, concrete differences, and next edits.
13. If any hard fail remains, never call the work `pass`, even if the subjective score feels high.
14. The final report must include tool inventory and escalations used, with the visual gap each one addressed.

## Workflow

1. Identify the reference source.
   - Use attached images, local paths, browser screenshots, Figma/exported images, or user-provided URLs.
   - If multiple screenshots are provided, explicitly identify which one is the current output and which one is the reference.
   - If the user says a reference exists but it is not available, search local context first; browse or ask only if the reference cannot be found.

2. Recreate the reference state before editing.
   - Match viewport size, device scale, browser zoom, theme, route, scroll position, selected workspace, selected folder, selected tab, data state, and visible controls.
   - If the reference state cannot be recreated, name the mismatch before editing and do not score as pass.

3. Classify each part of the target.
   - UI shell/layout: implement with code.
   - Complex visual asset: generate or edit a raster asset with `imagegen`.
   - Existing brand/logo/icon asset: reuse the official/local asset when available.
   - Data/functionality: preserve the current implementation.
   - Typography: choose deterministic fonts and weights; do not rely on browser fallback when fidelity matters.

4. Extract measurable visual facts.
   - Match viewport size, aspect ratio, column widths, fixed bars, card sizes, radii, gaps, icon sizes, font sizes, line heights, text box widths, and vertical rhythm.
   - Sample colors and shadows from the reference when practical.
   - Measure the bounding boxes of the top bar, rail, sidebar, main workspace, right panel, tab row, hero title, hero asset, search card, KPI cards, status strip, and bottom bar.
   - Name any uncertainty before editing.

5. Inventory tools and map gaps.
   - List the tools, assets, fonts, and dependencies already available: browser screenshots, DOM measurement, pixel sampling, image processing libraries, `imagegen`, local assets, installed fonts, icon libraries, and project dependencies.
   - Map each major visual gap to a tool: layout measurement, typography, icon style, raster asset quality, background/matting, clipping, scrollbars, color sampling, and pixel diff.
   - If no local tool can close a measured gap, escalate before lowering fidelity: search for a maintained tool or asset, create a helper script, use `imagegen`, or install a scoped dependency.

6. Build the visual layer.
   - Lock the macro layout first: top bar, rails, sidebars, content area, bottom bar.
   - Place generated/found raster assets where the reference uses rendered, photographic, glass, 3D, textured, or cinematic visuals.
   - Use CSS variables/tokens for repeated colors, spacing, radius, shadow, and transitions.

7. Verify visually.
   - Run the app or open the file in the browser.
   - Capture screenshots at the same viewport as the reference.
   - If `betterref-diff` or `betterref-capture` is available, run it and use `report.json` plus `diff.png` to localize mismatches.
   - Produce a structured visual verdict before deciding the work is complete.
   - Fix mismatches from the verdict: scrollbars, clipping, wrong proportions, wrong spacing, wrong asset quality, text overflow, contrast, and font weight.

8. Report honestly.
   - State what matches, what still differs, and what was verified.
   - Do not claim "100%" unless screenshots support it.
   - Do not use phrases like "close", "premium", "good enough", or a score above 90 while hard fails remain.

## Same-State Rule

The reference and current screenshot must represent the same app state before visual scoring.

Match or explicitly report:

- Viewport size, device scale factor, browser zoom, and OS/window chrome assumptions.
- URL/route, selected tab, selected navigation item, active mode, scroll position, and visible panel state.
- Workspace/path/folder/data state, especially when the reference shows a specific path or project.
- Dynamic text such as counts, timestamps, status labels, and current view labels when they are visible.

If the current screen shows a different workspace/path, selected folder, route, or scroll position than the reference, the verdict cannot be `pass`.

## Measurement Gate

Before making or judging visual changes, extract measurable facts from the reference or current screenshot.

Minimum measurements for UI work:

- Top bar height and main shell height.
- Left rail width, explorer/sidebar width, right panel width, and main workspace width.
- Tab row height and active underline position.
- Hero title bounding box, line count, and baseline position.
- Hero asset bounding box and crop position.
- Search card x/y/width/height, input height, CTA width, and chip rows.
- KPI card x/y/width/height and status strip y/height.
- Bottom status bar height.

Use browser screenshots, DOM bounding boxes, pixel sampling, or overlay/pixel diff tools when available. Do not rely on visual memory alone.

## Typography Fidelity Gate

Typography is a first-class fidelity requirement.

Check and match:

- Font family and Thai glyph shape. If the reference font is unknown, choose and bundle the closest deterministic font instead of relying on browser fallback.
- Font loading strategy: local `@font-face`, packaged font assets, or a known installed system font. Avoid accidental fallback differences between machines.
- Font size, weight, line height, text transform, letter spacing, word spacing, and anti-aliasing appearance.
- Text box widths and line breaks. If a reference title is one line, the output title breaking into two lines is a major mismatch.
- Separate number/KPI typography from body typography when the reference uses stronger numeric styling.
- Thai text readability and encoding. Mojibake, wrong fallback glyphs, clipped vowels/diacritics, or overly heavy Thai bold are visual failures.

If typography changes the line count, hierarchy, or premium feel of the reference, list it in `differences` and keep the verdict below `pass`.

## Image Asset Gate

Use `imagegen` or an equivalent raster asset workflow for rendered, glass, 3D, photographic, cinematic, or richly textured visuals.

A complex visual asset is not acceptable if:

- It has a visible rectangular bitmap boundary unless the reference also has one.
- It is cropped differently enough to change the composition.
- It is flatter, lower resolution, blurrier, noisier, or less polished than the reference.
- The lighting direction, edge glow, shadow depth, or perspective clearly differs.
- It fails to blend into the UI background when the reference blends.

For hero visuals, generate/edit until the asset quality is equal to or better than the reference, then verify in the actual UI screenshot.

## Better Than Ref Means

When the user asks for BetterRef quality, "better" means:

- Same category, composition, structure, and visible app state as the reference.
- Equal or better readability, alignment, contrast, typography, asset quality, and finish.
- No extra layout inventions that make the result less like the reference.
- Any improvement must preserve reference proportions and hierarchy.

If an edit makes the result prettier but less like the reference, it is a failure for BetterRef.

## Visual Verdict Gate

Use a visual-verdict style gate whenever both a reference image and a current screenshot exist. The verdict is the quality signal that drives the next edit.

Return or internally track this shape:

```json
{
  "score": 0,
  "verdict": "revise",
  "category_match": false,
  "same_state": false,
  "hard_fail_present": true,
  "viewport": "unknown",
  "differences": ["..."],
  "suggestions": ["..."],
  "reasoning": "short explanation"
}
```

Rules:

- `score` is 0-100.
- `verdict` is `pass`, `revise`, or `fail`.
- `category_match` is true only when the output is the same class of UI/visual as the reference.
- `same_state` is true only when viewport, route, selected UI state, scroll position, and visible data/path match the reference.
- `hard_fail_present` is true if any hard fail below is visible.
- `differences` must name concrete visual mismatches: layout, spacing, typography, colors, hierarchy, asset quality, clipping, scrollbars, or responsiveness.
- `suggestions` must be actionable edits tied to those differences.
- Score bands:
  - `<80`: fail.
  - `80-89`: revise.
  - `90-94`: close but not complete.
  - `95-97`: acceptable match if no hard fail remains.
  - `98+`: near pixel-perfect.
- Target threshold is 95+ with no hard fail for a true BetterRef pass. If `score < 95`, continue editing and capture a new screenshot before claiming completion unless the user asks only for analysis.
- Use pixel diff or overlay tools as secondary aids when the mismatch is hard to localize; convert hotspots into `differences` and `suggestions`.

## Hard Fail Gates

If any of these are present, the verdict is `fail` or `revise`; never `pass`:

- Current/reference roles are unclear or reversed.
- The current screen is not in the same state as the reference: wrong viewport, route, tab, selected folder, workspace/path, scroll position, or data state.
- Important content is clipped, hidden, overlapped, or blocked by a status bar or panel.
- Unexpected scrollbars, white scrollbars, nested scrollbars, or shifted scroll position appear.
- A reference one-line hero/title wraps differently, clips, or changes hierarchy.
- Typography relies on unintended fallback, uses the wrong Thai glyph style, has wrong line height, or changes text rhythm materially.
- A complex hero/raster visual has a visible bitmap box, wrong crop, wrong lighting, lower asset quality, or weaker depth than the reference.
- Macro layout proportions are visibly off: sidebar, rail, main workspace, right panel, tab row, hero, search card, KPI cards, or bottom bar.
- Right/side panels collide, overlap, or have insufficient spacing compared with the reference.
- Icons look like placeholders, have inconsistent stroke/fill style, or differ from the reference's icon language.
- The output only matches the palette/mood while spacing, composition, or hierarchy differ.
- The implementation is being judged without a fresh screenshot from the actual app.

## Tool Escalation Gate

Visual fidelity is allowed to require tooling. Do not treat a missing local tool as a reason to accept lower quality.

Start local:

- Inspect project dependencies, package scripts, existing assets, installed fonts, icon libraries, browser tools, screenshot tools, and image-processing libraries.
- Prefer tools that can be run locally and leave no permanent project footprint: one-off scripts, browser screenshots, DOM bounding boxes, pixel sampling, and temporary analysis assets.
- Prefer existing project dependencies over adding new ones.

Escalate when a measured gap remains:

- Use `imagegen` for missing or weak raster visuals, glass/3D/cinematic assets, premium backgrounds, transparent cutouts, and visual variants.
- Search for maintained tools, libraries, fonts, icon sets, or reference assets when the local environment cannot provide them.
- Install a scoped temporary or project-local package when it materially improves comparison, image processing, OCR/text bounds, font inspection, color extraction, pixel diff, SSIM/perceptual diff, background removal, or asset generation.
- Write a small helper script when existing tools can be composed into a reliable check faster than manual guessing.

Escalation rules:

- Name the visual gap before adding a tool: e.g. "hero asset crop differs", "Thai title wraps", "KPI cards clipped", "right panel width mismatch".
- Keep the blast radius small. Avoid global installs or runtime dependencies unless the project actually needs them.
- Document generated/downloaded assets and where they are used.
- After escalation, verify with a fresh app screenshot and update the visual verdict.
- Do not claim blocked while a reasonable tool can be found, generated, installed, or scripted.

## Tool Selection

| Target | Preferred Tool |
|---|---|
| Enterprise UI shell, dashboard, IDE layout | HTML/CSS/component code |
| Glass orb, 3D pedestal, cinematic hero, premium illustration | `imagegen` |
| Photorealistic/product/texture/background asset | `imagegen` |
| Existing logo or brand mark | reuse local/official asset |
| Exact icons in UI controls | SVG/lucide/icon library |
| Exact typography / Thai rendering | bundled or verified system fonts, `@font-face`, measured text boxes |
| Pixel/layout verification | browser screenshot/Playwright/visual verdict/pixel diff |
| Immediate screenshot diff | `betterref-diff --ref reference.png --actual screenshot.png --out .betterref` |
| URL capture plus diff | `betterref-capture --url <url> --ref reference.png --out .betterref --viewport WxH` |
| Pixel or perceptual mismatch that is hard to see | pixelmatch/SSIM/perceptual diff; install a scoped tool if missing |
| Color, shadow, or gradient mismatch | screenshot pixel sampler, browser devtools, image processing script |
| Background removal, alpha cleanup, bitmap edge issues | image processing library, background-removal tool, or regenerate with `imagegen` |
| Font identification and Thai text fit | local font inventory, font inspection tools, measured text boxes, bundled font |
| Component crop/overflow audit | browser screenshots, DOM bounding boxes, crop scripts |

## Red Flags

Stop and change approach when any of these happen:

- No local tool, asset, font, or dependency inventory was done before deciding the result is close.
- A missing tool is treated as a reason to lower fidelity instead of escalating.
- A tool is installed or downloaded without naming the specific visual gap it solves.
- A CSS/SVG drawing is being used to imitate a complex rendered image.
- The output only matches the palette but not the layout proportions.
- The page has unexpected nested scrollbars, white scrollbars, clipping, or shifted scroll position.
- The hero or main visual is missing, cropped, flat, or obviously lower quality than the reference.
- The implementation is being judged by memory instead of a fresh screenshot.
- The verdict score is below 90 but the work is being described as done.
- The verdict lists vague differences without actionable next edits.
- The user asks "how is this the same?" or similar. Re-enter the workflow from measurement and verification.
- The current screenshot uses a more comfortable viewport or cleaner state than the user/reference screenshot.
- Font fallback is accepted as "close enough" even though line breaks, weight, or Thai glyphs differ.
- A generated image is placed in the UI without checking for rectangular edges, crop, scale, and background blend.

## BetterRef Checklist

- [ ] Reference image is visible or located.
- [ ] Viewport and screenshot size are known.
- [ ] Current/reference roles are identified correctly.
- [ ] Same-state rule is satisfied or the mismatch is explicitly reported.
- [ ] Macro layout measurements were taken before final judgment.
- [ ] Macro layout proportions match before detail polish.
- [ ] Local tools, assets, fonts, icon libraries, and dependencies were inventoried.
- [ ] Each major visual gap was mapped to a tool or asset workflow.
- [ ] Any tool escalation was named, scoped, and verified with a fresh screenshot.
- [ ] Complex visuals use generated/found raster assets when appropriate.
- [ ] Image assets have no unwanted bitmap boundary, wrong crop, or lower quality than the reference.
- [ ] Font family, fallback, weights, line heights, text boxes, and Thai text rendering are checked.
- [ ] Reference line breaks and text hierarchy are matched.
- [ ] No accidental scrollbars, clipping, overlap, or overflow.
- [ ] Final screenshot was inspected against the reference.
- [ ] Visual verdict score is 95+ with no hard fail, or remaining gaps are explicitly reported.
- [ ] Verdict differences and suggestions are concrete enough to drive the next edit.
- [ ] Remaining differences are stated plainly.
- [ ] Final report includes score, verdict, hard-fail status, top differences, top next edits, and verification evidence.

## Common Mistakes

| Mistake | Correction |
|---|---|
| "CSS can approximate this" | If the reference visual is rendered/glass/3D/cinematic, use `imagegen`. |
| "It has the same colors" | Match proportions, hierarchy, lighting, spacing, and asset quality too. |
| "The prompt said CSS/SVG-style" | If the user's goal is reference fidelity, raster assets are allowed when they improve the result. |
| "A small asset adds complexity" | Visual fidelity is the requirement; manage the asset cleanly instead of avoiding it. |
| "Looks good enough" | Capture a screenshot and compare against the reference before deciding. |
| "The verdict is subjective" | Use it as a structured loop: score, differences, suggestions, screenshot, next edit. |
| "The screenshot I captured looks better" | Use the user's/reference viewport and state; do not switch to a friendlier state. |
| "The font is close" | Verify Thai glyphs, fallback, weight, line height, and line breaks. Bundle or choose a deterministic font when needed. |
| "The hero image is high quality" | Check it inside the actual UI for rectangular edges, crop, lighting, scale, and blend. |
| "Better than ref means redesign" | Improve finish while preserving the reference composition and hierarchy. |
| "We only use tools already installed" | Start local, then find, create, or install a scoped tool when a measured gap needs it. |
| "Installing a visual QA tool is too much" | If the tool materially improves fidelity or verification, use the smallest safe install or helper script. |

## Mandatory Final Report

Before claiming visual work is complete, report:

- Reference source and current screenshot source.
- Viewport/device scale and whether same-state passed.
- Visual verdict JSON or concise equivalent.
- BetterRef CLI report path and diff path when available.
- Top differences that remain.
- Top next edits if the score is below pass.
- Tool inventory and any escalations used, with the visual gap each one addressed.
- Verification performed: app run, screenshot path, pixel/overlay check when used, and functional smoke tests when the UI has behavior.

## Pressure Tests

Use these scenarios to check that the skill is working:

- If the output has the right dark/lime palette but the KPI cards are clipped by the bottom bar, verdict must be `fail`.
- If the current screen shows `C:\$Recycle.Bin` while the reference shows `D:\0.งานจัดซื้อ`, same-state is false and verdict cannot pass.
- If a one-line Thai hero title in the reference wraps into two lines, typography/layout must be listed as a major difference.
- If a glass hero orb is a rectangular bitmap pasted onto the page, image asset gate fails.
- If fonts render with different Thai glyphs or fallback and alter spacing, typography gate fails.
- If an agent says "90/100" while any hard fail remains, the verdict gate has failed and the work must be revised or reported honestly.
- If no pixel-diff tool is installed and a subtle layout mismatch remains, the agent must create, install, or use an equivalent comparison method instead of guessing.
- If a generated hero asset has a visible background edge or wrong crop, the agent must use image processing, regenerate, or edit the asset before passing.
