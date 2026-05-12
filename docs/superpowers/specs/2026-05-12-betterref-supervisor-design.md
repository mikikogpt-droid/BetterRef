# BetterRef Full Supervisor Design

## Summary

BetterRef will become a reference-driven supervisor for PRD PDFs, visual reference images, and 3D model generation workflows. Its job is to read the input evidence deeply, split the work across specialist agents, produce traceable implementation plans, and block completion unless PRD, visual, asset, 3D, browser, guard, and final evidence are complete.

The approved direction is the full BetterRef Supervisor with:

- PRD/PDF extraction and checklist generation.
- Reference image intelligence for 2D UI, visual assets, and 3D object cues.
- Hunyuan 3D support through Hugging Face Space and Hugging Face Endpoint/custom URL adapters.
- A tiered manager/specialist agent team.
- Hard-fail gates that prevent fake UI, fake 3D, missing evidence, and score-only passes.

Current reference-reading quality is approximately 6/10 overall: strong for existing 2D visual QA, weak for semantic reference understanding, and not yet ready for 3D/Hunyuan workflows. The target after implementation is 8.5-9/10, with honest uncertainty handling instead of unsupported 10/10 claims.

## Goals

1. Make BetterRef treat every PRD, screenshot, PDF page, and reference image as evidence with measurable facts, not as vague inspiration.
2. Extract product behavior, copy/content, visual requirements, responsive states, asset needs, hard fails, and 3D modeling needs from PRDs and references.
3. Produce structured artifacts that future agents and CLIs can consume without relying on conversation memory.
4. Route object/product/character/prop references into a 3D model lane, including Hunyuan 3D handoff and model QA.
5. Support both Hugging Face Space and Hugging Face Endpoint/custom URL adapters for Hunyuan 3D.
6. Use a tiered agent team: always-on core agents plus specialist agents selected by the supervisor based on task complexity.
7. Require fresh evidence before final pass claims.

## Non-Goals

- BetterRef will not pretend a single image reveals hidden sides, exact physical scale, or exact topology.
- BetterRef will not replace Hunyuan 3D. It will prepare inputs, build handoffs, validate outputs, and drive retry decisions.
- BetterRef will not spawn every specialist agent for every task. The supervisor chooses the smallest team that covers the evidence.
- BetterRef will not allow PDF renders, screenshots, reference crops, or 2D billboards to be shipped as real UI or real 3D.

## Architecture

The supervisor pipeline has seven stages:

1. Intake: collect PRD PDF, reference images, target URL, viewport, project path, asset targets, and 3D export targets.
2. Reference reading: extract measurable pixel facts, design semantics, object cues, and uncertainty.
3. Classification: label each requirement or visual item as code-native UI, imagegen asset, HyperFrames motion asset, existing asset, 3D model, or reference-only evidence.
4. Planning: create phase plans, ownership, artifact paths, evidence requirements, and retry loops.
5. Build loop: implement UI/assets/models, fixing the largest hard fail first.
6. Evidence capture: gather browser screenshots, DOM evidence, asset render evidence, model files, mesh stats, material checks, and turntable renders.
7. Verdict: merge all evidence and fail if any required artifact or hard-fail gate is missing.

## Reference Intelligence

BetterRef should read reference images in four layers.

Pixel facts:

- Image size, crop, aspect ratio, and visible viewport.
- Bounding boxes for major regions or object silhouettes.
- Color swatches, contrast, shadows, spacing, alignment, and repeated measurements.
- Visible text, approximate OCR, and line breaks.

Design semantics:

- UI hierarchy, component roles, visual density, mood, brand style, and asset categories.
- Typography class, weight, line-height, Thai glyph concerns, and copy hierarchy.
- Motion or interaction expectations when implied by PRD or reference.

3D cues:

- Object category, silhouette, major volumes, profile curves, visible edges, and proportions.
- Camera angle, lens feel, lighting direction, material slots, color zones, texture cues, and PBR hints.
- Recommended 3D target: GLB, OBJ, USDZ, Blender file, Three.js-ready asset, or turntable-only evidence.

