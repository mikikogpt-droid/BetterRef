#!/usr/bin/env node
import { parseArgs, numberValue } from '../lib/args.mjs';
import { BetterRefRunError, runBetterRef } from '../lib/run.mjs';

const usage = `Usage: betterref-run --pdf <prd.pdf> --project <dir> --ref <reference.png> [options]

Required:
  --pdf                  PRD PDF path.
  --project              Project root for AGENTS.md, BetterRef artifacts, and verification.
  --ref, --reference     Reference image path for visual comparison.

Options:
  --url                  Target app URL or URL fragment to select in Chrome.
  --endpoint <url>       Chrome DevTools endpoint. When omitted, run blocks with @chrome handoff.
  --browser-handoff      JSON handoff captured by @chrome, Chrome MCP, or browser tooling.
  --out <dir>            Output directory for run-state artifacts. Default: <project>/.betterref-run
  --viewport <WxH>       Override viewport when the PRD does not specify one.
  --selector <name=css>  DOM region selector for browser evidence. Repeatable.
  --wait-ms <n>          Wait before measuring/capturing. Default: 0
  --no-html              Do not write HTML reports.
  --json                 Print run state JSON to stdout.
  --help                 Show this help.
`;

function failUsage(message) {
  if (message) {
    console.error(message);
  }
  console.error(usage);
  process.exit(2);
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

  const referencePath = values.ref || values.reference;
  if (!values.pdf || !values.project || !referencePath) {
    failUsage('Missing required --pdf, --project, or --ref.');
  }

  try {
    const result = await runBetterRef({
      pdfPath: values.pdf,
      projectDir: values.project,
      referencePath,
      url: values.url,
      endpoint: values.endpoint,
      browserHandoffPath: values['browser-handoff'],
      runDir: values.out,
      viewport: values.viewport,
      selector: values.selector,
      waitMs: numberValue(values['wait-ms'], 0, '--wait-ms'),
      html: !flags.has('no-html')
    });

    if (flags.has('json')) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`[betterref-run] ${result.status.toUpperCase()} phase=${result.phase} exit=${result.exitCode}`);
      console.log(`[betterref-run] state=${result.artifacts.runStatePath}`);
      console.log(`[betterref-run] next=${result.artifacts.nextActionsPath}`);
      for (const blocker of result.blockers) {
        console.log(`[betterref-run] ${blocker.code}: ${blocker.message}`);
      }
      if (result.artifacts.finalVerdictPath) {
        console.log(`[betterref-run] verdict=${result.artifacts.finalVerdictPath}`);
      }
    }

    process.exit(result.exitCode);
  } catch (error) {
    if (error instanceof BetterRefRunError) {
      console.error(error.message);
      process.exit(error.exitCode);
    }
    console.error(`[betterref-run] ${error.stack || error.message}`);
    process.exit(1);
  }
}

await main();
