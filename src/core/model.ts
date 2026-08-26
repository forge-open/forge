/**
 * Forge canonical model — the vendor-neutral contract at the center of the product.
 *
 * Pipeline:  adapter (vendor-specific) → ForgeEvent[] → analyzeRun() → RunReport → renderer
 *
 * Rules:
 *  - Only `adapters/` may know a vendor's format. Core never does.
 *  - Events store minimized, canonical fields. Raw vendor payloads are NOT persisted.
 *  - Facts and inferences are separated all the way to the report layer.
 */

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type EventKind =
  | 'run_started'
  | 'run_finished'
  | 'agent_started'
  | 'agent_finished'
  | 'task_started'
  | 'task_finished'
  | 'tool_called'
  | 'tool_finished'
  | 'token_usage'
  | 'error'
  | 'retry'
  | 'file_changed'
  | 'commit_created'
  | 'test_started'
  | 'test_finished'
  | 'build_started'
  | 'build_finished'
  | 'note';

export const EVENT_KINDS: readonly EventKind[] = [
  'run_started',
  'run_finished',
  'agent_started',
  'agent_finished',
  'task_started',
  'task_finished',
  'tool_called',
  'tool_finished',
  'token_usage',
  'error',
  'retry',
  'file_changed',
  'commit_created',
  'test_started',
  'test_finished',
  'build_started',
  'build_finished',
  'note',
];

export type TaskStatus = 'success' | 'failure' | 'partial';

/** Token counts as reported by the provider. All fields optional; unit = tokens. */
export interface TokenUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
}

/**
 * One canonical Forge event.
 * `ts` is ISO-8601 (UTC recommended). Everything except `ts` + `kind` is optional
 * and interpreted per-kind (see docs/events.md).
 */
export interface ForgeEvent {
  /** ISO-8601 timestamp */
  ts: string;
  kind: EventKind;
  /** Assigned by the collector when missing */
  runId?: string;
  /** Stable agent id within a run, e.g. "claude-main", "subagent:Explore#1" */
  agentId?: string;
  /** Human display name */
  agentName?: string;
  /** Parent agent id for spawned sub-agents (swarm tree) */
  parentAgentId?: string;
  /** Model id, e.g. "claude-sonnet-4-5" */
  model?: string;
  taskId?: string;
  taskTitle?: string;
  status?: TaskStatus;
  tool?: string;
  /** Correlates tool_called ↔ tool_finished */
  toolCallId?: string;
  tokens?: TokenUsage;
  /** Explicit cost from the source, USD. Absent = estimate via pricing table. */
  costUsd?: number;
  files?: string[];
  /** Sanitized error message (no secrets, no prompt content) */
  error?: string;
  durationMs?: number;
  /** Short factual note; never raw prompt/completion text */
  note?: string;
}

export interface ParseResult {
  events: ForgeEvent[];
  /** Human-readable, non-fatal issues */
  warnings: string[];
  /** Number of input records skipped entirely */
  dropped: number;
}

// ---------------------------------------------------------------------------
// Run metadata & storage
// ---------------------------------------------------------------------------

export interface RunMeta {
  runId: string;
  /** Adapter/source id that produced this run, e.g. "claude-code", "jsonl", "demo" */
  source: string;
  /** Project directory the run belongs to, if known */
  project?: string;
  createdAt: string;
  /** Free-form generator info, e.g. "Claude Code v1.x" */
  generator?: string;
}

// ---------------------------------------------------------------------------
// Computed report model (produced by core/analyze.ts)
// ---------------------------------------------------------------------------

export interface TaskStats {
  taskId: string;
  title: string;
  agentId?: string;
  status: 'success' | 'failure' | 'partial' | 'unknown';
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  tokensTotal: number;
  costUsd?: number;
  toolCalls: number;
  files: string[];
  errors: number;
  retries: number;
  testRuns: number;
}

export interface AgentStats {
  agentId: string;
  name: string;
  parentAgentId?: string;
  /** model id → total tokens attributed to it */
  models: Record<string, number>;
  taskCount: number;
  successCount: number;
  failureCount: number;
  partialCount: number;
  /** Sum of completed task durations attributable to this agent */
  activeMs: number;
  /** First-event to last-event span for this agent */
  wallMs?: number;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  tokensTotal: number;
  costUsd?: number;
  toolCalls: number;
  /** tool name → call count */
  byTool: Record<string, number>;
  filesTouched: string[];
  errors: number;
  retries: number;
  testRuns: number;
}

export interface FileStats {
  path: string;
  /** Agent ids that wrote/edited this file (overlap ⇒ possible duplicated work) */
  agents: string[];
  writes: number;
}

/** Deterministic engineering signals only — no AI-judged scores in v1. */
export interface EngineeringSignals {
  /** Bash/tool invocations detected as test runs */
  testRuns: number;
  /** Failed test invocations where determinable, else null */
  testFailures: number | null;
  commits: number;
  /** build/typecheck invocations */
  buildChecks: number;
  filesChanged: number;
  /** Provider/API-level errors observed (retry proxy) */
  apiErrors: number;
  retries: number;
  errors: number;
}

export type InsightSeverity = 'info' | 'warn';

export type InsightKind =
  | 'token-concentration'
  | 'file-overlap'
  | 'retry-hotspot'
  | 'cost-mismatch'
  | 'duration-outlier'
  | 'failures'
  | 'no-tests';

/**
 * A rule-based finding. `observed` states facts with numbers taken straight from
 * the data; `recommendation` is clearly-marked inference. Never merge the two.
 */
export interface Insight {
  id: string;
  kind: InsightKind;
  title: string;
  severity: InsightSeverity;
  /** Factual observation, e.g. "subagent:Explore#2 used 24% of tokens for 8% of successful tasks." */
  observed: string;
  /** Concrete evidence references (ids, counts, file lists) */
  evidence: string[];
  /** Optional suggested change for the next run. Omit when evidence is thin. */
  recommendation?: string;
}

export interface RunTotals {
  agents: number;
  tasks: number;
  wallMs: number;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  tokensTotal: number;
  /** Estimated USD cost; undefined when no pricing data matched any usage */
  costUsd?: number;
  /** false ⇒ some token usage had unknown model pricing (cost is partial) */
  costKnown: boolean;
  success: number;
  failure: number;
  partial: number;
  unknown: number;
  errors: number;
  retries: number;
  toolCalls: number;
}

/** The complete computed artifact every renderer consumes. */
export interface RunReport {
  meta: RunMeta;
  totals: RunTotals;
  agents: AgentStats[];
  tasks: TaskStats[];
  files: FileStats[];
  engineering: EngineeringSignals;
  insights: Insight[];
  warnings: string[];
}
