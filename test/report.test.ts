/**
 * Deterministic unit tests for the Forge report renderers.
 *
 * Run: npx tsx --test test/report.test.ts
 *
 * No clocks, no randomness, no network: the fixtures below are hand-built
 * RunReport objects that follow src/core/model.ts exactly.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderTerminal } from '../src/report/terminal.js';
import { renderMarkdown } from '../src/report/markdown.js';
import { renderHtml } from '../src/report/html.js';
import {
  formatUsd,
  humanizeDuration,
  humanizeTokens,
} from '../src/report/format.js';
import type { RunReport } from '../src/core/model.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Rich run: 2 agents in a parent/child swarm + 1 independent, 4 mixed tasks. */
const richReport: RunReport = {
  meta: {
    runId: 'run-demo-001',
    source: 'demo',
    project: '/tmp/forge-demo',
    createdAt: '2026-08-26T09:00:00Z',
    generator: 'forge demo harness',
  },
  totals: {
    agents: 3,
    tasks: 4,
    wallMs: 10_620_000,
    tokensIn: 300_000,
    tokensOut: 84_200,
    cacheRead: 50_000,
    cacheWrite: 10_000,
    tokensTotal: 384_200,
    costUsd: 18.42,
    costKnown: true,
    success: 2,
    failure: 1,
    partial: 0,
    unknown: 1,
    errors: 4,
    retries: 3,
    toolCalls: 57,
  },
  agents: [
    {
      agentId: 'claude-main',
      name: 'Claude Main',
      models: { 'claude-opus-4-1': 270_000 },
      taskCount: 2,
      successCount: 1,
      failureCount: 1,
      partialCount: 0,
      activeMs: 5_400_000,
      wallMs: 10_620_000,
      tokensIn: 210_000,
      tokensOut: 60_000,
      cacheRead: 30_000,
      cacheWrite: 5_000,
      tokensTotal: 270_000,
      costUsd: 12.95,
      toolCalls: 30,
      byTool: { Bash: 12, Read: 10, Edit: 8 },
      filesTouched: [
        'src/core/model.ts',
        'src/app.ts',
        'src/core/cost.ts',
        'README.md',
        'docs/events.md',
      ],
      errors: 3,
      retries: 2,
      testRuns: 0,
    },
    {
      agentId: 'subagent:Explore#1',
      name: 'Explore #1',
      parentAgentId: 'claude-main',
      models: { 'claude-sonnet-4-5': 80_000 },
      taskCount: 1,
      successCount: 1,
      failureCount: 0,
      partialCount: 0,
      activeMs: 1_800_000,
      wallMs: 2_400_000,
      tokensIn: 60_000,
      tokensOut: 20_000,
      cacheRead: 15_000,
      cacheWrite: 4_000,
      tokensTotal: 80_000,
      costUsd: 3.2,
      toolCalls: 15,
      byTool: { Grep: 9, Read: 6 },
      filesTouched: ['src/core/model.ts', 'src/util/search.ts', 'src/index.ts'],
      errors: 1,
      retries: 1,
      testRuns: 0,
    },
    {
      agentId: 'codex-planner',
      name: 'Codex Planner',
      models: { 'gpt-5-codex': 34_200 },
      taskCount: 1,
      successCount: 0,
      failureCount: 0,
      partialCount: 0,
      activeMs: 900_000,
      wallMs: 3_600_000,
      tokensIn: 30_000,
      tokensOut: 4_200,
      cacheRead: 5_000,
      cacheWrite: 1_000,
      tokensTotal: 34_200,
      costUsd: 2.27,
      toolCalls: 12,
      byTool: { Write: 7, Read: 5 },
      filesTouched: ['docs/plan.md'],
      errors: 0,
      retries: 0,
      testRuns: 0,
    },
  ],
  tasks: [
    {
      taskId: 'task-t1',
      title: 'Implement canonical event model',
      agentId: 'claude-main',
      status: 'success',
      startedAt: '2026-08-26T09:00:00Z',
      endedAt: '2026-08-26T09:42:00Z',
      durationMs: 2_520_000,
      tokensIn: 90_000,
      tokensOut: 30_000,
      cacheRead: 0,
      cacheWrite: 0,
      tokensTotal: 120_000,
      costUsd: 4.9,
      toolCalls: 12,
      files: ['src/core/model.ts'],
      errors: 1,
      retries: 1,
      testRuns: 0,
    },
    {
      taskId: 'task-t2',
      title: 'Refactor cost estimation pipeline',
      agentId: 'claude-main',
      status: 'failure',
      startedAt: '2026-08-26T09:45:00Z',
      endedAt: '2026-08-26T10:30:00Z',
      durationMs: 2_700_000,
      tokensIn: 120_000,
      tokensOut: 30_000,
      cacheRead: 0,
      cacheWrite: 0,
      tokensTotal: 150_000,
      costUsd: 8.05,
      toolCalls: 18,
      files: ['src/core/cost.ts', 'src/app.ts'],
      errors: 2,
      retries: 1,
      testRuns: 0,
    },
    {
      taskId: 'task-t3',
      title: 'Explore search utilities',
      agentId: 'subagent:Explore#1',
      status: 'success',
      startedAt: '2026-08-26T10:05:00Z',
      endedAt: '2026-08-26T10:45:00Z',
      durationMs: 2_400_000,
      tokensIn: 60_000,
      tokensOut: 20_000,
      cacheRead: 0,
      cacheWrite: 0,
      tokensTotal: 80_000,
      costUsd: 3.2,
      toolCalls: 15,
      files: ['src/util/search.ts'],
      errors: 1,
      retries: 1,
      testRuns: 0,
    },
    {
      // Deliberately hostile: proves every surface renders it inert.
      taskId: 'task-xss',
      title: '<script>alert(1)</script>',
      agentId: 'codex-planner',
      status: 'unknown',
      startedAt: '2026-08-26T10:50:00Z',
      endedAt: '2026-08-26T11:15:00Z',
      durationMs: 1_500_000,
      tokensIn: 30_000,
      tokensOut: 4_200,
      cacheRead: 0,
      cacheWrite: 0,
      tokensTotal: 34_200,
      costUsd: 2.27,
      toolCalls: 12,
      files: ['docs/plan.md'],
      errors: 0,
      retries: 0,
      testRuns: 0,
    },
  ],
  files: [
    {
      path: 'src/core/model.ts', // shared by two agents -> overlap signal
      agents: ['claude-main', 'subagent:Explore#1'],
      writes: 7,
    },
    {
      path: 'weird"quotes"<&>.ts', // hostile path: quotes + angle brackets
      agents: ['claude-main'],
      writes: 3,
    },
    {
      path: 'docs/plan.md',
      agents: ['codex-planner'],
      writes: 1,
    },
  ],
  engineering: {
    testRuns: 0,
    testFailures: null,
    commits: 2,
    buildChecks: 1,
    filesChanged: 3,
    apiErrors: 1,
    retries: 3,
    errors: 4,
  },
  insights: [
    {
      id: 'ins-token-conc',
      kind: 'token-concentration',
      title: 'Token concentration in one sub-agent',
      severity: 'warn',
      observed:
        'Explore #1 (subagent:Explore#1) used 20.8% of all tokens while completing 1 of 4 tasks.',
      evidence: ['tokens=80000/384200', 'agent=subagent:Explore#1', 'tasks_completed=1/4'],
      recommendation:
        'Cap the exploration sub-agent token budget or require interim summaries before deep dives.',
    },
    {
      id: 'ins-no-tests',
      kind: 'no-tests',
      title: 'No test runs detected',
      severity: 'info',
      observed: '0 test invocations were recorded across 4 tasks and 57 tool calls.',
      evidence: ['test_runs=0', 'tool_calls=57'],
      recommendation: 'Add a test command to the workflow so task outcomes are verifiable.',
    },
  ],
  warnings: ['2 records skipped: missing timestamp'],
};

