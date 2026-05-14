import { readdir, readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export class BetterRefAgentsError extends Error {
  constructor(message, exitCode = 2, payload = null) {
    super(message);
    this.name = 'BetterRefAgentsError';
    this.exitCode = exitCode;
    this.payload = payload;
  }
}

const DEFAULT_TASK_ID = 'betterref-task-001';
const DISPATCH_STRATEGY = 'parallel-by-team';
const REPORT_FORMAT = 'concise-json';
const FULL_ROSTER_POLICY = 'explicit-only';
const CACHE_POLICY = {
  reuseArtifacts: [
    '.betterref-prd',
    '.betterref-reference',
    '.betterref-3d',
    '.betterref-agents/supervisor-merge.json'
  ],
  refreshWhen: [
    'source inputs changed',
    'required evidence is missing',
    'previous merge has hard fails'
  ]
};
const REQUIRED_REPORT_FIELDS = [
  'taskId',
  'assetId',
  'runtimeMode',
  'team',
  'agent',
  'role',
  'facts',
  'evidence',
  'confidence',
  'uncertainties',
  'recommendedActions',
  'hardFails'
];

export const AGENT_TEAMS = [
  {
    team: 'Reference Intelligence CLI',
    lead: 'Plato',
    members: ['Volta', 'Sagan', 'Curie'],
    owns: 'Reference analysis, visual facts, negative prompts, reference artifacts.',
    keywords: [/reference/i, /\bref\b/i, /image/i, /pack/i, /visual/i]
  },
  {
    team: '3D Asset Plan + Tencent Hunyuan Handoff',
    lead: 'Dalton',
    members: ['Arendt', 'Newton', 'Ohm', 'Parfit', 'Dewey'],
    owns: '3D asset plan, Tencent request metadata, provider output evidence.',
    keywords: [/3d/i, /hunyuan/i, /tencent/i, /roblox/i, /\bglb\b/i, /\bgltf\b/i, /\bmesh\b/i, /model/i, /texture/i]
  },
  {
    team: 'Final Verify 3D Evidence Gate',
    lead: 'Lagrange',
    members: ['Beauvoir', 'Chandrasekhar', 'Ramanujan', 'Wegener'],
    owns: 'Final 3D verdict, mesh/material/refine/import evidence gates.',
    keywords: [/verify/i, /evidence/i, /gate/i, /final/i, /3d/i, /hunyuan/i, /roblox/i]
  },
  {
    team: 'PRD Extraction + 3D Requirements',
    lead: 'Descartes',
    members: ['Tesla', 'Leibniz', 'Gibbs', 'Jason'],
    owns: 'PRD extraction for model, texture, Roblox, and 3D asset requirements.',
    keywords: [/prd/i, /pdf/i, /requirement/i, /acceptance/i]
  },
  {
    team: 'Run Orchestrator 3D Blockers',
    lead: 'Laplace',
    members: ['Boole', 'Sartre'],
    owns: '`betterref-run` blockers for missing external 3D evidence.',
    keywords: [/run/i, /orchestr/i, /block/i, /blocked/i, /evidence/i, /3d/i, /hunyuan/i, /roblox/i]
  },
  {
    team: 'Skill Docs + Agent-Team Contract',
    lead: 'Einstein',
    members: ['Gauss', 'Lorentz'],
    owns: '`SKILL.md`, README, `agents/openai.yaml`, and reference docs contract.',
    keywords: [/skill/i, /docs?/i, /contract/i, /agent.team/i, /roster/i]
  },
  {
    team: 'Final Whole-Feature Review',
    lead: 'BetterRef Supervisor',
    members: ['Pauli', 'Hilbert', 'Maxwell'],
    owns: 'Whole-feature review, hardening review, targeted final re-review.',
    keywords: [/final/i, /review/i, /release/i, /push/i, /whole/i, /hardening/i]
  }
];

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function slugAgent(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function unique(values) {
  return [...new Set(values)];
}

function defaultOutDir(outDir, projectDir) {
  if (outDir) return path.resolve(outDir);
  if (projectDir) return path.resolve(projectDir, '.betterref-agents');
  return path.resolve('.betterref-agents');
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new BetterRefAgentsError(`Unable to read ${label}: ${error.message}`, 2);
  }
}

async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function fileExists(filePath) {
  if (!filePath) return false;
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function teamAgents(team) {
  return unique([team.lead, ...team.members].filter((name) => name !== 'BetterRef Supervisor'));
}

function wantsFullRoster(task, allAgents = false) {
  if (allAgents) return true;
  const text = String(task || '');
  return (
    /29[-\s]?agent/i.test(text) ||
    /named\s+(?:29[-\s]?)?agent/i.test(text) ||
    /full\s+roster/i.test(text) ||
    /\ball\s+(?:29\s+)?agents\b/i.test(text) ||
    /complete\s+named\s+roster/i.test(text) ||
    /\u0e04\u0e23\u0e1a\s*29/u.test(text) ||
    /29\s*\u0e15\u0e31\u0e27/u.test(text)
  );
}

function selectTeams(task, requestedTeams = [], allAgents = false) {
  if (wantsFullRoster(task, allAgents)) {
    return [...AGENT_TEAMS];
  }
  const text = String(task || '');
  const selected = [];
  for (const team of AGENT_TEAMS) {
    if (asArray(requestedTeams).includes(team.team) || team.keywords.some((pattern) => pattern.test(text))) {
      selected.push(team);
    }
  }
  if (selected.length === 0) {
    selected.push(AGENT_TEAMS.find((team) => team.team === 'Skill Docs + Agent-Team Contract'));
  }
  return selected;
}

function blockingGatesForTeams(teams) {
  const names = teams.map((team) => team.team).join(' ');
  const gates = ['specialist reports', 'supervisor merge'];
  if (/3D|Hunyuan|Roblox/i.test(names)) {
    gates.push('ResultFile3Ds', 'refinementEvidence', 'robloxImportEvidence', 'betterref-3d --verify');
  }
  return unique(gates);
}

function buildDispatchGroups(teams) {
  return teams.map((team) => ({
    team: team.team,
    lead: team.lead,
    agents: teamAgents(team),
    owns: team.owns,
    dispatchMode: 'parallel',
    reportFormat: REPORT_FORMAT
  }));
}

function buildContextPack(packet) {
  return {
    schemaVersion: 'betterref.agents.context_pack.v1',
    taskId: packet.taskId,
    assetId: packet.assetId,
    runtimeMode: packet.runtimeMode,
    selectionMode: packet.selectionMode,
    fullRosterPolicy: packet.fullRosterPolicy,
    goal: packet.goal,
    inputs: packet.inputs,
    selectedTeams: packet.selectedTeams,
    selectedAgents: packet.selectedAgents,
    dispatchStrategy: packet.dispatchStrategy,
    dispatchGroups: packet.dispatchGroups,
    reportFormat: packet.reportFormat,
    requiredOutputs: packet.requiredOutputs,
    blockingGates: packet.blockingGates,
    cachePolicy: packet.cachePolicy
  };
}

function roleFor(agent, team) {
  if (agent === team.lead) {
    return `${team.team} lead`;
  }
  if (['Volta', 'Arendt', 'Newton', 'Beauvoir', 'Tesla', 'Leibniz', 'Boole', 'Gauss'].includes(agent)) {
    return 'spec reviewer';
  }
  if (['Sagan', 'Ohm', 'Chandrasekhar', 'Gibbs', 'Sartre', 'Lorentz'].includes(agent)) {
    return 'code/docs quality reviewer';
  }
  if (['Curie', 'Parfit', 'Dewey', 'Ramanujan', 'Wegener', 'Jason'].includes(agent)) {
    return 're-review and hardening reviewer';
  }
  if (['Pauli', 'Hilbert', 'Maxwell'].includes(agent)) {
    return 'final whole-feature reviewer';
  }
  return 'specialist';
}

function teamForAgent(packet, agent) {
  const selected = selectTeams(packet.task || packet.goal || '', packet.selectedTeams);
  return selected.find((team) => teamAgents(team).includes(agent)) || selected[0];
}

export async function planAgentRun({
  task,
  outDir,
  projectDir,
  assetId = 'asset-001',
  runtimeMode = 'structured',
  inputs = [],
  selectedTeams,
  allAgents = false
} = {}) {
  if (!task) {
    throw new BetterRefAgentsError('Missing required --task for --plan.', 2);
  }
  const resolvedOut = defaultOutDir(outDir, projectDir);
  const fullRoster = wantsFullRoster(task, allAgents);
  const teams = selectTeams(task, selectedTeams, fullRoster);
  const selectedAgents = unique(teams.flatMap(teamAgents));
  const contextPackPath = path.join(resolvedOut, 'context-pack.json');
  const packet = {
    schemaVersion: 'betterref.agents.supervisor_packet.v1',
    taskId: DEFAULT_TASK_ID,
    assetId,
    runtimeMode,
    selectionMode: fullRoster ? 'full-roster' : 'risk-scoped',
    fullRosterPolicy: FULL_ROSTER_POLICY,
    task,
    goal: task,
    inputs: asArray(inputs),
    selectedTeams: teams.map((team) => team.team),
    selectedAgents,
    dispatchStrategy: DISPATCH_STRATEGY,
    dispatchGroups: buildDispatchGroups(teams),
    reportFormat: REPORT_FORMAT,
    contextPackPath,
    cachePolicy: CACHE_POLICY,
    requiredOutputs: ['facts', 'evidence', 'uncertainties', 'hardFails', 'recommendedActions'],
    blockingGates: blockingGatesForTeams(teams)
  };
  const supervisorPacketPath = path.join(resolvedOut, 'supervisor-packet.json');
  await writeJson(supervisorPacketPath, packet);
  await writeJson(contextPackPath, buildContextPack(packet));
  return {
    schemaVersion: 'betterref.agents.plan.result.v1',
    runtimeMode,
    packet,
    artifacts: { outDir: resolvedOut, supervisorPacketPath, contextPackPath }
  };
}

function makeReport(packet, agent) {
  const team = teamForAgent(packet, agent);
  const role = roleFor(agent, team);
  const evidence = ['supervisor-packet.json'];
  return {
    schemaVersion: 'betterref.agents.specialist_report.v1',
    taskId: packet.taskId,
    assetId: packet.assetId,
    runtimeMode: packet.runtimeMode,
    reportFormat: packet.reportFormat || REPORT_FORMAT,
    team: team.team,
    agent,
    role,
    status: 'pass',
    facts: [
      {
        claim: `${agent} reviewed ${team.team} scope in ${packet.runtimeMode} mode.`,
        evidence: evidence[0],
        confidence: 'medium'
      }
    ],
    evidence,
    confidence: 'medium',
    uncertainties: [
      {
        unknown: 'Runtime subagent execution',
        impact: packet.runtimeMode === 'structured' ? 'No runtime spawn occurred; report is structured supervisor evidence.' : 'Handled by runtime.',
        neededEvidence: packet.runtimeMode === 'spawned' ? 'subagent transcript' : 'spawned runtime support'
      }
    ],
    recommendedActions: [`Use ${team.team} outputs as evidence, not proof.`],
    hardFails: []
  };
}

function validateReport(report, filePath) {
  const reasons = [];
  for (const field of REQUIRED_REPORT_FIELDS) {
    if (report?.[field] === undefined) {
      reasons.push(`${report?.agent || path.basename(filePath)} missing required field ${field}`);
    }
  }
  if (!Array.isArray(report?.facts)) reasons.push(`${report?.agent || path.basename(filePath)} facts must be an array`);
  if (!Array.isArray(report?.evidence)) reasons.push(`${report?.agent || path.basename(filePath)} evidence must be an array`);
  if (!Array.isArray(report?.uncertainties)) reasons.push(`${report?.agent || path.basename(filePath)} uncertainties must be an array`);
  if (!Array.isArray(report?.recommendedActions)) reasons.push(`${report?.agent || path.basename(filePath)} recommendedActions must be an array`);
  if (!Array.isArray(report?.hardFails)) reasons.push(`${report?.agent || path.basename(filePath)} hardFails must be an array`);
  return reasons;
}

async function readReports(outDir) {
  const reportsDir = path.join(outDir, 'reports');
  try {
    const names = await readdir(reportsDir);
    const reports = [];
    for (const name of names.filter((item) => item.endsWith('.json')).sort()) {
      const reportPath = path.join(reportsDir, name);
      const report = await readJson(reportPath, `agent report ${name}`);
      reports.push({ reportPath, report });
    }
    return reports;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function mergeAgentReports({ outDir, projectDir } = {}) {
  const resolvedOut = defaultOutDir(outDir, projectDir);
  const packetPath = path.join(resolvedOut, 'supervisor-packet.json');
  const packet = await readJson(packetPath, 'supervisor packet');
  const reportEntries = await readReports(resolvedOut);
  const blockingReasons = [];
  const reports = [];
  const byAgent = new Map(reportEntries.map((entry) => [entry.report.agent, entry]));

  for (const agent of asArray(packet.selectedAgents)) {
    const entry = byAgent.get(agent);
    if (!entry) {
      blockingReasons.push(`${agent} agent report evidence is missing`);
      continue;
    }
    blockingReasons.push(...validateReport(entry.report, entry.reportPath));
    if (asArray(entry.report.hardFails).length > 0) {
      blockingReasons.push(...entry.report.hardFails.map((item) => `${agent} hard fail: ${item.message || item}`));
    }
    reports.push({
      agent,
      team: entry.report.team,
      role: entry.report.role,
      status: entry.report.status,
      reportPath: entry.reportPath,
      confidence: entry.report.confidence
    });
  }

  const merge = {
    schemaVersion: 'betterref.agents.supervisor_merge.v1',
    taskId: packet.taskId,
    assetId: packet.assetId,
    runtimeMode: packet.runtimeMode,
    dispatchStrategy: packet.dispatchStrategy,
    reportFormat: packet.reportFormat,
    contextPackPath: packet.contextPackPath,
    cachePolicy: packet.cachePolicy,
    passed: blockingReasons.length === 0,
    selectedTeams: packet.selectedTeams,
    selectedAgents: packet.selectedAgents,
    reports,
    conflicts: [],
    acceptedAssumptions: packet.runtimeMode === 'structured' ? ['no runtime spawn occurred'] : [],
    unresolvedBlockers: blockingReasons,
    nextActions: blockingReasons.length > 0 ? ['complete missing or invalid specialist reports'] : [],
    blockingReasons
  };
  const mergePath = path.join(resolvedOut, 'supervisor-merge.json');
  await writeJson(mergePath, merge);
  return {
    schemaVersion: 'betterref.agents.report.result.v1',
    passed: merge.passed,
    runtimeMode: merge.runtimeMode,
    blockingReasons,
    merge,
    artifacts: { outDir: resolvedOut, supervisorPacketPath: packetPath, supervisorMergePath: mergePath }
  };
}

export async function runAgentWorkflow({
  task,
  outDir,
  projectDir,
  assetId,
  runtimeMode = 'structured',
  inputs = [],
  selectedTeams,
  allAgents = false
} = {}) {
  const plan = await planAgentRun({ task, outDir, projectDir, assetId, runtimeMode, inputs, selectedTeams, allAgents });
  const { packet } = plan;
  const out = plan.artifacts.outDir;
  const lines = [
    '# BetterRef Agent Run Log',
    '',
    `[Supervisor] runtimeMode=${packet.runtimeMode}; ${packet.runtimeMode === 'structured' ? 'no runtime spawn occurred' : 'runtime subagents reported'}`,
    `[Supervisor] selectedTeams=${packet.selectedTeams.join(', ')}`,
    `[Supervisor] contextPack=${path.relative(out, packet.contextPackPath).replace(/\\/g, '/')}`,
    `[Supervisor] dispatchStrategy=${packet.dispatchStrategy}`,
    ''
  ];
  for (const group of packet.dispatchGroups) {
    lines.push(`[Supervisor] Dispatching ${group.team} in parallel: ${group.agents.join(', ')}`);
  }
  lines.push('');
  for (const agent of packet.selectedAgents) {
    const report = makeReport(packet, agent);
    const reportPath = path.join(out, 'reports', `${slugAgent(agent)}.json`);
    await writeJson(reportPath, report);
    lines.push(`[${agent}] report -> ${path.relative(out, reportPath).replace(/\\/g, '/')}`);
  }
  const runLogPath = path.join(out, 'run-log.md');
  await writeFile(runLogPath, `${lines.join('\n')}\n`);
  const report = await mergeAgentReports({ outDir: out });
  return {
    schemaVersion: 'betterref.agents.run.result.v1',
    runtimeMode: packet.runtimeMode,
    message: packet.runtimeMode === 'structured' ? 'no runtime spawn occurred' : 'runtime subagents reported',
    packet,
    merge: report.merge,
    artifacts: {
      outDir: out,
      supervisorPacketPath: plan.artifacts.supervisorPacketPath,
      contextPackPath: plan.artifacts.contextPackPath,
      runLogPath,
      reportsDir: path.join(out, 'reports'),
      supervisorMergePath: report.artifacts.supervisorMergePath
    }
  };
}

export async function agentStatus({ outDir, projectDir } = {}) {
  const resolvedOut = defaultOutDir(outDir, projectDir);
  const packetPath = path.join(resolvedOut, 'supervisor-packet.json');
  const mergePath = path.join(resolvedOut, 'supervisor-merge.json');
  const packet = await readOptionalJson(packetPath);
  const merge = await readOptionalJson(mergePath);
  const reports = await readReports(resolvedOut);
  return {
    schemaVersion: 'betterref.agents.status.v1',
    runtimeMode: merge?.runtimeMode || packet?.runtimeMode || null,
    packetPresent: Boolean(packet),
    mergePresent: Boolean(merge),
    reportCount: reports.length,
    selectedAgents: packet?.selectedAgents || merge?.selectedAgents || [],
    passed: merge?.passed ?? false,
    artifacts: {
      outDir: resolvedOut,
      supervisorPacketPath: (await fileExists(packetPath)) ? packetPath : null,
      contextPackPath: (await fileExists(path.join(resolvedOut, 'context-pack.json'))) ? path.join(resolvedOut, 'context-pack.json') : null,
      runLogPath: (await fileExists(path.join(resolvedOut, 'run-log.md'))) ? path.join(resolvedOut, 'run-log.md') : null,
      reportsDir: path.join(resolvedOut, 'reports'),
      supervisorMergePath: (await fileExists(mergePath)) ? mergePath : null
    }
  };
}

export async function validateAgentMergeEvidence(mergePath) {
  if (!mergePath) {
    return {
      present: false,
      passed: true,
      hardFailPresent: false,
      blockingReasons: []
    };
  }
  const merge = await readJson(mergePath, 'BetterRef agent merge');
  const blockingReasons = [];
  if (merge.schemaVersion !== 'betterref.agents.supervisor_merge.v1') {
    blockingReasons.push('agent merge schemaVersion is not betterref.agents.supervisor_merge.v1');
  }
  if (!['spawned', 'structured', 'blocked'].includes(merge.runtimeMode)) {
    blockingReasons.push('agent merge runtimeMode is missing or invalid');
  }
  const reports = asArray(merge.reports);
  if (merge.passed === true && reports.length === 0) {
    blockingReasons.push('agent merge has no specialist report evidence');
  }
  for (const report of reports) {
    const reportPath = report.reportPath ? path.resolve(path.dirname(mergePath), report.reportPath) : null;
    const exists = reportPath ? await fileExists(reportPath) : false;
    if (!exists) {
      blockingReasons.push(`${report.agent || 'unknown'} agent report evidence is missing`);
      continue;
    }
    const specialist = await readJson(reportPath, `agent report ${report.agent || reportPath}`);
    blockingReasons.push(...validateReport(specialist, reportPath));
  }
  blockingReasons.push(...asArray(merge.blockingReasons));
  const passed = merge.passed === true && blockingReasons.length === 0;
  return {
    present: true,
    passed,
    hardFailPresent: !passed,
    runtimeMode: merge.runtimeMode,
    selectedAgents: merge.selectedAgents || [],
    reportCount: reports.length,
    blockingReasons
  };
}
