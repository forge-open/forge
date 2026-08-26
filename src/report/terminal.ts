/**
 * Terminal report — the primary Forge surface.
 *
 * Pure function of (RunReport, style options): deterministic bytes for
 * deterministic input. Two presentation modes chosen by the caller:
 *   unicode  - box-drawing header, thin dividers, typographic symbols
 *   ascii    - plain fallback for legacy terminals, CI, and pipes
 * and an optional ANSI color layer (never used for meaning, only emphasis).
 *
 * Dynamic strings from run data are always stripped to ASCII before being
 * embedded; typographic glyphs come only from Forge itself.
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
  /** Typographic mode: box header, ─ dividers, ✓ ✕ → glyphs. */
  unicode?: boolean;
  /** ANSI emphasis (labels dim, statuses tinted). Meaning never depends on it. */
  color?: boolean;
}

interface Glyphs {
  ok: string;
  warn: string;
  info: string;
  fail: string;
  unknown: string;
  arrow: string;
  divider: string;
}

const UNICODE: Glyphs = { ok: '✓', warn: '!', info: '·', fail: '✕', unknown: '?', arrow: '→', divider: '─' };
const ASCII: Glyphs = { ok: '+', warn: '!', info: 'i', fail: 'x', unknown: '?', arrow: '->', divider: '-' };

interface Sink {
  line(s?: string): void;
  blank(): void;
  /** Dim section label followed by a thin divider. */
  section(label: string): void;
  divider(): void;
}

export function renderTerminal(r: RunReport, opts: TerminalOptions = {}): string {
  const verbose = opts.verbose === true;
  const g = opts.unicode === true ? UNICODE : ASCII;
  const color = opts.color === true;
  const ansi = {
    dim: (s: string): string => (color ? `\x1b[2m${s}\x1b[0m` : s),
    ok: (s: string): string => (color ? `\x1b[32m${s}\x1b[0m` : s),
    warn: (s: string): string => (color ? `\x1b[33m${s}\x1b[0m` : s),
    fail: (s: string): string => (color ? `\x1b[31m${s}\x1b[0m` : s),
  };

  const lines: string[] = [];
  const sink: Sink = {
    line(s = ''): void {
      void lines.push(s);
    },
    blank(): void {
      sink.line('');
    },
    section(label: string): void {
      sink.blank();
      sink.line(ansi.dim(label.toUpperCase()));
    },
    divider(): void {
      sink.line(ansi.dim(g.divider.repeat(W)));
    },
  };

  renderHeader(sink, r, g, ansi);
  renderKpis(sink, r, ansi);
  sink.divider();
  renderOutcomes(sink, r, g, ansi);
  renderAgents(sink, r, g, ansi);
  sink.divider();
  renderWhatHappened(sink, r, g, ansi, verbose);
  renderRecommendations(sink, r, g, ansi);
  if (verbose) {
    sink.divider();
    renderTasks(sink, r, ansi);
    renderFiles(sink, r, ansi);
    renderSignals(sink, r);
  }
  renderFooter(sink, r, ansi, verbose);

  return lines.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}

// ---------------------------------------------------------------------------
// Header + KPIs
// ---------------------------------------------------------------------------

function renderHeader(
  out: Sink,
  r: RunReport,
  g: Glyphs,
  ansi: { dim(s: string): string },
): void {
  const project = r.meta.project?.trim() ? ascii(r.meta.project.trim()) : '';
  const subtitleParts = [project, ascii(cell(r.meta.source))].filter((p) => p !== '');
  if (g.divider === '─') {
    // Padding is computed from PLAIN text lengths; ANSI codes add string length
    // but zero display width.
    const title = ' FORGE RUN';
    const sub = subtitleParts.join(' · ');
    const pad = Math.max(0, W - 2 - (title.length + (sub ? 2 : 0) + sub.length));
    out.line(`╭${g.divider.repeat(W - 2)}╮`);
    out.line(`│${title}${sub ? `  ${ansi.dim(sub)}` : ''}${' '.repeat(pad)}│`);
    out.line(`╰${g.divider.repeat(W - 2)}╯`);
  } else {
    out.line('FORGE RUN');
    if (subtitleParts.length > 0) out.line(ansi.dim(subtitleParts.join(' | ')));
    out.line(ansi.dim(g.divider.repeat(W)));
  }
  const win = runWindow(r);
  const metaLine = `run ${cell(r.meta.runId)} | window ${cell(win.start)} -> ${cell(win.end)}${
    r.meta.generator ? ` | ${ascii(cell(r.meta.generator))}` : ''
  }`;
  for (const piece of wrapWords(ansi.dim(metaLine), W)) out.line(piece);
}

