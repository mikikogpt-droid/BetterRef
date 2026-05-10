#!/usr/bin/env node
import { parseArgs } from '../lib/args.mjs';
import { BetterRefChromeBridgeError, bridgeChromeHandoff } from '../lib/chromeBridge.mjs';

const usage = `Usage: betterref-chrome-bridge --input <chrome-handoff.json> --out <dir> [options]

Required:
  --input               JSON handoff captured from @chrome, Chrome MCP, or a browser script.
  --out                 Output directory for browser-evidence.json and chrome-dom-boxes.json.

Options:
  --config-out          Write .betterref.json regions from handoff elements.
  --match-size          strict or reference. Default: strict.
  --threshold <k=v>     Threshold override, for example minSsim=0.98. Repeatable.
  --strict-bounds       Reject region boxes outside the viewport.
  --json                Print JSON result to stdout.
  --help                Show this help.
`;

function failUsage(message) {
  if (message) {
    console.error(message);
  }
  console.error(usage);
  process.exit(2);
}

function asArray(value) {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function parseThresholds(values) {
  const thresholds = {};
  for (const item of asArray(values)) {
    const [key, rawValue] = String(item).split('=', 2);
    if (!key || rawValue === undefined) {
      throw new BetterRefChromeBridgeError('--threshold must use key=value format.');
    }
    const value = Number(rawValue);
    if (!Number.isFinite(value)) {
      throw new BetterRefChromeBridgeError(`Threshold ${key} must be a finite number.`);
    }
    thresholds[key] = value;
  }
  return thresholds;
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
  if (!values.input || !values.out) {
    failUsage('Missing required --input or --out.');
  }

  try {
    const result = await bridgeChromeHandoff({
      inputPath: values.input,
      outDir: values.out,
      configOutPath: values['config-out'],
      matchSize: values['match-size'],
      thresholds: parseThresholds(values.threshold),
      strictBounds: flags.has('strict-bounds')
    });

    if (flags.has('json')) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`[betterref-chrome-bridge] wrote=${values.out} regions=${result.regionCount}`);
    }
  } catch (error) {
    if (error instanceof BetterRefChromeBridgeError) {
      console.error(error.message);
      process.exit(2);
    }
    console.error(`[betterref-chrome-bridge] ${error.stack || error.message}`);
    process.exit(1);
  }
}

await main();

