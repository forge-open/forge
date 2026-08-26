/**
 * Self-contained HTML report: single file, inline CSS, no JavaScript, no
 * external fonts/scripts/images/CDN — renders offline via file://.
 *
 * Pure function of RunReport; deterministic bytes; safe on sparse data.
 * SECURITY: every dynamic string passes through escapeHtml (attribute-safe)
 * before being embedded. Numeric style values (bar widths) come from clamped
 * numeric helpers only.
 */
import type { AgentStats, FileStats, Insight, RunReport, TaskStats } from '../core/model.js';
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
  pctNum,
  REPORT_TITLE,
  runWindow,
  sortedInsights,
  truncate,
} from './format.js';

const CSS = `
:root{--bg:#f8fafc;--card:#ffffff;--ink:#0f172a;--mut:#475569;--line:#e2e8f0;--acc:#4f46e5;--acc-soft:#eef2ff}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;font-variant-numeric:tabular-nums}
.page{max-width:980px;margin:0 auto;padding:40px 24px 72px}
h1{font-size:26px;line-height:1.2;margin:0;letter-spacing:.02em}
h2{font-size:12px;text-transform:uppercase;letter-spacing:.09em;color:var(--mut);margin:0 0 6px}
.sub{color:var(--mut);margin:4px 0 0}
.meta{display:flex;flex-wrap:wrap;gap:10px 32px;margin-top:16px;font-size:13px;color:var(--mut)}
.meta .k{display:block;text-transform:uppercase;font-size:10px;letter-spacing:.08em}
.meta .v{color:var(--ink);font-weight:600}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:18px 20px;margin-top:18px}
.kpis{display:flex;flex-wrap:wrap;gap:12px;margin-top:18px}
.kpi{flex:1 1 150px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.kpi.grow{flex:2 1 260px}
.note{font-size:12px;color:var(--mut);margin-top:3px}
.label{font-size:10px;text-transform:uppercase;letter-spacing:.09em;color:var(--mut)}
.kpi .value{font-size:22px;font-weight:650;margin-top:4px;font-variant-numeric:tabular-nums}
.stat .value{font-size:18px;font-weight:650;margin-top:3px;font-variant-numeric:tabular-nums}
.note.warnnote{color:#92400e}
.badges{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.badge{display:inline-block;padding:1px 9px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap}
.st-success{background:#ecfdf5;color:#047857}
.st-failure{background:#fef2f2;color:#b91c1c}
.st-partial{background:#fffbeb;color:#b45309}
.st-unknown{background:#f1f5f9;color:#475569}
.sev-warn{background:var(--acc-soft);color:var(--acc)}
.sev-info{background:#f1f5f9;color:#475569}
.ovl{background:#fffbeb;color:#b45309}
table{width:100%;border-collapse:collapse;margin-top:10px;font-size:13.5px}
th{text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--mut);border-bottom:1px solid var(--line);padding:7px 10px;font-weight:600}
td{padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
tbody tr:last-child td{border-bottom:none}
th.n,td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;font-size:.93em}
.small{font-size:12px}
.mut{color:var(--mut)}
.bar{height:8px;background:#e8edf3;border-radius:4px;overflow:hidden;margin-top:5px;min-width:70px}
.fill{height:100%;background:var(--acc)}
.finding{border:1px solid var(--line);border-left:3px solid #cbd5e1;border-radius:8px;padding:12px 14px;margin-top:12px}
.finding.fwarn{border-left-color:var(--acc)}
.fact{margin:8px 0 0}
.sug{margin:8px 0 0;color:var(--mut);border-top:1px dashed var(--line);padding-top:8px}
.ev{margin:8px 0 0;color:var(--mut);font-size:12px}
.signals{display:flex;flex-wrap:wrap;gap:12px}
.stat{flex:1 1 110px;border:1px solid var(--line);border-radius:8px;padding:10px 12px}
.stat .value{font-size:18px;font-weight:650;margin-top:3px}
.empty{color:var(--mut);margin:8px 0 0}
.more{color:var(--mut);font-style:italic;margin:10px 0 0;font-size:13px}
footer{margin-top:26px;color:var(--mut);font-size:12.5px;font-style:italic}
footer p{margin:4px 0}
`.trim();

