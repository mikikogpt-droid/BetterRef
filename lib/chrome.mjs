import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import WebSocket from 'ws';
import { compareImages } from './diff.mjs';
import { writeRegionConfig } from './regions.mjs';

export class BetterRefChromeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BetterRefChromeError';
  }
}

const defaultSelectors = [
  { name: 'header', selector: 'header,[role="banner"],.header,.site-header' },
  { name: 'nav', selector: 'nav,[role="navigation"]' },
  { name: 'hero', selector: '[data-betterref="hero"],.hero,[class*="hero"]' },
  { name: 'main', selector: 'main,[role="main"]' },
  { name: 'footer', selector: 'footer,[role="contentinfo"]' }
];

async function fetchJson(url) {
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new BetterRefChromeError(`Could not connect to Chrome CDP endpoint ${url}: ${error.message}`);
  }

  if (!response.ok) {
    throw new BetterRefChromeError(`Chrome CDP endpoint ${url} returned HTTP ${response.status}.`);
  }
  return response.json();
}

function endpointUrl(endpoint, route) {
  return new URL(route, endpoint.endsWith('/') ? endpoint : `${endpoint}/`).href;
}

export async function listChromeTargets(endpoint = 'http://127.0.0.1:9222') {
  const targets = await fetchJson(endpointUrl(endpoint, 'json/list'));
  return targets.filter((target) => target.type === 'page' && target.webSocketDebuggerUrl);
}

export function selectChromeTarget(targets, options = {}) {
  if (targets.length === 0) {
    throw new BetterRefChromeError('No debuggable Chrome page targets found.');
  }

  if (options.targetId) {
    const target = targets.find((candidate) => candidate.id === options.targetId);
    if (!target) {
      throw new BetterRefChromeError(`No Chrome target found with id ${options.targetId}.`);
    }
    return target;
  }

  if (options.urlMatch) {
    const target = targets.find((candidate) => String(candidate.url || '').includes(options.urlMatch));
    if (!target) {
      throw new BetterRefChromeError(`No Chrome target URL matched ${options.urlMatch}.`);
    }
    return target;
  }

  if (options.titleMatch) {
    const target = targets.find((candidate) => String(candidate.title || '').includes(options.titleMatch));
    if (!target) {
      throw new BetterRefChromeError(`No Chrome target title matched ${options.titleMatch}.`);
    }
    return target;
  }

  return targets[0];
}

