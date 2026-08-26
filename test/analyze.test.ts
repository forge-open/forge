import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeRun } from '../src/core/analyze.js';
import type { ForgeEvent, RunMeta } from '../src/core/model.js';

const META: RunMeta = {
  runId: 'r-test',
  source: 'synthetic',
  project: '/work/demo',
  createdAt: '2026-08-26T09:00:00.000Z',
};

let seq = 0;
function at(min: number, sec = 0): string {
  const base = Date.parse('2026-08-26T09:00:00.000Z');
  return new Date(base + (min * 60 + sec) * 1000).toISOString();
}
function ev(min: number, kind: ForgeEvent['kind'], fields: Partial<ForgeEvent> = {}): ForgeEvent {
  return { ts: at(min, (seq++ % 60)), kind, ...fields };
}

interface TaskDef {
  id: string;
  agent: string;
  status?: 'success' | 'failure' | 'partial';
  startMin: number;
  durMin: number;
  tokIn: number;
  tokOut: number;
  model: string;
  retries?: number;
  tools?: number;
  files?: string[];
}

// Hand-designed swarm: 15 tasks, 5 agents, 1.2M tokens total, clean shares.
const TASKS: TaskDef[] = [
  // main (claude-sonnet-4-5), 200k tokens, 3 success / 1 failure / 1 partial
  { id: 'm1', agent: 'a-main', status: 'success', startMin: 0, durMin: 20, tokIn: 40000, tokOut: 8000, model: 'claude-sonnet-4-5', files: ['src/core.ts'] },
  { id: 'm2', agent: 'a-main', status: 'failure', startMin: 25, durMin: 15, tokIn: 30000, tokOut: 6000, model: 'claude-sonnet-4-5' },
  { id: 'm3', agent: 'a-main', status: 'success', startMin: 45, durMin: 25, tokIn: 50000, tokOut: 10000, model: 'claude-sonnet-4-5', files: ['src/api/x.ts'] },
  { id: 'm4', agent: 'a-main', status: 'partial', startMin: 75, durMin: 18, tokIn: 36000, tokOut: 8000, model: 'claude-sonnet-4-5', retries: 3, tools: 4 },
  { id: 'm5', agent: 'a-main', status: 'success', startMin: 95, durMin: 6, tokIn: 6000, tokOut: 6000, model: 'claude-sonnet-4-5' },
  // s1 (claude-opus-4), 300k tokens, 1 success of 4 -> token-concentration
  { id: 's1a', agent: 'subagent:s1', status: 'success', startMin: 5, durMin: 30, tokIn: 75000, tokOut: 15000, model: 'claude-opus-4', files: ['src/api/x.ts', 'src/api/y.ts'] },
  { id: 's1b', agent: 'subagent:s1', status: 'partial', startMin: 40, durMin: 22, tokIn: 70000, tokOut: 14000, model: 'claude-opus-4' },
  { id: 's1c', agent: 'subagent:s1', startMin: 265, durMin: 0, tokIn: 66000, tokOut: 12000, model: 'claude-opus-4' }, // never finishes -> unknown
  { id: 's1d', agent: 'subagent:s1', status: 'partial', startMin: 70, durMin: 12, tokIn: 24000, tokOut: 24000, model: 'claude-opus-4', tools: 1 }, // expensive + <=2 tools -> cost-mismatch
  // s2 (gpt-5), 200k tokens, overlaps files with s1
  { id: 's2a', agent: 'subagent:s2', status: 'success', startMin: 10, durMin: 28, tokIn: 100000, tokOut: 20000, model: 'gpt-5', files: ['src/api/x.ts', 'src/api/y.ts'] },
  { id: 's2b', agent: 'subagent:s2', status: 'success', startMin: 50, durMin: 16, tokIn: 32000, tokOut: 48000, model: 'gpt-5' },
  // b-bot (gemini-2.5-flash), 500k tokens, 4 successes, one giant-duration outlier
  { id: 'b1', agent: 'b-bot', status: 'success', startMin: 20, durMin: 35, tokIn: 100000, tokOut: 25000, model: 'gemini-2.5-flash', files: ['docs/guide.md'] },
  { id: 'b2', agent: 'b-bot', status: 'success', startMin: 60, durMin: 120, tokIn: 100000, tokOut: 25000, model: 'gemini-2.5-flash', tools: 23 },
  { id: 'b3', agent: 'b-bot', status: 'success', startMin: 185, durMin: 35, tokIn: 100000, tokOut: 25000, model: 'gemini-2.5-flash' },
  { id: 'b4', agent: 'b-bot', status: 'success', startMin: 225, durMin: 35, tokIn: 100000, tokOut: 25000, model: 'gemini-2.5-flash', files: ['README.md'] },
];

