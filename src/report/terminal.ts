/**
 * Terminal report — STRICT ASCII (codes 32-126 plus \n), no ANSI colors.
 *
 * Pure function of RunReport: deterministic bytes for deterministic input.
 * Never crashes on sparse data; missing values render as "-".
 *
 * Two modes, per the CLI-first product rule (the terminal is the primary UI):
 *   concise (default) - header, run overview, agent performance, what happened,
 *                       recommendations. Readable at a glance, SSH/CI-safe.
 *   verbose           - adds evidence under findings, the full task table,
 *                       files overlap, engineering signals, notes/warnings.
 */
import type { RunReport } from '../core/model.js';
import {
  ascii,
  cell,
  costNotice,
  DISCLAIMER_COST,
  DISCLAIMER_FACTS,
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
  wrapWords,
} from './format.js';

const W = 80; // hard column budget
const BAR_INNER = 22; // width of [#####.....] share bars

export interface TerminalOptions {
  /** Full depth: evidence, task table, files, engineering signals, notes. */
  verbose?: boolean;
}

/** Output sink handed to every section renderer. */
interface Sink {
  /** Push one pre-formatted line (ASCII-sanitized). */
  line(s?: string): void;
  blank(): void;
  section(title: string): void;
  /** "label     value" key-value line with aligned continuation indent. */
  kv(label: string, value: string): void;
}

