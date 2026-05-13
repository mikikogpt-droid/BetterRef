import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { WebSocketServer } from 'ws';

const repoRoot = path.resolve(import.meta.dirname, '..');
const chromeBin = path.join(repoRoot, 'bin', 'betterref-chrome.mjs');
const chromeCliTimeoutMs = 60000;
const pngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';

async function makeCase(name) {
  const dir = path.join(tmpdir(), `betterref-chrome-${process.pid}-${name}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function runCli(args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [chromeBin, ...args], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), chromeCliTimeoutMs);
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

async function makeFakeChrome({ withWebSocket = false } = {}) {
  let port;
  const commands = [];
  const target = () => ({
    id: 'page-1',
    type: 'page',
    title: 'Example Page',
    url: 'http://example.test/dashboard',
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
  let wss = null;

  if (withWebSocket) {
    wss = new WebSocketServer({ server, path: '/devtools/page/page-1' });
    wss.on('connection', (socket) => {
      socket.on('message', (message) => {
        const command = JSON.parse(message.toString());
        commands.push(command);
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
                    url: 'http://example.test/dashboard',
                    title: 'Example Page'
                  },
                  page: {
                    scrollWidth: 100,
                    scrollHeight: 160,
                    bodyTextLength: 24,
                    interactiveCount: 2
                  },
                  fonts: { ready: true, status: 'loaded' },
                  images: [
                    {
                      src: 'http://example.test/hero.png',
                      naturalWidth: 200,
                      naturalHeight: 100,
                      renderedWidth: 100,
                      renderedHeight: 50
                    }
                  ],
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
          socket.send(JSON.stringify({ id: command.id, result: { data: pngBase64 } }));
          return;
        }
        socket.send(JSON.stringify({ id: command.id, result: {} }));
      });
    });
  }

  port = await listen(server);
  return {
    endpoint: `http://127.0.0.1:${port}`,
    commands,
    close: () => closeServer(server, wss)
  };
}

test('betterref-chrome prints usage and exits with code 2 when required args are missing', () => {
  const result = spawnSync(process.execPath, [chromeBin], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: chromeCliTimeoutMs
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Usage: betterref-chrome/);
  assert.match(result.stderr, /--out/);
  assert.match(result.stderr, /--endpoint/);
});

test('betterref-chrome lists Chrome targets from a CDP endpoint', async () => {
  const fakeChrome = await makeFakeChrome();
  try {
    const result = await runCli([
      '--endpoint',
      fakeChrome.endpoint,
      '--out',
      await makeCase('list'),
      '--list',
      '--json'
    ]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.targets.length, 1);
    assert.equal(payload.targets[0].id, 'page-1');
    assert.equal(payload.targets[0].url, 'http://example.test/dashboard');
  } finally {
    await fakeChrome.close();
  }
});

test('betterref-chrome captures screenshot and DOM boxes from selected Chrome target', async () => {
  const fakeChrome = await makeFakeChrome({ withWebSocket: true });
  const out = await makeCase('capture');
  try {
    const result = await runCli([
      '--endpoint',
      fakeChrome.endpoint,
      '--out',
      out,
      '--url-match',
      'dashboard',
      '--selector',
      'header=header',
      '--selector',
      'hero=.hero',
      '--json'
    ]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.target.id, 'page-1');
    assert.match(payload.artifacts.screenshotPath, /chrome-screenshot\.png$/);
    assert.match(payload.artifacts.domBoxesPath, /chrome-dom-boxes\.json$/);
    assert.match(payload.artifacts.browserEvidencePath, /browser-evidence\.json$/);
    assert.match(payload.artifacts.configPath, /\.betterref\.json$/);
    const screenshot = await readFile(path.join(out, 'chrome-screenshot.png'));
    assert.ok(screenshot.length > 0);
    const domBoxes = JSON.parse(await readFile(path.join(out, 'chrome-dom-boxes.json'), 'utf8'));
    assert.equal(domBoxes.viewport.width, 100);
    assert.equal(domBoxes.elements.length, 2);
    const evidence = JSON.parse(await readFile(path.join(out, 'browser-evidence.json'), 'utf8'));
    assert.equal(evidence.page.scrollHeight, 160);
    assert.equal(evidence.fonts.ready, true);
    assert.equal(evidence.images[0].naturalWidth, 200);
    const config = JSON.parse(await readFile(path.join(out, '.betterref.json'), 'utf8'));
    assert.equal(config.viewport, '100x80');
    assert.equal(config.regions[0].name, 'header');
    assert.equal(config.regions[1].name, 'hero');
  } finally {
    await fakeChrome.close();
  }
});

test('betterref-chrome can capture full-page and section screenshots from DOM evidence', async () => {
  const fakeChrome = await makeFakeChrome({ withWebSocket: true });
  const out = await makeCase('full-page-sections');
  try {
    const result = await runCli([
      '--endpoint',
      fakeChrome.endpoint,
      '--out',
      out,
      '--url-match',
      'dashboard',
      '--selector',
      'header=header',
      '--selector',
      'hero=.hero',
      '--full-page',
      '--section-screenshots',
      '--json'
    ]);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.match(payload.artifacts.fullPageScreenshotPath, /chrome-full-page\.png$/);
    assert.equal(payload.artifacts.sectionScreenshotPaths.length, 2);
    assert.match(payload.artifacts.sectionScreenshotPaths[0].path, /sections[\\/]+header\.png$/);
    assert.match(payload.artifacts.sectionScreenshotPaths[1].path, /sections[\\/]+hero\.png$/);
    const fullPage = await readFile(path.join(out, 'chrome-full-page.png'));
    const header = await readFile(path.join(out, 'sections', 'header.png'));
    const hero = await readFile(path.join(out, 'sections', 'hero.png'));
    assert.ok(fullPage.length > 0);
    assert.ok(header.length > 0);
    assert.ok(hero.length > 0);

    const screenshots = fakeChrome.commands.filter((command) => command.method === 'Page.captureScreenshot');
    assert.equal(screenshots.length, 4);
    assert.equal(screenshots.some((command) => command.params.captureBeyondViewport === true), true);
    const clips = screenshots.map((command) => command.params.clip).filter(Boolean);
    assert.deepEqual(clips.map((clip) => [clip.x, clip.y, clip.width, clip.height, clip.scale]), [
      [0, 0, 100, 20, 1],
      [0, 20, 100, 40, 1]
    ]);
  } finally {
    await fakeChrome.close();
  }
});