Uncertainty gate:

- Hidden backs/sides, exact scale, unseen topology, ambiguous materials, and missing interaction/mobile states must be marked low-confidence.
- Critical low-confidence items should block final pass or request additional references.
- The final report must separate high-confidence facts from assumptions.

Reference-reading outputs:

- `reference-analysis.json`: measured facts, semantic facts, 3D cues, confidence, uncertainties, and source paths.
- `reference-overlay.png`: optional annotated zones, bounds, silhouette, and material regions.
- `visual-checklist.md`: visible areas and pass criteria.
- `3d-brief.md`: modeling brief for Hunyuan 3D or human/modeling workflows.
- `negative-prompts.md`: concrete things the output must avoid.

## Hunyuan 3D And Hugging Face

BetterRef will add a Hunyuan 3D lane for references that contain an object, product, character, prop, logo object, game asset, mascot, or other modelable subject.

Before API call:

- Clean or select the best reference image.
- Recommend crop/mask/background removal when needed.
- Build a `3d-brief.md` with shape, proportions, material slots, texture cues, lighting/camera notes, and known unknowns.
- Build a `3d-asset-plan.json` item with target format, acceptance criteria, and evidence requirements.

Hugging Face adapters:

- `space`: for Hugging Face Space or Gradio-style calls.
- `endpoint`: for dedicated Hugging Face Inference Endpoint or custom server URL.
- `custom`: explicit URL and payload mapping, for self-hosted or wrapper services.

Shared Hunyuan artifacts:

- `hunyuan-request.json`: provider, model/space/endpoint id, input image path, options, seed/settings, output target, and retry metadata.
- `hunyuan-response.json`: raw response metadata, output paths, timings, and provider status.
- `3d-verdict.json`: mesh, texture, material, silhouette, render, loadability, and export verdict.
- `3d-verdict.html`: human-readable model QA report.

After model generation:

- Verify the output file exists and loads in the intended renderer or runtime.
- Check geometry is non-empty, has reasonable bounds, and includes sane vertex/face/material counts.
- Check texture/PBR evidence when required: albedo/base color, normal, roughness, metalness, opacity, or baked texture maps.
- Produce front, side, three-quarter, and turntable render evidence when possible.
- Compare render evidence to the reference silhouette/material facts.

3D hard fails:

- Flat 2D billboard or screenshot pretending to be a 3D model.
- Model file exists but cannot load.
- Non-empty claim without real mesh stats.
- Missing turntable or render evidence when 3D fidelity is required.
- Missing PBR/material evidence when the PRD/reference requires material fidelity.
- Export target missing, wrong format, or not wired into the intended app/runtime.
- Hunyuan output accepted without recording provider, request settings, output path, and retry metadata.

## Agent Team

BetterRef will use a tiered agent architecture.

Tier 0:

- BetterRef Supervisor: owns intake, task splitting, evidence schemas, conflict resolution, report merging, next-action selection, and final verdict.

Tier 1 always-on core agents:

- PRD Analyst: requirements, copy, flows, acceptance criteria, and PRD gaps.
- Reference Analyst: pixel facts, layout, visual semantics, object cues, and confidence.
- Implementation Planner: phase plan, ownership, dependencies, and traceability.
- QA Verifier: browser evidence, guard reports, final verdict, and evidence bundle.

Tier 2 specialist agents called when needed:

- Typography Agent: fonts, Thai glyphs, text fit, line breaks, hierarchy.
- Color/Material Agent: palette, lighting, texture, PBR and material cues.
- Layout Agent: grid, spacing, responsive behavior, long-page section mapping.
- Asset Agent: imagegen, HyperFrames, existing assets, generated asset wiring.
- 3D Shape Agent: silhouette, volumes, topology hints, scale, modelability.
- Hunyuan API Agent: Hugging Face Space/Endpoint payloads, retry metadata, response handling.
- 3D QA Agent: mesh load, turntable evidence, materials, export validation.
- Accessibility/UX Agent: contrast, states, controls, usability, interaction checks.

