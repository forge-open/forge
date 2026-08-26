import { createRun, appendEvents } from './core/store.js';
import type { ForgeEvent, RunMeta } from './core/model.js';

/**
 * Deterministic synthetic multi-agent run  -  the zero-setup demo.
 * `forge demo` imports this as a normal run so anyone can see a full report
 * without installing any coding agent. Same shape as real data:
 * 5 agents (parent/child swarm), 12 tasks, known tokens/costs, retries,
 * overlapping files, one failure, mixed test outcomes.
 */

const T0 = Date.parse('2026-08-26T09:00:00.000Z');

function at(offsetSec: number): string {
  return new Date(T0 + offsetSec * 1000).toISOString();
}

interface TaskSpec {
  id: string;
  title: string;
  agent: string;
  status: 'success' | 'failure' | 'partial';
  startSec: number;
  durMin: number;
  tokIn: number;
  tokOut: number;
  model: string;
  tools?: number;
  retries?: number;
  files?: string[];
  tests?: 'pass' | 'fail';
}

const MAIN = 'claude-main';
const FE = 'subagent:frontend#1';
const BE = 'subagent:backend#1';
const CX = 'codex-bot';
const GM = 'gemini-docs';

// 12 tasks: 9 success / 2 partial / 1 failure.
const TASKS: TaskSpec[] = [
  { id: 't01', title: 'Scaffold Vite app and routing shell', agent: FE, status: 'success', startSec: 0, durMin: 14, tokIn: 41000, tokOut: 9800, model: 'claude-sonnet-4-5', tools: 11 },
  { id: 't02', title: 'Design system tokens + Button/Card components', agent: FE, status: 'success', startSec: 60, durMin: 22, tokIn: 64000, tokOut: 15400, model: 'claude-sonnet-4-5', tools: 16, files: ['src/ui/tokens.ts', 'src/ui/Button.tsx'], tests: 'pass' },
  { id: 't03', title: 'REST client with retry/backoff', agent: BE, status: 'success', startSec: 120, durMin: 18, tokIn: 52000, tokOut: 12100, model: 'claude-opus-4', tools: 9, files: ['src/api/client.ts'], tests: 'pass' },
  { id: 't04', title: 'Auth session handling', agent: BE, status: 'partial', startSec: 180, durMin: 31, tokIn: 88000, tokOut: 20300, model: 'claude-opus-4', tools: 12, retries: 3, files: ['src/api/client.ts', 'src/auth/session.ts'] },
  { id: 't05', title: 'Checkout form validation', agent: FE, status: 'success', startSec: 240, durMin: 17, tokIn: 47000, tokOut: 10200, model: 'claude-sonnet-4-5', tools: 10, files: ['src/ui/CheckoutForm.tsx'] },
  { id: 't06', title: 'Flaky e2e suite stabilization attempts', agent: CX, status: 'failure', startSec: 300, durMin: 42, tokIn: 121000, tokOut: 24900, model: 'gpt-5', tools: 23, retries: 5, tests: 'fail' },
  { id: 't07', title: 'Postgres migration for orders table', agent: BE, status: 'success', startSec: 360, durMin: 15, tokIn: 39000, tokOut: 8700, model: 'claude-opus-4', tools: 7, files: ['db/migrations/0007_orders.sql'] },
  { id: 't08', title: 'README quickstart rewrite', agent: GM, status: 'success', startSec: 420, durMin: 6, tokIn: 9000, tokOut: 3100, model: 'gemini-2.5-flash', tools: 3, files: ['README.md'] },
  { id: 't09', title: 'API reference doc generation', agent: GM, status: 'success', startSec: 480, durMin: 9, tokIn: 15000, tokOut: 6200, model: 'gemini-2.5-flash', tools: 4 },
  { id: 't10', title: 'Refactor shared fetch wrapper (overlaps t03)', agent: FE, status: 'success', startSec: 540, durMin: 20, tokIn: 71000, tokOut: 16800, model: 'claude-opus-4', tools: 14, files: ['src/api/client.ts', 'src/hooks/useFetch.ts'] },
  { id: 't11', title: 'Fix flaky checkout test selector', agent: CX, status: 'partial', startSec: 600, durMin: 26, tokIn: 93000, tokOut: 18700, model: 'gpt-5', tools: 18, retries: 2, files: ['src/ui/CheckoutForm.tsx'], tests: 'fail' },
  { id: 't12', title: 'Trivial dependency bump', agent: CX, status: 'success', startSec: 660, durMin: 3, tokIn: 28000, tokOut: 4200, model: 'gpt-5', tools: 2 },
];

