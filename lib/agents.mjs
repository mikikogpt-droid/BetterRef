import { spawn } from 'node:child_process';
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
const SPAWN_POLICY = {
  mode: 'batched-waves',
  maxConcurrentAgents: 4,
  fullRosterStrategy: 'never spawn all 29 at once; split selected agents into lead, review, and final waves',
  unavailableFallback: 'declare spawn unavailable and use structured mode artifacts'
};
const EXTERNAL_EXECUTORS = new Set(['openclaw']);
const WRITE_MODES = new Set(['read-only', 'propose-patch', 'scoped-write', 'production-write', 'release']);
const DENIED_WRITE_ACTIONS = [
  'git push',
  'git reset --hard',
  'delete outside workspace',
  'edit secrets or env files',
  'commit without BetterRef Supervisor merge'
];
const TEAM_WRITE_SCOPES = {
  'Reference Intelligence CLI': ['.betterref-reference/**', 'assets/references/**'],
  '3D Asset Plan + Tencent Hunyuan Handoff': ['.betterref-3d/**', 'assets/3d-briefs/**', 'assets/models/**', 'assets/textures/**'],
  'Final Verify 3D Evidence Gate': ['.betterref-3d/**', '.betterref-verify/**', 'assets/models/**', 'assets/textures/**'],
  'PRD Extraction + 3D Requirements': ['.betterref-prd/**', 'AGENTS.md'],
  'Run Orchestrator 3D Blockers': ['.betterref-run/**'],
  'Skill Docs + Agent-Team Contract': ['SKILL.md', 'README.md', 'references/**', 'agents/openai.yaml'],
  'Final Whole-Feature Review': ['.betterref-agents/supervisor-merge.json']
};
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
    gates.push('signedTencentGlobalApi', 'ResultFile3Ds', 'refinementEvidence', 'robloxImportEvidence', 'betterref-3d --verify');
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
    executor: packet.executor,
    writePolicy: packet.writePolicy,
    spawnPolicy: packet.spawnPolicy,
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

function validateRuntimeMode(runtimeMode) {
  if (!['spawned', 'structured', 'blocked'].includes(runtimeMode)) {
    throw new BetterRefAgentsError(`Invalid runtimeMode ${runtimeMode}; expected spawned, structured, or blocked.`, 2);
  }
}

function validateWriteMode(writeMode) {
  if (!WRITE_MODES.has(writeMode)) {
    throw new BetterRefAgentsError(`Invalid writeMode ${writeMode}; expected ${[...WRITE_MODES].join(', ')}.`, 2);
  }
}

function normalizeMaxConcurrency(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new BetterRefAgentsError('--max-concurrency must be a positive integer.', 2);
  }
  return parsed;
}

function buildExecutorConfig({ executor, runtimeMode, executorCommand, executorArgs = [] } = {}) {
  const name = executor || (runtimeMode === 'structured' ? 'structured' : 'codex');
  if (name !== 'structured' && name !== 'codex' && !EXTERNAL_EXECUTORS.has(name)) {
    throw new BetterRefAgentsError(`Unsupported executor ${name}; expected structured, codex, or openclaw.`, 2);
  }
  const kind = EXTERNAL_EXECUTORS.has(name) ? 'external' : 'internal';
  const command = executorCommand || (name === 'openclaw' ? 'openclaw' : null);
  const args = asArray(executorArgs);
  return {
    name,
    kind,
    command,
    args,
    invocation: executorCommand ? 'custom-command-plus-job-path' : name === 'openclaw' ? 'openclaw agent --message <prompt>' : 'none',
    outputContract: kind === 'external' ? 'stdout-json-specialist-report' : 'structured-report',
    unavailableBehavior: kind === 'external' ? 'blocked' : 'structured-fallback'
  };
}

function buildWritePolicy({ writeMode, executorName } = {}) {
  validateWriteMode(writeMode);
  return {
    schemaVersion: 'betterref.agents.write_policy.v1',
    mode: writeMode,
    executor: executorName,
    defaultAgentAccess: writeMode === 'read-only' ? 'read-only' : 'deny',
    mergeOwner: 'BetterRef Supervisor',
    supervisorOnlyActions: ['git commit', 'git push', 'release publish'],
    deniedActions: DENIED_WRITE_ACTIONS,
    reportRequirement: 'every write-capable agent must return a JSON report with touched paths and evidence',
    conflictRule: 'agents may only write paths assigned in allowedWritePaths; supervisor resolves conflicts before merge'
  };
}

