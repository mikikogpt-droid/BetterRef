import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';

const repoRoot = path.resolve(import.meta.dirname, '..');
const guardBin = path.join(repoRoot, 'bin', 'betterref-guard.mjs');

async function makeCase(name) {
  const dir = path.join(tmpdir(), `betterref-guard-${process.pid}-${name}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

async function writeJson(filePath, value) {
  await writeFile(filePath, JSON.stringify(value, null, 2));
}

function runGuard(args) {
  return spawnSync(process.execPath, [guardBin, ...args], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
}

async function writeCheckerPng(filePath, options = {}) {
  const size = 96;
  const channels = 3;
  const data = Buffer.alloc(size * size * channels);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = (y * size + x) * channels;
      const value = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0 ? 24 : 232;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
    }
  }

  let image = sharp(data, { raw: { width: size, height: size, channels } });
  if (options.blur) {
    image = image.blur(8);
  }
  await image.png().toFile(filePath);
}

test('betterref-guard hard fails when source uses reference assets despite a passing score', async () => {
  const dir = await makeCase('reference-reuse');
  const project = path.join(dir, 'project');
  await mkdir(path.join(project, 'src'), { recursive: true });
  await writeFile(
    path.join(project, 'src', 'page.tsx'),
    "export default function Page(){return <img src='/assets/reference/homepage.png' />;}"
  );
  const report = path.join(dir, 'report.json');
  const config = path.join(dir, 'guard.json');
  const out = path.join(dir, 'guard-report.json');
  await writeJson(report, {
    passed: true,
    mode: 'single_viewport',
    verdict: { verdict: 'pass', score: 99, hard_fail_present: false, hardFailHints: [] }
  });
  await writeJson(config, {
    forbiddenSourcePatterns: ['assets/reference', 'homepage-reference', 'pdf-render'],
    sourceExtensions: ['.tsx']
  });

  const result = runGuard(['--project', project, '--report', report, '--config', config, '--out', out, '--json']);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const guardReport = JSON.parse(await readFile(out, 'utf8'));
  assert.equal(guardReport.passed, false);
  assert.equal(guardReport.hardFailPresent, true);
  assert.ok(guardReport.hardFails.some((item) => item.code === 'reference_asset_used_in_source'));
});

test('betterref-guard hard fails long-page references without scroll mode and section scores', async () => {
  const dir = await makeCase('long-page');
  const project = path.join(dir, 'project');
  await mkdir(path.join(project, 'src'), { recursive: true });
  await writeFile(path.join(project, 'src', 'page.tsx'), 'export default function Page(){return <main />;}');
  const report = path.join(dir, 'report.json');
  const config = path.join(dir, 'guard.json');
  await writeJson(report, {
    passed: true,
    mode: 'single_viewport',
    viewport: { width: 1440, height: 900 },
    dimensions: {
      reference: { width: 1440, height: 1800 },
      actualCompared: { width: 1440, height: 900 }
    },
    verdict: { verdict: 'pass', score: 98, hard_fail_present: false, hardFailHints: [] }
  });
  await writeJson(config, { longReference: true, targetViewport: { width: 1440, height: 900 } });

  const result = runGuard(['--project', project, '--report', report, '--config', config, '--json']);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const guardReport = JSON.parse(result.stdout);
  assert.ok(guardReport.hardFails.some((item) => item.code === 'long_reference_missing_scroll_mode'));
  assert.ok(guardReport.hardFails.some((item) => item.code === 'long_reference_missing_section_scores'));
  assert.ok(guardReport.hardFails.some((item) => item.code === 'actual_page_missing_scroll_evidence'));
});

test('betterref-guard accepts full-page report mode metadata objects', async () => {
  const dir = await makeCase('long-page-mode-object');
  const project = path.join(dir, 'project');
  await mkdir(path.join(project, 'src'), { recursive: true });
  await writeFile(path.join(project, 'src', 'page.tsx'), 'export default function Page(){return <main><button>Buy</button></main>;}');
  const report = path.join(dir, 'report.json');
  const config = path.join(dir, 'guard.json');
  const evidence = path.join(dir, 'browser-evidence.json');
  await writeJson(report, {
    passed: true,
    mode: {
      name: 'full_page_scroll_reference',
      longPage: true,
      normalization: 'strict-no-fullpage-resize'
    },
    viewport: { width: 1440, height: 900 },
    sections: [{ name: 'hero', score: 97 }],
    verdict: { verdict: 'pass', score: 97, hard_fail_present: false, hardFailHints: [] }
  });
  await writeJson(config, { longReference: true, targetViewport: { width: 1440, height: 900 } });
  await writeJson(evidence, {
    viewport: { width: 1440, height: 900, scrollHeight: 1800 },
    page: { scrollHeight: 1800, bodyTextLength: 64, interactiveCount: 1 },
    fonts: { ready: true, status: 'loaded' },
    console: []
  });

  const result = runGuard([
    '--project',
    project,
    '--report',
    report,
    '--config',
    config,
    '--browser-evidence',
    evidence,
    '--json'
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const guardReport = JSON.parse(result.stdout);
  assert.equal(guardReport.passed, true);
});

test('betterref-guard hard fails images rendered larger than native dimensions', async () => {
  const dir = await makeCase('asset-scale');
  const project = path.join(dir, 'project');
  await mkdir(path.join(project, 'src'), { recursive: true });
  await writeFile(path.join(project, 'src', 'page.tsx'), 'export default function Page(){return <main />;}');
  const report = path.join(dir, 'report.json');
  const config = path.join(dir, 'guard.json');
  await writeJson(report, {
    passed: true,
    mode: 'single_viewport',
    verdict: { verdict: 'pass', score: 98, hard_fail_present: false, hardFailHints: [] }
  });
  await writeJson(config, {
    renderedAssets: [
      {
        selector: '.hero img',
        src: '/hero.png',
        nativeWidth: 640,
        nativeHeight: 360,
        renderedWidth: 1280,
        renderedHeight: 720
      }
    ]
  });

  const result = runGuard(['--project', project, '--report', report, '--config', config, '--json']);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const guardReport = JSON.parse(result.stdout);
  assert.ok(guardReport.hardFails.some((item) => item.code === 'asset_scaled_beyond_native_size'));
});

test('betterref-guard hard fails blurry raster assets below the configured sharpness threshold', async () => {
  const dir = await makeCase('asset-quality');
  const project = path.join(dir, 'project');
  const publicDir = path.join(project, 'public');
  await mkdir(path.join(project, 'src'), { recursive: true });
  await mkdir(publicDir, { recursive: true });
  await writeFile(path.join(project, 'src', 'page.tsx'), 'export default function Page(){return <main />;}');
  await writeCheckerPng(path.join(publicDir, 'hero-sharp.png'));
  await writeCheckerPng(path.join(publicDir, 'hero-blur.png'), { blur: true });
  const report = path.join(dir, 'report.json');
  const config = path.join(dir, 'guard.json');
  await writeJson(report, {
    passed: true,
    mode: 'single_viewport',
    verdict: { verdict: 'pass', score: 99, hard_fail_present: false, hardFailHints: [] }
  });
  await writeJson(config, {
    assetQualityChecks: [
      { path: 'public/hero-sharp.png', role: 'hero', minSharpness: 20 },
      { path: 'public/hero-blur.png', role: 'hero', minSharpness: 20 }
    ]
  });

  const result = runGuard(['--project', project, '--report', report, '--config', config, '--json']);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const guardReport = JSON.parse(result.stdout);
  const qualityFails = guardReport.hardFails.filter((item) => item.code === 'asset_quality_below_threshold');
  assert.equal(qualityFails.length, 1);
  assert.equal(qualityFails[0].asset.path, 'public/hero-blur.png');
});

test('betterref-guard can auto-check browser evidence images from local public assets', async () => {
  const dir = await makeCase('auto-asset-quality');
  const project = path.join(dir, 'project');
  const publicDir = path.join(project, 'public');
  await mkdir(path.join(project, 'src'), { recursive: true });
  await mkdir(publicDir, { recursive: true });
  await writeFile(path.join(project, 'src', 'page.tsx'), 'export default function Page(){return <main />;}');
  await writeCheckerPng(path.join(publicDir, 'hero-sharp.png'));
  await writeCheckerPng(path.join(publicDir, 'hero-blur.png'), { blur: true });
  const report = path.join(dir, 'report.json');
  const config = path.join(dir, 'guard.json');
  const evidence = path.join(dir, 'browser-evidence.json');
  await writeJson(report, {
    passed: true,
    mode: 'single_viewport',
    verdict: { verdict: 'pass', score: 99, hard_fail_present: false, hardFailHints: [] }
  });
  await writeJson(config, {
    autoAssetQuality: { enabled: true, minSharpness: 20 }
  });
  await writeJson(evidence, {
    viewport: { width: 1440, height: 900 },
    page: { bodyTextLength: 12, interactiveCount: 1 },
    fonts: { ready: true, status: 'loaded' },
    console: [],
    images: [
      {
        src: 'http://127.0.0.1:3000/hero-sharp.png',
        naturalWidth: 96,
        naturalHeight: 96,
        renderedWidth: 96,
        renderedHeight: 96
      },
      {
        src: '/hero-blur.png',
        naturalWidth: 96,
        naturalHeight: 96,
        renderedWidth: 96,
        renderedHeight: 96
      },
      {
        src: 'https://cdn.example.com/remote-hero.png',
        naturalWidth: 96,
        naturalHeight: 96,
        renderedWidth: 96,
        renderedHeight: 96
      }
    ]
  });

  const result = runGuard([
    '--project',
    project,
    '--report',
    report,
    '--config',
    config,
    '--browser-evidence',
    evidence,
    '--json'
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const guardReport = JSON.parse(result.stdout);
  const qualityFails = guardReport.hardFails.filter((item) => item.code === 'asset_quality_below_threshold');
  assert.equal(qualityFails.length, 1);
  assert.equal(qualityFails[0].asset.src, '/hero-blur.png');
  assert.equal(qualityFails[0].asset.path, 'public/hero-blur.png');
  assert.equal(guardReport.summary.assetQualityChecks, 2);
  assert.equal(guardReport.summary.assetQualityAutoSkipped, 1);
});

test('betterref-guard consumes browser evidence for scroll, image, font, console, and DOM hard fails', async () => {
  const dir = await makeCase('browser-evidence');
  const project = path.join(dir, 'project');
  await mkdir(path.join(project, 'src'), { recursive: true });
  await writeFile(path.join(project, 'src', 'page.tsx'), 'export default function Page(){return <main />;}');
  const report = path.join(dir, 'report.json');
  const config = path.join(dir, 'guard.json');
  const evidence = path.join(dir, 'browser-evidence.json');
  await writeJson(report, {
    passed: true,
    mode: 'full_page_scroll_reference',
    sections: [{ name: 'hero', score: 97 }],
    verdict: { verdict: 'pass', score: 97, hard_fail_present: false }
  });
  await writeJson(config, {
    longReference: true,
    requireDomText: true,
    minInteractiveElements: 1,
    targetViewport: { width: 1440, height: 900 }
  });
  await writeJson(evidence, {
    viewport: { width: 1440, height: 900, scrollHeight: 900 },
    page: { bodyTextLength: 0, interactiveCount: 0 },
    fonts: { ready: false, status: 'loading' },
    console: [{ type: 'error', text: 'Hydration failed' }],
    network: {
      errors: [{ type: 'response', url: 'http://127.0.0.1:3000/missing.png', status: 404 }]
    },
    images: [
      {
        src: '/hero.png',
        naturalWidth: 640,
        naturalHeight: 360,
        renderedWidth: 1280,
        renderedHeight: 720
      }
    ]
  });

  const result = runGuard([
    '--project',
    project,
    '--report',
    report,
    '--config',
    config,
    '--browser-evidence',
    evidence,
    '--json'
  ]);

  assert.equal(result.status, 1);
  const guardReport = JSON.parse(result.stdout);
  for (const code of [
    'browser_missing_scroll_evidence',
    'asset_scaled_beyond_native_size',
    'browser_fonts_not_ready',
    'browser_console_error_present',
    'browser_network_error_present',
    'browser_missing_dom_text',
    'browser_missing_interactive_elements'
  ]) {
    assert.ok(guardReport.hardFails.some((item) => item.code === code), `${code} should hard fail`);
  }
});

test('betterref-guard hard fails asset-heavy pages with no rendered production assets', async () => {
  const dir = await makeCase('missing-rendered-assets');
  const project = path.join(dir, 'project');
  await mkdir(path.join(project, 'src'), { recursive: true });
  await writeFile(path.join(project, 'src', 'page.tsx'), 'export default function Page(){return <main><button>Buy</button></main>;}');
  const report = path.join(dir, 'report.json');
  const config = path.join(dir, 'guard.json');
  const evidence = path.join(dir, 'browser-evidence.json');
  await writeJson(report, {
    passed: true,
    mode: 'single_viewport',
    verdict: { verdict: 'pass', score: 98, hard_fail_present: false }
  });
  await writeJson(config, {
    requireBrowserEvidence: true,
    requireDomText: true,
    minInteractiveElements: 1,
    minRenderedAssets: 1
  });
  await writeJson(evidence, {
    viewport: { width: 1440, height: 900 },
    page: { scrollHeight: 900, bodyTextLength: 24, interactiveCount: 1 },
    fonts: { ready: true, status: 'loaded' },
    console: [],
    images: [],
    assets: { rendered: [] }
  });

  const result = runGuard([
    '--project',
    project,
    '--report',
    report,
    '--config',
    config,
    '--browser-evidence',
    evidence,
    '--json'
  ]);

  assert.equal(result.status, 1);
  const guardReport = JSON.parse(result.stdout);
  assert.ok(guardReport.hardFails.some((item) => item.code === 'browser_missing_rendered_assets'));
  assert.equal(guardReport.summary.renderedProductionAssets, 0);
});

test('betterref-guard counts rendered CSS background assets toward asset-heavy evidence', async () => {
  const dir = await makeCase('css-background-assets');
  const project = path.join(dir, 'project');
  await mkdir(path.join(project, 'src'), { recursive: true });
  await writeFile(path.join(project, 'src', 'page.tsx'), 'export default function Page(){return <main><button>Buy</button></main>;}');
  const report = path.join(dir, 'report.json');
  const config = path.join(dir, 'guard.json');
  const evidence = path.join(dir, 'browser-evidence.json');
  await writeJson(report, {
    passed: true,
    mode: 'single_viewport',
    verdict: { verdict: 'pass', score: 98, hard_fail_present: false }
  });
  await writeJson(config, {
    requireBrowserEvidence: true,
    requireDomText: true,
    minInteractiveElements: 1,
    minRenderedAssets: 1
  });
  await writeJson(evidence, {
    viewport: { width: 1440, height: 900 },
    page: { scrollHeight: 900, bodyTextLength: 24, interactiveCount: 1 },
    fonts: { ready: true, status: 'loaded' },
    console: [],
    images: [],
    assets: {
      rendered: [
        {
          src: '/assets/hero-generated.png',
          renderedWidth: 720,
          renderedHeight: 420,
          sourceType: 'css-background'
        }
      ]
    }
  });

  const result = runGuard([
    '--project',
    project,
    '--report',
    report,
    '--config',
    config,
    '--browser-evidence',
    evidence,
    '--json'
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const guardReport = JSON.parse(result.stdout);
  assert.equal(guardReport.summary.renderedProductionAssets, 1);
});

test('betterref-guard hard fails when required browser evidence is missing', async () => {
  const dir = await makeCase('missing-browser-evidence');
  const project = path.join(dir, 'project');
  await mkdir(path.join(project, 'src'), { recursive: true });
  await writeFile(path.join(project, 'src', 'page.tsx'), 'export default function Page(){return <main><button>Buy</button></main>;}');
  const report = path.join(dir, 'report.json');
  const config = path.join(dir, 'guard.json');
  await writeJson(report, {
    passed: true,
    mode: 'single_viewport',
    verdict: { verdict: 'pass', score: 98, hard_fail_present: false, hardFailHints: [] }
  });
  await writeJson(config, {
    requireBrowserEvidence: true,
    requireDomText: true,
    minInteractiveElements: 1
  });

  const result = runGuard(['--project', project, '--report', report, '--config', config, '--json']);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const guardReport = JSON.parse(result.stdout);
  assert.equal(guardReport.passed, false);
  assert.equal(guardReport.hardFailPresent, true);
  assert.ok(guardReport.hardFails.some((item) => item.code === 'browser_evidence_missing'));
});

test('betterref-guard accepts unsupported browser font status when fonts are not reported as unready', async () => {
  const dir = await makeCase('font-unsupported');
  const project = path.join(dir, 'project');
  await mkdir(path.join(project, 'src'), { recursive: true });
  await writeFile(path.join(project, 'src', 'page.tsx'), 'export default function Page(){return <main><button>Buy</button></main>;}');
  const report = path.join(dir, 'report.json');
  const config = path.join(dir, 'guard.json');
  const evidence = path.join(dir, 'browser-evidence.json');
  await writeJson(report, {
    passed: true,
    mode: 'single_viewport',
    verdict: { verdict: 'pass', score: 96, hard_fail_present: false, hardFailHints: [] }
  });
  await writeJson(config, { forbiddenSourcePatterns: ['assets/reference'] });
  await writeJson(evidence, {
    viewport: { width: 1440, height: 900 },
    fonts: { ready: true, status: 'unsupported' },
    page: { bodyTextLength: 12, interactiveCount: 1 },
    images: [],
    console: []
  });

  const result = runGuard([
    '--project',
    project,
    '--report',
    report,
    '--config',
    config,
    '--browser-evidence',
    evidence,
    '--json'
  ]);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const guardReport = JSON.parse(result.stdout);
  assert.equal(guardReport.passed, true);
  assert.ok(!guardReport.hardFails.some((item) => item.code === 'browser_fonts_not_ready'));
});

test('betterref-guard passes clean reports with no hard-fail evidence', async () => {
  const dir = await makeCase('clean');
  const project = path.join(dir, 'project');
  await mkdir(path.join(project, 'src'), { recursive: true });
  await writeFile(path.join(project, 'src', 'page.tsx'), 'export default function Page(){return <main><button>Buy</button></main>;}');
  const report = path.join(dir, 'report.json');
  const config = path.join(dir, 'guard.json');
  await writeJson(report, {
    passed: true,
    mode: 'single_viewport',
    verdict: { verdict: 'pass', score: 96, hard_fail_present: false, hardFailHints: [] }
  });
  await writeJson(config, { forbiddenSourcePatterns: ['assets/reference'] });

  const result = runGuard(['--project', project, '--report', report, '--config', config, '--json']);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const guardReport = JSON.parse(result.stdout);
  assert.equal(guardReport.passed, true);
  assert.equal(guardReport.hardFailPresent, false);
  assert.deepEqual(guardReport.hardFails, []);
});
