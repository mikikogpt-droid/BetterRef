import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runGuard } from './guard.mjs';
import { verifyFinal } from './verify.mjs';

export class BetterRefEvalInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BetterRefEvalInputError';
  }
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new BetterRefEvalInputError(`Could not read ${label} ${filePath}: ${error.message}`);
  }
}

function resolveFrom(baseDir, value) {
  if (!value) {
    return undefined;
  }
  return path.isAbsolute(value) ? value : path.join(baseDir, value);
}

function asArray(value) {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function matchesExpectation(actual, expected = {}) {
  const mismatches = [];

  if (expected.verdict !== undefined && actual.verdict !== expected.verdict) {
    mismatches.push(`expected verdict ${expected.verdict}, got ${actual.verdict}`);
  }
  if (expected.hardFailPresent !== undefined && actual.hardFailPresent !== expected.hardFailPresent) {
    mismatches.push(`expected hardFailPresent ${expected.hardFailPresent}, got ${actual.hardFailPresent}`);
  }
  if (expected.passed !== undefined && actual.passed !== expected.passed) {
    mismatches.push(`expected passed ${expected.passed}, got ${actual.passed}`);
  }
  if (expected.minPrdCompliance !== undefined && actual.prdCompliance.score < Number(expected.minPrdCompliance)) {
    mismatches.push(`expected PRD compliance >= ${expected.minPrdCompliance}, got ${actual.prdCompliance.score}`);
  }
  const blockingReasons = asArray(actual.blockingReasons).join('\n');
  for (const expectedReason of asArray(expected.blockingReasonIncludes || expected.blockingReasonsInclude)) {
    if (!blockingReasons.includes(String(expectedReason))) {
      mismatches.push(`expected blocking reason to include ${expectedReason}`);
    }
  }
  const assetRequirements = asArray(actual.assetPlan?.requirements).join('\n');
  for (const forbiddenRequirement of asArray(expected.assetPlanForbiddenRequirementIncludes)) {
    if (assetRequirements.includes(String(forbiddenRequirement))) {
      mismatches.push(`expected asset plan requirements not to include ${forbiddenRequirement}`);
    }
  }
  for (const requiredRequirement of asArray(expected.assetPlanRequiredRequirementIncludes)) {
    if (!assetRequirements.includes(String(requiredRequirement))) {
      mismatches.push(`expected asset plan requirements to include ${requiredRequirement}`);
    }
  }

  return {
    matched: mismatches.length === 0,
    mismatches
  };
}

async function summarizeAssetPlan(assetPlanPath) {
  if (!assetPlanPath) {
    return undefined;
  }
  const plan = await readJson(assetPlanPath, 'asset plan');
  const assets = asArray(plan.assets);
  return {
    imagegenRequired: Boolean(plan.imagegenRequired),
    assetCount: assets.length,
    requirements: assets.map((asset) => asset.requirement || '').filter(Boolean),
    roles: assets.map((asset) => asset.role || '').filter(Boolean),
    targetPaths: assets.map((asset) => asset.targetPath || '').filter(Boolean)
  };
}

export async function runEval(options) {
  const manifestPath = options.manifestPath;
  const manifest = await readJson(manifestPath, 'BetterRef eval manifest');
  const baseDir = path.dirname(path.resolve(manifestPath));
  const cases = Array.isArray(manifest.cases) ? manifest.cases : [];
  if (cases.length === 0) {
    throw new BetterRefEvalInputError('Eval manifest must contain cases[].');
  }

  const results = [];
  for (const item of cases) {
    const reportPath = resolveFrom(baseDir, item.report);
    const guardPath = resolveFrom(baseDir, item.guard);
    const guardConfigPath = resolveFrom(baseDir, item.guardConfig || item.guardConfigPath || item.config);
    const browserEvidencePath = resolveFrom(baseDir, item.browserEvidence || item.browserEvidencePath || item.browser);
    const projectDir = resolveFrom(baseDir, item.project || item.projectDir);
    const assetPlanPath = resolveFrom(baseDir, item.assetPlan || item.assetplan || item.asset);
    const guardReport = guardConfigPath
      ? await runGuard({
          reportPath,
          projectDir,
          configPath: guardConfigPath,
          browserEvidencePath
        })
      : undefined;
    const actual = await verifyFinal({
      reportPath,
      guardPath,
      guardReport,
      prdPath: resolveFrom(baseDir, item.prd),
      longPagePath: resolveFrom(baseDir, item.longpage || item.longPage),
      assetPlanPath,
      browserEvidencePath,
      projectDir,
      requiredEvidence: item.require || item.requiredEvidence
    });
    const assetPlan = await summarizeAssetPlan(assetPlanPath);
    if (assetPlan) {
      actual.assetPlan = assetPlan;
    }
    const expectation = matchesExpectation(actual, item.expect || {});
    results.push({
      id: item.id || `case-${results.length + 1}`,
      matched: expectation.matched,
      mismatches: expectation.mismatches,
      expected: item.expect || {},
      actual: {
        verdict: actual.verdict,
        passed: actual.passed,
        hardFailPresent: actual.hardFailPresent,
        visualScore: actual.visual.score,
        longPageScore: actual.longPage.score,
        prdCompliance: actual.prdCompliance.score,
        blockingReasons: actual.blockingReasons,
        assetPlan
      }
    });
  }

  const matched = results.filter((item) => item.matched).length;
  const report = {
    passed: matched === results.length,
    summary: {
      total: results.length,
      matched,
      mismatched: results.length - matched
    },
    cases: results
  };

  if (options.outPath) {
    await writeFile(options.outPath, JSON.stringify(report, null, 2));
  }

  return report;
}