function buildSwarmEvents(): ForgeEvent[] {
  const out: ForgeEvent[] = [];
  out.push(ev(0, 'run_started', { agentId: 'a-main' }));
  out.push(ev(0, 'agent_started', { agentId: 'a-main', agentName: 'Claude Code (main)' }));
  out.push(ev(0, 'agent_started', { agentId: 'subagent:s1', agentName: 'explorer', parentAgentId: 'a-main' }));
  out.push(ev(0, 'agent_started', { agentId: 'subagent:s2', agentName: 'fixer', parentAgentId: 'a-main' }));
  out.push(ev(0, 'agent_started', { agentId: 'b-bot', agentName: 'B bot' }));
  out.push(ev(0, 'agent_started', { agentId: 'c-docs', agentName: 'Docs bot' }));

  for (const t of TASKS) {
    out.push({ ts: at(t.startMin), kind: 'task_started', agentId: t.agent, taskId: t.id, taskTitle: `task ${t.id}` });
    for (let i = 0; i < (t.retries ?? 0); i++) {
      out.push({ ts: at(t.startMin + 1 + i), kind: 'retry', agentId: t.agent, taskId: t.id, error: 'boom (synthetic)' });
    }
    for (let i = 0; i < (t.tools ?? 0); i++) {
      out.push({ ts: at(t.startMin + 2 + i), kind: 'tool_called', agentId: t.agent, taskId: t.id, tool: 'Bash', toolCallId: `${t.id}-c${i}` });
      out.push({ ts: at(t.startMin + 2 + i, 30), kind: 'tool_finished', agentId: t.agent, taskId: t.id, tool: 'Bash', toolCallId: `${t.id}-c${i}`, status: 'success' });
    }
    if (t.files) {
      out.push({ ts: at(t.startMin + 3), kind: 'file_changed', agentId: t.agent, taskId: t.id, files: t.files });
    }
    if (t.status) {
      out.push({ ts: at(t.startMin + t.durMin), kind: 'task_finished', agentId: t.agent, taskId: t.id, status: t.status, durationMs: t.durMin * 60000 });
    }
    out.push({
      ts: at(t.startMin + t.durMin, 10),
      kind: 'token_usage',
      agentId: t.agent,
      taskId: t.id,
      model: t.model,
      tokens: { input: t.tokIn, output: t.tokOut },
    });
  }
  // c-docs: usage without any task
  out.push({ ts: at(270), kind: 'token_usage', agentId: 'c-docs', model: 'gemini-2.5-flash', tokens: { input: 6000, output: 4000 } });

  out.push({ ts: at(102), kind: 'commit_created', agentId: 'a-main', taskId: 'm1' });
  out.push({ ts: at(103), kind: 'build_started', agentId: 'a-main' });
  out.push({ ts: at(104), kind: 'build_finished', agentId: 'a-main', status: 'success' });
  out.push({ ts: at(280), kind: 'run_finished', agentId: 'a-main', status: 'partial' });
  return out.sort((a, b) => a.ts.localeCompare(b.ts));
}

