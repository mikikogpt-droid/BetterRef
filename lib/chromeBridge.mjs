import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildRegionConfig } from './regions.mjs';

export class BetterRefChromeBridgeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BetterRefChromeBridgeError';
  }
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new BetterRefChromeBridgeError(`Could not read Chrome handoff ${filePath}: ${error.message}`);
  }
}

function asArray(value) {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function normalizeViewport(input) {
  const viewport = input.viewport || input.page?.viewport;
  const width = Number(viewport?.width ?? viewport?.w);
  const height = Number(viewport?.height ?? viewport?.h);
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new BetterRefChromeBridgeError('Chrome handoff is missing a valid viewport.');
  }
  const result = { width, height };
  const deviceScaleFactor = Number(viewport?.deviceScaleFactor ?? viewport?.scale);
  if (Number.isFinite(deviceScaleFactor) && deviceScaleFactor > 0) {
    result.deviceScaleFactor = deviceScaleFactor;
  }
  return result;
}

function normalizePage(input) {
  const page = input.page || {};
  return {
    url: page.url || input.url || null,
    title: page.title || input.title || null,
    scrollHeight: Number(page.scrollHeight ?? input.scrollHeight ?? 0),
    bodyTextLength: Number(page.bodyTextLength ?? input.bodyTextLength ?? 0),
    interactiveCount: Number(page.interactiveCount ?? input.interactiveCount ?? 0)
  };
}

function normalizeNetwork(input) {
  const network = input.network || {};
  return {
    ...network,
    errors: asArray(network.errors || input.networkErrors)
  };
}

function normalizeElements(input) {
  return asArray(input.elements || input.boxes || input.regions).map((element, index) => ({
    name: element.name || element.label || element.id || element.selector || `region-${index + 1}`,
    selector: element.selector || null,
    rect: element.rect || element.boundingBox || element.bounds || element.box || element
  }));
}

export async function bridgeChromeHandoff(options) {
  if (!options.inputPath) {
    throw new BetterRefChromeBridgeError('Missing --input.');
  }
  if (!options.outDir) {
    throw new BetterRefChromeBridgeError('Missing --out.');
  }

  const input = await readJson(options.inputPath);
  const generatedAt = new Date().toISOString();
  const viewport = normalizeViewport(input);
  const page = normalizePage(input);
  const source = {
    tool: input.source?.tool || input.tool || '@chrome',
    capturedAt: input.source?.capturedAt || input.capturedAt || generatedAt,
    url: page.url,
    title: page.title
  };

  const browserEvidence = {
    schemaVersion: 'betterref.browser.evidence.v1',
    source,
    viewport,
    page,
    fonts: input.fonts || {},
    console: asArray(input.console),
    network: normalizeNetwork(input),
    images: asArray(input.images)
  };

  const domBoxes = {
    schemaVersion: 'betterref.chrome.dom.boxes.v1',
    source,
    viewport,
    elements: normalizeElements(input)
  };

  await mkdir(options.outDir, { recursive: true });
  const browserEvidencePath = path.join(options.outDir, 'browser-evidence.json');
  const domBoxesPath = path.join(options.outDir, 'chrome-dom-boxes.json');
  await writeFile(browserEvidencePath, `${JSON.stringify(browserEvidence, null, 2)}\n`);
  await writeFile(domBoxesPath, `${JSON.stringify(domBoxes, null, 2)}\n`);

  let configPath = null;
  let regionCount = 0;
  if (options.configOutPath) {
    const config = await buildRegionConfig({
      inputPath: domBoxesPath,
      viewport,
      matchSize: options.matchSize || 'strict',
      thresholds: options.thresholds || {},
      strictBounds: Boolean(options.strictBounds)
    });
    config.metadata = {
      ...(config.metadata || {}),
      generatedBy: 'betterref-chrome-bridge',
      sourceTool: source.tool
    };
    await writeFile(options.configOutPath, `${JSON.stringify(config, null, 2)}\n`);
    configPath = path.resolve(options.configOutPath);
    regionCount = config.regions.length;
  }

  return {
    schemaVersion: 'betterref.chrome.bridge.v1',
    generatedAt,
    source,
    browserEvidencePath: path.resolve(browserEvidencePath),
    domBoxesPath: path.resolve(domBoxesPath),
    configPath,
    regionCount
  };
}

