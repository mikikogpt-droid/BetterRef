# BetterRef Agent Team

BetterRef has two agent layers:

- Named 29-agent execution roster: the historical Codex agents used to build and review BetterRef.
- Functional architecture roles: generic roles future BetterRef runs can map onto named agents or runtime subagents.

The skill is not a subagent runtime by itself. Every agent-team run must declare `runtimeMode`:

- `spawned`: real subagents were dispatched and reported back.
- `structured`: no subagents were spawned; the supervisor produced the same packet/report/merge artifacts in one session.
- `blocked`: required inputs are missing.

If `runtimeMode` is `structured`, explicitly say `no runtime spawn occurred`. Never imply the 29 named agents ran when they did not.

## Supervisor Packet

The supervisor must issue one packet before specialist work starts:

```json
{
  "taskId": "betterref-task-001",
  "assetId": "model-001",
  "runtimeMode": "structured",
  "goal": "Roblox-ready Tencent Hunyuan3D asset",
  "inputs": ["PRD.pdf", "reference-pack.json"],
  "selectedTeams": ["3D Asset Plan", "Final Verify 3D Evidence Gate"],
  "selectedAgents": ["Dalton", "Arendt", "Newton", "Ohm", "Lagrange", "Beauvoir", "Chandrasekhar"],
  "requiredOutputs": ["facts", "evidence", "uncertainties", "hardFails", "recommendedActions"],
  "blockingGates": ["ResultFile3Ds", "refinementEvidence", "robloxImportEvidence", "betterref-3d --verify"]
}
```

## Named 29-Agent Roster

| Team | Team lead | Members | Owns |
|---|---|---|---|
| Reference Intelligence CLI | Plato | Volta, Sagan, Curie | Reference analysis, visual facts, negative prompts, reference artifacts. |
| 3D Asset Plan + Tencent Hunyuan Handoff | Dalton | Arendt, Newton, Ohm, Parfit, Dewey | 3D asset plan, Tencent request metadata, provider output evidence. |
| Final Verify 3D Evidence Gate | Lagrange | Beauvoir, Chandrasekhar, Ramanujan, Wegener | Final 3D verdict, mesh/material/refine/import evidence gates. |
| PRD Extraction + 3D Requirements | Descartes | Tesla, Leibniz, Gibbs, Jason | PRD extraction for model, texture, Roblox, and 3D asset requirements. |
| Run Orchestrator 3D Blockers | Laplace | Boole, Sartre | `betterref-run` blockers for missing external 3D evidence. |
| Skill Docs + Agent-Team Contract | Einstein | Gauss, Lorentz | `SKILL.md`, README, `agents/openai.yaml`, and reference docs contract. |
| Final Whole-Feature Review | BetterRef Supervisor | Pauli, Hilbert, Maxwell | Whole-feature review, hardening review, targeted final re-review. |

## Named Tier Map

Tier 0:

- BetterRef Supervisor: owns intake, team selection, packet creation, report merging, conflict resolution, and final verdict.

Tier 1 implementer leads:

- Plato
- Dalton
- Lagrange
- Descartes
- Laplace
- Einstein

Tier 2 spec reviewers:

- Volta
- Arendt
- Newton
- Beauvoir
- Tesla
- Leibniz
- Boole
- Gauss

Tier 3 code/docs quality reviewers:

- Sagan
- Ohm
- Chandrasekhar
- Gibbs
- Sartre
- Lorentz

Tier 4 re-review and hardening agents:

- Curie
- Parfit
- Dewey
- Ramanujan
- Wegener
- Jason

Tier 5 final whole-feature reviewers:

- Pauli
- Hilbert
- Maxwell

## Functional Architecture Roles

Tier 0:

- BetterRef Supervisor

Tier 1:

- PRD Analyst
- Reference Analyst
- Implementation Planner
- QA Verifier

Tier 2:

- Typography Agent
- Color/Material Agent
- Layout Agent
- Asset Agent
- 3D Shape Agent
- Hunyuan API Agent: prepares Tencent Cloud Hunyuan3D request/response metadata and flags missing provider output evidence.
- 3D QA Agent
- Accessibility/UX Agent

Tier 3:

- Hard-Fail Auditor
- Spec Compliance Reviewer
- Code Quality Reviewer
- Evidence Integrity Agent

## Visible Agent Workflow

1. The supervisor states the real requirement, selected teams, selected agents, `runtimeMode`, and evidence gates.
2. The supervisor emits a dispatch log before analysis starts.
3. Each selected agent returns a Specialist Report, even in `structured` mode.
4. Review agents must cite the implementer output they reviewed.
5. The supervisor merges reports, names conflicts, accepted assumptions, unresolved blockers, and next commands.
6. Completion is blocked if required reports, evidence paths, or hard-fail checks are missing.

Example visible log:

```text
[Supervisor] runtimeMode=structured; no runtime spawn occurred
[Supervisor] Dispatching Dalton team: 3D Asset Plan + Tencent Hunyuan Handoff
[Dalton] report -> .betterref-agents/reports/dalton.json
[Arendt] spec review -> .betterref-agents/reports/arendt.json
[Ohm] quality review -> .betterref-agents/reports/ohm.json
[Supervisor] merge -> .betterref-agents/supervisor-merge.json
```

## Required Artifacts

When file output is appropriate, write:

```text
.betterref-agents/supervisor-packet.json
.betterref-agents/run-log.md
.betterref-agents/reports/<agent>.json
.betterref-agents/supervisor-merge.json
```

When file output is not appropriate, present the same packet, report, and merge structure in the response.

## Team Selection

- Reference image or pack: Plato team, plus Pauli/Hilbert/Maxwell for high-risk final review.
- Tencent Hunyuan 3D or Roblox asset: Dalton team, Lagrange team, and Evidence Integrity Agent.
- PRD with model/texture/Roblox requirements: Descartes team, then Laplace team if `betterref-run` must block on evidence.
- Skill or contract changes: Einstein team.
- Final release or push: Pauli, Hilbert, and Maxwell whole-feature review.

Do not spawn or simulate every agent for every task. Select the smallest team that covers the risk. If the user explicitly asks for the complete named roster, run `betterref-agents --all-agents` and require all 29 specialist reports before merge.

Every specialist report must include facts, evidence, confidence, uncertainties, recommended actions, and hard fails.

## Specialist Report Schema

Each specialist returns this shape:

```json
{
  "taskId": "betterref-task-001",
  "assetId": "model-001",
  "runtimeMode": "structured",
  "team": "3D Asset Plan",
  "agent": "Dalton",
  "role": "3D asset planning lead",
  "status": "pass",
  "facts": [{ "claim": "Rounded body with raised trim", "evidence": "ref-main.png", "confidence": "high" }],
  "evidence": ["ref-main.png", ".betterref-3d/hunyuan-request.json"],
  "uncertainties": [{ "unknown": "back side", "impact": "blocks exact likeness", "neededEvidence": "rear ref" }],
  "recommendedActions": ["keep texture refs out of Tencent mesh input"],
  "hardFails": []
}
```

## Supervisor Merge

The supervisor rejects reports missing `taskId`, `assetId`, `runtimeMode`, `agent`, `role`, `facts`, `evidence`, `confidence`, `uncertainties`, or `hardFails`. Final summaries must list selected teams, conflicts, accepted assumptions, unresolved blockers, and the next command or artifact needed.
