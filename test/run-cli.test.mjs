import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createWriteStream } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import { WebSocketServer } from 'ws';

const repoRoot = path.resolve(import.meta.dirname, '..');
const runBin = path.join(repoRoot, 'bin', 'betterref-run.mjs');
const pngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

async function makeCase(name) {
  const dir = path.join(tmpdir(), `betterref-run-${process.pid}-${name}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

function writePdf(filePath, lines) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const stream = doc.pipe(createWriteStream(filePath));
    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.fontSize(18).text('BetterRef Run PRD');
    doc.moveDown();
    doc.fontSize(11);
    for (const line of lines) {
      doc.text(line);
    }
    doc.end();
  });
}

async function writePng(filePath, base64 = pngBase64) {
  await writeFile(filePath, Buffer.from(base64, 'base64'));
}

async function solidPngBase64(width, height, color) {
  const buffer = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: color
    }
  }).png().toBuffer();
  return buffer.toString('base64');
}

async function writeCheckerPng(filePath, width = 1920, height = 1080) {
  const channels = 3;
  const data = Buffer.alloc(width * height * channels);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * channels;
      const value = (Math.floor(x / 4) + Math.floor(y / 4)) % 2 === 0 ? 24 : 232;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
    }
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  await sharp(data, { raw: { width, height, channels } }).png().toFile(filePath);
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function runCli(args) {
  return spawnSync(process.execPath, [runBin, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 10000
  });
}

function runCliAsync(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [runBin, ...args], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), 10000);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      resolve({ status, signal, stdout, stderr });
    });
  });
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

async function closeServer(server, wss) {
  if (wss) {
    for (const client of wss.clients) {
      client.terminate();
    }
    await new Promise((resolve) => wss.close(resolve));
  }
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}

async function makeFakeChrome({ screenshot = pngBase64 } = {}) {
  let port;
  const target = () => ({
    id: 'page-1',
    type: 'page',
    title: 'ONETAPGG Local',
    url: 'http://127.0.0.1:3000/',
    webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/page-1`
  });
  const server = createServer((request, response) => {
    if (request.url === '/json/list') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify([target()]));
      return;
    }
    if (request.url === '/json/version') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ Browser: 'FakeChrome/1.0' }));
      return;
    }
    response.statusCode = 404;
    response.end('not found');
  });
  const wss = new WebSocketServer({ server, path: '/devtools/page/page-1' });
  wss.on('connection', (socket) => {
    socket.on('message', (message) => {
      const command = JSON.parse(message.toString());
      if (command.method === 'Runtime.evaluate') {
        socket.send(JSON.stringify({
          id: command.id,
          result: {
            result: {
              type: 'object',
              value: {
                viewport: {
                  width: 100,
                  height: 80,
                  deviceScaleFactor: 1,
                  scrollHeight: 160,
                  scrollX: 0,
                  scrollY: 0,
                  url: 'http://127.0.0.1:3000/',
                  title: 'ONETAPGG Local'
                },
                page: {
                  scrollWidth: 100,
                  scrollHeight: 160,
                  bodyTextLength: 24,
                  interactiveCount: 2
                },
                fonts: { ready: true, status: 'loaded' },
                images: [],
                console: [],
                elements: [
                  {
                    name: 'header',
                    selector: 'header',
                    boundingBox: { x: 0, y: 0, width: 100, height: 20 },
                    absoluteBox: { x: 0, y: 0, width: 100, height: 20 }
                  },
                  {
                    name: 'hero',
                    selector: '.hero',
                    boundingBox: { x: 0, y: 20, width: 100, height: 40 },
                    absoluteBox: { x: 0, y: 20, width: 100, height: 40 }
                  }
                ]
              }
            }
          }
        }));
        return;
      }
      if (command.method === 'Page.captureScreenshot') {
        socket.send(JSON.stringify({ id: command.id, result: { data: screenshot } }));
        return;
      }
      socket.send(JSON.stringify({ id: command.id, result: {} }));
    });
  });

  port = await listen(server);
  return {
    endpoint: `http://127.0.0.1:${port}`,
    close: () => closeServer(server, wss)
  };
}

test('betterref-run prints usage and exits with code 2 when required args are missing', () => {
  const result = runCli([]);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: betterref-run/);
  assert.match(result.stderr, /--pdf/);
  assert.match(result.stderr, /--project/);
  assert.match(result.stderr, /--ref/);
});