export function renderHtml(r: RunReport): string {
  const e = escapeHtml;
  const m = r.meta;
  const win = runWindow(r);
  const out: string[] = [];

  out.push('<!doctype html>');
  out.push('<html lang="en">');
  out.push('<head>');
  out.push('<meta charset="utf-8">');
  out.push('<meta name="viewport" content="width=device-width, initial-scale=1">');
  out.push(`<title>${e(`Forge Run Report - ${m.runId}`)}</title>`);
  out.push(`<style>${CSS}</style>`);
  out.push('</head>');
  out.push('<body>');
  out.push('<main class="page">');

  // -- header ----------------------------------------------------------------
  out.push('<header>');
  out.push(`<h1>${e(REPORT_TITLE)}</h1>`);
  out.push(`<p class="sub mono">${e(m.runId)}</p>`);
  const metaRows: string[] = [];
  metaRows.push(metaCell('Source', e(m.source)));
  if (m.project !== undefined && m.project.trim() !== '') {
    metaRows.push(metaCell('Project', `<span class="mono">${e(m.project)}</span>`));
  }
  if (m.generator !== undefined && m.generator.trim() !== '') {
    metaRows.push(metaCell('Generator', e(m.generator)));
  }
  metaRows.push(metaCell('Recorded', e(m.createdAt)));
  metaRows.push(
    metaCell(
      'Activity window',
      `${e(win.start)} <span class="mut">&rarr;</span> ${e(win.end)}`,
    ),
  );
  metaRows.push(metaCell('Wall duration', humanizeDuration(r.totals.wallMs)));
  out.push(`<div class="meta">${metaRows.join('')}</div>`);
  out.push('</header>');

  // -- overview KPI cards ----------------------------------------------------
  const t = r.totals;
  const notice = costNotice(t);
  let tokensNote = `in ${humanizeTokens(t.tokensIn)} &middot; out ${humanizeTokens(t.tokensOut)}`;
  if (t.cacheRead + t.cacheWrite > 0) {
    tokensNote += ` &middot; cache ${humanizeTokens(t.cacheRead + t.cacheWrite)}`;
  }
  const costNoteClass = t.costUsd === undefined ? 'note warnnote' : 'note';
  const costNoteText =
    t.costUsd === undefined
      ? `estimate &middot; ${escapeHtml(notice ?? 'pricing unavailable')}`
      : notice !== null
        ? `estimate &middot; list prices &middot; ${escapeHtml(notice)}`
        : 'estimate &middot; built-in public list prices';
  out.push('<section class="kpis" aria-label="Run overview">');
  out.push(kpiCard('Agents', num(t.agents), ''));
  out.push(kpiCard('Tasks', num(t.tasks), ''));
  out.push(kpiCard('Duration', humanizeDuration(t.wallMs), ''));
  out.push(kpiCard('Tokens', humanizeTokens(t.tokensTotal), tokensNote));
  out.push(kpiCard('Estimated cost', formatUsd(t.costUsd), costNoteText, costNoteClass));
  out.push(
    kpiCard(
      'Outcomes',
      '',
      [
        badge(t.success, 'success', 'st-success'),
        badge(t.partial, 'partial', 'st-partial'),
        badge(t.failure, 'failure', 'st-failure'),
        badge(t.unknown, 'unknown', 'st-unknown'),
      ].join(' '),
      '',
      true,
    ),
  );
  out.push('</section>');

  // -- findings --------------------------------------------------------------
  out.push('<section class="card">');
  out.push('<h2>Findings</h2>');
  const insights = sortedInsights(r);
  if (insights.length === 0) {
    out.push(`<p class="empty">${e(NO_FINDINGS)}</p>`);
  } else {
    for (const ins of insights) out.push(findingBlock(ins));
  }
  out.push('</section>');

  // -- agents ----------------------------------------------------------------
  out.push('<section class="card">');
  out.push('<h2>Agents</h2>');
  const ordered = orderAgents(r.agents);
  if (ordered.length === 0) {
    out.push('<p class="empty">No agents recorded.</p>');
  } else {
    const head =
      '<tr><th>Agent</th><th>Models</th><th class="n">Tasks S/F/P/U</th>' +
      '<th class="n">Tokens in</th><th class="n">Tokens out</th><th class="n">Est. cost*</th>' +
      '<th class="n">Tools</th><th class="n">Err/Ret</th><th class="n">Files</th>' +
      '<th class="n">Token share</th></tr>';
    const body = ordered.map(({ agent: a, depth }) => agentRow(a, depth, r)).join('');
    out.push(`<table><thead>${head}</thead><tbody>${body}</tbody></table>`);
    out.push('<p class="more small">* estimated from built-in public list prices.</p>');
  }
  out.push('</section>');

  // -- tasks -----------------------------------------------------------------
  out.push('<section class="card">');
  out.push('<h2>Tasks</h2>');
  if (r.tasks.length === 0) {
    out.push('<p class="empty">No tasks recorded.</p>');
  } else {
    const agentNames = new Map(r.agents.map((a) => [a.agentId, a.name || a.agentId]));
    const sorted = r.tasks
      .slice()
      .sort(
        (x, y) =>
          (y.startedAt ?? '').localeCompare(x.startedAt ?? '') ||
          x.taskId.localeCompare(y.taskId),
      );
    const shown = sorted.slice(0, 15);
    const head =
      '<tr><th>Task</th><th>Title</th><th>Agent</th><th>Status</th><th class="n">Duration</th>' +
      '<th class="n">Tokens</th><th class="n">Est. cost*</th><th class="n">Tools</th>' +
      '<th class="n">Err/Ret</th></tr>';
    const body = shown.map((task) => taskRow(task, agentNames)).join('');
    out.push(`<table><thead>${head}</thead><tbody>${body}</tbody></table>`);
    const hidden = sorted.length - shown.length;
    if (hidden > 0) out.push(`<p class="more">+${num(hidden)} more tasks not shown.</p>`);
  }
  out.push('</section>');

  // -- files -----------------------------------------------------------------
  out.push('<section class="card">');
  out.push('<h2>Files</h2>');
  if (r.files.length === 0) {
    out.push('<p class="empty">No files recorded.</p>');
  } else {
    const sorted = r.files
      .slice()
      .sort((x, y) => y.writes - x.writes || x.path.localeCompare(y.path));
    const shown = sorted.slice(0, 10);
    const head = '<tr><th>File</th><th class="n">Writes</th><th>Agents</th></tr>';
    const body = shown.map(fileRow).join('');
    out.push(`<table><thead>${head}</thead><tbody>${body}</tbody></table>`);
    const hidden = sorted.length - shown.length;
    if (sorted.some((f) => f.agents.length > 1)) {
      out.push(
        '<p class="more small">Shared files were touched by more than one agent (possible duplicated work).</p>',
      );
    }
    if (hidden > 0) out.push(`<p class="more">+${num(hidden)} more files not shown.</p>`);
  }
  out.push('</section>');

  // -- engineering signals ---------------------------------------------------
  const s = r.engineering;
  const failuresKnown = s.testFailures !== null && s.testFailures !== undefined;
  out.push('<section class="card">');
  out.push('<h2>Engineering signals</h2>');
  out.push('<div class="signals">');
  out.push(stat('Test runs', num(s.testRuns), failuresKnown ? `${num(s.testFailures)} failed` : 'failures unknown'));
  out.push(stat('Commits', num(s.commits), ''));
  out.push(stat('Build checks', num(s.buildChecks), ''));
  out.push(stat('Files changed', num(s.filesChanged), ''));
  out.push(stat('API errors', num(s.apiErrors), ''));
  out.push(stat('Retries', num(s.retries), ''));
  out.push(stat('Errors', num(s.errors), ''));
  out.push('</div>');
  out.push('</section>');

  // -- footer ----------------------------------------------------------------
  out.push('<footer>');
  if (r.warnings.length > 0) {
    for (const w of r.warnings) {
      out.push(`<p>Adapter warning: ${e(w)}</p>`);
    }
  }
  out.push(`<p>${e(DISCLAIMER_COST)}</p>`);
  out.push(`<p>${e(DISCLAIMER_FACTS)}</p>`);
  out.push(`<p>${e(GENERATED_BY)}.</p>`);
  out.push('</footer>');

  out.push('</main>');
  out.push('</body>');
  out.push('</html>');
  return out.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

function metaCell(label: string, valueHtml: string): string {
  return `<div><span class="k">${label}</span><span class="v">${valueHtml}</span></div>`;
}

function kpiCard(
  label: string,
  value: string,
  noteHtml: string,
  noteClass = 'note',
  grow = false,
): string {
  const cls = grow ? 'kpi grow' : 'kpi';
  return (
    `<div class="${cls}"><div class="label">${escapeHtml(label)}</div>` +
    (value !== '' ? `<div class="value">${value}</div>` : '') +
    (noteHtml !== '' ? `<div${noteClass !== '' ? ` class="${noteClass}"` : ''}>${noteHtml}</div>` : '') +
    '</div>'
  );
}

function badge(count: number, label: string, cls: string): string {
  return `<span class="badge ${cls}">${num(count)} ${escapeHtml(label)}</span>`;
}

function findingBlock(ins: Insight): string {
  const e = escapeHtml;
  const sevCls = ins.severity === 'warn' ? 'sev-warn' : 'sev-info';
  const borderCls = ins.severity === 'warn' ? 'finding fwarn' : 'finding';
  const parts: string[] = [];
  parts.push(`<article class="${borderCls}">`);
  parts.push(
    `<div><span class="badge ${sevCls}">${e(ins.severity)}</span> <strong>${e(ins.title)}</strong></div>`,
  );
  parts.push(`<p class="fact"><b>Observed:</b> ${e(ins.observed)}</p>`);
  if (ins.evidence.length > 0) {
    parts.push(`<p class="ev mono">Evidence: ${e(ins.evidence.join('; '))}</p>`);
  }
  if (ins.recommendation !== undefined && ins.recommendation.trim() !== '') {
    parts.push(`<p class="sug"><em>Suggestion:</em> ${e(ins.recommendation)}</p>`);
  }
  parts.push('</article>');
  return parts.join('');
}

function agentRow(a: AgentStats, depth: number, r: RunReport): string {
  const e = escapeHtml;
  const name = a.name || a.agentId;
  const label = depth === 0 ? name : `\u2514 ${name}`;
  const unknownTasks = Math.max(0, a.taskCount - a.successCount - a.failureCount - a.partialCount);
  const shareWidth = pctNum(a.tokensTotal, r.totals.tokensTotal, 1);
  const indent = depth === 0 ? '' : ` style="padding-left:${depth * 16}px"`;
  return (
    '<tr>' +
    `<td${indent}><strong>${e(label)}</strong><br><span class="mono small mut">${e(a.agentId)}</span></td>` +
    `<td class="mono small">${e(modelsUsed(a.models) || '-')}</td>` +
    `<td class="n">${num(a.successCount)}/${num(a.failureCount)}/${num(a.partialCount)}/${num(unknownTasks)}</td>` +
    `<td class="n">${humanizeTokens(a.tokensIn)}</td>` +
    `<td class="n">${humanizeTokens(a.tokensOut)}</td>` +
    `<td class="n">${formatUsd(a.costUsd)}</td>` +
    `<td class="n">${num(a.toolCalls)}</td>` +
    `<td class="n">${num(a.errors)}/${num(a.retries)}</td>` +
    `<td class="n">${num(a.filesTouched.length)}</td>` +
    `<td class="n"><span class="small">${pct(a.tokensTotal, r.totals.tokensTotal)}</span>` +
    `<div class="bar"><div class="fill" style="width:${shareWidth}%"></div></div></td>` +
    '</tr>'
  );
}

function taskRow(t: TaskStats, agentNames: Map<string, string>): string {
  const e = escapeHtml;
  const agent =
    t.agentId !== undefined ? agentNames.get(t.agentId) ?? t.agentId : '-';
  return (
    '<tr>' +
    `<td class="mono small">${e(t.taskId)}</td>` +
    `<td class="mono small">${e(truncate(t.title, 60))}</td>` +
    `<td>${e(agent)}</td>` +
    `<td><span class="badge st-${e(t.status)}">${e(t.status)}</span></td>` +
    `<td class="n">${humanizeDuration(t.durationMs)}</td>` +
    `<td class="n">${humanizeTokens(t.tokensTotal)}</td>` +
    `<td class="n">${formatUsd(t.costUsd)}</td>` +
    `<td class="n">${num(t.toolCalls)}</td>` +
    `<td class="n">${num(t.errors)}/${num(t.retries)}</td>` +
    '</tr>'
  );
}

function fileRow(f: FileStats): string {
  const e = escapeHtml;
  const shared = f.agents.length > 1;
  const agentsCell = shared
    ? `<span class="badge ovl">shared &middot; ${num(f.agents.length)} agents</span> <span class="mono small">${e(f.agents.join(', '))}</span>`
    : `<span class="mono small">${e(f.agents.join(', ')) || '-'}</span>`;
  return (
    '<tr>' +
    `<td class="mono small">${e(truncate(f.path, 60))}</td>` +
    `<td class="n">${num(f.writes)}</td>` +
    `<td>${agentsCell}</td>` +
    '</tr>'
  );
}

function stat(label: string, value: string, note: string): string {
  return (
    `<div class="stat"><div class="label">${escapeHtml(label)}</div>` +
    `<div class="value">${value}</div>` +
    (note !== '' ? `<div class="note">${escapeHtml(note)}</div>` : '') +
    '</div>'
  );
}
