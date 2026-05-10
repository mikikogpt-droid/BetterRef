import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const captureBin = path.join(repoRoot, 'bin', 'betterref-capture.mjs');

async function makeCase(name) {
  const dir = path.join(tmpdir(), `betterref-capture-${process.pid}-${name}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

test('betterref-capture prints usage and exits with code 2 when required args are missing', () => {
  const result = spawnSync(process.execPath, [captureBin], {
    cwd: repoRoot,
    encoding: 'utf8'
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: betterref-capture/);
  assert.match(result.stderr, /--config/);
  assert.match(result.stderr, /--regions/);
  assert.match(result.stderr, /--min-ssim/);
  assert.match(result.stderr, /--match-size/);
});

test('betterref-capture explains how to install Playwright when it is unavailable', () => {
  const result = spawnSync(process.execPath, [
    captureBin,
    '--url',
    'http://127.0.0.1:1/',
    '--out',
    path.join(repoRoot, '.tmp-capture-test')
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      BETTERREF_FORCE_NO_PLAYWRIGHT: '1'
    }
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Install Playwright/);
});

test('betterref-capture writes browser evidence using project-local Playwright', async () => {
  const project = await makeCase('project-local-playwright');
  const out = path.join(project, 'out');
  const moduleDir = path.join(project, 'node_modules', 'playwright');
  await mkdir(moduleDir, { recursive: true });
  await writeFile(path.join(project, 'package.json'), '{"type":"commonjs"}\n');
  await writeFile(
    path.join(moduleDir, 'index.js'),
    `
const fs = require('node:fs/promises');
exports.chromium = {
  async launch() {
    return {
      async newContext() {
        return {
          async newPage() {
            const handlers = {};
            const sectionHandle = {
              async evaluate() {
                return {
                  boundingBox: { x: 0, y: 20, width: 320, height: 180 },
                  absoluteBox: { x: 0, y: 120, width: 320, height: 180 },
                  tagName: 'SECTION',
                  text: 'Hero'
                };
              },
              async screenshot({ path }) {
                await fs.writeFile(path, Buffer.from('section'));
              }
            };
            const page = {
              __betterrefConsole: [],
              __betterrefNetwork: [],
              on(event, handler) {
                handlers[event] = handler;
              },
              async goto() {
                handlers.response?.({
                  status: () => 404,
                  statusText: () => 'Not Found',
                  url: () => 'http://127.0.0.1:3000/missing-hero.png',
                  request: () => ({
                    method: () => 'GET',
                    resourceType: () => 'image'
                  })
                });
              },
              async screenshot({ path }) {
                await fs.writeFile(path, Buffer.from('png'));
              },
              async $$(selector) {
                return selector.includes('hero') ? [sectionHandle] : [];
              },
              async evaluate() {
                return {
                  viewport: { width: 1440, height: 900, deviceScaleFactor: 1, scrollHeight: 1800, scrollX: 0, scrollY: 0, url: 'http://127.0.0.1:3000/', title: 'Test' },
                  page: { scrollWidth: 1440, scrollHeight: 1800, clientWidth: 1440, clientHeight: 900, bodyTextLength: 128, interactiveCount: 3 },
                  fonts: { ready: true, status: 'loaded' },
                  images: [{ src: '/hero.png', naturalWidth: 1920, naturalHeight: 1080, renderedWidth: 640, renderedHeight: 360 }],
                  assets: { rendered: [{ src: '/bg.png', renderedWidth: 1440, renderedHeight: 900, sourceType: 'css-background' }] }
                };
              }
            };
            return page;
          },
          async close() {}
        };
      },
      async close() {}
    };
  }
};
`
  );

  const result = spawnSync(process.execPath, [
    captureBin,
    '--url',
    'http://127.0.0.1:3000/',
    '--out',
    out,
    '--full-page',
    '--section-screenshots',
    '--selector',
    'hero=[data-betterref="hero"]',
    '--json'
  ], {
    cwd: project,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.match(payload.browserEvidencePath, /browser-evidence\.json$/);
  assert.match(payload.fullPageScreenshotPath, /screenshot\.png$/);
  assert.match(payload.sectionScreenshotPaths[0].path, /sections[\\/]hero\.png$/);
  const evidence = JSON.parse(await readFile(path.join(out, 'browser-evidence.json'), 'utf8'));
  assert.equal(evidence.page.bodyTextLength, 128);
  assert.equal(evidence.images[0].naturalWidth, 1920);
  assert.equal(evidence.assets.rendered[0].sourceType, 'css-background');
  assert.equal(evidence.network.errors[0].status, 404);
  assert.match(evidence.network.errors[0].url, /missing-hero\.png/);
  assert.equal(evidence.sectionScreenshotPaths[0].clip.y, 120);
  assert.match(evidence.fullPageScreenshotPath, /screenshot\.png$/);
});