function renderKpis(out: Sink, r: RunReport, ansi: { dim(s: string): string }): void {
  const t = r.totals;
  const items = [
    { label: 'AGENTS', value: num(t.agents) },
    { label: 'TASKS', value: num(t.tasks) },
    { label: 'RUNTIME', value: humanizeDuration(t.wallMs) },
    // Missing evidence is "unavailable", never a fabricated zero.
    { label: 'TOKENS', value: t.tokensTotal > 0 ? humanizeTokens(t.tokensTotal) : 'unavailable' },
    { label: 'COST', value: t.costUsd !== undefined ? formatUsd(t.costUsd) : 'unavailable' },
  ];
  const widths = items.map((i) => Math.max(i.label.length, i.value.length));
  out.blank();
  out.line(ansi.dim(items.map((i, idx) => i.label.padEnd(widths[idx])).join('   ')));
  out.line(items.map((i, idx) => i.value.padEnd(widths[idx])).join('   '));
  const notice = costNotice(t);
  if (notice && t.tokensTotal > 0) {
    for (const l of wrapWords(ansi.dim(`note: ${notice}`), W)) out.line(l);
  }
}

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

function renderOutcomes(
  out: Sink,
  r: RunReport,
  g: Glyphs,
  ansi: { dim(s: string): string; ok(s: string): string; warn(s: string): string; fail(s: string): string },
): void {
  const t = r.totals;
  if (t.tasks === 0 && t.agents === 0) return;
  out.section('outcomes');
  const rows: Array<{ glyph: string; text: string; paint: (s: string) => string }> = [];
  if (t.success > 0) rows.push({ glyph: g.ok, text: `${num(t.success)} successful`, paint: ansi.ok });
  if (t.partial > 0) rows.push({ glyph: g.warn, text: `${num(t.partial)} partial`, paint: ansi.warn });
  if (t.failure > 0) rows.push({ glyph: g.fail, text: `${num(t.failure)} failed`, paint: ansi.fail });
  if (t.unknown > 0) rows.push({ glyph: g.unknown, text: `${num(t.unknown)} unknown outcome`, paint: ansi.dim });
  if (rows.length === 0) out.line(ansi.dim('no tasks recorded'));
  for (const row of rows) out.line(`  ${row.paint(row.glyph)} ${row.text}`);
}

// ---------------------------------------------------------------------------
// Agent performance
// ---------------------------------------------------------------------------