/** Minimal run: nothing happened, no pricing — must not crash anywhere. */
const sparseReport: RunReport = {
  meta: { runId: 'run-empty', source: 'jsonl', createdAt: '2026-08-26T00:00:00Z' },
  totals: {
    agents: 0,
    tasks: 0,
    wallMs: 0,
    tokensIn: 0,
    tokensOut: 0,
    cacheRead: 0,
    cacheWrite: 0,
    tokensTotal: 0,
    costKnown: false,
    success: 0,
    failure: 0,
    partial: 0,
    unknown: 0,
    errors: 0,
    retries: 0,
    toolCalls: 0,
  },
  agents: [],
  tasks: [],
  files: [],
  engineering: {
    testRuns: 0,
    testFailures: null,
    commits: 0,
    buildChecks: 0,
    filesChanged: 0,
    apiErrors: 0,
    retries: 0,
    errors: 0,
  },
  insights: [],
  warnings: [],
};

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

test('format: humanizeDuration follows the documented shapes', () => {
  assert.equal(humanizeDuration(2400), '2.4s');
  assert.equal(humanizeDuration(65000), '1m 05s');
  assert.equal(humanizeDuration(3420000), '57m 00s'); // 3_420_000 ms is 57 min
  assert.equal(humanizeDuration(10620000), '2h 57m');
  assert.equal(humanizeDuration(undefined), '-');
  assert.equal(humanizeDuration(-5), '-');
});