export function buildDemoEvents(): ForgeEvent[] {
  const e: ForgeEvent[] = [];
  const push = (x: ForgeEvent) => e.push(x);

  push({ ts: at(0), kind: 'run_started', agentId: MAIN });
  push({ ts: at(0), kind: 'agent_started', agentId: MAIN, agentName: 'Claude Code (main)' });
  push({ ts: at(0), kind: 'agent_started', agentId: FE, agentName: 'frontend subagent', parentAgentId: MAIN });
  push({ ts: at(0), kind: 'agent_started', agentId: BE, agentName: 'backend subagent', parentAgentId: MAIN });
  push({ ts: at(1), kind: 'agent_started', agentId: CX, agentName: 'Codex bot' });
  push({ ts: at(1), kind: 'agent_started', agentId: GM, agentName: 'Gemini docs agent' });

  for (const t of TASKS) {
    const endSec = t.startSec + t.durMin * 60;
    push({ ts: at(t.startSec), kind: 'task_started', agentId: t.agent, taskId: t.id, taskTitle: t.title });
    let off = 20;
    for (let i = 0; i < (t.retries ?? 0); i++) {
      push({ ts: at(t.startSec + off), kind: 'retry', agentId: t.agent, taskId: t.id, error: 'provider 500 / assertion failed (synthetic)' });
      off += 30;
    }
    if (t.files) push({ ts: at(t.startSec + off), kind: 'file_changed', agentId: t.agent, taskId: t.id, files: t.files });
    if (t.tests) {
      push({ ts: at(endSec - 90), kind: 'test_started', agentId: t.agent, taskId: t.id });
      push({ ts: at(endSec - 60), kind: 'test_finished', agentId: t.agent, taskId: t.id, status: t.tests === 'pass' ? 'success' : 'failure' });
    }
    push({
      ts: at(endSec - 30),
      kind: 'token_usage',
      agentId: t.agent,
      taskId: t.id,
      model: t.model,
      tokens: { input: t.tokIn, output: t.tokOut, cacheRead: Math.round(t.tokIn * 0.6) },
    });
    const toolNames = ['Edit', 'Bash', 'Read'];
    for (let i = 0; i < (t.tools ?? 0); i++) {
      const tsCall = at(t.startSec + ((i + 1) * Math.max(15, Math.floor((endSec - t.startSec - 120) / Math.max(1, t.tools ?? 1)))));
      push({ ts: tsCall, kind: 'tool_called', agentId: t.agent, taskId: t.id, tool: toolNames[i % 3], toolCallId: `${t.id}-c${i}` });
      push({ ts: at(t.startSec + ((i + 1) * Math.max(15, Math.floor((endSec - t.startSec - 120) / Math.max(1, t.tools ?? 1)))) + 12), kind: 'tool_finished', agentId: t.agent, taskId: t.id, tool: toolNames[i % 3], toolCallId: `${t.id}-c${i}`, status: 'success' });
    }
    push({ ts: at(endSec), kind: 'task_finished', agentId: t.agent, taskId: t.id, status: t.status, durationMs: t.durMin * 60_000 });
  }

  // Tail: everything wraps up shortly after the last task ends (~840s).
  push({ ts: at(850), kind: 'commit_created', agentId: BE, note: 'orders migration' });
  push({ ts: at(855), kind: 'build_started', agentId: MAIN });
  push({ ts: at(875), kind: 'build_finished', agentId: MAIN, status: 'success' });
  push({ ts: at(880), kind: 'agent_finished', agentId: GM, status: 'success' });
  push({ ts: at(881), kind: 'agent_finished', agentId: CX, status: 'partial' });
  push({ ts: at(882), kind: 'agent_finished', agentId: BE, status: 'success' });
  push({ ts: at(883), kind: 'agent_finished', agentId: FE, status: 'success' });
  push({ ts: at(884), kind: 'agent_finished', agentId: MAIN, status: 'success' });
  push({ ts: at(885), kind: 'run_finished', agentId: MAIN, status: 'partial' });

  return e.sort((a, b) => a.ts.localeCompare(b.ts));
}

export async function createDemoRun(baseDir?: string): Promise<{ meta: RunMeta; dir: string }> {
  const created = await createRun('demo', {
    project: 'demo-workspace',
    generator: 'forge synthetic swarm fixture',
    createdAt: new Date(T0),
    ...(baseDir ? { baseDir } : {}),
  });
  await appendEvents(created.dir, buildDemoEvents());
  return created;
}
