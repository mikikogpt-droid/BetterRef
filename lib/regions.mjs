import { readFile, writeFile } from 'node:fs/promises';

export class BetterRefRegionsError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BetterRefRegionsError';
  }
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new BetterRefRegionsError(`Could not read JSON ${filePath}: ${error.message}`);
  }
}

function parseViewport(value, label = 'viewport') {
  if (!value) {
    throw new BetterRefRegionsError(`Missing ${label}. Provide --viewport WxH or include viewport in the input/merge config.`);
  }

  if (typeof value === 'string') {
    const match = /^(\d+)x(\d+)$/i.exec(value.trim());
    if (!match) {
      throw new BetterRefRegionsError(`${label} must use WxH format.`);
    }
    return { width: Number(match[1]), height: Number(match[2]) };
  }

  if (Array.isArray(value) && value.length >= 2) {
    return { width: Number(value[0]), height: Number(value[1]) };
  }

  if (typeof value === 'object') {
    return {
      width: Number(value.width ?? value.w),
      height: Number(value.height ?? value.h)
    };
  }

  throw new BetterRefRegionsError(`${label} must be a string, array, or object.`);
}

function viewportString(viewport) {
  if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0) {
    throw new BetterRefRegionsError('Viewport width and height must be positive finite numbers.');
  }
  return `${Math.round(viewport.width)}x${Math.round(viewport.height)}`;
}

function pickBoxes(input) {
  if (Array.isArray(input)) {
    return input;
  }

  for (const key of ['elements', 'boxes', 'regions', 'nodes']) {
    if (Array.isArray(input?.[key])) {
      return input[key];
    }
  }

  throw new BetterRefRegionsError('Input JSON must be an array or contain elements, boxes, regions, or nodes.');
}

function rectFromBox(box) {
  const source = box.rect || box.boundingBox || box.bounds || box.box || box;
  const x = Number(source.x ?? source.left);
  const y = Number(source.y ?? source.top);
  const width = source.width !== undefined ? Number(source.width) : Number(source.right) - x;
  const height = source.height !== undefined ? Number(source.height) : Number(source.bottom) - y;
  return { x, y, width, height };
}

function regionName(box, index) {
  const name = box.name || box.label || box.id || box.selector || `region-${index + 1}`;
  return String(name).trim();
}

function normalizeRegion(box, index, viewport, options) {
  const rect = rectFromBox(box);
  for (const key of ['x', 'y', 'width', 'height']) {
    if (!Number.isFinite(rect[key])) {
      throw new BetterRefRegionsError(`${regionName(box, index)} has invalid ${key}.`);
    }
  }

  let x = Math.round(rect.x);
  let y = Math.round(rect.y);
  let width = Math.round(rect.width);
  let height = Math.round(rect.height);
  const name = regionName(box, index);

  if (!name) {
    throw new BetterRefRegionsError(`Region ${index + 1} is missing a name.`);
  }
  if (width <= 0 || height <= 0) {
    return null;
  }

  const viewportWidth = Math.round(viewport.width);
  const viewportHeight = Math.round(viewport.height);
  const outside = x < 0 || y < 0 || x + width > viewportWidth || y + height > viewportHeight;
  if (outside && options.strictBounds) {
    throw new BetterRefRegionsError(`${name} is outside viewport ${viewportWidth}x${viewportHeight}.`);
  }

  const right = Math.min(viewportWidth, Math.max(0, x + width));
  const bottom = Math.min(viewportHeight, Math.max(0, y + height));
  x = Math.max(0, x);
  y = Math.max(0, y);
  width = right - x;
  height = bottom - y;

  if (width <= 0 || height <= 0) {
    return null;
  }

  const region = {
    name,
    x,
    y,
    width,
    height,
    weight: box.weight === undefined ? 1 : Number(box.weight)
  };

  if (box.thresholds) {
    region.thresholds = box.thresholds;
  }
  if (box.selector) {
    region.source = String(box.selector);
  }

  return region;
}

function mergeThresholds(baseThresholds, cliThresholds) {
  return Object.keys(cliThresholds).length > 0
    ? { ...(baseThresholds || {}), ...cliThresholds }
    : baseThresholds;
}

export async function buildRegionConfig(options) {
  const input = await readJson(options.inputPath);
  const mergeConfig = options.mergePath ? await readJson(options.mergePath) : {};
  const viewport = parseViewport(options.viewport || input.viewport || mergeConfig.viewport);
  const boxes = pickBoxes(input);
  const regions = boxes
    .map((box, index) => normalizeRegion(box, index, viewport, options))
    .filter(Boolean);

  if (regions.length === 0) {
    throw new BetterRefRegionsError('No visible regions found in input JSON.');
  }

  const config = {
    ...mergeConfig,
    viewport: viewportString(viewport),
    matchSize: options.matchSize || mergeConfig.matchSize || 'strict',
    thresholds: mergeThresholds(mergeConfig.thresholds, options.thresholds || {}),
    regions,
    metadata: {
      ...(mergeConfig.metadata || {}),
      generatedBy: 'betterref-regions',
      generatedAt: new Date().toISOString(),
      source: options.inputPath
    }
  };

  if (!config.thresholds) {
    delete config.thresholds;
  }

  return config;
}

export async function writeRegionConfig(options) {
  if (!options.inputPath) {
    throw new BetterRefRegionsError('Missing --input.');
  }
  if (!options.outPath) {
    throw new BetterRefRegionsError('Missing --out.');
  }

  const config = await buildRegionConfig(options);
  await writeFile(options.outPath, `${JSON.stringify(config, null, 2)}\n`);
  return config;
}
