import type {
  AgentStats,
  EngineeringSignals,
  FileStats,
  ForgeEvent,
  Insight,
  RunMeta,
  RunReport,
  TaskStats,
  TokenUsage,
} from './model.js';
import type { PriceTable } from './cost.js';
import { estimateCost, priceFor } from './cost.js';

/**
 * Aggregation + evaluation engine. PURE: same inputs ⇒ byte-identical report.
 *
 * Consumes canonical events for one run and produces the full RunReport:
 * totals, per-agent stats (swarm tree via parentAgentId), per-task rollups,
 * file overlap map, deterministic engineering signals, and rule-based insights
 * whose `observed` strings cite only numbers present in the data. Below a rule's
 * evidence threshold it stays silent  -  silence is correct.
 */

const EMPTY_TOKENS: Required<{ [K in keyof TokenUsage]-?: number }> = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

function tokSum(t?: TokenUsage): { input: number; output: number; cacheRead: number; cacheWrite: number; total: number } {
  const input = t?.input ?? 0;
  const output = t?.output ?? 0;
  const cacheRead = t?.cacheRead ?? 0;
  const cacheWrite = t?.cacheWrite ?? 0;
  return { input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite };
}

interface AgentAgg extends AgentStats {
  firstTs?: string;
  lastTs?: string;
  fileSet: Set<string>;
  costAccum: number;
  costSeen: boolean;
}

interface TaskAgg extends TaskStats {
  fileSet: Set<string>;
  costAccum: number;
  costSeen: boolean;
  hasFinish: boolean;
  startFallbackTs?: string;
}

