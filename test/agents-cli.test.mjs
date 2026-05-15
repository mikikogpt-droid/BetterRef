import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const agentsBin = path.join(repoRoot, 'bin', 'betterref-agents.mjs');

async function makeCase(name) {
  const dir = path.join(tmpdir(), `betterref-agents-${process.pid}-${name}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function runAgents(args) {
  return spawnSync(process.execPath, [agentsBin, ...args], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
}

test('betterref-agents prints usage and exits code 2 without mode inputs', () => {
  const result = runAgents([]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: betterref-agents/);
  assert.match(result.stderr, /--plan/);
  assert.match(result.stderr, /--run/);
  assert.match(result.stderr, /--status/);
  assert.match(result.stderr, /--report/);
});

test('betterref-agents plan creates a supervisor packet for PRD reference and Tencent 3D work', async () => {
  const out = path.join(await makeCase('plan'), '.betterref-agents');

  const result = runAgents([
    '--plan',
    '--task',
    'Read PRD PDF and Reference Pack, then create Roblox-ready Tencent Hunyuan 3D model evidence.',
    '--asset-id',
    'model-rocket',
    '--out',
    out,
    '--json'
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.schemaVersion, 'betterref.agents.plan.result.v1');
  assert.match(payload.artifacts.supervisorPacketPath, /supervisor-packet\.json$/);
  const packet = JSON.parse(await readFile(path.join(out, 'supervisor-packet.json'), 'utf8'));
  assert.equal(packet.schemaVersion, 'betterref.agents.supervisor_packet.v1');
  assert.equal(packet.runtimeMode, 'structured');
  assert.equal(packet.assetId, 'model-rocket');
  assert.equal(packet.selectedTeams.includes('Reference Intelligence CLI'), true);
  assert.equal(packet.selectedTeams.includes('3D Asset Plan + Tencent Hunyuan Handoff'), true);
  assert.equal(packet.selectedTeams.includes('Final Verify 3D Evidence Gate'), true);
  assert.equal(packet.selectedTeams.includes('PRD Extraction + 3D Requirements'), true);
  assert.equal(packet.dispatchStrategy, 'parallel-by-team');
  assert.equal(packet.reportFormat, 'concise-json');
  assert.equal(packet.fullRosterPolicy, 'explicit-only');
  assert.equal(packet.spawnPolicy.mode, 'batched-waves');
  assert.equal(packet.spawnPolicy.maxConcurrentAgents, 4);
  assert.match(packet.spawnPolicy.fullRosterStrategy, /never spawn all 29/i);
  assert.equal(packet.contextPackPath.endsWith('context-pack.json'), true);
  assert.deepEqual(packet.cachePolicy.reuseArtifacts, [
    '.betterref-prd',
    '.betterref-reference',
    '.betterref-3d',
    '.betterref-agents/supervisor-merge.json'
  ]);
  assert.ok(packet.dispatchGroups.some((group) => group.team === 'Reference Intelligence CLI'));
  for (const name of ['Plato', 'Dalton', 'Lagrange', 'Descartes', 'Laplace']) {
    assert.equal(packet.selectedAgents.includes(name), true);
  }
  assert.equal(packet.blockingGates.includes('signedTencentGlobalApi'), true);
  assert.equal(packet.blockingGates.includes('ResultFile3Ds'), true);
});

test('betterref-agents can force the full named 29-agent roster', async () => {
  const out = path.join(await makeCase('all-agents'), '.betterref-agents');

  const result = runAgents([
    '--plan',
    '--task',
    'Use the BetterRef named 29-agent roster for PRD reference Tencent 3D Roblox work.',
    '--all-agents',
    '--out',
    out,
    '--json'
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const packet = JSON.parse(await readFile(path.join(out, 'supervisor-packet.json'), 'utf8'));
  assert.equal(packet.selectionMode, 'full-roster');
  assert.equal(packet.selectedAgents.length, 29);
  for (const name of [
    'Plato',
    'Dalton',
    'Lagrange',
    'Descartes',
    'Laplace',
    'Einstein',
    'Pauli',
    'Hilbert',
    'Maxwell'
  ]) {
    assert.equal(packet.selectedAgents.includes(name), true);
  }
});

test('betterref-agents auto-selects all 29 agents when the task asks for the named roster', async () => {
  const out = path.join(await makeCase('auto-all-agents'), '.betterref-agents');

  const result = runAgents([
    '--plan',
    '--task',
    'Run the named 29-agent roster and visible agent team for a full BetterRef audit.',
    '--out',
    out,
    '--json'
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const packet = JSON.parse(await readFile(path.join(out, 'supervisor-packet.json'), 'utf8'));
  assert.equal(packet.selectionMode, 'full-roster');
  assert.equal(packet.selectedAgents.length, 29);
  assert.equal(packet.selectedTeams.includes('Skill Docs + Agent-Team Contract'), true);
  assert.equal(packet.selectedTeams.includes('Final Whole-Feature Review'), true);
});

test('betterref-agents keeps visible agent team requests risk-scoped unless full roster is explicit', async () => {
  const out = path.join(await makeCase('risk-scoped-agent-team'), '.betterref-agents');

  const result = runAgents([
    '--plan',
    '--task',
    'Use agents for a Tencent Hunyuan 3D Roblox reference audit.',
    '--out',
    out,
    '--json'
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const packet = JSON.parse(await readFile(path.join(out, 'supervisor-packet.json'), 'utf8'));
  assert.equal(packet.fullRosterPolicy, 'explicit-only');
  assert.equal(packet.selectionMode, 'risk-scoped');
  assert.ok(packet.selectedAgents.length < 29);
  assert.equal(packet.selectedTeams.includes('3D Asset Plan + Tencent Hunyuan Handoff'), true);
  assert.equal(packet.selectedAgents.includes('Einstein'), false);
  assert.equal(packet.selectedAgents.includes('Pauli'), false);
});

test('betterref-agents plan includes OpenClaw scoped-write executor policy', async () => {
  const out = path.join(await makeCase('openclaw-plan'), '.betterref-agents');

  const result = runAgents([
    '--plan',
    '--task',
    'Use OpenClaw agents for a Tencent Hunyuan 3D Roblox reference workflow.',
    '--runtime-mode',
    'spawned',
    '--executor',
    'openclaw',
    '--write-mode',
    'scoped-write',
    '--max-concurrency',
    '3',
    '--out',
    out,
    '--json'
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const packet = JSON.parse(await readFile(path.join(out, 'supervisor-packet.json'), 'utf8'));
  assert.equal(packet.runtimeMode, 'spawned');
  assert.equal(packet.executor.name, 'openclaw');
  assert.equal(packet.executor.kind, 'external');
  assert.equal(packet.spawnPolicy.maxConcurrentAgents, 3);
  assert.equal(packet.writePolicy.mode, 'scoped-write');
  assert.equal(packet.writePolicy.mergeOwner, 'BetterRef Supervisor');
  assert.equal(packet.writePolicy.defaultAgentAccess, 'deny');
  assert.ok(packet.writePolicy.deniedActions.includes('git push'));
  const daltonGroup = packet.dispatchGroups.find((group) => group.team === '3D Asset Plan + Tencent Hunyuan Handoff');
  assert.ok(daltonGroup);
  assert.equal(daltonGroup.writeMode, 'scoped-write');
  assert.ok(daltonGroup.writeScopes.includes('.betterref-3d/**'));
  assert.ok(daltonGroup.writeScopes.includes('assets/models/**'));
  const contextPack = JSON.parse(await readFile(path.join(out, 'context-pack.json'), 'utf8'));
  assert.equal(contextPack.executor.name, 'openclaw');
  assert.equal(contextPack.writePolicy.mode, 'scoped-write');
});

test('betterref-agents run can execute OpenClaw-compatible external agent jobs with scoped writes', async () => {
  const root = await makeCase('openclaw-run');
  const out = path.join(root, '.betterref-agents');
  const fakeExecutor = path.join(root, 'fake-openclaw.mjs');
  await writeFile(fakeExecutor, `
import { readFile } from 'node:fs/promises';
const job = JSON.parse(await readFile(process.argv.at(-1), 'utf8'));
const report = {
  schemaVersion: 'betterref.agents.specialist_report.v1',
  taskId: job.taskId,
  assetId: job.assetId,
  runtimeMode: job.runtimeMode,
  reportFormat: job.reportFormat,
  team: job.team,
  agent: job.agent,
  role: job.role,
  status: 'pass',
  facts: [{
    claim: job.agent + ' executed through fake OpenClaw with scoped write policy.',
    evidence: job.jobPath,
    confidence: 'high'
  }],
  evidence: [job.jobPath],
  confidence: 'high',
  uncertainties: [],
  recommendedActions: ['merge through BetterRef Supervisor'],
  touchedPaths: ['SKILL.md'],
  hardFails: []
};
console.log('fake OpenClaw completed ' + job.agent);
console.log(JSON.stringify(report));
`);

  const result = runAgents([
    '--run',
    '--task',
    'Use OpenClaw agents for skill docs contract work.',
    '--runtime-mode',
    'spawned',
    '--executor',
    'openclaw',
    '--executor-command',
    process.execPath,
    '--executor-arg',
    fakeExecutor,
    '--write-mode',
    'scoped-write',
    '--out',
    out,
    '--json'
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.runtimeMode, 'spawned');
  assert.equal(payload.message, 'external executor reported');
  assert.equal(await pathExists(path.join(out, 'jobs', 'einstein.json')), true);
  assert.equal(await pathExists(path.join(out, 'transcripts', 'einstein.jsonl')), true);
  assert.equal(await pathExists(path.join(out, 'reports', 'einstein.json')), true);
  const job = JSON.parse(await readFile(path.join(out, 'jobs', 'einstein.json'), 'utf8'));
  assert.equal(job.executor.name, 'openclaw');
  assert.equal(job.writePolicy.mode, 'scoped-write');
  assert.ok(job.allowedWritePaths.includes('SKILL.md'));
  const report = JSON.parse(await readFile(path.join(out, 'reports', 'einstein.json'), 'utf8'));
  assert.equal(report.runtimeMode, 'spawned');
  assert.equal(report.agent, 'Einstein');
  assert.deepEqual(report.touchedPaths, ['SKILL.md']);
  const log = await readFile(path.join(out, 'run-log.md'), 'utf8');
  assert.match(log, /executor=openclaw/);
  assert.match(log, /writeMode=scoped-write/);
  assert.match(log, /\[Einstein\] external report/);
});

test('betterref-agents report rejects write-capable reports that touch paths outside scope', async () => {
  const out = path.join(await makeCase('reject-out-of-scope-write'), '.betterref-agents');
  await writeJson(path.join(out, 'supervisor-packet.json'), {
    schemaVersion: 'betterref.agents.supervisor_packet.v1',
    taskId: 'betterref-task-001',
    assetId: 'asset-001',
    runtimeMode: 'spawned',
    task: 'Skill docs and agent-team contract',
    selectedTeams: ['Skill Docs + Agent-Team Contract'],
    selectedAgents: ['Einstein'],
    executor: { name: 'openclaw', kind: 'external' },
    writePolicy: {
      mode: 'scoped-write',
      deniedActions: ['git push'],
      mergeOwner: 'BetterRef Supervisor'
    },
    blockingGates: []
  });
  await writeJson(path.join(out, 'reports', 'einstein.json'), {
    schemaVersion: 'betterref.agents.specialist_report.v1',
    taskId: 'betterref-task-001',
    assetId: 'asset-001',
    runtimeMode: 'spawned',
    team: 'Skill Docs + Agent-Team Contract',
    agent: 'Einstein',
    role: 'Skill Docs + Agent-Team Contract lead',
    status: 'pass',
    facts: [],
    evidence: ['reports/einstein.json'],
    confidence: 'high',
    uncertainties: [],
    recommendedActions: [],
    touchedPaths: ['package.json'],
    hardFails: []
  });

  const result = runAgents(['--report', '--out', out, '--json']);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.passed, false);
  assert.ok(payload.blockingReasons.some((item) => /package\.json.*outside allowedWritePaths/i.test(item)));
});

test('betterref-agents run structured writes visible dispatch log reports and supervisor merge', async () => {
  const out = path.join(await makeCase('run'), '.betterref-agents');

  const result = runAgents([
    '--run',
    '--task',
    'Tencent Hunyuan 3D Roblox asset with reference pack and final verification.',
    '--out',
    out,
    '--json'
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.schemaVersion, 'betterref.agents.run.result.v1');
  assert.equal(payload.runtimeMode, 'structured');
  assert.equal(payload.message, 'no runtime spawn occurred');
  assert.equal(await pathExists(path.join(out, 'run-log.md')), true);
  assert.equal(await pathExists(path.join(out, 'context-pack.json')), true);
  assert.equal(await pathExists(path.join(out, 'supervisor-merge.json')), true);
  const contextPack = JSON.parse(await readFile(path.join(out, 'context-pack.json'), 'utf8'));
  assert.equal(contextPack.dispatchStrategy, 'parallel-by-team');
  assert.equal(contextPack.reportFormat, 'concise-json');
  assert.equal(contextPack.spawnPolicy.mode, 'batched-waves');
  assert.ok(contextPack.dispatchGroups.length >= 2);
  assert.equal(contextPack.cachePolicy.reuseArtifacts.includes('.betterref-3d'), true);
  for (const name of ['dalton', 'lagrange']) {
    const reportPath = path.join(out, 'reports', `${name}.json`);
    assert.equal(await pathExists(reportPath), true);
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    assert.equal(report.schemaVersion, 'betterref.agents.specialist_report.v1');
    assert.equal(report.runtimeMode, 'structured');
    assert.equal(report.reportFormat, 'concise-json');
    assert.equal(Array.isArray(report.facts), true);
    assert.equal(Array.isArray(report.evidence), true);
    assert.equal(Array.isArray(report.hardFails), true);
  }
  const log = await readFile(path.join(out, 'run-log.md'), 'utf8');
  assert.match(log, /runtimeMode=structured; no runtime spawn occurred/);
  assert.match(log, /contextPack=.*context-pack\.json/);
  assert.match(log, /dispatchStrategy=parallel-by-team/);
  assert.match(log, /spawnPolicy=batched-waves/);
  assert.match(log, /Dispatching 3D Asset Plan \+ Tencent Hunyuan Handoff in parallel/);
  assert.match(log, /\[Dalton\] report/);
  const merge = JSON.parse(await readFile(path.join(out, 'supervisor-merge.json'), 'utf8'));
  assert.equal(merge.schemaVersion, 'betterref.agents.supervisor_merge.v1');
  assert.equal(merge.runtimeMode, 'structured');
  assert.equal(merge.dispatchStrategy, 'parallel-by-team');
  assert.equal(merge.reportFormat, 'concise-json');
  assert.equal(merge.spawnPolicy.mode, 'batched-waves');
  assert.equal(merge.selectedAgents.includes('Dalton'), true);
  assert.equal(merge.reports.some((item) => item.agent === 'Dalton'), true);
});

test('betterref-agents status summarizes packet reports and merge artifacts', async () => {
  const out = path.join(await makeCase('status'), '.betterref-agents');
  const run = runAgents(['--run', '--task', 'Skill docs and agent-team contract', '--out', out, '--json']);
  assert.equal(run.status, 0, run.stderr || run.stdout);

  const status = runAgents(['--status', '--out', out, '--json']);

  assert.equal(status.status, 0, status.stderr || status.stdout);
  const payload = JSON.parse(status.stdout);
  assert.equal(payload.schemaVersion, 'betterref.agents.status.v1');
  assert.equal(payload.runtimeMode, 'structured');
  assert.equal(payload.packetPresent, true);
  assert.equal(payload.mergePresent, true);
  assert.ok(payload.reportCount >= 3);
});

test('betterref-agents report rejects incomplete specialist reports', async () => {
  const out = path.join(await makeCase('reject-incomplete-report'), '.betterref-agents');
  await writeJson(path.join(out, 'supervisor-packet.json'), {
    schemaVersion: 'betterref.agents.supervisor_packet.v1',
    taskId: 'betterref-task-001',
    assetId: 'asset-001',
    runtimeMode: 'structured',
    task: 'Skill docs and agent-team contract',
    selectedTeams: ['Skill Docs + Agent-Team Contract'],
    selectedAgents: ['Einstein'],
    blockingGates: []
  });
  await writeJson(path.join(out, 'reports', 'einstein.json'), {
    schemaVersion: 'betterref.agents.specialist_report.v1',
    taskId: 'betterref-task-001',
    agent: 'Einstein'
  });

  const result = runAgents(['--report', '--out', out, '--json']);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.schemaVersion, 'betterref.agents.report.result.v1');
  assert.equal(payload.passed, false);
  assert.ok(payload.blockingReasons.some((item) => /missing required field evidence/i.test(item)));
});
