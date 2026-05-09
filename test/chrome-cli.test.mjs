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
    const timer = setTimeout(() => child.kill('SIGTERM'), 5000);
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
                    scrollX: 0,
                    scrollY: 0,
                    url: 'http://example.test/dashboard',
                    title: 'Example Page'
                  },
                  elements: [
                    {
                      name: 'header',
                      selector: 'header',
                      boundingBox: { x: 0, y: 0, width: 100, height: 20 }
                    },
                    {
                      name: 'hero',
                      selector: '.hero',
                      boundingBox: { x: 0, y: 20, width: 100, height: 40 }
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
    close: () => closeServer(server, wss)
  };
}

test('betterref-chrome prints usage and exits with code 2 when required args are missing', () => {
  const result = spawnSync(process.execPath, [chromeBin], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 5000
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
    assert.match(payload.artifacts.configPath, /\.betterref\.json$/);
    const screenshot = await readFile(path.join(out, 'chrome-screenshot.png'));
    assert.ok(screenshot.length > 0);
    const domBoxes = JSON.parse(await readFile(path.join(out, 'chrome-dom-boxes.json'), 'utf8'));
    assert.equal(domBoxes.viewport.width, 100);
    assert.equal(domBoxes.elements.length, 2);
    const config = JSON.parse(await readFile(path.join(out, '.betterref.json'), 'utf8'));
    assert.equal(config.viewport, '100x80');
    assert.equal(config.regions[0].name, 'header');
    assert.equal(config.regions[1].name, 'hero');
  } finally {
    await fakeChrome.close();
  }
});
