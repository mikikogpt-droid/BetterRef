import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const captureBin = path.join(repoRoot, 'bin', 'betterref-capture.mjs');

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