test('analyze: swarm totals match hand-computed sums', () => {
  const r = analyzeRun(META, buildSwarmEvents());
  assert.equal(r.totals.agents, 5);
  assert.equal(r.totals.tasks, 15);
  assert.equal(r.totals.tokensIn, 935000); // includes c-docs' 6k no-task usage
  assert.equal(r.totals.tokensOut, 275000);
  assert.equal(r.totals.tokensTotal, 1210000);
  assert.deepEqual(
    { s: r.totals.success, f: r.totals.failure, p: r.totals.partial, u: r.totals.unknown },
    { s: 10, f: 1, p: 3, u: 1 },
  );
  assert.equal(r.totals.retries, 3);
  assert.equal(r.totals.toolCalls, 28);
  assert.ok(Math.abs((r.totals.costUsd ?? 0) - 10.6828) < 1e-9, `cost ${r.totals.costUsd}`);
  assert.equal(r.totals.costKnown, true);
  assert.equal(r.engineering.filesChanged, 5);
  assert.equal(r.engineering.commits, 1);
  assert.equal(r.engineering.buildChecks, 1);
  assert.equal(r.engineering.testRuns, 0);
});

test('analyze: swarm tree, attribution, and rollups', () => {
  const r = analyzeRun(META, buildSwarmEvents());
  const byId = new Map(r.agents.map((a) => [a.agentId, a]));
  const s1 = byId.get('subagent:s1')!;
  assert.equal(s1.parentAgentId, 'a-main');
  assert.equal(s1.tokensTotal, 300000);
  assert.equal(s1.successCount, 1);
  assert.equal(s1.taskCount, 4);
  assert.equal(byId.get('b-bot')!.models['gemini-2.5-flash'], 500000);

  const m4 = r.tasks.find((t) => t.taskId === 'm4')!;
  assert.equal(m4.status, 'partial');
  assert.equal(m4.retries, 3);
  assert.equal(m4.toolCalls, 4);
  const s1c = r.tasks.find((t) => t.taskId === 's1c')!;
  assert.equal(s1c.status, 'unknown'); // closed implicitly at run end
  assert.ok(typeof s1c.durationMs === 'number');

  // files: overlap recorded per path
  const x = r.files.find((f) => f.path === 'src/api/x.ts')!;
  assert.deepEqual(x.agents, ['a-main', 'subagent:s1', 'subagent:s2']);
});

test('analyze: insight rules fire with evidence in the designed swarm (capped at 6)', () => {
  const r = analyzeRun(META, buildSwarmEvents());
  const kinds = r.insights.map((i) => i.kind);
  assert.ok(kinds.includes('token-concentration'), 'token-concentration should fire for s1');
  const tc = r.insights.find((i) => i.kind === 'token-concentration')!;
  assert.ok(tc.evidence.some((e) => e.startsWith('agent:subagent:s1')));
  assert.ok(tc.observed.includes('explorer')); // insight cites the display name
  assert.ok(kinds.includes('file-overlap'), 'overlap s1+s2 (2 files) should fire');
  assert.ok(kinds.includes('retry-hotspot'), 'm4 with 3 retries should fire');
  assert.ok(kinds.includes('cost-mismatch'), 's1d (expensive, 1 tool call) should fire');
  assert.ok(kinds.includes('duration-outlier'), 'b2 at 120min vs 25min median should fire');
  assert.ok(kinds.includes('failures'), 'm2 failed');
  assert.ok(!kinds.includes('no-tests'), 'no-tests is ranked below the 6-insight cap here');
  assert.ok(r.insights.length <= 6);
  // warn severity ranks first
  assert.equal(r.insights[0].severity, 'warn');
  // facts cite numbers; recommendations are separate fields
  for (const i of r.insights) {
    assert.ok(i.observed.length > 10);
    if (i.recommendation) assert.notEqual(i.observed, i.recommendation);
  }
});

