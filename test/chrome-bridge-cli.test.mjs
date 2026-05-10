import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const bridgeBin = path.join(repoRoot, 'bin', 'betterref-chrome-bridge.mjs');
const pngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

async function makeCase(name) {
  const dir = path.join(tmpdir(), `betterref-chrome-bridge-${process.pid}-${name}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

function runBridge(args) {
  return spawnSync(process.execPath, [bridgeBin, ...args], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
}

test('betterref-chrome-bridge converts @chrome handoff into BetterRef evidence', async () => {
  const dir = await makeCase('handoff');
  const handoff = path.join(dir, 'chrome-handoff.json');
  const viewportScreenshot = path.join(dir, 'chrome-viewport.png');
  const fullPageScreenshot = path.join(dir, 'chrome-full-page.png');
  const out = path.join(dir, '.betterref');
  const configOut = path.join(dir, '.betterref.json');
  await writeFile(viewportScreenshot, Buffer.from(pngBase64, 'base64'));
  await writeFile(fullPageScreenshot, Buffer.from(pngBase64, 'base64'));
  await writeFile(handoff, JSON.stringify({
    source: { tool: '@chrome' },
    screenshots: {
      viewport: viewportScreenshot,
      fullPage: fullPageScreenshot,
      sections: [
        { name: 'hero', selector: '[data-betterref="hero"]', path: viewportScreenshot }
      ]
    },
    viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
    page: {
      url: 'http://127.0.0.1:3000/',
      title: 'ONETAPGG',
      scrollHeight: 1780,
      bodyTextLength: 4200,
      interactiveCount: 32
    },
    fonts: { ready: true, status: 'loaded' },
    console: [],
    network: { errors: [] },
    images: [
      {
        src: '/betterref-assets/hero.png',
        naturalWidth: 1920,
        naturalHeight: 1080,
        renderedWidth: 840,
        renderedHeight: 520
      }
    ],
    elements: [
      { name: 'header', selector: 'header', boundingBox: { x: 0, y: 0, width: 1440, height: 80 } },
      { name: 'hero', selector: '[data-betterref="hero"]', rect: { left: 0, top: 80, right: 1440, bottom: 560 } }
    ]
  }, null, 2));

  const result = runBridge(['--input', handoff, '--out', out, '--config-out', configOut, '--json']);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.schemaVersion, 'betterref.chrome.bridge.v1');
  assert.equal(payload.source.tool, '@chrome');
  assert.match(payload.screenshotPath, /chrome-viewport\.png$/);
  assert.match(payload.fullPageScreenshotPath, /chrome-full-page\.png$/);
  assert.match(payload.browserEvidencePath, /browser-evidence\.json$/);
  assert.match(payload.domBoxesPath, /chrome-dom-boxes\.json$/);
  assert.match(payload.configPath, /\.betterref\.json$/);

  const browserEvidence = JSON.parse(await readFile(path.join(out, 'browser-evidence.json'), 'utf8'));
  assert.equal(browserEvidence.source.tool, '@chrome');
  assert.equal(browserEvidence.viewport.width, 1440);
  assert.equal(browserEvidence.page.scrollHeight, 1780);
  assert.equal(browserEvidence.images[0].naturalWidth, 1920);
  assert.match(browserEvidence.screenshotPath, /chrome-viewport\.png$/);
  assert.match(browserEvidence.fullPageScreenshotPath, /chrome-full-page\.png$/);
  assert.equal(browserEvidence.sectionScreenshotPaths.length, 1);

  const domBoxes = JSON.parse(await readFile(path.join(out, 'chrome-dom-boxes.json'), 'utf8'));
  assert.equal(domBoxes.source.tool, '@chrome');
  assert.equal(domBoxes.elements.length, 2);

  const config = JSON.parse(await readFile(configOut, 'utf8'));
  assert.equal(config.viewport, '1440x900');
  assert.equal(config.matchSize, 'strict');
  assert.equal(config.regions.length, 2);
  assert.equal(config.regions[0].name, 'header');
  assert.equal(config.regions[1].source, '[data-betterref="hero"]');
});

test('betterref-chrome-bridge rejects metadata-only handoff without screenshot evidence', async () => {
  const dir = await makeCase('metadata-only');
  const handoff = path.join(dir, 'chrome-handoff.json');
  await writeFile(handoff, JSON.stringify({
    source: { tool: '@chrome' },
    viewport: { width: 1440, height: 900 },
    page: { scrollHeight: 1200, bodyTextLength: 100, interactiveCount: 4 },
    fonts: { ready: true },
    console: [],
    images: []
  }, null, 2));

  const result = runBridge(['--input', handoff, '--out', path.join(dir, '.betterref'), '--json']);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /missing viewport screenshot path/i);
});

test('betterref-chrome-bridge rejects missing screenshot files', async () => {
  const dir = await makeCase('missing-screenshot');
  const handoff = path.join(dir, 'chrome-handoff.json');
  await writeFile(handoff, JSON.stringify({
    source: { tool: '@chrome' },
    screenshots: { viewport: 'missing.png' },
    viewport: { width: 1440, height: 900 },
    page: { scrollHeight: 1200, bodyTextLength: 100, interactiveCount: 4 },
    fonts: { ready: true },
    console: [],
    images: []
  }, null, 2));

  const result = runBridge(['--input', handoff, '--out', path.join(dir, '.betterref'), '--json']);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /does not exist/i);
});