function renderAgents(
  out: Sink,
  r: RunReport,
  g: Glyphs,
  ansi: { dim(s: string): string },
): void {
  out.section('agent performance');
  const ordered = orderAgents(r.agents);
  if (ordered.length === 0) {
    out.line(ansi.dim('(no agents recorded)'));
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
  out.line(ansi.dim('* estimated from built-in list prices. FL=files, TL=tool calls.'));

  if (r.totals.tokensTotal > 0) {
    out.blank();
    out.line(ansi.dim(`token share of ${humanizeTokens(r.totals.tokensTotal)} total:`));
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
// What happened + recommendations
// ---------------------------------------------------------------------------

function renderWhatHappened(
  out: Sink,
  r: RunReport,
  g: Glyphs,
  ansi: { dim(s: string): string; warn(s: string): string; fail(s: string): string; ok(s: string): string },
  verbose: boolean,
): void {
  out.section('what happened');
  const t = r.totals;
  if (t.success > 0) out.line(`  ${ansi.ok(g.ok)} ${num(t.success)} task${t.success === 1 ? '' : 's'} completed`);
  if (t.partial > 0) out.line(`  ${ansi.warn(g.warn)} ${num(t.partial)} task${t.partial === 1 ? '' : 's'} partially completed`);
  if (t.failure > 0) out.line(`  ${ansi.fail(g.fail)} ${num(t.failure)} task${t.failure === 1 ? '' : 's'} failed`);
  if (t.unknown > 0) out.line(`  ${ansi.dim(g.unknown)} ${num(t.unknown)} task${t.unknown === 1 ? '' : 's'} with unknown outcome`);

  const insights = sortedInsights(r);
  if (insights.length === 0) {
    if (t.tasks === 0) {
      out.line(ansi.dim('  (nothing recorded)'));
      return;
    }
    out.blank();
    out.line(ansi.dim(`  ${NO_FINDINGS}`));
    return;
  }
  for (const ins of insights) {
    out.blank();
    const isWarn = ins.severity === 'warn';
    const glyph = isWarn ? g.warn : g.info;
    const paint = isWarn ? ansi.warn : ansi.dim;
    out.line(`  ${paint(glyph)} ${truncate(ascii(cell(ins.title)), W - 7)}`);
    labeledBlock(out, 'Observed', ins.observed, ansi);
    if (verbose && ins.evidence.length > 0) labeledBlock(out, 'Evidence', ins.evidence.join('; '), ansi);
  }
}

/** Wrapped prose block with hanging indent aligned under the label text. */
function labeledBlock(
  out: Sink,
  label: string,
  text: string,
  ansi: { dim(s: string): string },
): void {
  const prefix = `    ${label}: `;
  // Insight text embeds run data (paths, titles): strip control/ANSI bytes.
  const parts = wrapWords(ascii(text), W - prefix.length);
  out.line(ansi.dim(prefix) + (parts[0] ?? '-'));
  const cont = ' '.repeat(prefix.length);
  for (let i = 1; i < parts.length; i++) out.line(cont + parts[i]);
}

function renderRecommendations(
  out: Sink,
  r: RunReport,
  g: Glyphs,
  ansi: { dim(s: string): string },
): void {
  const recs = sortedInsights(r).filter(
    (i) => i.recommendation !== undefined && i.recommendation.trim() !== '',
  );
  if (recs.length === 0) return;
  out.section('recommendations');
  for (const ins of recs) {
    const parts = wrapWords(ins.recommendation!.trim(), W - 6);
    out.line(`  ${g.arrow} ${(parts[0] ?? '').trim()}`);
    for (let i = 1; i < parts.length; i++) out.line(`    ${parts[i]}`);
  }
}

// ---------------------------------------------------------------------------
// Pipe tables
// ---------------------------------------------------------------------------

interface AsciiCol {
  h: string;
  align?: 'left' | 'right';
  cap?: number;
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
// Tasks / files / signals (verbose)
// ---------------------------------------------------------------------------

function renderTasks(out: Sink, r: RunReport, ansi: { dim(s: string): string }): void {
  out.section('tasks');
  if (r.tasks.length === 0) {
    out.line(ansi.dim('(no tasks recorded)'));
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
  out.line(ansi.dim('* estimated from built-in list prices.'));
  const hidden = sorted.length - shown.length;
  if (hidden > 0) out.line(ansi.dim(`+${hidden} more tasks not shown.`));
}

function renderFiles(out: Sink, r: RunReport, ansi: { dim(s: string): string }): void {
  out.section('files');
  if (r.files.length === 0) {
    out.line(ansi.dim('(no files recorded)'));
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
    out.line(ansi.dim('* touched by more than one agent (possible duplicated work)'));
  }
  const hidden = sorted.length - shown.length;
  if (hidden > 0) out.line(ansi.dim(`+${hidden} more files not shown.`));
}

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

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

function renderFooter(
  out: Sink,
  r: RunReport,
  ansi: { dim(s: string): string },
  verbose: boolean,
): void {
  out.divider();
  const notes: string[] = [DISCLAIMER_COST, DISCLAIMER_FACTS];
  if (verbose) notes.push(...r.warnings);
  out.blank();
  for (const n of notes) {
    for (const l of wrapWords(n, W)) out.line(ansi.dim(l));
  }
  if (verbose) {
    for (const w of r.warnings) {
      for (const l of wrapWords(ascii(w), W - 2)) out.line(ansi.dim(`- ${l}`.slice(0, W)));
    }
  }
  out.blank();
  out.line(ansi.dim(`${GENERATED_BY} | more: forge report --verbose | forge report --json`));
}
