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
  "dispatchStrategy": "parallel-by-team",
  "reportFormat": "concise-json",
  "executor": { "name": "openclaw", "kind": "external", "outputContract": "stdout-json-specialist-report" },
  "writePolicy": { "mode": "scoped-write", "defaultAgentAccess": "deny", "mergeOwner": "BetterRef Supervisor" },
  "spawnPolicy": { "mode": "batched-waves", "maxConcurrentAgents": 4 },
  "contextPackPath": ".betterref-agents/context-pack.json",
  "cachePolicy": { "reuseArtifacts": [".betterref-prd", ".betterref-reference", ".betterref-3d"] },
  "requiredOutputs": ["facts", "evidence", "uncertainties", "hardFails", "recommendedActions"],
  "blockingGates": ["signedTencentGlobalApi", "ResultFile3Ds", "refinementEvidence", "robloxImportEvidence", "betterref-3d --verify"]
}
```

## External Executor And Write Modes

External execution is allowed when the user explicitly asks for agents to run outside Codex or when Codex spawn limits block useful parallelism. The supported OpenClaw handoff is:

```bash
betterref-agents --run --runtime-mode spawned --executor openclaw --write-mode scoped-write --max-concurrency 4 --task "Reference Pack to Roblox-ready Tencent Hunyuan 3D asset"
```

The executor layer must not turn every agent loose on the repository. The BetterRef Supervisor owns the merge, commit, push, and release boundary. Each external job receives `allowedWritePaths`, denied actions, the Context Pack path, and the required JSON report schema. Jobs that need broad edits must use the narrowest write mode that can finish the work:

| Write mode | Agent power | Use when |
|---|---|---|
| `read-only` | Reads context and writes only reports. | First-pass analysis or unknown executor trust. |
| `propose-patch` | Writes patch artifacts under `.betterref-agents/patches/**`. | Changes need review before apply. |
| `scoped-write` | Writes only team-owned `allowedWritePaths`. | Normal OpenClaw production work. |
| `production-write` | Writes team-owned production paths and must return touched paths plus verification evidence. | Mature executors with stable tests. |
| `release` | Supervisor-only release actions. | Final commit/push/publish after merge passes. |

Denied actions for non-supervisor agents include `git push`, destructive reset, deleting outside the workspace, editing secrets or env files, and committing without a BetterRef Supervisor merge. If OpenClaw or another executor is missing, the run is `blocked`; do not pretend it was `spawned`.

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
- Hunyuan API Agent: prepares signed Tencent HY 3D Global request/response metadata and flags missing provider output evidence.
- 3D QA Agent
- Accessibility/UX Agent

Tier 3:

- Hard-Fail Auditor
- Spec Compliance Reviewer
- Code Quality Reviewer
- Evidence Integrity Agent

## Visible Agent Workflow

1. The supervisor states the real requirement, selected teams, selected agents, `runtimeMode`, and evidence gates.
2. The supervisor builds a Context Pack before dispatch so agents do not reread the same PRD/reference/3D facts.
3. The supervisor emits `parallel-by-team` dispatch lines before analysis starts.
4. Each selected agent returns a concise JSON Specialist Report, even in `structured` mode.
5. Review agents must cite the implementer output they reviewed.
6. The supervisor merges reports, names conflicts, accepted assumptions, unresolved blockers, and next commands.
7. Completion is blocked if required reports, evidence paths, or hard-fail checks are missing.

Example visible log:

```text
[Supervisor] runtimeMode=structured; no runtime spawn occurred
[Supervisor] executor=structured; writeMode=read-only
[Supervisor] contextPack=.betterref-agents/context-pack.json
[Supervisor] dispatchStrategy=parallel-by-team
[Supervisor] spawnPolicy=batched-waves; maxConcurrentAgents=4
[Supervisor] Dispatching 3D Asset Plan + Tencent Hunyuan Handoff in parallel: Dalton, Arendt, Newton, Ohm, Parfit, Dewey
[Dalton] report -> .betterref-agents/reports/dalton.json
[Arendt] spec review -> .betterref-agents/reports/arendt.json
[Ohm] quality review -> .betterref-agents/reports/ohm.json
[Supervisor] merge -> .betterref-agents/supervisor-merge.json
```

## Required Artifacts

When file output is appropriate, write:

```text
.betterref-agents/context-pack.json
.betterref-agents/supervisor-packet.json
.betterref-agents/run-log.md
.betterref-agents/jobs/<agent>.json
.betterref-agents/transcripts/<agent>.jsonl
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

Do not spawn or simulate every agent for every task. Select the smallest team that covers the risk; the full roster is explicit only. If the user asks for the complete named roster, run `betterref-agents --all-agents` and require all 29 specialist reports before merge.

Codex real subagent spawning must use batched waves, max 4 concurrent agents; never spawn all 29 at once. Run team leads first, then reviewers, then final reviewers. If spawn unavailable or rate-limited, say spawn unavailable and fall back to `structured` evidence instead of claiming spawned work.

Reuse cached artifacts before asking agents to reread or recalc facts: `.betterref-prd`, `.betterref-reference`, `.betterref-3d`, and `.betterref-agents/supervisor-merge.json`. Refresh only when source inputs changed, required evidence is missing, or the previous merge has hard fails.

Every specialist report must be concise JSON and include facts, evidence, confidence, uncertainties, recommended actions, and hard fails.

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
