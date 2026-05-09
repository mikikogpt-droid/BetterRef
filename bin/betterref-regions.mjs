#!/usr/bin/env node
import { parseArgs } from '../lib/args.mjs';
import { BetterRefRegionsError, writeRegionConfig } from '../lib/regions.mjs';

const usage = `Usage: betterref-regions --input <dom-boxes.json> --out <.betterref.json> [options]

Required:
  --input                JSON file from Chrome MCP/browser DOM measurement.
  --out                  Output .betterref.json path.

Options:
  --viewport <WxH>       Viewport size when input/merge config does not include one.
  --merge <path>         Existing .betterref.json to preserve thresholds and ignoreRegions.
  --match-size <mode>    strict or reference. Default: strict
  --threshold <k=v>      Threshold override, for example minSsim=0.98. Repeatable.
  --strict-bounds        Reject boxes outside the viewport instead of clipping them.
  --json                 Print generated config to stdout.
  --help                 Show this help.
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
      throw new BetterRefRegionsError('--threshold must use key=value format.');
    }
    const value = Number(rawValue);
    if (!Number.isFinite(value)) {
      throw new BetterRefRegionsError(`Threshold ${key} must be a finite number.`);
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
    const config = await writeRegionConfig({
      inputPath: values.input,
      outPath: values.out,
      mergePath: values.merge,
      viewport: values.viewport,
      matchSize: values['match-size'],
      thresholds: parseThresholds(values.threshold),
      strictBounds: flags.has('strict-bounds')
    });

    if (flags.has('json')) {
      console.log(JSON.stringify(config, null, 2));
    } else {
      console.log(`[betterref-regions] wrote=${values.out} regions=${config.regions.length} viewport=${config.viewport}`);
    }
  } catch (error) {
    if (error instanceof BetterRefRegionsError) {
      console.error(error.message);
      process.exit(2);
    }
    console.error(`[betterref-regions] ${error.stack || error.message}`);
    process.exit(1);
  }
}

await main();