test('betterref-run bootstraps PRD artifacts and blocks on pending imagegen assets', async () => {
  const dir = await makeCase('imagegen-block');
  const project = path.join(dir, 'project');
  const pdf = path.join(dir, 'prd.pdf');
  const ref = path.join(dir, 'reference.png');
  await mkdir(project, { recursive: true });
  await writePng(ref);
  await writePdf(pdf, [
    'Viewport: 1440x900.',
    'Required screens: Homepage.',
    'Hero Image: premium 3D glass hero raster for the landing page.'
  ]);

  const result = runCli([
    '--pdf', pdf,
    '--project', project,
    '--ref', ref,
    '--url', 'http://127.0.0.1:3000/',
    '--json'
  ]);

  assert.equal(result.status, 3, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'blocked');
  assert.equal(payload.phase, 'assets');
  assert.equal(payload.exitCode, 3);
  assert.ok(payload.blockers.some((item) => item.code === 'blocked_external_asset_generation'));
  assert.match(payload.artifacts.agentsPath, /AGENTS\.md$/);
  assert.match(payload.artifacts.imagegenQueuePath, /imagegen-requests\.json$/);
  assert.match(payload.artifacts.imagegenHandoffRequestPath, /imagegen-handoff-request\.json$/);
  assert.match(payload.artifacts.imagegenHandoffPromptPath, /imagegen-handoff-prompt\.md$/);
  assert.match(payload.artifacts.imagegenStatusPath, /imagegen-status\.json$/);
  assert.match(payload.artifacts.imagegenGeneratedDir, /generated$/);
  assert.equal(await pathExists(path.join(project, 'AGENTS.md')), true);
  assert.equal(await pathExists(path.join(project, '.betterref-run', 'imagegen-handoff-request.json')), true);
  assert.equal(await pathExists(path.join(project, '.betterref-run', 'imagegen-handoff-prompt.md')), true);

  const queue = JSON.parse(await readFile(path.join(project, '.betterref-imagegen', 'imagegen-requests.json'), 'utf8'));
  assert.equal(queue.requests.length, 1);
  assert.match(queue.requests[0].outputSlot, /generated[\\/]asset-001\.png$/);
  const status = JSON.parse(await readFile(path.join(project, '.betterref-imagegen', 'imagegen-status.json'), 'utf8'));
  assert.equal(status.counts.pending, 1);
  const actions = await readFile(path.join(project, '.betterref-run', 'next-actions.md'), 'utf8');
  assert.match(actions, /image_gen/);
  assert.match(actions, /imagegen-handoff-request\.json/);
  assert.match(actions, /imagegen-status\.json/);
  assert.match(actions, /betterref-imagegen --asset-plan/);
  assert.match(actions, /--auto-attach-dir/);
});

test('betterref-run auto-attaches generated imagegen slots before browser evidence gate', async () => {
  const dir = await makeCase('imagegen-auto-resume');
  const project = path.join(dir, 'project');
  const pdf = path.join(dir, 'prd.pdf');
  const ref = path.join(dir, 'reference.png');
  const generated = path.join(project, '.betterref-imagegen', 'generated', 'asset-001.png');
  await mkdir(project, { recursive: true });
  await writePng(ref);
  await writeCheckerPng(generated);
  await writePdf(pdf, [
    'Viewport: 960x900.',
    'Hero Image: premium 3D glass hero raster for the landing page.'
  ]);

  const result = runCli([
    '--pdf', pdf,
    '--project', project,
    '--ref', ref,
    '--url', 'http://127.0.0.1:3000/',
    '--json'
  ]);

  assert.equal(result.status, 3, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.phase, 'browser');
  assert.ok(payload.steps.some((step) => step.name === 'imagegen-auto-attach' && step.attached === 1));
  assert.match(payload.artifacts.imagegenAutoAttach.attached[0].targetPath, /public\/betterref-assets\/cinematic-hero-01\.png/);
  assert.equal(await pathExists(path.join(project, 'public', 'betterref-assets', 'cinematic-hero-01.png')), true);

  const updatedPlan = JSON.parse(await readFile(path.join(project, '.betterref-prd', 'asset-plan.json'), 'utf8'));
  assert.equal(updatedPlan.assets[0].status, 'pass');
  assert.equal(updatedPlan.assets[0].verification, 'betterref-imagegen attach');
});