function baseWriteScopes(writeMode) {
  if (writeMode === 'read-only') return ['.betterref-agents/reports/**'];
  if (writeMode === 'propose-patch') return ['.betterref-agents/patches/**', '.betterref-agents/reports/**'];
  return ['.betterref-agents/reports/**'];
}

function writeScopesForTeam(team, writeMode) {
  validateWriteMode(writeMode);
  if (writeMode === 'release') {
    return team.team === 'Final Whole-Feature Review'
      ? ['.betterref-agents/supervisor-merge.json', '.betterref-release/**']
      : ['.betterref-agents/reports/**'];
  }
  if (writeMode === 'read-only' || writeMode === 'propose-patch') {
    return baseWriteScopes(writeMode);
  }
  return unique([...baseWriteScopes(writeMode), ...(TEAM_WRITE_SCOPES[team.team] || [])]);
}

function addDispatchWritePolicy(groups, writeMode) {
  return groups.map((group) => ({
    ...group,
    writeMode,
    writeScopes: writeScopesForTeam({ team: group.team }, writeMode)
  }));
}

function buildAgentPrompt(job) {
  return [
    `You are ${job.agent}, ${job.role}, working inside BetterRef.`,
    `Task: ${job.goal}`,
    `Runtime mode: ${job.runtimeMode}. Executor: ${job.executor.name}. Write mode: ${job.writePolicy.mode}.`,
    `Allowed write paths: ${job.allowedWritePaths.join(', ') || 'none'}.`,
    `Denied actions: ${job.deniedActions.join(', ')}.`,
    'Return one JSON object matching betterref.agents.specialist_report.v1.',
    'Do not include markdown fences or commentary outside JSON.'
  ].join('\n');
}

export async function planAgentRun({
  task,
  outDir,
  projectDir,
  assetId = 'asset-001',
  runtimeMode = 'structured',
  executor,
  executorCommand,
  executorArgs = [],
  writeMode = 'read-only',
  maxConcurrency,
  inputs = [],
  selectedTeams,
  allAgents = false
} = {}) {
  if (!task) {
    throw new BetterRefAgentsError('Missing required --task for --plan.', 2);
  }
  validateRuntimeMode(runtimeMode);
  validateWriteMode(writeMode);
  const resolvedOut = defaultOutDir(outDir, projectDir);
  const fullRoster = wantsFullRoster(task, allAgents);
  const teams = selectTeams(task, selectedTeams, fullRoster);
  const selectedAgents = unique(teams.flatMap(teamAgents));
  const concurrency = maxConcurrency === undefined ? SPAWN_POLICY.maxConcurrentAgents : normalizeMaxConcurrency(maxConcurrency);
  const executorConfig = buildExecutorConfig({ executor, runtimeMode, executorCommand, executorArgs });
  const writePolicy = buildWritePolicy({ writeMode, executorName: executorConfig.name });
  const spawnPolicy = { ...SPAWN_POLICY, maxConcurrentAgents: concurrency };
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
    dispatchGroups: addDispatchWritePolicy(buildDispatchGroups(teams), writeMode),
    reportFormat: REPORT_FORMAT,
    executor: executorConfig,
    writePolicy,
    spawnPolicy,
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

function buildExternalJob(packet, agent, outDir) {
  const team = teamForAgent(packet, agent);
  const role = roleFor(agent, team);
  const jobPath = path.join(outDir, 'jobs', `${slugAgent(agent)}.json`);
  const allowedWritePaths = writeScopesForTeam(team, packet.writePolicy?.mode || 'read-only');
  const job = {
    schemaVersion: 'betterref.agents.external_job.v1',
    taskId: packet.taskId,
    assetId: packet.assetId,
    runtimeMode: packet.runtimeMode,
    reportFormat: packet.reportFormat || REPORT_FORMAT,
    executor: packet.executor,
    writePolicy: packet.writePolicy,
    jobPath,
    contextPackPath: packet.contextPackPath,
    goal: packet.goal,
    team: team.team,
    agent,
    role,
    allowedWritePaths,
    deniedActions: packet.writePolicy?.deniedActions || DENIED_WRITE_ACTIONS,
    requiredOutputSchema: 'betterref.agents.specialist_report.v1'
  };
  job.prompt = buildAgentPrompt(job);
  return job;
}

function parseExecutorReport(stdout, agent) {
  const trimmed = String(stdout || '').trim();
  if (!trimmed) {
    throw new BetterRefAgentsError(`${agent} external executor returned empty stdout`, 3);
  }
  const candidates = [trimmed, ...trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).reverse()];
  for (const candidate of candidates) {
    if (!candidate.startsWith('{')) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // Keep looking; external executors often log before emitting a final JSON line.
    }
  }
  try {
    return JSON.parse(trimmed);
  } catch (error) {
    throw new BetterRefAgentsError(`${agent} external executor stdout is not JSON: ${error.message}`, 3);
  }
}

