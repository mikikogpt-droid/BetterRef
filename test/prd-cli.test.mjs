import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import PDFDocument from 'pdfkit';
import { normalizeExtractedPrdText } from '../lib/prd.mjs';

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

test('normalizes Thai PRD text before building prompts and checklists', () => {
  const mojibakeTopUp = String.fromCodePoint(
    0x0e40,
    0x0e19,
    0x20ac,
    0x0e40,
    0x0e18,
    0x2022,
    0x0e40,
    0x0e18,
    0x0e14,
    0x0e40,
    0x0e18,
    0x0e01,
    0x0e40,
    0x0e19,
    0x20ac,
    0x0e40,
    0x0e18,
    0x81,
    0x0e40,
    0x0e18,
    0x0e01
  );

  assert.equal(normalizeExtractedPrdText(mojibakeTopUp), 'เติมเกม');
  assert.equal(
    normalizeExtractedPrdText('สร้ำงภำพส;ำหรับผู้ใช้งำน ผ่ำนประสบกำรณ์ ลูกค้ำเติมซ;้ำได้ง่ำยใน 5 วินำที'),
    'สร้างภาพสำหรับผู้ใช้งาน ผ่านประสบการณ์ ลูกค้าเติมซ้ำได้ง่ายใน 5 วินาที'
  );
});

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
  assert.equal(guardConfig.requireBrowserEvidence, true);
  assert.equal(guardConfig.requireDomText, true);
  assert.equal(guardConfig.minInteractiveElements, 1);
  assert.equal(guardConfig.minRenderedAssets, 1);
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
  assert.match(runbook, /--browser-evidence \.betterref\/browser-evidence\.json/);
  assert.match(runbook, /--project \./);
  assert.match(runbook, /--require guard,prd,longpage,assetplan,browser/);
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

test('betterref-prd infers canonical screens without noisy requirement lines', async () => {
  const dir = await makeCase('canonical-screens');
  const pdf = path.join(dir, 'prd.pdf');
  const out = path.join(dir, 'prd-out');
  await writePdf(pdf, [
    'Page Purpose Core Modules',
    'Homepage Build first impression with hero 3D and quick top-up cards.',
    'Catalog Let users find all games and wallet items.',
    'Checkout Let customers pay quickly with packages and payment methods.',
    'Account Dashboard Customers can track recent orders, saved IDs, favorites, and quick reorder.',
    'Promotions & Rewards show gift boxes and discount campaigns.'
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
  const summary = JSON.parse(await readFile(path.join(out, 'prd-summary.json'), 'utf8'));
  assert.deepEqual(summary.screens, ['Homepage', 'Catalog', 'Checkout', 'Promotions', 'Account Dashboard']);
});

test('betterref-prd keeps code-native visual behavior out of the imagegen asset plan', async () => {
  const dir = await makeCase('asset-extraction');
  const pdf = path.join(dir, 'prd.pdf');
  const out = path.join(dir, 'prd-out');
  await writePdf(pdf, [
    'Viewport: 1440x900.',
    'Homepage modules: Hero 3D, quick top-up, popular games, promotions, footer.',
    'Header sticky on desktop after scroll through hero.',
    'Hero Headline: top up fast, 3D logo frame, floating status cards.',
    'Game cards hover with image zoom and border glow.',
    'Fallback: static image required for the animation.',
    '3D Asset Rules: hero premium glass device frame with static fallback image.',
    'Image: game or wallet card art.',
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
  const assetPlan = JSON.parse(await readFile(path.join(out, 'asset-plan.json'), 'utf8'));
  assert.equal(assetPlan.imagegenRequired, true);
  assert.equal(assetPlan.assets.some((asset) => /3D Asset Rules/i.test(asset.requirement)), true);
  assert.equal(assetPlan.assets.find((asset) => /Hero Headline/i.test(asset.requirement))?.role, 'cinematic-hero');
  assert.equal(assetPlan.assets.some((asset) => /Image: game or wallet card art/i.test(asset.requirement)), true);
  assert.equal(assetPlan.assets.some((asset) => /sticky/i.test(asset.requirement)), false);
  assert.equal(assetPlan.assets.some((asset) => /hover|zoom|border glow/i.test(asset.requirement)), false);
  assert.equal(assetPlan.assets.some((asset) => /^Fallback:/i.test(asset.requirement)), false);

  const prdChecklist = JSON.parse(await readFile(path.join(out, 'prd-checklist.json'), 'utf8'));
  assert.equal(prdChecklist.items.some((item) => /sticky/i.test(item.requirement)), true);
  assert.equal(prdChecklist.items.some((item) => /hover/i.test(item.requirement)), true);
});
