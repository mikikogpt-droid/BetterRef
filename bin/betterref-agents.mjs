#!/usr/bin/env node
import { parseArgs } from '../lib/args.mjs';
import {
  agentStatus,
  BetterRefAgentsError,
  mergeAgentReports,
  planAgentRun,
  runAgentWorkflow
} from '../lib/agents.mjs';

const usage = `Usage: betterref-agents <mode> --out <dir> [options]

Modes:
  --plan                  Create supervisor-packet.json.
  --run                   Create supervisor packet, run-log, specialist reports, and merge.
  --status                Summarize current .betterref-agents artifacts.
  --report                Merge specialist reports into supervisor-merge.json.

Options:
  --task                  Task text for team selection.
  --asset-id              Asset id for packet/report scope. Default asset-001.
  --out                   Output directory. Default .betterref-agents.
  --project               Project root; default out becomes <project>/.betterref-agents.
  --runtime-mode          spawned, structured, or blocked. Default structured.
  --executor              structured, codex, or openclaw. Default structured for structured mode.
  --executor-command      External executor command. For OpenClaw tests/adapters, job path is appended.
  --executor-arg          Extra external executor argument. Repeatable.
  --write-mode            read-only, propose-patch, scoped-write, production-write, or release. Default read-only.
  --max-concurrency       Max spawned/external jobs at once. Default 4.
  --all-agents            Force the full named 29-agent roster.
  --input                 Input artifact path. Repeatable.
  --json                  Print JSON to stdout.
  --help                  Show this help.
`;

function failUsage(message) {
  if (message) {
    console.error(message);
  }
  console.error(usage);
  process.exit(2);
}

function hasMode(parsed, mode) {
  return parsed.flags.has(mode) || parsed.values[mode] !== undefined;
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    failUsage(error.message);
  }
  const { values, flags } = parsed;
  if (flags.has('help') || flags.has('h')) {
    console.log(usage);
    return;
  }
  const modes = ['plan', 'run', 'status', 'report'].filter((mode) => hasMode(parsed, mode));
  if (modes.length !== 1) {
    failUsage('Specify exactly one mode: --plan, --run, --status, or --report.');
  }

  try {
    const common = {
      task: values.task,
      outDir: values.out,
      projectDir: values.project,
      assetId: values['asset-id'],
      runtimeMode: values['runtime-mode'] || 'structured',
      executor: values.executor,
      executorCommand: values['executor-command'],
      executorArgs: values['executor-arg'],
      writeMode: values['write-mode'] || 'read-only',
      maxConcurrency: values['max-concurrency'],
      allAgents: flags.has('all-agents') || flags.has('all'),
      inputs: values.input
    };
    let result;
    const mode = modes[0];
    if (mode === 'plan') {
      result = await planAgentRun(common);
    } else if (mode === 'run') {
      result = await runAgentWorkflow(common);
    } else if (mode === 'status') {
      result = await agentStatus(common);
    } else {
      result = await mergeAgentReports(common);
    }

    if (flags.has('json')) {
      console.log(JSON.stringify(result, null, 2));
    } else if (mode === 'plan') {
      console.log(`[betterref-agents] packet=${result.artifacts.supervisorPacketPath}`);
    } else if (mode === 'run') {
      console.log(`[betterref-agents] runtimeMode=${result.runtimeMode} ${result.message}`);
      console.log(`[betterref-agents] merge=${result.artifacts.supervisorMergePath}`);
    } else if (mode === 'status') {
      console.log(`[betterref-agents] reports=${result.reportCount} merge=${result.mergePresent}`);
    } else {
      console.log(`[betterref-agents] merge=${result.artifacts.supervisorMergePath} passed=${result.passed}`);
    }
    if ((mode === 'report' || mode === 'status') && result.passed === false) {
      process.exit(1);
    }
  } catch (error) {
    if (error instanceof BetterRefAgentsError) {
      if (error.payload && flags.has('json')) {
        console.log(JSON.stringify(error.payload, null, 2));
      } else {
        console.error(error.message);
      }
      process.exit(error.exitCode);
    }
    console.error(`[betterref-agents] ${error.stack || error.message}`);
    process.exit(1);
  }
}

await main();