function runCommand(command, args, { input } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      resolve({ status: null, stdout, stderr, error });
    });
    child.on('close', (status) => {
      resolve({ status, stdout, stderr, error: null });
    });
    child.stdin.end(input || '');
  });
}

function commandForJob(job) {
  if (job.executor.name === 'openclaw' && job.executor.command !== 'openclaw') {
    return {
      command: job.executor.command,
      args: [...asArray(job.executor.args), job.jobPath],
      input: JSON.stringify(job, null, 2)
    };
  }
  if (job.executor.name === 'openclaw') {
    return {
      command: job.executor.command,
      args: ['agent', '--message', job.prompt],
      input: JSON.stringify(job, null, 2)
    };
  }
  throw new BetterRefAgentsError(`Executor ${job.executor.name} cannot run external jobs.`, 2);
}

async function runExternalJob(packet, agent, outDir) {
  const job = buildExternalJob(packet, agent, outDir);
  await writeJson(job.jobPath, job);
  const transcriptPath = path.join(outDir, 'transcripts', `${slugAgent(agent)}.jsonl`);
  const { command, args, input } = commandForJob(job);
  const result = await runCommand(command, args, { input });
  const transcript = {
    schemaVersion: 'betterref.agents.executor_transcript.v1',
    taskId: job.taskId,
    assetId: job.assetId,
    executor: job.executor.name,
    agent,
    jobPath: job.jobPath,
    command,
    args,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error ? result.error.message : null
  };
  await mkdir(path.dirname(transcriptPath), { recursive: true });
  await writeFile(transcriptPath, `${JSON.stringify(transcript)}\n`);
  if (result.error || result.status !== 0) {
    throw new BetterRefAgentsError(
      `${agent} external executor failed${result.error ? `: ${result.error.message}` : ` with exit code ${result.status}`}`,
      3,
      {
        schemaVersion: 'betterref.agents.blocked.v1',
        runtimeMode: 'blocked',
        executor: job.executor.name,
        agent,
        transcriptPath,
        blockingReasons: [result.error ? result.error.message : result.stderr || `exit code ${result.status}`]
      }
    );
  }
  const report = parseExecutorReport(result.stdout, agent);
  const reportPath = path.join(outDir, 'reports', `${slugAgent(agent)}.json`);
  await writeJson(reportPath, report);
  return { jobPath: job.jobPath, transcriptPath, reportPath, report };
}

async function mapWithLimit(items, limit, worker) {
  const results = [];
  let nextIndex = 0;
  async function runNext() {
    const index = nextIndex;
    nextIndex += 1;
    if (index >= items.length) return;
    results[index] = await worker(items[index], index);
    await runNext();
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, runNext);
  await Promise.all(workers);
  return results;
}

