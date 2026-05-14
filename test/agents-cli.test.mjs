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
  for (const name of ['Plato', 'Dalton', 'Lagrange', 'Descartes', 'Laplace']) {
    assert.equal(packet.selectedAgents.includes(name), true);
  }
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
  assert.equal(await pathExists(path.join(out, 'supervisor-merge.json')), true);
  for (const name of ['dalton', 'lagrange']) {
    const reportPath = path.join(out, 'reports', `${name}.json`);
    assert.equal(await pathExists(reportPath), true);
    const report = JSON.parse(await readFile(reportPath, 'utf8'));
    assert.equal(report.schemaVersion, 'betterref.agents.specialist_report.v1');
    assert.equal(report.runtimeMode, 'structured');
    assert.equal(Array.isArray(report.facts), true);
    assert.equal(Array.isArray(report.evidence), true);
    assert.equal(Array.isArray(report.hardFails), true);
  }
  const log = await readFile(path.join(out, 'run-log.md'), 'utf8');
  assert.match(log, /runtimeMode=structured; no runtime spawn occurred/);
  assert.match(log, /\[Dalton\] report/);
  const merge = JSON.parse(await readFile(path.join(out, 'supervisor-merge.json'), 'utf8'));
  assert.equal(merge.schemaVersion, 'betterref.agents.supervisor_merge.v1');
  assert.equal(merge.runtimeMode, 'structured');
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