function asArray(value) {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

export function parseSelectorSpecs(values) {
  const items = asArray(values);
  if (items.length === 0) {
    return defaultSelectors;
  }

  return items.map((item) => {
    const text = String(item);
    const separator = text.indexOf('=');
    if (separator <= 0 || separator === text.length - 1) {
      throw new BetterRefChromeError('--selector must use name=css format.');
    }
    return {
      name: text.slice(0, separator).trim(),
      selector: text.slice(separator + 1).trim()
    };
  });
}

class CdpClient {
  constructor(webSocketUrl) {
    this.webSocketUrl = webSocketUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.socket = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(this.webSocketUrl);
      this.socket = socket;
      socket.once('open', resolve);
      socket.once('error', reject);
      socket.on('message', (message) => this.handleMessage(message));
      socket.on('close', () => {
        for (const { reject: rejectPending } of this.pending.values()) {
          rejectPending(new BetterRefChromeError('Chrome CDP WebSocket closed before command completed.'));
        }
        this.pending.clear();
      });
    });
  }

  handleMessage(message) {
    const payload = JSON.parse(message.toString());
    if (!payload.id || !this.pending.has(payload.id)) {
      return;
    }
    const { resolve, reject } = this.pending.get(payload.id);
    this.pending.delete(payload.id);
    if (payload.error) {
      reject(new BetterRefChromeError(payload.error.message || `CDP command ${payload.id} failed.`));
      return;
    }
    resolve(payload.result || {});
  }

  send(method, params = {}) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new BetterRefChromeError('Chrome CDP WebSocket is not open.');
    }

    const id = this.nextId;
    this.nextId += 1;
    const message = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(message, (error) => {
        if (!error) {
          return;
        }
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  close() {
    this.socket?.close();
  }
}

function buildMeasurementExpression(selectors) {
  return `(() => {
    const specs = ${JSON.stringify(selectors)};
    const elements = [];
    for (const spec of specs) {
      const matches = Array.from(document.querySelectorAll(spec.selector));
      matches.forEach((element, index) => {
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        elements.push({
          name: index === 0 ? spec.name : spec.name + '-' + (index + 1),
          selector: spec.selector,
          boundingBox: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height
          },
          tagName: element.tagName,
          text: (element.innerText || element.textContent || '').trim().slice(0, 120)
        });
      });
    }
    const doc = document.documentElement;
    const body = document.body;
    const images = Array.from(document.images || []).map((image) => {
      const rect = image.getBoundingClientRect();
      return {
        src: image.currentSrc || image.src || '',
        alt: image.alt || '',
        naturalWidth: image.naturalWidth || 0,
        naturalHeight: image.naturalHeight || 0,
        renderedWidth: rect.width || image.clientWidth || 0,
        renderedHeight: rect.height || image.clientHeight || 0
      };
    });
    const interactiveSelector = 'a,button,input,select,textarea,[role="button"],[tabindex]:not([tabindex="-1"])';
    return {
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        deviceScaleFactor: window.devicePixelRatio || 1,
        scrollHeight: Math.max(doc?.scrollHeight || 0, body?.scrollHeight || 0),
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        url: location.href,
        title: document.title
      },
      page: {
        scrollWidth: Math.max(doc?.scrollWidth || 0, body?.scrollWidth || 0),
        scrollHeight: Math.max(doc?.scrollHeight || 0, body?.scrollHeight || 0),
        clientWidth: doc?.clientWidth || window.innerWidth,
        clientHeight: doc?.clientHeight || window.innerHeight,
        bodyTextLength: (body?.innerText || body?.textContent || '').trim().length,
        interactiveCount: document.querySelectorAll(interactiveSelector).length
      },
      fonts: {
        ready: document.fonts ? document.fonts.status === 'loaded' : true,
        status: document.fonts ? document.fonts.status : 'unsupported'
      },
      images,
      console: Array.isArray(window.__betterrefConsoleErrors) ? window.__betterrefConsoleErrors : [],
      elements
    };
  })()`;
}

async function wait(ms) {
  if (!ms) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function captureChrome(options) {
  const {
    endpoint = 'http://127.0.0.1:9222',
    outDir,
    selectors,
    waitMs = 0,
    targetId,
    urlMatch,
    titleMatch,
    referencePath,
    mergeConfigPath,
    regionMode,
    html = false,
    matchSize,
    maxChangedPercent,
    maxMeanDiff,
    minSsim,
    pixelThreshold
  } = options;

  if (!outDir) {
    throw new BetterRefChromeError('Missing --out.');
  }

  await mkdir(outDir, { recursive: true });
  const targets = await listChromeTargets(endpoint);
  const target = selectChromeTarget(targets, { targetId, urlMatch, titleMatch });
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();

  try {
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Page.bringToFront');
    await wait(waitMs);

    const selectorSpecs = parseSelectorSpecs(selectors);
    const evaluation = await client.send('Runtime.evaluate', {
      expression: buildMeasurementExpression(selectorSpecs),
      returnByValue: true,
      awaitPromise: true
    });
    if (evaluation.exceptionDetails) {
      throw new BetterRefChromeError('Chrome DOM measurement failed.');
    }

    const domBoxes = evaluation.result?.value;
    if (!domBoxes || !domBoxes.viewport || !Array.isArray(domBoxes.elements)) {
      throw new BetterRefChromeError('Chrome DOM measurement returned an unexpected shape.');
    }

    const screenshot = await client.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false
    });
    if (!screenshot.data) {
      throw new BetterRefChromeError('Chrome did not return screenshot data.');
    }

    const screenshotPath = path.join(outDir, 'chrome-screenshot.png');
    const domBoxesPath = path.join(outDir, 'chrome-dom-boxes.json');
    const browserEvidencePath = path.join(outDir, 'browser-evidence.json');
    const configPath = path.join(outDir, '.betterref.json');
    await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
    await writeFile(domBoxesPath, `${JSON.stringify(domBoxes, null, 2)}\n`);
    await writeFile(browserEvidencePath, `${JSON.stringify({
      viewport: domBoxes.viewport,
      page: domBoxes.page || {},
      fonts: domBoxes.fonts || {},
      images: domBoxes.images || [],
      console: domBoxes.console || [],
      elements: domBoxes.elements || []
    }, null, 2)}\n`);
    const config = await writeRegionConfig({
      inputPath: domBoxesPath,
      outPath: configPath,
      mergePath: mergeConfigPath,
      matchSize
    });

    const result = {
      schemaVersion: 'betterref.chrome.v1',
      generatedAt: new Date().toISOString(),
      endpoint,
      target: {
        id: target.id,
        type: target.type,
        title: target.title,
        url: target.url
      },
      selectors: selectorSpecs,
      viewport: domBoxes.viewport,
      artifacts: {
        screenshotPath,
        domBoxesPath,
        browserEvidencePath,
        configPath,
        reportPath: null,
        htmlPath: null
      },
      regionConfig: config,
      diff: null
    };

    if (referencePath) {
      result.diff = await compareImages({
        referencePath,
        actualPath: screenshotPath,
        outDir,
        configPath,
        regionMode,
        html,
        matchSize,
        maxChangedPercent,
        maxMeanDiff,
        minSsim,
        pixelThreshold
      });
      result.artifacts.reportPath = result.diff.artifacts.reportPath;
      result.artifacts.htmlPath = result.diff.artifacts.htmlPath;
    }

    return result;
  } finally {
    client.close();
  }
}