test('format: humanizeTokens and formatUsd follow the documented shapes', () => {
  assert.equal(humanizeTokens(2800000), '2.8M');
  assert.equal(humanizeTokens(384200), '384.2k');
  assert.equal(humanizeTokens(912), '912');
  assert.equal(humanizeTokens(undefined), '-');
  assert.equal(formatUsd(18.42), '$18.42');
  assert.equal(formatUsd(0.0023), '$0.0023');
  assert.equal(formatUsd(undefined), '-');
});

// ---------------------------------------------------------------------------
// Terminal
// ---------------------------------------------------------------------------

test('terminal: strict ASCII output only', () => {
  const out = renderTerminal(richReport);
  assert.match(out, /^[\x20-\x7E\n\r]*$/);
});

test('terminal: contains header, run id, severity marker and estimated-cost markers', () => {
  const out = renderTerminal(richReport);
  for (const marker of [
    'FORGE RUN REPORT',
    'run-demo-001',
    '[!]', // warn severity
    '[i]', // info severity
    'estimated',
    '$18.42',
    '_ Explore #1', // child-agent hierarchy prefix (ASCII fallback of "└ ")
    'Generated by Forge',
  ]) {
    assert.ok(out.includes(marker), `missing terminal marker: ${marker}`);
  }
  // deep-detail markers live behind --verbose
  const verbose = renderTerminal(richReport, { verbose: true });
  for (const marker of [
    'more than one agent', // file overlap legend
    '.forge/prices.json.',
    'Facts come from recorded events',
  ]) {
    assert.ok(verbose.includes(marker), `missing verbose marker: ${marker}`);
  }
});

test('terminal: lines stay within the 80-column budget', () => {
  const out = renderTerminal(richReport);
  const tooWide = out.split('\n').filter((l) => l.length > 80);
  assert.deepEqual(tooWide, []);
});

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

test('markdown: GitHub-flavored structure with facts and suggestions separated', () => {
  const out = renderMarkdown(richReport);
  for (const marker of [
    '# FORGE RUN REPORT',
    '|', // pipe tables
    '**Observed:**',
    '*Suggestion:*',
    '| :--- |',
    '## Findings',
    '## Agents',
    '## Tasks',
    '## Files',
    '.forge/prices.json.',
    'Generated by Forge',
  ]) {
    assert.ok(out.includes(marker), `missing markdown marker: ${marker}`);
  }
});

test('markdown: hostile title is escaped (no raw script tag)', () => {
  const out = renderMarkdown(richReport);
  assert.ok(!out.includes('<script'));
  assert.ok(out.includes('&lt;script&gt;'));
});

// ---------------------------------------------------------------------------
// HTML
// ---------------------------------------------------------------------------

test('html: single self-contained offline document', () => {
  const out = renderHtml(richReport);
  assert.ok(out.startsWith('<!doctype html>'));
  assert.ok(out.includes('<meta charset="utf-8">'));
  // No external references of any kind may leak into the markup.
  assert.ok(!out.includes('http://'), 'found forbidden http:// in HTML');
  assert.ok(!out.includes('https://'), 'found forbidden https:// in HTML');
  assert.ok(!out.includes('<script'), 'found forbidden <script in HTML');
  assert.ok(!out.includes('<img'), 'found forbidden <img in HTML');
});

