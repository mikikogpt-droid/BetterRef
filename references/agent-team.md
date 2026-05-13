# BetterRef Agent Team

Use a tiered team for PRD/reference/3D work.

## Supervisor Packet

The supervisor must issue one packet before specialist work starts:

```json
{
  "taskId": "betterref-task-001",
  "assetId": "model-001",
  "goal": "Roblox-ready Tencent Hunyuan3D asset",
  "inputs": ["PRD.pdf", "reference-pack.json"],
  "requiredOutputs": ["facts", "evidence", "uncertainties", "hardFails", "recommendedActions"],
  "blockingGates": ["ResultFile3Ds", "refinementEvidence", "robloxImportEvidence", "betterref-3d --verify"]
}
```

## Tier 0

- BetterRef Supervisor

## Tier 1

- PRD Analyst
- Reference Analyst
- Implementation Planner
- QA Verifier

## Tier 2

- Typography Agent
- Color/Material Agent
- Layout Agent
- Asset Agent
- 3D Shape Agent
- Hunyuan API Agent: prepares Tencent Cloud Hunyuan3D request/response metadata and flags missing provider output evidence.
- 3D QA Agent
- Accessibility/UX Agent

## Tier 3

- Hard-Fail Auditor
- Spec Compliance Reviewer
- Code Quality Reviewer
- Evidence Integrity Agent

Every specialist report must include facts, evidence, confidence, uncertainties, recommended actions, and hard fails.

## Specialist Report Schema

Each specialist returns this shape:

```json
{
  "taskId": "betterref-task-001",
  "assetId": "model-001",
  "agent": "3D Shape Agent",
  "role": "silhouette and topology risk",
  "facts": [{ "claim": "Rounded body with raised trim", "evidence": "ref-main.png", "confidence": "high" }],
  "uncertainties": [{ "unknown": "back side", "impact": "blocks exact likeness", "neededEvidence": "rear ref" }],
  "recommendedActions": ["keep texture refs out of Tencent mesh input"],
  "hardFails": []
}
```

## Supervisor Merge

The supervisor rejects reports missing `facts`, `evidence`, `confidence`, `uncertainties`, or `hardFails`. Final summaries must list conflicts, accepted assumptions, unresolved blockers, and the next command or artifact needed.