Tier 3 review and red-team agents:

- Hard-Fail Auditor: fake UI, fake 3D, missing evidence, screenshot-as-UI, PDF-as-UI.
- Spec Compliance Reviewer: checks output against PRD and reference facts.
- Code Quality Reviewer: maintainability, tests, blast radius, and local patterns.
- Evidence Integrity Agent: checks evidence freshness, paths, hashes, and completeness.

Specialist report contract:

```json
{
  "agent": "reference-image-agent",
  "scope": "visual and 3D cues only",
  "facts": [
    {
      "claim": "The main object uses a rounded rectangular body with metallic side trim.",
      "evidence": "reference region object-body",
      "confidence": "high"
    }
  ],
  "uncertainties": [
    {
      "unknown": "Back side of object",
      "impact": "Blocks 3D pass if the deliverable requires all sides",
      "need": "side/back reference or accepted assumption"
    }
  ],
  "recommendedActions": ["Create a 3D brief before Hunyuan request"],
  "hardFails": []
}
```

The supervisor merges reports and resolves contradictions. Example: if the PRD asks for a glass hero object but the reference shows matte plastic, the supervisor must name the conflict and choose a source of truth or ask the user.

## CLI And File Changes

Planned new or expanded commands:

- `betterref-reference`: analyze image references, emit `reference-analysis.json`, optional overlay, visual checklist, and 3D brief.
- `betterref-3d`: create or validate `3d-asset-plan.json`, `hunyuan-request.json`, and `3d-verdict.json`.
- `betterref-hunyuan`: provider adapter for Hugging Face Space, Hugging Face Endpoint, and custom URLs.
- `betterref-verify`: expand final verification to include required 3D evidence when any 3D model item exists.
- `betterref-run`: orchestrate PRD, reference image, asset, browser, and 3D handoffs together.

Planned reference files:

- `references/reference-intelligence.md`
- `references/reference-to-3d.md`
- `references/hunyuan-huggingface.md`
- `references/agent-team.md`
- Expanded `references/pressure-tests.md`
- Expanded `references/hard-fail-ledger.md`

## Evidence And Final Gate

Final pass requires all required evidence classes:

- PRD checklist: every required item pass or explicitly out of scope.
- Visual report: score at least 95 and no visual hard fail.
- Browser evidence: viewport, route, scroll, DOM text, interactives, fonts, console/network, rendered image/video assets.
- Asset plan: imagegen/HyperFrames/existing assets attached, verified, and rendered in the app.
- 3D plan: model outputs, mesh stats, load evidence, material evidence, and render/turntable evidence when required.
- Guard report: no hard fails.
- Evidence bundle: all required artifact paths present with hashes.

If any required class is missing, the final verdict is `fail` or `revise`, never `pass`.

## Testing And Pressure Cases

Add pressure tests for:

- High visual score but missing PRD behavior.
- Reference image analyzed only as vibe, without measured facts.
- Low-confidence reference assumptions hidden in final report.
- Thai copy/glyph/line-break drift.
- Hunyuan request missing provider settings or retry metadata.
- Hunyuan output file exists but cannot load.
- Flat 2D billboard accepted as 3D.
- 3D model pass without mesh stats or turntable/render evidence.
- Required PBR/material fidelity missing.
- Generated model not wired into the web app or Three.js/model-viewer runtime.
- Expanded agent team report missing specialist confidence or evidence.

## Open Assumptions

- Hugging Face credentials will come from environment variables or secure connector setup, not hardcoded files.
- Hunyuan provider details may vary between Space, Endpoint, and custom wrappers; BetterRef should use adapter interfaces rather than baking one API shape into the skill contract.
- 3D validation can start with metadata and render evidence, then grow into deeper mesh comparisons.
- The first implementation should prioritize structured artifacts and hard-fail gates before advanced visual/3D scoring.

## Approval Status

The user approved:

- Full BetterRef Supervisor direction.
- 3D Model Lane.
- Hunyuan 3D through Hugging Face with support for both Space and Endpoint/custom URL adapters.
- Expanded tiered agent team.
