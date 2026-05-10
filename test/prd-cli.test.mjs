import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import PDFDocument from 'pdfkit';

const repoRoot = path.resolve(import.meta.dirname, '..');
const prdBin = path.join(repoRoot, 'bin', 'betterref-prd.mjs');

async function makeCase(name) {
  const dir = path.join(tmpdir(), `betterref-prd-${process.pid}-${name}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

function writePdf(filePath, lines) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const stream = doc.pipe(createWriteStream(filePath));
    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.fontSize(18).text('ONETAPGG PRD');
    doc.moveDown();
    doc.fontSize(11);
    for (const line of lines) {
      doc.text(line);
    }
    doc.end();
  });
}

test('betterref-prd prints usage and exits with code 2 when required args are missing', () => {
  const result = spawnSync(process.execPath, [prdBin], {
    cwd: repoRoot,
    encoding: 'utf8'
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: betterref-prd/);
  assert.match(result.stderr, /--pdf/);
  assert.match(result.stderr, /--out/);
});

test('betterref-prd converts a PRD PDF into BetterRef control artifacts', async () => {
  const dir = await makeCase('artifacts');
  const pdf = path.join(dir, 'prd.pdf');
  const out = path.join(dir, 'prd-out');
  await writePdf(pdf, [
    'Summary: Build ONETAPGG landing page from the reference UI.',
    'Viewport: 1672x941.',
    'Full-page scroll reference: yes.',
    'Required screens: home landing, top up flow, admin orders.',
    'Visual requirements: header, hero, mascot, popular game cards, package cards, news panel, security panel, footer.',
    'Hard fail: no overlap, no horizontal overflow, Thai font must match, text must not clip.',
    'Thresholds: minSsim 0.98, maxChangedPercent 12, maxMeanDiff 5.',
    'Ignore dynamic regions: timestamp and cursor.'
  ]);

  const result = spawnSync(process.execPath, [
    prdBin,
    '--pdf',
    pdf,
    '--out',
    out,
    '--json'
  ], { cwd: repoRoot, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.schemaVersion, 'betterref.prd.v1');
  assert.equal(payload.viewport, '1672x941');
  assert.match(payload.artifacts.summaryPath, /prd-summary\.json$/);
  assert.match(payload.artifacts.configPath, /\.betterref\.json$/);
  assert.match(payload.artifacts.guardConfigPath, /betterref\.guard\.json$/);
  assert.match(payload.artifacts.prdChecklistPath, /prd-checklist\.json$/);
  assert.match(payload.artifacts.assetPlanPath, /asset-plan\.json$/);
  assert.match(payload.artifacts.runbookPath, /betterref-runbook\.md$/);

  const summary = JSON.parse(await readFile(path.join(out, 'prd-summary.json'), 'utf8'));
  assert.equal(summary.requirements.some((item) => /Thai font/.test(item)), true);
  assert.equal(summary.hardFailHints.some((item) => /overlap/.test(item)), true);
  assert.equal(summary.screens.some((item) => /home landing/.test(item)), true);

  const config = JSON.parse(await readFile(path.join(out, '.betterref.json'), 'utf8'));
  assert.equal(config.viewport, '1672x941');
  assert.equal(config.thresholds.minSsim, 0.98);
  assert.equal(config.thresholds.maxChangedPercent, 12);
  assert.equal(config.thresholds.maxMeanDiff, 5);
  assert.equal(config.regions.some((region) => region.name === 'header'), true);
  assert.equal(config.regions.some((region) => region.name === 'hero'), true);
  assert.equal(config.regions.some((region) => region.name === 'cards'), true);
  assert.equal(config.ignoreRegions.some((region) => region.name === 'timestamp'), true);

  const guardConfig = JSON.parse(await readFile(path.join(out, 'betterref.guard.json'), 'utf8'));
  assert.equal(guardConfig.longReference, true);
  assert.deepEqual(guardConfig.targetViewport, { width: 1672, height: 941 });
  assert.equal(guardConfig.requireDomText, true);
  assert.equal(guardConfig.minInteractiveElements, 1);
  assert.ok(guardConfig.forbiddenSourcePatterns.includes('pdf-render'));
  assert.deepEqual(guardConfig.autoAssetQuality, {
    enabled: true,
    minSharpness: 20,
    roots: ['public']
  });

  const prdChecklist = JSON.parse(await readFile(path.join(out, 'prd-checklist.json'), 'utf8'));
  assert.equal(prdChecklist.schemaVersion, 'betterref.prd.checklist.v1');
  assert.equal(prdChecklist.items.some((item) => /Thai font/.test(item.requirement) && item.status === 'pending'), true);
  assert.equal(prdChecklist.items.every((item) => item.phase && item.category), true);

  const assetPlan = JSON.parse(await readFile(path.join(out, 'asset-plan.json'), 'utf8'));
  assert.equal(assetPlan.schemaVersion, 'betterref.asset.plan.v1');
  assert.equal(assetPlan.imagegenRequired, true);
  assert.equal(assetPlan.assets.length > 0, true);
  assert.equal(assetPlan.assets[0].status, 'pending');
  assert.equal(assetPlan.assets[0].implementation, 'imagegen-or-production-asset');
  assert.match(assetPlan.assets[0].targetPath, /^public\/betterref-assets\//);
  assert.equal(assetPlan.assets[0].minNativeWidth >= 3344, true);
  assert.match(assetPlan.assets[0].prompt, /ONETAPGG/i);
  assert.equal(assetPlan.assets[0].acceptanceCriteria.some((item) => /reference crop/i.test(item)), true);

  const runbook = await readFile(path.join(out, 'betterref-runbook.md'), 'utf8');
  assert.match(runbook, /betterref-chrome/);
  assert.match(runbook, /betterref-guard --project/);
  assert.match(runbook, /betterref-verify/);
  assert.match(runbook, /prd-checklist\.json/);
  assert.match(runbook, /asset-plan\.json/);
  assert.match(runbook, /betterref-imagegen --asset-plan/);
  assert.match(runbook, /imagegen/);
  assert.match(runbook, /autoAssetQuality/);
});

test('betterref-prd allows config output outside the artifact directory', async () => {
  const dir = await makeCase('config-out');
  const pdf = path.join(dir, 'prd.pdf');
  const out = path.join(dir, 'prd-out');
  const configOut = path.join(dir, 'project.betterref.json');
  await writePdf(pdf, ['Viewport: 1440x900.', 'Visual requirements: header, hero, footer.']);

  const result = spawnSync(process.execPath, [
    prdBin,
    '--pdf',
    pdf,
    '--out',
    out,
    '--config-out',
    configOut
  ], { cwd: repoRoot, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const config = JSON.parse(await readFile(configOut, 'utf8'));
  assert.equal(config.viewport, '1440x900');
  assert.equal(config.regions.some((region) => region.name === 'footer'), true);
});