function normalizeTouchedPath(value) {
  return String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function scopeMatchesPath(scope, touchedPath) {
  const normalizedScope = normalizeTouchedPath(scope);
  const normalizedPath = normalizeTouchedPath(touchedPath);
  if (normalizedScope.endsWith('/**')) {
    const prefix = normalizedScope.slice(0, -3);
    return normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`);
  }
  return normalizedPath === normalizedScope;
}

function validateWriteScope(report, packet) {
  const mode = packet?.writePolicy?.mode;
  if (!mode || mode === 'structured') return [];
  const touchedPaths = report?.touchedPaths;
  if (mode === 'read-only') {
    return asArray(touchedPaths).length > 0 ? [`${report?.agent || 'unknown'} reported touchedPaths in read-only mode`] : [];
  }
  if (!['scoped-write', 'production-write', 'release'].includes(mode)) return [];
  if (!Array.isArray(touchedPaths)) {
    return [`${report?.agent || 'unknown'} touchedPaths must be an array in ${mode} mode`];
  }
  const team = teamForAgent(packet, report.agent);
  const allowedWritePaths = writeScopesForTeam(team, mode);
  return touchedPaths
    .filter((item) => !allowedWritePaths.some((scope) => scopeMatchesPath(scope, item)))
    .map((item) => `${report.agent} touched path ${item} outside allowedWritePaths: ${allowedWritePaths.join(', ')}`);
}

function validateReport(report, filePath, packet = null) {
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
  reasons.push(...validateWriteScope(report, packet));
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
    blockingReasons.push(...validateReport(entry.report, entry.reportPath, packet));
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
    executor: packet.executor,
    writePolicy: packet.writePolicy,
    spawnPolicy: packet.spawnPolicy,
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
  executor,
  executorCommand,
  executorArgs = [],
  writeMode = 'read-only',
  maxConcurrency,
  inputs = [],
  selectedTeams,
  allAgents = false
} = {}) {
  const plan = await planAgentRun({
    task,
    outDir,
    projectDir,
    assetId,
    runtimeMode,
    executor,
    executorCommand,
    executorArgs,
    writeMode,
    maxConcurrency,
    inputs,
    selectedTeams,
    allAgents
  });
  const { packet } = plan;
  const out = plan.artifacts.outDir;
  const isExternal = packet.executor?.kind === 'external';
  const lines = [
    '# BetterRef Agent Run Log',
    '',
    `[Supervisor] runtimeMode=${packet.runtimeMode}; ${packet.runtimeMode === 'structured' ? 'no runtime spawn occurred' : isExternal ? 'external executor enabled' : 'runtime subagents reported'}`,
    `[Supervisor] executor=${packet.executor.name}; writeMode=${packet.writePolicy.mode}`,
    `[Supervisor] selectedTeams=${packet.selectedTeams.join(', ')}`,
    `[Supervisor] contextPack=${path.relative(out, packet.contextPackPath).replace(/\\/g, '/')}`,
    `[Supervisor] dispatchStrategy=${packet.dispatchStrategy}`,
    `[Supervisor] spawnPolicy=${packet.spawnPolicy.mode}; maxConcurrentAgents=${packet.spawnPolicy.maxConcurrentAgents}`,
    ''
  ];
  for (const group of packet.dispatchGroups) {
    lines.push(`[Supervisor] Dispatching ${group.team} in parallel: ${group.agents.join(', ')}; writeScopes=${group.writeScopes.join(', ')}`);
  }
  lines.push('');
  if (isExternal && packet.runtimeMode === 'spawned') {
    const results = await mapWithLimit(packet.selectedAgents, packet.spawnPolicy.maxConcurrentAgents, (agent) =>
      runExternalJob(packet, agent, out)
    );
    for (let index = 0; index < packet.selectedAgents.length; index += 1) {
      const agent = packet.selectedAgents[index];
      const result = results[index];
      lines.push(`[${agent}] external report -> ${path.relative(out, result.reportPath).replace(/\\/g, '/')}`);
    }
  } else {
    for (const agent of packet.selectedAgents) {
      const report = makeReport(packet, agent);
      const reportPath = path.join(out, 'reports', `${slugAgent(agent)}.json`);
      await writeJson(reportPath, report);
      lines.push(`[${agent}] report -> ${path.relative(out, reportPath).replace(/\\/g, '/')}`);
    }
  }
  const runLogPath = path.join(out, 'run-log.md');
  await writeFile(runLogPath, `${lines.join('\n')}\n`);
  const report = await mergeAgentReports({ outDir: out });
  return {
    schemaVersion: 'betterref.agents.run.result.v1',
    runtimeMode: packet.runtimeMode,
    message: packet.runtimeMode === 'structured' ? 'no runtime spawn occurred' : isExternal ? 'external executor reported' : 'runtime subagents reported',
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
    blockingReasons.push(...validateReport(specialist, reportPath, merge));
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
