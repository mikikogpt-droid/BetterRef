import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const guardBin = path.join(repoRoot, 'bin', 'betterref-guard.mjs');

async function makeCase(name) {
  const dir = path.join(tmpdir(), `betterref-guard-${process.pid}-${name}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function writeJson(filePath, value) {
  await writeFile(filePath, JSON.stringify(value, null, 2));
}

function runGuard(args) {
  return spawnSync(process.execPath, [guardBin, ...args], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
}

test('betterref-guard hard fails when source uses reference assets despite a passing score', async () => {
  const dir = await makeCase('reference-reuse');
  const project = path.join(dir, 'project');
  await mkdir(path.join(project, 'src'), { recursive: true });
  await writeFile(
    path.join(project, 'src', 'page.tsx'),
    "export default function Page(){return <img src='/assets/reference/homepage.png' />;}"
  );
  const report = path.join(dir, 'report.json');
  const config = path.join(dir, 'guard.json');
  const out = path.join(dir, 'guard-report.json');
  await writeJson(report, {
    passed: true,
    mode: 'single_viewport',
    verdict: { verdict: 'pass', score: 99, hard_fail_present: false, hardFailHints: [] }
  });
  await writeJson(config, {
    forbiddenSourcePatterns: ['assets/reference', 'homepage-reference', 'pdf-render'],
    sourceExtensions: ['.tsx']
  });

  const result = runGuard(['--project', project, '--report', report, '--config', config, '--out', out, '--json']);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const guardReport = JSON.parse(await readFile(out, 'utf8'));
  assert.equal(guardReport.passed, false);
  assert.equal(guardReport.hardFailPresent, true);
  assert.ok(guardReport.hardFails.some((item) => item.code === 'reference_asset_used_in_source'));
});

test('betterref-guard hard fails long-page references without scroll mode and section scores', async () => {
  const dir = await makeCase('long-page');
  const project = path.join(dir, 'project');
  await mkdir(path.join(project, 'src'), { recursive: true });
  await writeFile(path.join(project, 'src', 'page.tsx'), 'export default function Page(){return <main />;}');
  const report = path.join(dir, 'report.json');
  const config = path.join(dir, 'guard.json');
  await writeJson(report, {
    passed: true,
    mode: 'single_viewport',
    viewport: { width: 1440, height: 900 },
    dimensions: {
      reference: { width: 1440, height: 1800 },
      actualCompared: { width: 1440, height: 900 }
    },
    verdict: { verdict: 'pass', score: 98, hard_fail_present: false, hardFailHints: [] }
  });
  await writeJson(config, { longReference: true, targetViewport: { width: 1440, height: 900 } });

  const result = runGuard(['--project', project, '--report', report, '--config', config, '--json']);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const guardReport = JSON.parse(result.stdout);
  assert.ok(guardReport.hardFails.some((item) => item.code === 'long_reference_missing_scroll_mode'));
  assert.ok(guardReport.hardFails.some((item) => item.code === 'long_reference_missing_section_scores'));
  assert.ok(guardReport.hardFails.some((item) => item.code === 'actual_page_missing_scroll_evidence'));
});

test('betterref-guard hard fails images rendered larger than native dimensions', async () => {
  const dir = await makeCase('asset-scale');
  const project = path.join(dir, 'project');
  await mkdir(path.join(project, 'src'), { recursive: true });
  await writeFile(path.join(project, 'src', 'page.tsx'), 'export default function Page(){return <main />;}');
  const report = path.join(dir, 'report.json');
  const config = path.join(dir, 'guard.json');
  await writeJson(report, {
    passed: true,
    mode: 'single_viewport',
    verdict: { verdict: 'pass', score: 98, hard_fail_present: false, hardFailHints: [] }
  });
  await writeJson(config, {
    renderedAssets: [
      {
        selector: '.hero img',
        src: '/hero.png',
        nativeWidth: 640,
        nativeHeight: 360,
        renderedWidth: 1280,
        renderedHeight: 720
      }
    ]
  });

  const result = runGuard(['--project', project, '--report', report, '--config', config, '--json']);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const guardReport = JSON.parse(result.stdout);
  assert.ok(guardReport.hardFails.some((item) => item.code === 'asset_scaled_beyond_native_size'));
});

test('betterref-guard passes clean reports with no hard-fail evidence', async () => {
  const dir = await makeCase('clean');
  const project = path.join(dir, 'project');
  await mkdir(path.join(project, 'src'), { recursive: true });
  await writeFile(path.join(project, 'src', 'page.tsx'), 'export default function Page(){return <main><button>Buy</button></main>;}');
  const report = path.join(dir, 'report.json');
  const config = path.join(dir, 'guard.json');
  await writeJson(report, {
    passed: true,
    mode: 'single_viewport',
    verdict: { verdict: 'pass', score: 96, hard_fail_present: false, hardFailHints: [] }
  });
  await writeJson(config, { forbiddenSourcePatterns: ['assets/reference'] });

  const result = runGuard(['--project', project, '--report', report, '--config', config, '--json']);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const guardReport = JSON.parse(result.stdout);
  assert.equal(guardReport.passed, true);
  assert.equal(guardReport.hardFailPresent, false);
  assert.deepEqual(guardReport.hardFails, []);
});
