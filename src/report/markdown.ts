/**
 * Markdown report (GitHub-flavored).
 *
 * Pure function of RunReport; deterministic bytes; safe on sparse data.
 * Every dynamic string is HTML-escaped (& < > " ') before being embedded, so
 * hostile titles/paths can never inject markup into a rendered MD viewer.
 */
import type { RunReport } from '../core/model.js';
import {
  costNotice,
  DISCLAIMER_COST,
  DISCLAIMER_FACTS,
  escapeHtml,
  formatUsd,
  GENERATED_BY,
  humanizeDuration,
  humanizeTokens,
  modelsUsed,
  NO_FINDINGS,
  num,
  orderAgents,
  pct,
  REPORT_TITLE,
  runWindow,
  sortedInsights,
  truncate,
} from './format.js';

export function renderMarkdown(r: RunReport): string {
  const parts: string[] = [];
  const push = (s = ''): void => void parts.push(s);

  renderHeader(push, r);
  renderOverview(push, r);
  renderFindings(push, r);
  renderAgents(push, r);
  renderTasks(push, r);
  renderFiles(push, r);
  renderSignals(push, r);
  renderFooter(push, r);

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Cell escaping for pipe tables
// ---------------------------------------------------------------------------

/** Escape a value for use inside a GFM table cell (pipes and backticks neutralized). */
function md(v: unknown): string {
  return escapeHtml(String(v))
    .replace(/\|/g, '\\|')
    .replace(/`/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Escape a value for use inside a markdown inline code span. */
function codeSpan(v: unknown): string {
  return '`' + String(v).replace(/`/g, "'").replace(/[\r\n]+/g, ' ').trim() + '`';
}

function row(cells: string[]): string {
  return `| ${cells.join(' | ')} |`;
}

function alignRow(specs: Array<'l' | 'r'>): string {
  return `| ${specs.map((s) => (s === 'r' ? '---:' : ':---')).join(' | ')} |`;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function renderHeader(push: (s?: string) => void, r: RunReport): void {
  push(`# ${REPORT_TITLE}`);
  push();
  const e = escapeHtml;
  const kv = (k: string, v: string): string => `**${k}:** ${v}  `;
  push(kv('Run ID', codeSpan(r.meta.runId)));
  push(kv('Source', codeSpan(r.meta.source)));
  if (r.meta.project !== undefined && r.meta.project.trim() !== '') {
    push(kv('Project', codeSpan(r.meta.project)));
  }
  if (r.meta.generator !== undefined && r.meta.generator.trim() !== '') {
    push(kv('Generator', e(r.meta.generator)));
  }
  const win = runWindow(r);
  push(
    kv(
      'Window',
      `${e(win.start)} → ${e(win.end)}`,
    ),
  );
  push(kv('Wall duration', humanizeDuration(r.totals.wallMs)));
}

function renderOverview(push: (s?: string) => void, r: RunReport): void {
  const t = r.totals;
  push();
  push('## Overview');
  push();
  push(row(['Metric', 'Value']));
  push(alignRow(['l', 'l']));
  push(row(['Agents', md(num(t.agents))]));
  push(row(['Tasks', md(num(t.tasks))]));
  push(row(['Duration', md(humanizeDuration(t.wallMs))]));
  push(row(['Tokens (total)', md(humanizeTokens(t.tokensTotal))]));
  push(
    row([
      'Tokens in / out',
      `${md(humanizeTokens(t.tokensIn))} / ${md(humanizeTokens(t.tokensOut))}`,
    ]),
  );
  if (t.cacheRead + t.cacheWrite > 0) {
    push(row(['Tokens cache (read + write)', md(humanizeTokens(t.cacheRead + t.cacheWrite))]));
  }
  push(row(['Estimated cost*', md(formatUsd(t.costUsd))]));
  push(
    row([
      'Outcomes',
      `${md(num(t.success))} success / ${md(num(t.partial))} partial / ` +
        `${md(num(t.failure))} failure / ${md(num(t.unknown))} unknown`,
    ]),
  );
  const notice = costNotice(t);
  if (notice) {
    push();
    push(`*Note: ${escapeHtml(notice)}*`);
  }
}

function renderFindings(push: (s?: string) => void, r: RunReport): void {
  push();
  push('## Findings');
  const insights = sortedInsights(r);
  if (insights.length === 0) {
    push();
    push(`_${NO_FINDINGS}_`);
    return;
  }
  for (const ins of insights) {
    push();
    push(`### [${md(ins.severity)}] ${md(ins.title)}`);
    push();
    push(`> **Observed:** ${escapeHtml(ins.observed).replace(/\s+/g, ' ').trim()}`);
    if (ins.evidence.length > 0) {
      const ev = escapeHtml(ins.evidence.join('; ')).replace(/\s+/g, ' ').trim();
      push(`> **Evidence:** ${ev}`);
    }
    if (ins.recommendation !== undefined && ins.recommendation.trim() !== '') {
      push('>');
      push(
        `> *Suggestion:* ${escapeHtml(ins.recommendation).replace(/\s+/g, ' ').trim()}`,
      );
    }
  }
}

function renderAgents(push: (s?: string) => void, r: RunReport): void {
  push();
  push('## Agents');
  const ordered = orderAgents(r.agents);
  if (ordered.length === 0) {
    push();
    push('_No agents recorded._');
    return;
  }
  push();
  push(
    row([
      'Agent',
      'Models',
      'Tasks S/F/P/U',
      'Tokens in',
      'Tokens out',
      'Est. cost*',
      'Tools',
      'Err/Ret',
      'Files',
      'Share',
    ]),
  );
  push(alignRow(['l', 'l', 'l', 'r', 'r', 'r', 'r', 'r', 'r', 'r']));
  for (const { agent: a, depth } of ordered) {
    const label = depth === 0 ? a.name || a.agentId : `└ ${a.name || a.agentId}`;
    const unknownTasks = Math.max(
      0,
      a.taskCount - a.successCount - a.failureCount - a.partialCount,
    );
    push(
      row([
        md(label),
        md(modelsUsed(a.models) || '-'),
        `${md(a.successCount)}/${md(a.failureCount)}/${md(a.partialCount)}/${md(unknownTasks)}`,
        md(humanizeTokens(a.tokensIn)),
        md(humanizeTokens(a.tokensOut)),
        md(formatUsd(a.costUsd)),
        md(a.toolCalls),
        `${md(a.errors)}/${md(a.retries)}`,
        md(a.filesTouched.length),
        md(pct(a.tokensTotal, r.totals.tokensTotal)),
      ]),
    );
  }
  push();
  push('_\\* estimated from built-in public list prices._');
}

function renderTasks(push: (s?: string) => void, r: RunReport): void {
  push();
  push('## Tasks');
  if (r.tasks.length === 0) {
    push();
    push('_No tasks recorded._');
    return;
  }
  const agentNames = new Map(r.agents.map((a) => [a.agentId, a.name || a.agentId]));
  const sorted = r.tasks
    .slice()
    .sort(
      (x, y) =>
        (y.startedAt ?? '').localeCompare(x.startedAt ?? '') ||
        x.taskId.localeCompare(y.taskId),
    );
  const shown = sorted.slice(0, 15);
  push();
  push(
    row([
      'Task ID',
      'Title',
      'Agent',
      'Status',
      'Duration',
      'Tokens',
      'Est. cost*',
      'Tools',
      'Err/Ret',
    ]),
  );
  push(alignRow(['l', 'l', 'l', 'l', 'r', 'r', 'r', 'r', 'r']));
  for (const t of shown) {
    push(
      row([
        md(t.taskId),
        md(truncate(t.title, 60)),
        md(t.agentId !== undefined ? agentNames.get(t.agentId) ?? t.agentId : '-'),
        md(t.status),
        md(humanizeDuration(t.durationMs)),
        md(humanizeTokens(t.tokensTotal)),
        md(formatUsd(t.costUsd)),
        md(t.toolCalls),
        `${md(t.errors)}/${md(t.retries)}`,
      ]),
    );
  }
  const hidden = sorted.length - shown.length;
  if (hidden > 0) {
    push();
    push(`_+${hidden} more tasks not shown._`);
  }
}

function renderFiles(push: (s?: string) => void, r: RunReport): void {
  push();
  push('## Files');
  if (r.files.length === 0) {
    push();
    push('_No files recorded._');
    return;
  }
  push();
  push(row(['File', 'Writes', 'Agents']));
  push(alignRow(['l', 'r', 'l']));
  const sorted = r.files
    .slice()
    .sort((x, y) => y.writes - x.writes || x.path.localeCompare(y.path));
  const shown = sorted.slice(0, 10);
  let hasShared = false;
  for (const f of shown) {
    if (f.agents.length > 1) hasShared = true;
    const agentsCell =
      f.agents.length > 1 ? `**shared:** ${md(f.agents.join(', '))}` : md(f.agents.join(', ')) || '-';
    push(row([`\`${md(truncate(f.path, 60))}\``, md(f.writes), agentsCell]));
  }
  const hidden = sorted.length - shown.length;
  if (hasShared || hidden > 0) push();
  if (hasShared) push('_shared = touched by more than one agent (possible duplicated work)._');
  if (hidden > 0) push(`_+${hidden} more files not shown._`);
}

function renderSignals(push: (s?: string) => void, r: RunReport): void {
  push();
  push('## Engineering signals');
  push();
  const s = r.engineering;
  const testFailures =
    s.testFailures === null || s.testFailures === undefined
      ? '-'
      : String(s.testFailures);
  push(row(['Signal', 'Value']));
  push(alignRow(['l', 'r']));
  push(row(['Test runs', md(s.testRuns)]));
  push(row(['Test failures', md(testFailures)]));
  push(row(['Commits', md(s.commits)]));
  push(row(['Build checks', md(s.buildChecks)]));
  push(row(['Files changed', md(s.filesChanged)]));
  push(row(['API errors', md(s.apiErrors)]));
  push(row(['Retries', md(s.retries)]));
  push(row(['Errors', md(s.errors)]));
}

function renderFooter(push: (s?: string) => void, r: RunReport): void {
  push();
  push('---');
  push();
  if (r.warnings.length > 0) {
    for (const w of r.warnings) push(`- Warning: ${escapeHtml(w).replace(/\s+/g, ' ').trim()}`);
    push();
  }
  push(`_${DISCLAIMER_COST}_`);
  push();
  push(`_${DISCLAIMER_FACTS}_`);
  push();
  push(`_${GENERATED_BY}._`);
}