test('html: hostile title and quoted path render inert via escapeHtml', () => {
  const out = renderHtml(richReport);
  assert.ok(out.includes('&lt;script&gt;'), 'hostile title not escaped');
  assert.ok(out.includes('&quot;'), 'quoted path not escaped');
  assert.ok(out.includes('&lt;&amp;&gt;'), 'path angle brackets/ampersand not escaped');
  assert.ok(!out.includes('<script>alert(1)</script>'), 'raw hostile title leaked');
  assert.ok(!out.includes('weird"quotes"'), 'raw quoted path leaked');
});

test('html: every opened table is closed', () => {
  const out = renderHtml(richReport);
  const open = out.split('<table>').length - 1;
  const close = out.split('</table>').length - 1;
  assert.ok(open >= 3, `expected at least 3 tables, found ${open}`);
  assert.equal(open, close);
});

// ---------------------------------------------------------------------------
// Sparse data + determinism
// ---------------------------------------------------------------------------

test('sparse report: all three renderers produce "-" placeholders without throwing', () => {
  const renderers: Array<[string, (r: RunReport) => string]> = [
    ['terminal', renderTerminal],
    ['markdown', renderMarkdown],
    ['html', renderHtml],
  ];
  for (const [name, render] of renderers) {
    let out = '';
    assert.doesNotThrow(() => {
      out = render(sparseReport);
    }, `${name} threw on sparse report`);
    assert.equal(typeof out, 'string');
    assert.ok(out.length > 0, `${name} produced empty output`);
    assert.ok(out.includes('-'), `${name} rendered no "-" placeholder`);
    if (name === 'terminal') {
      assert.match(out, /^[\x20-\x7E\n\r]*$/);
      assert.ok(out.includes('(no agents recorded)'));
    }
    if (name === 'markdown') {
      assert.ok(out.includes('_No findings met evidence thresholds._'));
    }
    if (name === 'html') {
      assert.ok(out.startsWith('<!doctype html>'));
      assert.ok(!out.includes('http://') && !out.includes('https://') && !out.includes('<script'));
    }
  }
});

test('renderers are pure: same input yields byte-identical output', () => {
  for (const render of [renderTerminal, renderMarkdown, renderHtml]) {
    assert.equal(render(richReport), render(richReport));
    assert.equal(render(sparseReport), render(sparseReport));
  }
});

// ---------------------------------------------------------------------------
// CLI-first modes: concise default vs --verbose
// ---------------------------------------------------------------------------

test('terminal: concise mode omits deep sections; verbose mode includes them', () => {
  const concise = renderTerminal(richReport);
  assert.ok(concise.includes('=== RUN OVERVIEW ==='));
  assert.ok(concise.includes('=== AGENT PERFORMANCE ==='));
  assert.ok(concise.includes('=== WHAT HAPPENED ==='));
  assert.ok(!concise.includes('=== TASKS ==='), 'task table is verbose-only');
  assert.ok(!concise.includes('=== FILES ==='), 'files section is verbose-only');
  assert.ok(!concise.includes('Evidence:'), 'evidence lines are verbose-only');

  const verbose = renderTerminal(richReport, { verbose: true });
  assert.ok(verbose.includes('=== TASKS ==='));
  assert.ok(verbose.includes('=== FILES ==='));
  assert.ok(verbose.includes('=== ENGINEERING SIGNALS ==='));
  assert.ok(verbose.includes('Evidence:'));
  // recommendations surface in both modes
  assert.ok(concise.includes('=== RECOMMENDATIONS ==='));
  assert.ok(verbose.includes('=== RECOMMENDATIONS ==='));
});

test('terminal: outcome markers and recommendation arrows are ASCII-safe', () => {
  const out = renderTerminal(richReport);
  assert.match(out, /^[\x20-\x7E\n\r]*$/);
  assert.ok(out.includes('+ 2 tasks completed'));
  assert.ok(out.includes('x 1 task failed'));
  assert.ok(out.includes('-> '));
});