test('betterref-run writes HyperFrames requests and blocks without CLI evidence', async () => {
  const dir = await makeCase('hyperframes-block');
  const project = path.join(dir, 'project');
  const pdf = path.join(dir, 'prd.pdf');
  const ref = path.join(dir, 'reference.png');
  await mkdir(project, { recursive: true });
  await writePng(ref);
  await writePdf(pdf, [
    'Viewport: 1440x900.',
    'Hero Motion: animated cinematic 3D logo reveal with transparent WebM loop.'
  ]);

  const result = runCli([
    '--pdf', pdf,
    '--project', project,
    '--ref', ref,
    '--json'
  ]);

  assert.equal(result.status, 3, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'blocked');
  assert.equal(payload.phase, 'assets');
  assert.ok(payload.blockers.some((item) => item.code === 'blocked_external_asset_generation'));
  assert.match(payload.artifacts.hyperframesQueuePath, /hyperframes-requests\.json$/);

  const queue = JSON.parse(await readFile(path.join(project, '.betterref-hyperframes', 'hyperframes-requests.json'), 'utf8'));
  assert.equal(queue.requests.length, 1);
  const actions = await readFile(path.join(project, '.betterref-run', 'next-actions.md'), 'utf8');
  assert.match(actions, /npx hyperframes lint/);
  assert.match(actions, /betterref-hyperframes --asset-plan/);
});

test('betterref-run blocks with @chrome handoff when no endpoint is supplied', async () => {
  const dir = await makeCase('browser-block');
  const project = path.join(dir, 'project');
  const pdf = path.join(dir, 'prd.pdf');
  const ref = path.join(dir, 'reference.png');
  await mkdir(project, { recursive: true });
  await writePng(ref);
  await writePdf(pdf, ['Viewport: 1440x900.']);

  const result = runCli([
    '--pdf', pdf,
    '--project', project,
    '--ref', ref,
    '--url', 'http://127.0.0.1:3000/',
    '--json'
  ]);

  assert.equal(result.status, 3, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'blocked');
  assert.equal(payload.phase, 'browser');
  assert.ok(payload.blockers.some((item) => item.code === 'blocked_browser_evidence'));
  assert.match(payload.artifacts.chromeHandoffRequestPath, /chrome-handoff-request\.json$/);
  assert.match(payload.artifacts.chromeHandoffPromptPath, /chrome-handoff-prompt\.md$/);
  assert.equal(await pathExists(path.join(project, '.betterref-run', 'chrome-handoff-request.json')), true);
  assert.equal(await pathExists(path.join(project, '.betterref-run', 'chrome-handoff-prompt.md')), true);
  const actions = await readFile(path.join(project, '.betterref-run', 'next-actions.md'), 'utf8');
  assert.match(actions, /@chrome/);
  assert.match(actions, /--browser-handoff/);
  assert.match(actions, /chrome-handoff-request\.json/);
  assert.match(actions, /betterref-chrome/);
  assert.match(actions, /browser-evidence\.json/);
});

