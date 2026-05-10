import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const skillPath = path.join(repoRoot, 'SKILL.md');

async function fileExists(relativePath) {
  try {
    await stat(path.join(repoRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

test('SKILL.md stays concise enough for agents to read before acting', async () => {
  const skill = await readFile(skillPath, 'utf8');
  const words = skill.replace(/---[\s\S]*?---/, '').trim().split(/\s+/).filter(Boolean);
  assert.ok(words.length <= 2200, `SKILL.md has ${words.length} words; move details to references.`);
});

test('SKILL.md frontmatter is discoverable without summarizing workflow', async () => {
  const skill = await readFile(skillPath, 'utf8');
  const description = skill.match(/description:\s*(.+)/)?.[1] || '';
  assert.match(description, /^Use when /);
  assert.ok(description.length < 500, 'description must stay short enough for discovery');
  assert.doesNotMatch(description, /workflow|step|run|dispatch|compare section/i);
});

test('SKILL.md contains the mandatory operating contract and future-proof PRD loop', async () => {
  const skill = await readFile(skillPath, 'utf8');
  assert.match(skill, /## Non-Negotiable Operating Contract/);
  assert.match(skill, /## PRD To Web Loop/);
  assert.match(skill, /betterref-guard/);
  assert.match(skill, /reference-only/i);
  assert.match(skill, /hard-fail ledger/i);
});

test('SKILL.md does not show dangerous final-pass match-size commands', async () => {
  const skill = await readFile(skillPath, 'utf8');
  assert.doesNotMatch(skill, /--match-size\s+reference/);
});

test('BetterRef ships focused reference files for heavy guidance', async () => {
  for (const relativePath of [
    'references/prd-to-web.md',
    'references/full-page-scroll.md',
    'references/hard-fail-ledger.md',
    'references/pressure-tests.md'
  ]) {
    assert.equal(await fileExists(relativePath), true, `${relativePath} must exist`);
  }
});

test('pressure tests cover the failure modes that caused the ONETAPGG miss', async () => {
  const pressureTests = await readFile(path.join(repoRoot, 'references', 'pressure-tests.md'), 'utf8');
  for (const id of [
    'BR-PRESSURE-001',
    'BR-PRESSURE-002',
    'BR-PRESSURE-003',
    'BR-PRESSURE-004',
    'BR-PRESSURE-005',
    'BR-PRESSURE-006',
    'BR-PRESSURE-007',
    'BR-PRESSURE-008',
    'BR-PRESSURE-009'
  ]) {
    assert.match(pressureTests, new RegExp(id));
  }
});
