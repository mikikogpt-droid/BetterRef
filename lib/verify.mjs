import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class BetterRefVerifyInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BetterRefVerifyInputError';
  }
}

async function readJson(filePath, label) {
  if (!filePath) {
    return null;
  }

  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    throw new BetterRefVerifyInputError(`Could not read ${label} ${filePath}: ${error.message}`);
  }
}

function asArray(value) {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function isPassStatus(value) {
  return ['pass', 'passed', 'done', 'complete', 'completed', 'ok'].includes(normalizeStatus(value));
}

function visualVerdict(report) {
  const verdict = report?.verdict || {};
  const score = Number(verdict.score ?? report?.score ?? report?.global?.score ?? 0);
  const passed = report?.passed !== false && (verdict.verdict ? verdict.verdict === 'pass' : true);
  const hardFailPresent = Boolean(
    report?.hardFailPresent ||
      report?.hard_fail_present ||
      verdict.hardFailPresent ||
      verdict.hard_fail_present ||
      asArray(verdict.hardFailHints).length > 0 ||
      asArray(report?.hardFails).length > 0
  );

  return {
    passed,
    verdict: verdict.verdict || (passed ? 'pass' : 'revise'),
    score: Number.isFinite(score) ? score : 0,
    hardFailPresent
  };
}

function guardVerdict(report) {
  if (!report) {
    return {
      present: false,
      passed: true,
      hardFailPresent: false,
      hardFails: []
    };
  }

  const hardFails = asArray(report.hardFails);
  return {
    present: true,
    passed: report.passed !== false && !report.hardFailPresent && hardFails.length === 0,
    hardFailPresent: Boolean(report.hardFailPresent || hardFails.length > 0),
    hardFails
  };
}

function longPageVerdict(report) {
  if (!report) {
    return {
      present: false,
      passed: true,
      hardFailPresent: false,
      failedSections: []
    };
  }

  const sections = asArray(report.sections);
  const failedSections = sections.filter((section) => section.passed === false);
  const fullPagePassed = report.fullPageStructure ? report.fullPageStructure.passed !== false : true;
  return {
    present: true,
    passed: report.passed !== false && fullPagePassed && failedSections.length === 0,
    hardFailPresent: Boolean(report.hardFailPresent || report.hard_fail_present || !fullPagePassed || failedSections.length > 0),
    fullPagePassed,
    score: Number(report.verdict?.score ?? report.score ?? 0),
    failedSections
  };
}

function prdCompliance(checklist) {
  if (!checklist) {
    return {
      present: false,
      total: 0,
      passed: 0,
      missing: [],
      score: 100
    };
  }

  const items = asArray(checklist.items || checklist.requirements || checklist.checklist);
  const missing = [];
  let passed = 0;

  for (const item of items) {
    if (isPassStatus(item.status || item.state || item.result)) {
      passed += 1;
      continue;
    }
    missing.push({
      id: item.id || item.name || item.requirement || `item-${missing.length + 1}`,
      status: item.status || item.state || item.result || 'missing',
      requirement: item.requirement || item.description || item.name || ''
    });
  }

  return {
    present: true,
    total: items.length,
    passed,
    missing,
    score: items.length === 0 ? 100 : Math.round((passed / items.length) * 100)
  };
}

export async function verifyFinal(options) {
  const visualReport = await readJson(options.reportPath, 'BetterRef report');
  const guardReport = await readJson(options.guardPath, 'BetterRef guard report');
  const prdChecklist = await readJson(options.prdPath, 'PRD checklist');
  const longPageReport = await readJson(options.longPagePath, 'BetterRef long-page report');
  if (!visualReport) {
    throw new BetterRefVerifyInputError('Missing required BetterRef report.');
  }

  const visual = visualVerdict(visualReport);
  const guard = guardVerdict(guardReport);
  const prd = prdCompliance(prdChecklist);
  const longPage = longPageVerdict(longPageReport);
  const blockingReasons = [];

  if (!visual.passed) {
    blockingReasons.push(`visual report is ${visual.verdict}`);
  }
  if (visual.score < 95) {
    blockingReasons.push(`visual score ${visual.score} is below 95`);
  }
  if (visual.hardFailPresent) {
    blockingReasons.push('visual report contains hard-fail evidence');
  }
  if (!guard.passed) {
    for (const hardFail of guard.hardFails) {
      blockingReasons.push(`guard hard fail ${hardFail.code || 'unknown'}: ${hardFail.message || ''}`.trim());
    }
    if (guard.hardFails.length === 0) {
      blockingReasons.push('guard report did not pass');
    }
  }
  for (const item of prd.missing) {
    blockingReasons.push(`PRD item ${item.id} is ${item.status}`);
  }
  if (!longPage.passed) {
    if (!longPage.fullPagePassed) {
      blockingReasons.push('long-page full-page structure did not pass');
    }
    for (const section of longPage.failedSections) {
      blockingReasons.push(`long-page section ${section.name || 'unknown'} did not pass`);
    }
    if (longPage.failedSections.length === 0 && longPage.fullPagePassed) {
      blockingReasons.push('long-page report did not pass');
    }
  }

  const hardFailPresent = Boolean(visual.hardFailPresent || guard.hardFailPresent || longPage.hardFailPresent);
  const passed = blockingReasons.length === 0 && visual.passed && guard.passed && longPage.passed && prd.score === 100;
  const verdict = passed ? 'pass' : hardFailPresent ? 'fail' : 'revise';
  const finalReport = {
    passed,
    verdict,
    hardFailPresent,
    visual,
    guard,
    longPage,
    prdCompliance: prd,
    blockingReasons,
    inputs: {
      report: options.reportPath ? path.resolve(options.reportPath) : null,
      guard: options.guardPath ? path.resolve(options.guardPath) : null,
      prd: options.prdPath ? path.resolve(options.prdPath) : null,
      longPage: options.longPagePath ? path.resolve(options.longPagePath) : null
    }
  };

  if (options.outPath) {
    await writeFile(options.outPath, JSON.stringify(finalReport, null, 2));
  }

  return finalReport;
}