test('betterref-run accepts @chrome handoff evidence and completes final verification', async () => {
  const dir = await makeCase('browser-handoff-pass');
  const project = path.join(dir, 'project');
  const pdf = path.join(dir, 'prd.pdf');
  const ref = path.join(dir, 'reference.png');
  const screenshot = path.join(dir, 'chrome-viewport.png');
  const fullPage = path.join(dir, 'chrome-full-page.png');
  const handoff = path.join(dir, 'chrome-handoff.json');
  const screenshotBase64 = await solidPngBase64(100, 80, { r: 255, g: 255, b: 255 });
  await mkdir(project, { recursive: true });
  await writePng(ref, screenshotBase64);
  await writePng(screenshot, screenshotBase64);
  await writePng(fullPage, screenshotBase64);
  await writePdf(pdf, ['Viewport: 100x80.']);
  await writeFile(handoff, JSON.stringify({
    source: { tool: '@chrome' },
    screenshots: {
      viewport: screenshot,
      fullPage,
      sections: [
        { name: 'hero', selector: '.hero', path: screenshot, clip: { x: 0, y: 0, width: 100, height: 80 } }
      ]
    },
    viewport: { width: 100, height: 80, deviceScaleFactor: 1 },
    page: {
      url: 'http://127.0.0.1:3000/',
      title: 'ONETAPGG Local',
      scrollHeight: 80,
      bodyTextLength: 24,
      interactiveCount: 2
    },
    fonts: { ready: true, status: 'loaded' },
    console: [],
    network: { errors: [] },
    images: [],
    elements: [
      { name: 'hero', selector: '.hero', boundingBox: { x: 0, y: 0, width: 100, height: 80 } }
    ]
  }, null, 2));

  const result = runCli([
    '--pdf', pdf,
    '--project', project,
    '--ref', ref,
    '--url', 'http://127.0.0.1:3000/',
    '--browser-handoff', handoff,
    '--json'
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'pass');
  assert.equal(payload.exitCode, 0);
  assert.equal(payload.finalVerdict.verdict, 'pass');
  assert.match(payload.inputs.browserHandoff, /chrome-handoff\.json$/);
  assert.match(payload.artifacts.screenshotPath, /chrome-viewport\.png$/);
  assert.match(payload.artifacts.browserEvidencePath, /browser-evidence\.json$/);

  const evidence = JSON.parse(await readFile(path.join(project, '.betterref', 'browser-evidence.json'), 'utf8'));
  assert.equal(evidence.source.tool, '@chrome');
  assert.match(evidence.screenshotPath, /chrome-viewport\.png$/);
});

test('betterref-run returns pass after browser capture, guard, and final verify all pass', async () => {
  const dir = await makeCase('pass');
  const project = path.join(dir, 'project');
  const pdf = path.join(dir, 'prd.pdf');
  const ref = path.join(dir, 'reference.png');
  const screenshot = await solidPngBase64(100, 80, { r: 255, g: 255, b: 255 });
  await mkdir(project, { recursive: true });
  await writePng(ref, screenshot);
  await writePdf(pdf, ['Viewport: 100x80.']);
  const fakeChrome = await makeFakeChrome({ screenshot });
  try {
    const result = await runCliAsync([
      '--pdf', pdf,
      '--project', project,
      '--ref', ref,
      '--url', 'http://127.0.0.1:3000/',
      '--endpoint', fakeChrome.endpoint,
      '--json'
    ]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.status, 'pass');
    assert.equal(payload.exitCode, 0);
    assert.equal(payload.finalVerdict.verdict, 'pass');
    assert.deepEqual(payload.blockers, []);
    assert.match(payload.artifacts.reportPath, /report\.json$/);
    assert.match(payload.artifacts.guardReportPath, /guard-report\.json$/);
    assert.match(payload.artifacts.browserEvidencePath, /browser-evidence\.json$/);
    assert.match(payload.artifacts.finalVerdictPath, /final-verdict\.json$/);

    const summary = JSON.parse(await readFile(path.join(project, '.betterref-run', 'final-summary.json'), 'utf8'));
    assert.equal(summary.status, 'pass');
    assert.equal(summary.finalVerdict.verdict, 'pass');
  } finally {
    await fakeChrome.close();
  }
});

test('betterref-run returns exit 1 when final verify runs but PRD remains incomplete', async () => {
  const dir = await makeCase('revise');
  const project = path.join(dir, 'project');
  const pdf = path.join(dir, 'prd.pdf');
  const ref = path.join(dir, 'reference.png');
  const screenshot = await solidPngBase64(100, 80, { r: 255, g: 255, b: 255 });
  await mkdir(project, { recursive: true });
  await writePng(ref, screenshot);
  await writePdf(pdf, ['Viewport: 100x80.', 'Required screens: Homepage.']);
  const fakeChrome = await makeFakeChrome({ screenshot });
  try {
    const result = await runCliAsync([
      '--pdf', pdf,
      '--project', project,
      '--ref', ref,
      '--url', 'http://127.0.0.1:3000/',
      '--endpoint', fakeChrome.endpoint,
      '--json'
    ]);

    assert.equal(result.status, 1, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.status, 'revise');
    assert.equal(payload.phase, 'final');
    assert.equal(payload.exitCode, 1);
    assert.equal(payload.finalVerdict.verdict, 'revise');
    assert.ok(payload.finalVerdict.blockingReasons.some((item) => item.includes('prd-001')));
  } finally {
    await fakeChrome.close();
  }
});

test('betterref-run returns exit 1 when visual comparison fails after capture', async () => {
  const dir = await makeCase('visual-fail');
  const project = path.join(dir, 'project');
  const pdf = path.join(dir, 'prd.pdf');
  const ref = path.join(dir, 'reference.png');
  const screenshot = await solidPngBase64(100, 80, { r: 255, g: 255, b: 255 });
  const blackReference = await solidPngBase64(100, 80, { r: 0, g: 0, b: 0 });
  await mkdir(project, { recursive: true });
  await writePng(ref, blackReference);
  await writePdf(pdf, ['Viewport: 100x80.']);
  const fakeChrome = await makeFakeChrome({ screenshot });
  try {
    const result = await runCliAsync([
      '--pdf', pdf,
      '--project', project,
      '--ref', ref,
      '--url', 'http://127.0.0.1:3000/',
      '--endpoint', fakeChrome.endpoint,
      '--json'
    ]);

    assert.equal(result.status, 1, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.status, 'fail');
    assert.equal(payload.phase, 'final');
    assert.equal(payload.exitCode, 1);
    assert.equal(payload.finalVerdict.verdict, 'fail');
    assert.ok(payload.finalVerdict.blockingReasons.some((item) => /visual/i.test(item)));
  } finally {
    await fakeChrome.close();
  }
});
