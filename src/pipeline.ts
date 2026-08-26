import path from 'node:path';
import fsp from 'node:fs/promises';
import { forgeRoot } from './core/store.js';
import { parseEventsJsonl } from './core/events.js';
import { loadPriceTable } from './core/cost-io.js';
import { analyzeRun } from './core/analyze.js';
import { renderMarkdown } from './report/markdown.js';
import { renderHtml } from './report/html.js';
import { renderTerminal } from './report/terminal.js';
import type { RunMeta, RunReport } from './core/model.js';

/**
 * Report pipeline shared by the CLI and scripts: load a stored run -> canonical
 * events -> analyze -> render surfaces. File writing is opt-in so `forge show`
 * stays read-only.
 */

export async function resolveRunMeta(ref?: string): Promise<RunMeta | null> {
  const { resolveRunRef } = await import('./core/store.js');
  return resolveRunRef(ref);
}

export interface GeneratedReport {
  meta: RunMeta;
  /** The computed artifact - machine-readable consumers want this object. */
  report: RunReport;
  terminal: string;
  markdownPath?: string;
  htmlPath?: string;
}

export async function generateReport(
  ref: string | undefined,
  opts: { writeFiles: boolean; verbose?: boolean },
): Promise<GeneratedReport | null> {
  const { resolveRunRef, readRunEvents } = await import('./core/store.js');
  const meta = await resolveRunRef(ref ?? 'latest');
  if (!meta) return null;
  const { text } = await readRunEvents(meta.runId);
  const parsed = parseEventsJsonl(text);
  const { table, problems } = await loadPriceTable(forgeRoot());
  const report = analyzeRun(meta, parsed.events, table);
  const warnings = [...problems, ...parsed.warnings.slice(0, 20)];
  report.warnings.push(...warnings);

  const out: GeneratedReport = {
    meta,
    report,
    terminal: renderTerminal(report, { verbose: opts.verbose === true }),
  };
  if (opts.writeFiles) {
    // runDirFor enforces the strict run-id pattern before any path is built.
    const { runDirFor } = await import('./core/store.js');
    const dir = runDirFor(meta.runId);
    const mdPath = path.join(dir, 'report.md');
    const htmlPath = path.join(dir, 'report.html');
    await fsp.writeFile(mdPath, renderMarkdown(report), 'utf8');
    await fsp.writeFile(htmlPath, renderHtml(report), 'utf8');
    out.markdownPath = mdPath;
    out.htmlPath = htmlPath;
  }
  return out;
}