export function renderTerminal(r: RunReport, opts: TerminalOptions = {}): string {
  const verbose = opts.verbose === true;
  const lines: string[] = [];
  const sink: Sink = {
    line(s = ''): void {
      void lines.push(ascii(s));
    },
    blank(): void {
      sink.line('');
    },
    section(title: string): void {
      sink.blank();
      sink.line(`=== ${cell(title).toUpperCase()} ===`);
    },
    kv(label: string, value: string): void {
      const pad = 10;
      const parts = wrapWords(value, W - pad);
      sink.line(label.padEnd(pad) + (parts[0] ?? ''));
      for (let i = 1; i < parts.length; i++) sink.line(' '.repeat(pad) + parts[i]);
    },
  };

  renderHeader(sink, r);
  renderOverview(sink, r);
  renderAgents(sink, r);
  renderWhatHappened(sink, r, verbose);
  renderRecommendations(sink, r);
  if (verbose) {
    renderTasks(sink, r);
    renderFiles(sink, r);
    renderSignals(sink, r);
  }
  renderFooter(sink, r, verbose);

  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function renderHeader(out: Sink, r: RunReport): void {
  out.line('='.repeat(W));
  out.line(REPORT_TITLE);
  out.line('='.repeat(W));
  out.blank();

  out.kv('run id', cell(r.meta.runId) || '-');
  out.kv('source', cell(r.meta.source) || '-');
  if (r.meta.project !== undefined && r.meta.project.trim() !== '') {
    out.kv('project', cell(r.meta.project));
  }
  if (r.meta.generator !== undefined && r.meta.generator.trim() !== '') {
    out.kv('generator', cell(r.meta.generator));
  }
  const win = runWindow(r);
  out.kv('window', `${cell(win.start)} -> ${cell(win.end)}`);
  out.kv('wall time', humanizeDuration(r.totals.wallMs));
}

// ---------------------------------------------------------------------------
// Overview KPIs
// ---------------------------------------------------------------------------

function renderOverview(out: Sink, r: RunReport): void {
  const t = r.totals;
  out.section('run overview');
  const emit = (s: string): void => {
    for (const piece of s.length <= W ? [s] : wrapWords(s, W)) out.line(piece);
  };

  emit(
    `agents ${num(t.agents)} | tasks ${num(t.tasks)} | duration ${humanizeDuration(t.wallMs)}`,
  );

  let tokens = `tokens ${humanizeTokens(t.tokensTotal)} (in ${humanizeTokens(t.tokensIn)} / out ${humanizeTokens(t.tokensOut)}`;
  if (t.cacheRead + t.cacheWrite > 0) {
    tokens += ` / cache ${humanizeTokens(t.cacheRead + t.cacheWrite)}`;
  }
  tokens += ')';
  emit(tokens);

  emit(
    `outcomes ${num(t.success)} success / ${num(t.partial)} partial / ` +
      `${num(t.failure)} failure / ${num(t.unknown)} unknown`,
  );

  emit(`est. cost (estimated): ${formatUsd(t.costUsd)}`);
  const notice = costNotice(t);
  if (notice) for (const l of wrapWords(`NOTE: ${notice}`, W - 4)) emit(`  ${l}`);
}

// ---------------------------------------------------------------------------
// What happened: outcome rollup + fact titles (+evidence when verbose)
// ---------------------------------------------------------------------------

function renderWhatHappened(out: Sink, r: RunReport, verbose: boolean): void {
  out.section('what happened');
  const t = r.totals;
  if (t.success > 0) out.line(`+ ${num(t.success)} task${t.success === 1 ? '' : 's'} completed`);
  if (t.partial > 0) out.line(`! ${num(t.partial)} task${t.partial === 1 ? '' : 's'} partially completed`);
  if (t.failure > 0) out.line(`x ${num(t.failure)} task${t.failure === 1 ? '' : 's'} failed`);
  if (t.unknown > 0) out.line(`? ${num(t.unknown)} task${t.unknown === 1 ? '' : 's'} with unknown outcome`);

  const insights = sortedInsights(r);
  if (insights.length === 0) {
    if (t.tasks === 0) {
      out.line('(nothing recorded)');
      return;
    }
    out.blank();
    out.line(NO_FINDINGS);
    return;
  }
  for (const ins of insights) {
    out.blank();
    const marker = ins.severity === 'warn' ? '[!]' : '[i]';
    out.line(`${marker} ${truncate(cell(ins.title), W - 5)}`);
    labeledBlock(out, 'Observed', ins.observed);
    if (verbose && ins.evidence.length > 0) labeledBlock(out, 'Evidence', ins.evidence.join('; '));
  }
}

/** Wrapped prose block with hanging indent aligned under the label text. */
function labeledBlock(out: Sink, label: string, text: string): void {
  const prefix = `${' '.repeat(4)}${label}: `;
  const parts = wrapWords(text, W - prefix.length);
  out.line(prefix + (parts[0] ?? '-'));
  const cont = ' '.repeat(prefix.length);
  for (let i = 1; i < parts.length; i++) out.line(cont + parts[i]);
}

// ---------------------------------------------------------------------------
// Recommendations: clearly-labeled inferences, never presented as facts
// ---------------------------------------------------------------------------

function renderRecommendations(out: Sink, r: RunReport): void {
  const recs = sortedInsights(r).filter(
    (i) => i.recommendation !== undefined && i.recommendation.trim() !== '',
  );
  if (recs.length === 0) return;
  out.section('recommendations');
  for (const ins of recs) {
    const parts = wrapWords(ins.recommendation!.trim(), W - 4);
    out.line(`-> ${(parts[0] ?? '').trim()}`);
    for (let i = 1; i < parts.length; i++) out.line(`   ${parts[i]}`);
  }
}

// ---------------------------------------------------------------------------
// Pipe tables
// ---------------------------------------------------------------------------

interface AsciiCol {
  h: string;
  align?: 'left' | 'right';
  /** Hard cap for auto-sizing. */
  cap?: number;
  /** Minimum width kept while shrinking (protects ids/amounts from mangling). */
  min?: number;
}

/**
 * Fixed-budget pipe table: pads/truncates so no line ever exceeds 80 columns.
 * When over budget, the widest shrinkable column loses one character per step
 * (level-by-level, so no single column collapses first). Headers may truncate
 * only after every column has hit its floor.
 */
function asciiTable(cols: AsciiCol[], rows: string[][]): string[] {
  const gap = 3; // " | "
  const floorOf = (i: number): number => Math.max(cols[i].h.length, cols[i].min ?? 1);
  const widths = cols.map((c, i) =>
    Math.max(
      floorOf(i),
      Math.min(c.cap ?? 40, Math.max(c.h.length, ...rows.map((row) => (row[i] ?? '').length))),
    ),
  );
  const totalWidth = (): number => widths.reduce((a, b) => a + b, 0) + gap * (cols.length - 1);
  let guard = 4000;
  while (totalWidth() > W && guard-- > 0) {
    const candidate = cols
      .map((_, i) => i)
      .filter((i) => widths[i] > floorOf(i))
      .sort((a, b) => widths[b] - widths[a] || a - b)[0];
    if (candidate === undefined) break;
    widths[candidate]--;
  }
  const fmtRow = (cells: string[]): string => {
    const rendered = cells
      .map((raw, i) => {
        const s = raw.length > widths[i] ? raw.slice(0, widths[i]) : raw;
        return cols[i].align === 'right' ? s.padStart(widths[i]) : s.padEnd(widths[i]);
      })
      .join(' | ');
    return rendered.replace(/\s+$/, '');
  };
  const rowWidth = widths.reduce((a, b) => a + b, 0) + gap * (cols.length - 1);
  return [
    fmtRow(cols.map((c) => c.h)),
    '-'.repeat(Math.max(1, rowWidth)),
    ...rows.map(fmtRow),
  ];
}

/** Keep the TAIL of an over-long identifier (model ids differ at the end). */
function tailClip(s: string, width: number): string {
  if (width <= 0) return '';
  if (s.length <= width) return s;
  if (width <= 2) return s.slice(s.length - width);
  return '..' + s.slice(-(width - 2));
}

function agentTreeLabel(name: string, depth: number): string {
  return depth === 0 ? name : `${'  '.repeat(depth - 1)}\\_ ${name}`;
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

function renderAgents(out: Sink, r: RunReport): void {
  out.section('agent performance');
  const ordered = orderAgents(r.agents);
  if (ordered.length === 0) {
    out.line('(no agents recorded)');
    return;
  }

  const rows = ordered.map(({ agent: a, depth }) => {
    const unknownTasks = Math.max(
      0,
      a.taskCount - a.successCount - a.failureCount - a.partialCount,
    );
    const modelList = cell(modelsUsed(a.models));
    const primaryModel = modelList === '' ? '-' : tailClip(modelList.split(',')[0].trim(), 7);
    return [
      agentTreeLabel(cell(a.name || a.agentId), depth),
      primaryModel,
      `${num(a.successCount)}/${num(a.failureCount)}/${num(a.partialCount)}/${num(unknownTasks)}`,
      `${humanizeTokens(a.tokensIn)}/${humanizeTokens(a.tokensOut)}`,
      formatUsd(a.costUsd),
      num(a.toolCalls),
      `${num(a.errors)}/${num(a.retries)}`,
      num(a.filesTouched.length),
    ];
  });
  for (const l of asciiTable(
    [
      { h: 'AGENT', cap: 24, min: 13 },
      { h: 'MODEL', cap: 9 },
      { h: 'S/F/P/U', min: 7 },
      { h: 'IN/OUT', align: 'right', cap: 14, min: 10 },
      { h: 'COST*', align: 'right', cap: 9, min: 7 },
      { h: 'TL', align: 'right', min: 2 },
      { h: 'ERR/RT', align: 'right', min: 6 },
      { h: 'FL', align: 'right', min: 2 },
    ],
    rows,
  )) {
    out.line(l);
  }
  out.line('* estimated from built-in list prices. FL=files, TL=tool calls.');

  // Token-share bars, one per agent (children indented like the table).
  if (r.totals.tokensTotal > 0) {
    out.blank();
    out.line(`token share of ${humanizeTokens(r.totals.tokensTotal)} total:`);
    const labels = ordered.map(({ agent: a, depth }) =>
      truncate(agentTreeLabel(cell(a.name || a.agentId), depth), 26),
    );
    const labelWidth = Math.max(...labels.map((l) => l.length));
    ordered.forEach(({ agent: a }, i) => {
      const fill = Math.min(
        BAR_INNER,
        Math.max(0, Math.round((a.tokensTotal / r.totals.tokensTotal) * BAR_INNER)),
      );
      const bar = `[${'#'.repeat(fill)}${'.'.repeat(BAR_INNER - fill)}]`;
      out.line(
        `${labels[i].padEnd(labelWidth)} ${bar} ${pct(a.tokensTotal, r.totals.tokensTotal)}`,
      );
    });
  }
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

function renderTasks(out: Sink, r: RunReport): void {
  out.section('tasks');
  if (r.tasks.length === 0) {
    out.line('(no tasks recorded)');
    return;
  }
  const agentNames = new Map(r.agents.map((a) => [a.agentId, cell(a.name || a.agentId)]));
  const sorted = r.tasks
    .slice()
    .sort(
      (x, y) =>
        (y.startedAt ?? '').localeCompare(x.startedAt ?? '') ||
        x.taskId.localeCompare(y.taskId),
    );
  const shown = sorted.slice(0, 15);
  const rows = shown.map((t) => [
    cell(t.taskId),
    truncate(cell(t.title), 30),
    cell(t.agentId !== undefined ? agentNames.get(t.agentId) ?? t.agentId : '-') || '-',
    t.status,
    humanizeDuration(t.durationMs),
    humanizeTokens(t.tokensTotal),
    formatUsd(t.costUsd),
    num(t.toolCalls),
    `${num(t.errors)}/${num(t.retries)}`,
  ]);
  for (const l of asciiTable(
    [
      { h: 'ID', cap: 12, min: 7 },
      { h: 'TITLE', cap: 20, min: 10 },
      { h: 'AGENT', cap: 14, min: 4 },
      { h: 'STATUS', min: 7 },
      { h: 'DUR', align: 'right', min: 7 },
      { h: 'TOKENS', align: 'right', cap: 8, min: 6 },
      { h: 'COST*', align: 'right', cap: 8, min: 6 },
      { h: 'TL', align: 'right', min: 2 },
      { h: 'ERR/RT', align: 'right', min: 6 },
    ],
    rows,
  )) {
    out.line(l);
  }
  out.line('* estimated from built-in list prices.');
  const hidden = sorted.length - shown.length;
  if (hidden > 0) out.line(`+${hidden} more tasks not shown.`);
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

function renderFiles(out: Sink, r: RunReport): void {
  out.section('files');
  if (r.files.length === 0) {
    out.line('(no files recorded)');
    return;
  }
  const sorted = r.files
    .slice()
    .sort((x, y) => y.writes - x.writes || x.path.localeCompare(y.path));
  const shown = sorted.slice(0, 10);
  const rows = shown.map((f) => [
    truncate(cell(f.path), 46),
    num(f.writes),
    f.agents.length > 1 ? `* ${cell(f.agents.join(', '))}` : cell(f.agents.join(', ')) || '-',
  ]);
  for (const l of asciiTable(
    [
      { h: 'FILE', cap: 42 },
      { h: 'WRITES', align: 'right', cap: 7 },
      { h: 'AGENTS', cap: 26 },
    ],
    rows,
  )) {
    out.line(l);
  }
  if (sorted.some((f) => f.agents.length > 1)) {
    out.line('* touched by more than one agent (possible duplicated work)');
  }
  const hidden = sorted.length - shown.length;
  if (hidden > 0) out.line(`+${hidden} more files not shown.`);
}

// ---------------------------------------------------------------------------
// Engineering signals + footer
// ---------------------------------------------------------------------------

function renderSignals(out: Sink, r: RunReport): void {
  out.section('engineering signals');
  const s = r.engineering;
  const tests =
    s.testFailures === null || s.testFailures === undefined
      ? num(s.testRuns)
      : `${num(s.testRuns)} (${num(s.testFailures)} failed)`;
  const parts = [
    `test runs ${tests}`,
    `commits ${num(s.commits)}`,
    `build checks ${num(s.buildChecks)}`,
    `files changed ${num(s.filesChanged)}`,
    `api errors ${num(s.apiErrors)}`,
    `retries ${num(s.retries)}`,
    `errors ${num(s.errors)}`,
  ];
  for (const l of wrapWords(parts.join(' | '), W)) out.line(l);
}

function renderFooter(out: Sink, r: RunReport, verbose: boolean): void {
  if (verbose) {
    out.section('notes');
    for (const l of wrapWords(DISCLAIMER_COST, W)) out.line(l);
    for (const l of wrapWords(DISCLAIMER_FACTS, W)) out.line(l);
    for (const w of r.warnings) {
      for (const l of wrapWords(w, W - 2)) out.line(`- ${l}`.slice(0, W));
    }
  } else {
    out.blank();
    out.line('costs are estimates from built-in public list prices.');
    out.line('facts come from recorded events; suggestions are rule-based inferences.');
  }
  out.blank();
  out.line(GENERATED_BY);
}
