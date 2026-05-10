import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
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
  const fullPage = report.fullPageStructure || report.fullPage;
  const fullPagePassed = fullPage ? fullPage.passed !== false : true;
  return {
    present: true,
    passed: report.passed !== false && fullPagePassed && failedSections.length === 0,
    hardFailPresent: Boolean(report.hardFailPresent || report.hard_fail_present || !fullPagePassed || failedSections.length > 0),
    fullPagePassed,
    score: Number(report.verdict?.score ?? report.summary?.score ?? fullPage?.score ?? report.score ?? 0),
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

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return char;
    }
  });
}

function renderList(items) {
  if (items.length === 0) {
    return '<li>None</li>';
  }
  return items.map((item) => `<li>${escapeHtml(item)}</li>`).join('\n');
}

function renderHardFails(report) {
  const hardFails = report.guard.hardFails.map((hardFail) => {
    const code = hardFail.code || hardFail.type || hardFail.id || 'unknown';
    const message = hardFail.message || hardFail.reason || '';
    return `${code}${message ? `: ${message}` : ''}`;
  });
  return renderList(hardFails);
}

function renderMissingPrd(report) {
  const missing = report.prdCompliance.missing.map((item) => {
    const detail = item.requirement ? ` - ${item.requirement}` : '';
    return `${item.id} (${item.status})${detail}`;
  });
  return renderList(missing);
}

function renderFailedSections(report) {
  const sections = report.longPage.failedSections.map((section) => {
    const name = section.name || section.id || 'unknown';
    const score = Number.isFinite(Number(section.score)) ? ` score ${section.score}` : '';
    return `long-page section ${name} did not pass${score}`;
  });
  return renderList(sections);
}

function renderFinalHtml(report) {
  const status = report.verdict.toUpperCase();
  const statusClass = report.passed ? 'pass' : report.hardFailPresent ? 'fail' : 'revise';
  const longPageScore = Number.isFinite(Number(report.longPage.score)) ? report.longPage.score : 'n/a';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>BetterRef Final Verdict</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #0d1020;
      --panel: #151a2d;
      --text: #f5f7fb;
      --muted: #aab3ca;
      --border: #2a3352;
      --pass: #33d17a;
      --revise: #f5c542;
      --fail: #ff5c7a;
    }
    body {
      margin: 0;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    main {
      max-width: 1120px;
      margin: 0 auto;
      padding: 32px 20px 48px;
    }
    h1, h2 {
      margin: 0;
      letter-spacing: 0;
    }
    h1 {
      font-size: 34px;
    }
    h2 {
      font-size: 18px;
    }
    .summary, .section {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 20px;
      margin-top: 18px;
    }
    .status {
      display: inline-flex;
      align-items: center;
      min-height: 36px;
      padding: 0 12px;
      border-radius: 6px;
      font-weight: 700;
      color: #0d1020;
      background: var(--revise);
    }
    .status.pass { background: var(--pass); }
    .status.fail { background: var(--fail); color: #fff; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 12px;
      margin-top: 16px;
    }
    .metric {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px;
    }
    .label {
      color: var(--muted);
      font-size: 13px;
    }
    .value {
      margin-top: 4px;
      font-size: 24px;
      font-weight: 700;
    }
    ul {
      padding-left: 20px;
      margin: 12px 0 0;
    }
    code {
      color: var(--text);
      background: rgba(255, 255, 255, 0.08);
      border-radius: 4px;
      padding: 2px 5px;
    }
    .inputs {
      display: grid;
      gap: 6px;
      overflow-wrap: anywhere;
    }
  </style>
</head>
<body>
  <main>
    <div class="summary">
      <h1>BetterRef Final Verdict</h1>
      <p><span class="status ${statusClass}">${escapeHtml(status)}</span></p>
      <div class="grid">
        <div class="metric"><div class="label">Visual Score</div><div class="value">${escapeHtml(report.visual.score)}</div></div>
        <div class="metric"><div class="label">PRD Compliance</div><div class="value">${escapeHtml(report.prdCompliance.score)}%</div></div>
        <div class="metric"><div class="label">Long-Page Score</div><div class="value">${escapeHtml(longPageScore)}</div></div>
        <div class="metric"><div class="label">Hard Fail</div><div class="value">${report.hardFailPresent ? 'YES' : 'NO'}</div></div>
      </div>
    </div>
    <section class="section">
      <h2>Blocking Reasons</h2>
      <ul>${renderList(report.blockingReasons)}</ul>
    </section>
    <section class="section">
      <h2>Guard Hard Fails</h2>
      <ul>${renderHardFails(report)}</ul>
    </section>
    <section class="section">
      <h2>PRD Compliance</h2>
      <p>${escapeHtml(report.prdCompliance.passed)} of ${escapeHtml(report.prdCompliance.total)} items passed.</p>
      <ul>${renderMissingPrd(report)}</ul>
    </section>
    <section class="section">
      <h2>Long-Page Sections</h2>
      <ul>${renderFailedSections(report)}</ul>
    </section>
    <section class="section">
      <h2>Inputs</h2>
      <div class="inputs">
        <code>report: ${escapeHtml(report.inputs.report || '')}</code>
        <code>guard: ${escapeHtml(report.inputs.guard || '')}</code>
        <code>prd: ${escapeHtml(report.inputs.prd || '')}</code>
        <code>longPage: ${escapeHtml(report.inputs.longPage || '')}</code>
        <code>html: ${escapeHtml(report.inputs.html || '')}</code>
      </div>
    </section>
  </main>
</body>
</html>
`;
}

async function describeArtifact(kind, filePath) {
  if (!filePath) {
    return {
      kind,
      path: null,
      present: false
    };
  }

  const resolved = path.resolve(filePath);
  try {
    const [contents, info] = await Promise.all([readFile(resolved), stat(resolved)]);
    return {
      kind,
      path: resolved,
      present: true,
      bytes: info.size,
      sha256: createHash('sha256').update(contents).digest('hex')
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        kind,
        path: resolved,
        present: false
      };
    }
    throw error;
  }
}

async function buildEvidenceBundle(report, options) {
  const artifactInputs = [
    ['visual-report', options.reportPath],
    ['guard-report', options.guardPath],
    ['prd-checklist', options.prdPath],
    ['long-page-report', options.longPagePath],
    ['final-verdict-json', options.outPath],
    ['final-verdict-html', options.htmlPath]
  ];
  const artifacts = [];
  for (const [kind, filePath] of artifactInputs) {
    const artifact = await describeArtifact(kind, filePath);
    if (artifact.path) {
      artifacts.push(artifact);
    }
  }

  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    verdict: {
      passed: report.passed,
      verdict: report.verdict,
      hardFailPresent: report.hardFailPresent,
      visualScore: report.visual.score,
      prdScore: report.prdCompliance.score,
      longPageScore: report.longPage.present ? report.longPage.score : null
    },
    blockingReasons: report.blockingReasons,
    artifacts
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
      longPage: options.longPagePath ? path.resolve(options.longPagePath) : null,
      html: options.htmlPath ? path.resolve(options.htmlPath) : null
    }
  };

  if (options.outPath) {
    await writeFile(options.outPath, JSON.stringify(finalReport, null, 2));
  }
  if (options.htmlPath) {
    await writeFile(options.htmlPath, renderFinalHtml(finalReport));
  }
  if (options.bundlePath) {
    const bundle = await buildEvidenceBundle(finalReport, options);
    await writeFile(options.bundlePath, JSON.stringify(bundle, null, 2));
  }

  return finalReport;
}