test('analyze: suppression discipline - rules stay silent below thresholds', () => {
  // single agent, one task, one shared-file-less world
  const events: ForgeEvent[] = [
    { ts: at(0), kind: 'run_started', agentId: 'solo' },
    { ts: at(0), kind: 'agent_started', agentId: 'solo', agentName: 'Solo' },
    { ts: at(0), kind: 'task_started', agentId: 'solo', taskId: 't1', taskTitle: 'only task' },
    { ts: at(10), kind: 'file_changed', agentId: 'solo', taskId: 't1', files: ['a.ts'] },
    {
      ts: at(11), kind: 'token_usage', agentId: 'solo', taskId: 't1',
      model: 'claude-sonnet-4-5', tokens: { input: 5000, output: 1000 },
    },
    { ts: at(12), kind: 'task_finished', agentId: 'solo', taskId: 't1', status: 'success', durationMs: 720000 },
    { ts: at(12), kind: 'run_finished', agentId: 'solo' },
  ];
  const r = analyzeRun(META, events);
  const kinds = r.insights.map((i) => i.kind);
  assert.ok(!kinds.includes('token-concentration'), 'needs >=2 leaf agents');
  assert.ok(!kinds.includes('file-overlap'), 'needs a pair sharing >=2 files');
  assert.ok(!kinds.includes('retry-hotspot'), 'no retries here');
  assert.ok(!kinds.includes('cost-mismatch'), 'needs >=4 costed tasks');
  assert.ok(!kinds.includes('duration-outlier'), 'needs >=4 timed tasks');
  assert.ok(kinds.includes('no-tests'), 'zero test runs with >=1 task fires info insight');

  // overlap of exactly 1 file does NOT fire even with many agents
  const two: ForgeEvent[] = [
    { ts: at(0), kind: 'agent_started', agentId: 'A' },
    { ts: at(0), kind: 'agent_started', agentId: 'B' },
    { ts: at(1), kind: 'file_changed', agentId: 'A', files: ['one.ts', 'two.ts'] },
    { ts: at(2), kind: 'file_changed', agentId: 'B', files: ['one.ts'] },
  ];
  const r2 = analyzeRun(META, two);
  assert.ok(!r2.insights.some((i) => i.kind === 'file-overlap'));
  const three: ForgeEvent[] = [
    { ts: at(0), kind: 'agent_started', agentId: 'A' },
    { ts: at(0), kind: 'agent_started', agentId: 'B' },
    { ts: at(1), kind: 'file_changed', agentId: 'A', files: ['one.ts', 'two.ts'] },
    { ts: at(2), kind: 'file_changed', agentId: 'B', files: ['one.ts', 'two.ts'] },
  ];
  const r3 = analyzeRun(META, three);
  assert.ok(r3.insights.some((i) => i.kind === 'file-overlap'));
});

test('analyze: unknown pricing flips costKnown without inventing dollars; explicit costs win', () => {
  const events: ForgeEvent[] = [
    { ts: at(0), kind: 'agent_started', agentId: 'A' },
    {
      ts: at(1), kind: 'token_usage', agentId: 'A', model: 'mystery-model-x',
      tokens: { input: 10000, output: 1000 },
    },
    {
      ts: at(2), kind: 'token_usage', agentId: 'A', model: 'also-mystery',
      tokens: { input: 10000, output: 1000 }, costUsd: 0.5,
    },
  ];
  const r = analyzeRun(META, events);
  assert.equal(r.totals.costKnown, false);
  assert.ok(Math.abs((r.totals.costUsd ?? 0) - 0.5) < 1e-9);

  // cache tokens flow through attribution
  const r2 = analyzeRun(
    META,
    [{ ts: at(1), kind: 'token_usage', agentId: 'A', model: 'claude-sonnet-4-5', tokens: { input: 1000, output: 100, cacheRead: 5000, cacheWrite: 200 } }],
  );
  const a = r2.agents[0];
  assert.equal(a.tokensTotal, 6300);
  assert.equal(r2.totals.cacheRead, 5000);
  // 1000*3 + 100*15 + 5000*0.3 + 200*3.75 = 3000+1500+1500+750 = 6750 / 1e6
  assert.ok(Math.abs((r2.totals.costUsd ?? 0) - 0.00675) < 1e-9);
});

test('analyze: empty input yields a valid, quiet report; output is deterministic', () => {
  const empty = analyzeRun(META, []);
  assert.equal(empty.totals.agents, 0);
  assert.equal(empty.totals.costUsd, undefined);
  assert.equal(empty.totals.costKnown, true);
  assert.deepEqual(empty.insights, []);

  const events = buildSwarmEvents();
  const a = JSON.stringify(analyzeRun(META, events));
  const b = JSON.stringify(analyzeRun(META, events));
  assert.equal(a, b);
});