export function analyzeRun(meta: RunMeta, events: ForgeEvent[], prices?: PriceTable): RunReport {
  const warnings: string[] = [];
  const evs = [...events].sort((a, b) => a.ts.localeCompare(b.ts));

  const agents = new Map<string, AgentAgg>();
  const tasks = new Map<string, TaskAgg>();
  const files = new Map<string, { agents: Set<string>; writes: number }>();

  let runFirst: string | undefined;
  let runLast: string | undefined;

  const eng: EngineeringSignals = {
    testRuns: 0,
    testFailures: null,
    commits: 0,
    buildChecks: 0,
    filesChanged: 0,
    apiErrors: 0,
    retries: 0,
    errors: 0,
  };
  let testFinishedTotal = 0;
  let testFinishedFailed = 0;

  let toolCalledCount = 0;
  let toolFinishedCount = 0;
  let orphanTaskFinishes = 0;
  let tokenUsageWithoutModel = 0;
  let eventsWithoutAgent = 0;

  // run-scope cost accumulators (single source of truth; agent/task scopes mirror)
  let runCost = 0;
  let runCostSeen = false;
  let runCostFullyKnown = true;

  function ensureAgent(agentId: string | undefined, ts: string): AgentAgg | undefined {
    if (!agentId) return undefined;
    let a = agents.get(agentId);
    if (!a) {
      a = {
        agentId,
        name: agentId,
        models: {},
        taskCount: 0,
        successCount: 0,
        failureCount: 0,
        partialCount: 0,
        activeMs: 0,
        tokensIn: 0,
        tokensOut: 0,
        cacheRead: 0,
        cacheWrite: 0,
        tokensTotal: 0,
        toolCalls: 0,
        byTool: {},
        filesTouched: [],
        fileSet: new Set<string>(),
        errors: 0,
        retries: 0,
        testRuns: 0,
        costAccum: 0,
        costSeen: false,
        firstTs: ts,
      };
      agents.set(agentId, a);
    }
    if (!a.firstTs || ts < a.firstTs) a.firstTs = ts;
    if (!a.lastTs || ts > a.lastTs) a.lastTs = ts;
    return a;
  }

  function ensureTask(taskId: string | undefined, ts: string): TaskAgg | undefined {
    if (!taskId) return undefined;
    let t = tasks.get(taskId);
    if (!t) {
      t = {
        taskId,
        title: taskId,
        status: 'unknown',
        tokensIn: 0,
        tokensOut: 0,
        cacheRead: 0,
        cacheWrite: 0,
        tokensTotal: 0,
        toolCalls: 0,
        files: [],
        fileSet: new Set(),
        errors: 0,
        retries: 0,
        testRuns: 0,
        costAccum: 0,
        costSeen: false,
        hasFinish: false,
        startFallbackTs: ts,
      };
      tasks.set(taskId, t);
    }
    return t;
  }

  /** Attribute one usage/cost record to run + agent + task scopes. */
  function attributeTokens(ev: ForgeEvent, scope: { agent?: AgentAgg; task?: TaskAgg }): void {
    const s = tokSum(ev.tokens);
    const hasTokens = s.total > 0;
    let cost: number | null = null;
    if (typeof ev.costUsd === 'number') {
      cost = ev.costUsd;
    } else if (hasTokens) {
      const est = estimateCost(ev.model, ev.tokens ?? {}, prices);
      if (est !== null) cost = est;
      else runCostFullyKnown = false;
    }
    const apply = (acc: { tokensIn: number; tokensOut: number; cacheRead: number; cacheWrite: number; tokensTotal: number }) => {
      acc.tokensIn += s.input;
      acc.tokensOut += s.output;
      acc.cacheRead += s.cacheRead;
      acc.cacheWrite += s.cacheWrite;
      acc.tokensTotal += s.total;
    };
    if (scope.agent && hasTokens) {
      apply(scope.agent);
      const m = ev.model ?? 'unknown-model';
      scope.agent.models[m] = (scope.agent.models[m] ?? 0) + s.total;
    }
    if (scope.task && hasTokens) apply(scope.task);
    if (cost !== null) {
      runCost += cost;
      runCostSeen = true;
      if (scope.agent) {
        scope.agent.costAccum += cost;
        scope.agent.costSeen = true;
      }
      if (scope.task) {
        scope.task.costAccum += cost;
        scope.task.costSeen = true;
      }
    }
  }

  // pass 1: fold events
  for (const ev of evs) {
    if (!runFirst || ev.ts < runFirst) runFirst = ev.ts;
    if (!runLast || ev.ts > runLast) runLast = ev.ts;
    if (!ev.agentId) eventsWithoutAgent++;
    const agent = ensureAgent(ev.agentId, ev.ts);
    if (ev.kind === 'agent_started' && ev.agentId && ev.parentAgentId) {
      ensureAgent(ev.parentAgentId, ev.ts);
      agent!.parentAgentId = ev.parentAgentId;
    }
    if (ev.kind === 'agent_started' && agent && ev.agentName) agent.name = ev.agentName;

    const task = ev.taskId ? ensureTask(ev.taskId, ev.ts) : undefined;
    if (ev.kind === 'task_started') {
      task!.agentId = ev.agentId ?? task!.agentId;
      task!.title = ev.taskTitle ?? task!.title;
      task!.startedAt = ev.ts;
    }
    if (ev.kind === 'task_finished') {
      if (!task) {
        orphanTaskFinishes++;
      } else {
        task.hasFinish = true;
        task.status = ev.status ?? 'unknown';
        task.endedAt = ev.ts;
        task.durationMs =
          ev.durationMs ??
          (task.startedAt ? Math.max(0, Date.parse(ev.ts) - Date.parse(task.startedAt)) : undefined);
      }
    }
    if (ev.kind === 'tool_called') {
      toolCalledCount++;
      if (agent) {
        agent.toolCalls++;
        if (ev.tool) agent.byTool[ev.tool] = (agent.byTool[ev.tool] ?? 0) + 1;
      }
      if (task) task.toolCalls++;
    }
    if (ev.kind === 'token_usage') {
      if (!ev.model) tokenUsageWithoutModel++;
      attributeTokens(ev, { agent, task });
    }
    if (ev.kind === 'file_changed') {
      for (const f of ev.files ?? []) {
        let entry = files.get(f);
        if (!entry) {
          entry = { agents: new Set(), writes: 0 };
          files.set(f, entry);
        }
        entry.writes++;
        if (ev.agentId) entry.agents.add(ev.agentId);
        if (agent && !agent.fileSet.has(f)) {
          agent.fileSet.add(f);
          agent.filesTouched.push(f);
        }
        if (task && !task.fileSet.has(f)) {
          task.fileSet.add(f);
          task.files.push(f);
        }
      }
    }
    if (ev.kind === 'commit_created') eng.commits++;
    if (ev.kind === 'test_started') {
      eng.testRuns++;
      if (agent) agent.testRuns++;
      if (task) task.testRuns++;
    }
    if (ev.kind === 'test_finished') {
      testFinishedTotal++;
      if (ev.status === 'failure') testFinishedFailed++;
    }
    if (ev.kind === 'build_started') eng.buildChecks++;
    if (ev.kind === 'error') {
      eng.errors++;
      if (agent) agent.errors++;
      if (task) task.errors++;
    }
    if (ev.kind === 'retry') {
      eng.retries++;
      eng.apiErrors++;
      if (agent) agent.retries++;
      if (task) task.retries++;
    }
  }

  // close unfinished tasks at run end
  for (const t of tasks.values()) {
    if (!t.hasFinish) {
      t.endedAt = runLast;
      if (t.startedAt) t.durationMs = Math.max(0, Date.parse(runLast ?? t.startedAt) - Date.parse(t.startedAt));
    }
  }

  // per-agent task ownership rollups
  for (const t of tasks.values()) {
    if (!t.agentId) continue;
    const a = agents.get(t.agentId);
    if (!a) continue;
    a.taskCount++;
    if (t.status === 'success') a.successCount++;
    else if (t.status === 'failure') a.failureCount++;
    else if (t.status === 'partial') a.partialCount++;
    if (t.durationMs !== undefined) a.activeMs += t.durationMs;
  }

  eng.filesChanged = files.size;
  if (eng.testRuns > 0 && testFinishedTotal > 0) eng.testFailures = testFinishedFailed;

  // ---- assemble outputs ----------------------------------------------------
  const childrenOf = new Map<string, number>();
  for (const a of agents.values()) {
    if (a.parentAgentId && agents.has(a.parentAgentId)) {
      childrenOf.set(a.parentAgentId, (childrenOf.get(a.parentAgentId) ?? 0) + 1);
    }
  }
  function depth(a: AgentAgg): number {
    let d = 0;
    let cur = a.parentAgentId;
    const seen = new Set<string>();
    while (cur && agents.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      d++;
      cur = agents.get(cur)!.parentAgentId;
    }
    return d;
  }
  const agentList = [...agents.values()]
    .map((a): AgentStats => ({
      agentId: a.agentId,
      name: a.name,
      parentAgentId: a.parentAgentId,
      models: a.models,
      taskCount: a.taskCount,
      successCount: a.successCount,
      failureCount: a.failureCount,
      partialCount: a.partialCount,
      activeMs: a.activeMs,
      ...(a.lastTs && a.firstTs && a.lastTs > a.firstTs ? { wallMs: Date.parse(a.lastTs) - Date.parse(a.firstTs) } : {}),
      tokensIn: a.tokensIn,
      tokensOut: a.tokensOut,
      cacheRead: a.cacheRead,
      cacheWrite: a.cacheWrite,
      tokensTotal: a.tokensTotal,
      ...(a.costSeen ? { costUsd: round6(a.costAccum) } : {}),
      toolCalls: a.toolCalls,
      byTool: a.byTool,
      filesTouched: [...a.fileSet].sort(),
      errors: a.errors,
      retries: a.retries,
      testRuns: a.testRuns,
    }))
    .sort(
      (x, y) =>
        depth(agents.get(x.agentId)!) - depth(agents.get(y.agentId)!) ||
        y.tokensTotal - x.tokensTotal ||
        x.agentId.localeCompare(y.agentId),
    );

  const taskList = [...tasks.values()]
    .map((t): TaskStats => ({
      taskId: t.taskId,
      title: t.title,
      agentId: t.agentId,
      status: t.status,
      ...(t.startedAt ? { startedAt: t.startedAt } : {}),
      ...(t.endedAt ? { endedAt: t.endedAt } : {}),
      ...(t.durationMs !== undefined ? { durationMs: t.durationMs } : {}),
      tokensIn: t.tokensIn,
      tokensOut: t.tokensOut,
      cacheRead: t.cacheRead,
      cacheWrite: t.cacheWrite,
      tokensTotal: t.tokensTotal,
      ...(t.costSeen ? { costUsd: round6(t.costAccum) } : {}),
      toolCalls: t.toolCalls,
      files: [...t.fileSet].sort(),
      errors: t.errors,
      retries: t.retries,
      testRuns: t.testRuns,
    }))
    .sort((x, y) => (x.startedAt ?? x.taskId).localeCompare(y.startedAt ?? y.taskId));

  const fileList: FileStats[] = [...files.entries()]
    .map(([p, v]) => ({ path: p, agents: [...v.agents].sort(), writes: v.writes }))
    .sort((x, y) => y.writes - x.writes || x.path.localeCompare(y.path));

  const tokenTotals = tokSum();
  for (const ev of evs) {
    if (ev.kind !== 'token_usage') continue;
    const s = tokSum(ev.tokens);
    tokenTotals.input += s.input;
    tokenTotals.output += s.output;
    tokenTotals.cacheRead += s.cacheRead;
    tokenTotals.cacheWrite += s.cacheWrite;
    tokenTotals.total += s.total;
  }

  const statusBuckets = { success: 0, failure: 0, partial: 0, unknown: 0 };
  for (const t of taskList) statusBuckets[t.status === 'success' || t.status === 'failure' || t.status === 'partial' ? t.status : 'unknown']++;

  if (toolCalledCount > toolFinishedCount) {
    warnings.push(`${toolCalledCount - toolFinishedCount} tool call(s) without matching finish`);
  }
  if (orphanTaskFinishes > 0) warnings.push(`${orphanTaskFinishes} task_finished without task_started`);
  if (tokenUsageWithoutModel > 0) warnings.push(`${tokenUsageWithoutModel} token_usage record(s) without model`);
  if (eventsWithoutAgent > 0) warnings.push(`${eventsWithoutAgent} event(s) without agentId`);

  const insights = buildInsights({ meta, agents: agentList, tasks: taskList, files: fileList, eng, totals: {
    success: statusBuckets.success,
    failure: statusBuckets.failure,
    tokensTotal: tokenTotals.total,
  } });

  return {
    meta,
    totals: {
      agents: agentList.length,
      tasks: taskList.length,
      wallMs: runFirst && runLast ? Math.max(0, Date.parse(runLast) - Date.parse(runFirst)) : 0,
      tokensIn: tokenTotals.input,
      tokensOut: tokenTotals.output,
      cacheRead: tokenTotals.cacheRead,
      cacheWrite: tokenTotals.cacheWrite,
      tokensTotal: tokenTotals.total,
      ...(runCostSeen ? { costUsd: round6(runCost) } : {}),
      costKnown: runCostFullyKnown,
      success: statusBuckets.success,
      failure: statusBuckets.failure,
      partial: statusBuckets.partial,
      unknown: statusBuckets.unknown,
      errors: eng.errors,
      retries: eng.retries,
      toolCalls: toolCalledCount,
    },
    agents: agentList,
    tasks: taskList,
    files: fileList,
    engineering: eng,
    insights,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// insights
// ---------------------------------------------------------------------------

interface InsightInputs {
  meta: RunMeta;
  agents: AgentStats[];
  tasks: TaskStats[];
  files: FileStats[];
  eng: EngineeringSignals;
  totals: { success: number; failure: number; tokensTotal: number };
}

function buildInsights(input: InsightInputs): Insight[] {
  const out: Insight[] = [];
  const { agents, tasks, files, eng, totals } = input;
  void files;

  // 1. token concentration vs delivered success (leaf agents only)
  const isParent = new Set(agents.map((a) => a.parentAgentId).filter(Boolean));
  const leaves = agents.filter((a) => !isParent.has(a.agentId));
  if (leaves.length >= 2 && totals.tokensTotal > 0 && totals.success > 0) {
    for (const a of leaves) {
      const tokenShare = a.tokensTotal / totals.tokensTotal;
      const successShare = a.successCount / totals.success;
      if (tokenShare >= 0.2 && successShare <= 0.1) {
        out.push({
          id: `token-concentration:${a.agentId}`,
          kind: 'token-concentration',
          title: `${a.name} consumed ${Math.round(tokenShare * 100)}% of tokens for little completed work`,
          severity: 'warn',
          observed: `${a.name} used ${a.tokensTotal.toLocaleString('en-US')} tokens (${Math.round(tokenShare * 100)}% of the run) while completing ${a.successCount} of ${totals.success} successful tasks (${Math.round(successShare * 100)}%).`,
          evidence: [`agent:${a.agentId}`, `tokens:${a.tokensTotal}`, `successful-tasks:${a.successCount}/${totals.success}`],
          recommendation: `Consider narrower task boundaries for ${a.name}, or reassign its workload to an agent with a better completion-to-token ratio.`,
        });
        break; // worst offender is enough; agents sorted by tokens desc upstream
      }
    }
  }

  // 2. overlapping file edits between agents (possible duplicated work)
  const byFile = new Map<string, Set<string>>();
  for (const f of files) {
    if (f.agents.length > 1) byFile.set(f.path, new Set(f.agents));
  }
  const pairs = new Map<string, { a: string; b: string; shared: string[] }>();
  for (const [path, agentSet] of byFile) {
    const ids = [...agentSet].sort();
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const key = `${ids[i]}|${ids[j]}`;
        const entry = pairs.get(key) ?? { a: ids[i], b: ids[j], shared: [] };
        entry.shared.push(path);
        pairs.set(key, entry);
      }
    }
  }
  const offenders = [...pairs.values()].filter((p) => p.shared.length >= 2).sort((x, y) => y.shared.length - x.shared.length);
  if (offenders.length > 0) {
    const top = offenders[0];
    out.push({
      id: 'file-overlap:' + top.a + '+' + top.b,
      kind: 'file-overlap',
      title: `${top.a} and ${top.b} both edited ${top.shared.length} shared file${top.shared.length === 1 ? '' : 's'}`,
      severity: 'warn',
      observed: `${offenders.length === 1 ? 'One agent pair' : `${offenders.length} agent pairs`} modified overlapping files; largest overlap: ${top.a} & ${top.b} on ${top.shared.length} files (${top.shared.slice(0, 5).join(', ')}${top.shared.length > 5 ? ', ...' : ''}).`,
      evidence: offenders.slice(0, 3).flatMap((p) => [`pair:${p.a}+${p.b}`, ...p.shared.slice(0, 3).map((f) => `file:${f}`)]),
      recommendation: 'Partition work by directory or module so agents do not edit the same files concurrently.',
    });
  }

  // 3. retry hotspots
  const hot = tasks
    .filter((t) => t.retries + t.errors >= 3)
    .sort((x, y) => y.retries + y.errors - (x.retries + x.errors))
    .slice(0, 3);
  if (hot.length > 0) {
    const worst = hot[0];
    out.push({
      id: `retry-hotspot:${worst.taskId}`,
      kind: 'retry-hotspot',
      title: `${hot.length} task${hot.length === 1 ? '' : 's'} required repeated retries`,
      severity: 'warn',
      observed: `Task "${truncate(worst.title, 60)}" (${worst.taskId}) hit ${worst.retries} retr${worst.retries === 1 ? 'y' : 'ies'} and ${worst.errors} error${worst.errors === 1 ? '' : 's'}.` +
        (hot.length > 1 ? ` ${hot.length - 1} further task(s) also exceeded 3 combined retries/errors.` : ''),
      evidence: hot.map((t) => `task:${t.taskId}(retries:${t.retries},errors:${t.errors})`),
      recommendation: 'Retry-heavy tasks usually have vague acceptance criteria  -  split them into smaller verifiable steps next run.',
    });
  }

  // 4. expensive model on low-complexity signals
  const costed = tasks.filter((t) => typeof t.costUsd === 'number');
  if (costed.length >= 4) {
    const sortedDesc = [...costed].sort((x, y) => (y.costUsd ?? 0) - (x.costUsd ?? 0));
    const topQuartile = sortedDesc.slice(0, Math.max(1, Math.ceil(costed.length / 4)));
    const cheapWork = topQuartile.filter((t) => t.toolCalls <= 2);
    if (cheapWork.length > 0) {
      const w = cheapWork[0];
      out.push({
        id: `cost-mismatch:${w.taskId}`,
        kind: 'cost-mismatch',
        title: 'High-cost tasks show few signs of hands-on complexity',
        severity: 'info',
        observed: `${cheapWork.length} of the ${topQuartile.length} most expensive tasks made <=2 tool calls; e.g. "${truncate(w.title, 50)}" (${w.taskId}) cost ~$${(w.costUsd ?? 0).toFixed(2)} with ${w.toolCalls} tool calls.`,
        evidence: cheapWork.map((t) => `task:${t.taskId}(cost:$${(t.costUsd ?? 0).toFixed(2)},tools:${t.toolCalls})`),
        recommendation: 'Low tool engagement alongside high token spend can indicate prompt overhead rather than build effort  -  worth reviewing what context those tasks were given.',
      });
    }
  }

  // 5. duration outliers
  const timed = tasks.filter((t) => typeof t.durationMs === 'number' && t.durationMs! > 0);
  if (timed.length >= 4) {
    const durs = timed.map((t) => t.durationMs!).sort((a, b) => a - b);
    const median = durs[Math.floor(durs.length / 2)];
    const outliers = timed.filter((t) => t.durationMs! > 3 * median).sort((x, y) => y.durationMs! - x.durationMs!);
    if (outliers.length > 0) {
      const o = outliers[0];
      out.push({
        id: `duration-outlier:${o.taskId}`,
        kind: 'duration-outlier',
        title: `Long-running task: ${Math.round(o.durationMs! / median)}x the median`,
        severity: 'info',
        observed: `"${truncate(o.title, 60)}" (${o.taskId}) ran for ${o.durationMs! / 60000 >= 1 ? `${Math.round(o.durationMs! / 60000)} min` : `${Math.round(o.durationMs! / 1000)} s`} versus a median task time of ${Math.round(median / 60000)} min.`,
        evidence: outliers.map((t) => `task:${t.taskId}(ms:${t.durationMs})`),
      });
    }
  }

  // 6. failures
  const failed = tasks.filter((t) => t.status === 'failure');
  if (failed.length > 0) {
    out.push({
      id: 'failures:run',
      kind: 'failures',
      title: `${failed.length} task${failed.length === 1 ? '' : 's'} failed`,
      severity: 'warn',
      observed: `${failed.length} of ${tasks.length} tasks ended in failure (${failed.slice(0, 5).map((t) => `"${truncate(t.title, 40)}"`).join(', ')}${failed.length > 5 ? ', ...' : ''}).`,
      evidence: failed.map((t) => `task:${t.taskId}`),
      recommendation: 'Re-run failed tasks individually after fixing root causes; avoid letting failed scope block dependent tasks.',
    });
  }

  // 7. no test activity at all
  if (eng.testRuns === 0 && tasks.length > 0) {
    out.push({
      id: 'no-tests:run',
      kind: 'no-tests',
      title: 'No test runs observed in this session',
      severity: 'info',
      observed: `0 test invocations across ${tasks.length} tasks and ${eng.buildChecks} build/typecheck command${eng.buildChecks === 1 ? '' : 's'}.`,
      evidence: ['engineering:testRuns=0'],
      recommendation: 'Add an explicit verification step (test suite or typecheck) to each task so outcomes are measurable.',
    });
  }

  const sevRank = (i: Insight) => (i.severity === 'warn' ? 0 : 1);
  const magRank = (i: Insight): number => {
    switch (i.kind) {
      case 'token-concentration':
        return 5;
      case 'file-overlap':
        return 4;
      case 'retry-hotspot':
        return 4;
      case 'failures':
        return 3;
      case 'cost-mismatch':
        return 2;
      case 'duration-outlier':
        return 1;
      default:
        return 0;
    }
  };
  return out.sort((x, y) => sevRank(x) - sevRank(y) || magRank(y) - magRank(x) || x.id.localeCompare(y.id)).slice(0, 6);
}

const DUMMY = { tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, tokensTotal: 0 };

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '...' : s;
}
