#!/usr/bin/env node
import { parseArgs } from '../lib/args.mjs';
import { BetterRefPrdError, buildPrdArtifacts } from '../lib/prd.mjs';

const usage = `Usage: betterref-prd --pdf <prd.pdf> --out <dir> [options]

Required:
  --pdf                  PRD PDF path.
  --out                  Output directory for PRD summary, checklist, runbook, and config.

Options:
  --config-out <path>    Write generated .betterref.json to a custom path.
  --project <dir>        Project root where AGENTS.md should be created or updated.
  --viewport <WxH>       Override viewport when the PRD does not specify one.
  --ref, --reference     Reference image path to include in the generated runbook.
  --url                  Target app URL to include in the generated runbook.
  --json                 Print JSON result to stdout.
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
  if (!values.pdf || !values.out) {
    failUsage('Missing required --pdf or --out.');
  }

  try {
    const result = await buildPrdArtifacts({
      pdfPath: values.pdf,
      outDir: values.out,
      configOut: values['config-out'],
      projectDir: values.project,
      viewport: values.viewport,
      referencePath: values.ref || values.reference,
      url: values.url
    });

    if (flags.has('json')) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`[betterref-prd] summary=${result.artifacts.summaryPath}`);
      console.log(`[betterref-prd] config=${result.artifacts.configPath}`);
      console.log(`[betterref-prd] checklist=${result.artifacts.checklistPath}`);
      console.log(`[betterref-prd] assetPlan=${result.artifacts.assetPlanPath}`);
      console.log(`[betterref-prd] runbook=${result.artifacts.runbookPath}`);
      if (result.artifacts.agentsPath) {
        console.log(`[betterref-prd] agents=${result.artifacts.agentsPath}`);
      }
    }
  } catch (error) {
    if (error instanceof BetterRefPrdError) {
      console.error(error.message);
      process.exit(2);
    }
    console.error(`[betterref-prd] ${error.stack || error.message}`);
    process.exit(1);
  }
}

await main();
