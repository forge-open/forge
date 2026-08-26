import fsp from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeTs } from '../core/events.js';
import type { ForgeEvent, ParseResult } from '../core/model.js';

/**
 * Codex CLI adapter.
 *
 * Converts local OpenAI Codex CLI session rollouts
 * (~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl) into canonical Forge
 * events. Pure converter below; discovery helpers touch the filesystem.
 *
 * Schema verified against 51 real rollouts spanning cli_version 0.112.0-alpha.3
 * (2026-03) through 0.149.1 (2026-08). Every line is
 * `{ timestamp: "<ISO Z>", type, payload }`; newer builds add an `ordinal`.
 * Observed types: session_meta, response_item, turn_context, event_msg,
 * world_state (noise), compacted (noise).
 *
 * Evidence-based mapping decisions:
 *  - Model lives in turn_context.payload.model (string, may change per turn);
 *    every token_count event follows a turn_context in all 51 files.
 *  - Token usage lives ONLY in event_msg/token_count payloads
 *    (info.last_token_usage = per-API-call deltas, info.total_token_usage =
 *    cumulative). We emit deltas; reasoning_output_tokens is a subset of
 *    output_tokens and is never added again. cache_write_input_tokens appears
 *    only on newer builds and maps to TokenUsage.cacheWrite when present.
 *  - Turn boundaries come from event_msg/task_started|task_complete (present in
 *    every observed file, carry turn_id and sometimes duration_ms). Real user
 *    prompts are response_item/message role=user whose text is NOT one of the
 *    CLI-injected blocks (<environment_context>, <user_instructions>, ...);
 *    they supply task titles only, because they routinely arrive after
 *    task_started and are replayed on resume (double-counting otherwise).
 *  - Tool calls are response_item/function_call {call_id,name,arguments} and
 *    response_item/custom_tool_call {call_id,name,input}, paired by call_id
 *    with the *_call_output records. Outputs carry no error flag, so failures
 *    come from correlated event_msg/exec_command_end (status/exit_code) and
 *    event_msg/patch_apply_end (success=false); default is success.
 *  - File writes: custom_tool_call name=apply_patch carries a raw patch
 *    ("*** Update File: <path>" headers). Newer builds route the same patches
 *    through custom_tool_call name=exec whose input is sandboxed JS
 *    (`const patch = "*** Begin Patch\n*** Update File: ..."`), so headers are
 *    matched after unescaping "\n" sequences.
 *  - Interruptions: event_msg/turn_aborted (reason, e.g. "interrupted") and
 *    event_msg/error -> retry events, counting toward the open task window
 *    (partial status).
 *  - Sub-agents: multi-agent hooks exist on newest builds (spawn_agent calls,
 *    multi_agent_v1__* JS helpers) but sibling threads live in OTHER rollout
 *    files and carry no per-agent telemetry here, so v1 attributes everything
 *    to the single "codex" agent.
 *
 * Privacy: events carry metadata only. The sole free-text field is taskTitle
 * (first <=120 chars of the user prompt, control-stripped, secret-scrubbed).
 * Shell commands are classified (commit/test/build) but never stored verbatim;
 * patch bodies are reduced to file paths (<=1024 chars/path).
 */

// ---------------------------------------------------------------------------
// rollout shape (subset we understand)
// ---------------------------------------------------------------------------

interface CodexRecord {
  type?: unknown;
  timestamp?: unknown;
  ordinal?: unknown;
  payload?: unknown;
}

/** Payload fields we look at, across all observed versions. */
interface CodexPayload {
  type?: unknown;
  // session_meta / turn_context
  cwd?: unknown;
  cli_version?: unknown;
  model?: unknown;
  turn_id?: unknown;
  // message
  role?: unknown;
  content?: unknown;
  phase?: unknown;
  // tool calls
  name?: unknown;
  call_id?: unknown;
  arguments?: unknown;
  input?: unknown;
  output?: unknown;
  status?: unknown;
  exit_code?: unknown;
  success?: unknown;
  // token_count
  info?: unknown;
  last_token_usage?: unknown;
  total_token_usage?: unknown;
  input_tokens?: unknown;
  output_tokens?: unknown;
  cached_input_tokens?: unknown;
  cache_write_input_tokens?: unknown;
  // errors / aborts / durations
  reason?: unknown;
  message?: unknown;
  duration_ms?: unknown;
}

const FILE_HEADER_RE = /\*\*\* (?:Add|Update|Delete) File:[ \t]?/;
const TEST_RE =
  /\b(npm (run )?test|npm run test:[a-z-]+|vitest|jest|pytest|cargo test|go test|mvn .*test|gradle .*test|dotnet test|phpunit|rake test|flutter test|npx playwright)\b/;
const BUILD_RE = /\b(tsc|typecheck|type-check|npm run build|make|cmake|gradle build|cargo build|go build)\b/;

const SECRET_RE =
  /\b(sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{20,}|gh[spo]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[bap]-[A-Za-z0-9-]{10,}|glpat-[A-Za-z0-9_-]{15,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})\b/g;

function scrub(text: string, max: number): string {
  const cleaned = text
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(SECRET_RE, '[REDACTED]');
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, Math.max(0, max - 3)) + '...';
}

function normPath(p: unknown): string | undefined {
  if (typeof p !== 'string' || p.length === 0) return undefined;
  // JS-embedded patches escape backslashes ("D:\\dir"), which would turn into
  // doubled separators; collapse runs like Claude Code's scheme cannot hit.
  // Control characters (ANSI escapes, OSC) are stripped: paths are display data.
  const normalized = p
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, '')
    .replace(/\\+/g, '/');
  return normalized.length > 1024 ? normalized.slice(0, 1024) : normalized;
}

/** Non-negative finite number: negative token/duration values are forged data. */
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Bounded identifier: hostile rollouts must not bloat events with huge strings. */
function ident(v: string | undefined, max = 200): string | undefined {
  return v === undefined ? undefined : v.length > max ? v.slice(0, max) : v;
}

function asPayload(v: unknown): CodexPayload {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as CodexPayload) : {};
}

function safeJsonParse(text: unknown): Record<string, unknown> | null {
  if (typeof text !== 'string' || text.length === 0) return null;
  try {
    const v = JSON.parse(text);
    return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * User-role messages whose text opens with these XML-ish tags are CLI plumbing
 * (environment snapshots, AGENTS.md-style instructions, abort notices,
 * plugin ads, pasted-image placeholders) — observed leading tags across the
 * corpus. They never represent user work.
 */
const INJECTED_TAG_RE = /^\s*<([A-Za-z][A-Za-z0-9_-]*)[>\n]/;
const INJECTED_TAGS = new Set([
  'environment_context',
  'user_instructions',
  'turn_aborted',
  'subagent_notification',
  'recommended_plugins',
  'app_context',
  'image',
]);

/** Extract changed paths from a patch body (raw or embedded in JS source). */
function extractPatchFiles(input: string): string[] {
  // Newest builds embed the patch inside a JS string literal where newlines
  // are "\n" escape sequences; unescaping them makes both forms uniform.
  const text = input.includes('\\n') ? input.replace(/\\n/g, '\n') : input;
  const files: string[] = [];
  // Line-by-line with a cheap substring pre-filter: a global multiline regex
  // over a hostile multi-MB body can backtrack quadratically.
  const re = /^[ \t]{0,8}\*\*\* (?:Add|Update|Delete) File:[ \t]*(.+)$/;
  for (const line of text.split('\n')) {
    if (files.length >= 200) break;
    if (!line.includes('*** ')) continue;
    const m = re.exec(line);
    if (!m) continue;
    const f = normPath(m[1]?.trim());
    if (f) files.push(f);
  }
  return [...new Set(files)].slice(0, 100);
}

function extractUserText(payload: CodexPayload): string | null {
  const parts: string[] = [];
  if (Array.isArray(payload.content)) {
    for (const block of payload.content) {
      if (typeof block === 'object' && block !== null) {
        const b = block as { type?: unknown; text?: unknown };
        if (b.type === 'input_text' && typeof b.text === 'string') parts.push(b.text);
      }
    }
  } else if (typeof payload.content === 'string') {
    parts.push(payload.content);
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

// ---------------------------------------------------------------------------
// converter state machine
// ---------------------------------------------------------------------------

type CallCategory = 'plain' | 'commit' | 'test' | 'build';

interface PendingCall {
  ts: string;
  taskId?: string;
  category: CallCategory;
}

interface OpenTask {
  id: string;
  turnId?: string;
  errors: number;
  /** Already-pushed task_started event; title may be backfilled when the prompt arrives later. */
  startEvent: ForgeEvent;
}

class Converter {
  private readonly agentId = 'codex';
  private readonly events: ForgeEvent[] = [];
  private readonly warnings: string[] = [];
  private readonly noise = new Map<string, number>();
  private readonly pending = new Map<string, PendingCall>();
  /** call_id -> tool known to have failed, via exec_command_end / patch_apply_end correlation. */
  private readonly failedCalls = new Set<string>();
  private droppedCount = 0;

  private model?: string;
  private taskCounter = 0;
  private open: OpenTask | null = null;
  private pendingTitle?: string;
  private agentStartedAt?: string;

  private warn(msg: string): void {
    if (this.warnings.length < 100) this.warnings.push(msg);
  }

  private note(kind: string): void {
    // Hostile transcripts can carry megabyte "type" strings: bound the key.
    const bounded = kind.length > 40 ? kind.slice(0, 40) : kind;
    this.noise.set(bounded, (this.noise.get(bounded) ?? 0) + 1);
  }

  private emit(e: ForgeEvent): void {
    this.events.push(e);
  }

  /** Lazily declare the single main agent at its first mapped activity. */
  private ensureStarted(ts: string): void {
    if (this.agentStartedAt !== undefined) return;
    this.agentStartedAt = ts;
    this.emit({ ts, kind: 'agent_started', agentId: this.agentId, agentName: 'Codex CLI' });
  }

  private classifyCommand(cmd: string): CallCategory {
    if (/git commit/.test(cmd)) return 'commit';
    if (TEST_RE.test(cmd)) return 'test';
    if (BUILD_RE.test(cmd)) return 'build';
    return 'plain';
  }

  private closeOpenTask(ts: string, durationMs?: number): void {
    if (!this.open) return;
    if (this.open.startEvent.taskTitle === undefined) this.open.startEvent.taskTitle = 'untitled turn';
    this.emit({
      ts,
      kind: 'task_finished',
      agentId: this.agentId,
      taskId: this.open.id,
      status: this.open.errors > 0 ? 'partial' : 'success',
      ...(durationMs !== undefined ? { durationMs } : {}),
    });
    this.open = null;
  }

  private beginTask(ts: string, turnId: string | undefined): void {
    this.closeOpenTask(ts);
    this.taskCounter++;
    const taskId = `t${this.taskCounter}`;
    const title = this.pendingTitle;
    this.pendingTitle = undefined;
    const startEvent: ForgeEvent = {
      ts,
      kind: 'task_started',
      agentId: this.agentId,
      taskId,
      taskTitle: title ?? 'untitled turn',
    };
    this.emit(startEvent);
    this.open = { id: taskId, ...(turnId ? { turnId } : {}), errors: 0, startEvent };
  }

  private emitRetry(ts: string, rawError: string): void {
    this.ensureStarted(ts);
    this.emit({ ts, kind: 'retry', agentId: this.agentId, error: scrub(rawError, 200) });
    if (this.open) this.open.errors++;
  }

  private handleTokenCount(ts: string, payload: CodexPayload): void {
    const info = typeof payload.info === 'object' && payload.info !== null ? (payload.info as CodexPayload) : {};
    const last = typeof info.last_token_usage === 'object' && info.last_token_usage !== null ? (info.last_token_usage as CodexPayload) : {};
    const tokens = {
      ...(num(last.input_tokens) !== undefined ? { input: num(last.input_tokens) } : {}),
      ...(num(last.output_tokens) !== undefined ? { output: num(last.output_tokens) } : {}),
      ...(num(last.cached_input_tokens) !== undefined ? { cacheRead: num(last.cached_input_tokens) } : {}),
      ...(num(last.cache_write_input_tokens) !== undefined ? { cacheWrite: num(last.cache_write_input_tokens) } : {}),
    };
    const total = Object.values(tokens).reduce<number>((a, b) => a + (b ?? 0), 0);
    if (total <= 0) {
      this.note('event_msg/token_count(no usage)');
      return;
    }
    this.ensureStarted(ts);
    this.emit({
      ts,
      kind: 'token_usage',
      agentId: this.agentId,
      ...(this.model ? { model: ident(this.model) } : {}),
      ...(this.open ? { taskId: this.open.id } : {}),
      tokens,
    });
  }

  private beginToolCall(
    ts: string,
    callId: string,
    name: string,
    category: CallCategory,
    files?: string[],
  ): void {
    const taskId = this.open?.id;
    this.ensureStarted(ts);
    if (category === 'commit') {
      this.emit({ ts, kind: 'commit_created', agentId: this.agentId, ...(taskId ? { taskId } : {}) });
    } else if (category === 'test' || category === 'build') {
      this.emit({
        ts,
        kind: category === 'test' ? 'test_started' : 'build_started',
        agentId: this.agentId,
        ...(taskId ? { taskId } : {}),
      });
    }
    if (files && files.length > 0) {
      this.emit({ ts, kind: 'file_changed', agentId: this.agentId, ...(taskId ? { taskId } : {}), files });
    }
    this.emit({
      ts,
      kind: 'tool_called',
      agentId: this.agentId,
      ...(taskId ? { taskId } : {}),
      tool: ident(name),
      toolCallId: ident(callId),
    });
    this.pending.set(callId, { ts, ...(taskId ? { taskId } : {}), category });
  }

  private finishToolCall(ts: string, callId: string, output: unknown): void {
    const call = this.pending.get(callId);
    this.pending.delete(callId);
    if (!call) {
      this.note('response_item/*_call_output(unmatched)');
      return;
    }
    // Outputs carry no error flag in any observed version; honor one if a
    // future build adds it, otherwise fall back to correlation evidence.
    let failed = false;
    const parsed = safeJsonParse(output);
    if (parsed && (parsed.is_error === true || typeof parsed.error === 'string')) failed = true;
    if (this.failedCalls.has(callId)) failed = true;
    const status = failed ? 'failure' : 'success';
    const startMs = Date.parse(call.ts);
    const durationMs = Number.isFinite(startMs) ? Math.max(0, Date.parse(ts) - startMs) : undefined;
    this.emit({
      ts,
      kind: 'tool_finished',
      agentId: this.agentId,
      toolCallId: ident(callId),
      status,
      ...(durationMs !== undefined ? { durationMs } : {}),
    });
    if (call.category === 'test' || call.category === 'build') {
      this.emit({
        ts,
        kind: call.category === 'test' ? 'test_finished' : 'build_finished',
        agentId: this.agentId,
        ...(call.taskId ? { taskId: call.taskId } : {}),
        status,
      });
    }
  }

  private handleResponseItem(ts: string, payload: CodexPayload): void {
    const pt = str(payload.type) ?? 'unknown';
    switch (pt) {
      case 'message': {
        const role = str(payload.role);
        if (role === 'user') {
          const text = extractUserText(payload);
          if (text === null || text.trim() === '') {
            this.note('response_item/message(user-empty)');
            return;
          }
          const injected = INJECTED_TAG_RE.exec(text.slice(0, 80));
          if (injected && INJECTED_TAGS.has(injected[1])) {
            this.note('response_item/message(user-injected)');
            return;
          }
          // Real prompt: supplies the title for the current or next turn.
          this.ensureStarted(ts);
          const title = scrub(text.trim(), 120);
          if (this.open && this.open.startEvent.taskTitle === 'untitled turn') {
            // The prompt belongs to the already-open turn; consume it entirely
            // so it cannot resurface as a stale title on the following task.
            this.open.startEvent.taskTitle = title;
            this.pendingTitle = undefined;
          } else {
            this.pendingTitle = title;
          }
          return;
        }
        // assistant / developer messages carry no usage or tool data we need.
        this.note(`response_item/message(${role ?? 'unknown'})`);
        return;
      }
      case 'function_call': {
        const callId = str(payload.call_id);
        const name = str(payload.name);
        if (!callId || !name) {
          this.note('response_item/function_call(malformed)');
          return;
        }
        const args = safeJsonParse(payload.arguments) ?? {};
        // shell_command passes {command: string}; tolerate array form too.
        const rawCmd = args.command;
        const cmd =
          typeof rawCmd === 'string'
            ? rawCmd
            : Array.isArray(rawCmd)
              ? rawCmd.filter((c): c is string => typeof c === 'string').join(' ')
              : '';
        this.beginToolCall(ts, callId, name, cmd ? this.classifyCommand(cmd) : 'plain');
        return;
      }
      case 'custom_tool_call': {
        const callId = str(payload.call_id);
        const name = str(payload.name);
        if (!callId || !name) {
          this.note('response_item/custom_tool_call(malformed)');
          return;
        }
        const input = typeof payload.input === 'string' ? payload.input : '';
        let files: string[] | undefined;
        const looksLikePatch = name === 'apply_patch' || FILE_HEADER_RE.test(input.replace(/\\n/g, '\n'));
        if (looksLikePatch && input.length > 0) {
          files = extractPatchFiles(input);
        }
        this.beginToolCall(ts, callId, name, 'plain', files && files.length > 0 ? files : undefined);
        return;
      }
      case 'function_call_output':
      case 'custom_tool_call_output': {
        const callId = str(payload.call_id);
        if (!callId) {
          this.note(`response_item/${pt}(malformed)`);
          return;
        }
        this.finishToolCall(ts, callId, payload.output);
        return;
      }
      case 'reasoning':
      case 'web_search_call':
      case 'tool_search_call':
      case 'tool_search_output':
        this.note(`response_item/${pt}`);
        return;
      default:
        this.note(`response_item/${pt}`);
    }
  }

  private handleEventMsg(ts: string, payload: CodexPayload): void {
    const pt = str(payload.type) ?? 'unknown';
    switch (pt) {
      case 'task_started':
        this.beginTask(ts, str(payload.turn_id));
        return;
      case 'task_complete':
        // Ordering guarantees completion closes the currently open turn.
        this.closeOpenTask(ts, num(payload.duration_ms));
        return;
      case 'token_count':
        this.handleTokenCount(ts, payload);
        return;
      case 'turn_aborted':
        this.emitRetry(ts, str(payload.reason) ?? 'turn aborted');
        return;
      case 'error':
        this.emitRetry(ts, str(payload.message) ?? 'codex reported an error');
        return;
      case 'exec_command_end': {
        const callId = str(payload.call_id);
        if (callId && (payload.status === 'failed' || (num(payload.exit_code) ?? 0) !== 0)) {
          this.failedCalls.add(callId);
        }
        this.note('event_msg/exec_command_end');
        return;
      }
      case 'patch_apply_end': {
        const callId = str(payload.call_id);
        if (callId && payload.success === false) this.failedCalls.add(callId);
        this.note('event_msg/patch_apply_end');
        return;
      }
      default:
        // agent_message/agent_reasoning/user_message duplicate response_items;
        // item_completed/thread_*/context_compacted/web_search_end/
        // dynamic_tool_* are UI telemetry with no canonical counterpart.
        this.note(`event_msg/${pt}`);
    }
  }

  processRecord(raw: unknown): void {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      this.droppedCount++;
      this.warn('skipped non-object record');
      return;
    }
    const rec = raw as CodexRecord;
    const ts = normalizeTs(rec.timestamp);
    if (!ts) {
      this.droppedCount++;
      this.warn('skipped record without valid timestamp');
      return;
    }
    const type = str(rec.type) ?? 'unknown';
    const payload = asPayload(rec.payload);

    switch (type) {
      case 'session_meta':
        // cwd/cli_version are discovery metadata, not events; several copies
        // may appear per file (resume) but cwd was constant in every rollout.
        this.note('session_meta');
        return;
      case 'turn_context': {
        const model = str(payload.model);
        if (model) this.model = model; // attaches to subsequent token_usage until changed
        this.note('turn_context');
        return;
      }
      case 'response_item':
        this.handleResponseItem(ts, payload);
        return;
      case 'event_msg':
        this.handleEventMsg(ts, payload);
        return;
      default:
        // world_state, compacted, heartbeats, anything new.
        this.note(type);
    }
  }

  /** Ingest raw rollout text line by line; bad lines are warned and dropped. */
  ingest(text: string): void {
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line === '') continue;
      let obj: unknown;
      try {
        obj = JSON.parse(line);
      } catch {
        this.droppedCount++;
        this.warn(`line ${i + 1}: invalid JSON`);
        continue;
      }
      try {
        this.processRecord(obj);
      } catch {
        this.droppedCount++;
        this.warn(`line ${i + 1}: unexpected record structure`);
      }
    }
  }

  finish(): ParseResult {
    // Close trailing windows using the latest observed timestamp.
    let lastTs = '';
    for (const e of this.events) if (e.ts > lastTs) lastTs = e.ts;
    const endTs = lastTs || new Date(0).toISOString();
    this.closeOpenTask(endTs);
    if (this.agentStartedAt !== undefined) {
      this.emit({ ts: endTs, kind: 'agent_finished', agentId: this.agentId });
    }
    if (this.pending.size > 0) {
      this.warnings.push(`${this.pending.size} tool call(s) never received a result`);
    }
    if (this.noise.size > 0) {
      const total = [...this.noise.values()].reduce((a, b) => a + b, 0);
      this.warnings.push(
        `${total} non-conversation record(s) skipped (${[...this.noise.keys()].sort().join(', ').slice(0, 300)})`,
      );
    }
    this.events.sort((a, b) => a.ts.localeCompare(b.ts) || a.kind.localeCompare(b.kind));
    return { events: this.events, warnings: [...this.warnings], dropped: this.droppedCount };
  }
}

/**
 * Pure converter: Codex rollout JSONL text -> canonical events + warnings.
 * No fs access. Lenient across CLI version variance; malformed lines are
 * dropped with warnings, never fatal.
 */
export function codexSessionToEvents(text: string, opts: { projectPath?: string } = {}): ParseResult {
  void opts.projectPath;
  const conv = new Converter();
  conv.ingest(text);
  return conv.finish();
}

// ---------------------------------------------------------------------------
// filesystem discovery
// ---------------------------------------------------------------------------

export interface CodexSessionRef {
  sessionId: string;
  filePath: string;
  project?: string;
  mtimeMs: number;
}

/** Locate the Codex sessions directory (~/.codex/sessions) or null. */
export function findCodexSessionsDir(): string | null {
  const override = process.env.CODEX_SESSIONS_DIR;
  if (override) return fsSync.existsSync(override) ? override : null;
  const dir = path.join(os.homedir(), '.codex', 'sessions');
  return fsSync.existsSync(dir) ? dir : null;
}

/** Case-insensitive comparison only where the platform mandates it (win32). */
function normalizeProjectPath(p: string): string {
  const slashed = p.replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' ? slashed.toLowerCase() : slashed;
}

/**
 * Read the first line (always a session_meta record in every observed rollout)
 * without loading the whole file. session_meta lines can exceed 8KB (dynamic
 * tool catalogs), so chunks are pulled until a newline appears, bounded at 1MB.
 * Null when unavailable.
 */
async function readFirstLineCwd(filePath: string): Promise<string | null> {
  let handle: Awaited<ReturnType<typeof fsp.open>> | null = null;
  try {
    handle = await fsp.open(filePath, 'r');
    const chunks: Buffer[] = [];
    let total = 0;
    const CHUNK = 64 * 1024;
    const MAX = 1024 * 1024;
    while (total < MAX) {
      const buf = Buffer.alloc(Math.min(CHUNK, MAX - total));
      const { buffer, bytesRead } = await handle.read(buf, 0, buf.length, total);
      if (bytesRead <= 0) break;
      const view = buffer.subarray(0, bytesRead);
      chunks.push(view);
      total += bytesRead;
      if (view.includes(0x0a) || bytesRead < buf.length) break;
    }
    const firstLine = Buffer.concat(chunks).toString('utf8').split('\n')[0]?.trim() ?? '';
    const record = safeJsonParse(firstLine) as CodexRecord | null;
    // cwd sits under payload: `{ type: "session_meta", payload: { cwd, ... } }`
    const payload = record !== null && typeof record.payload === 'object' && record.payload !== null ? asPayload(record.payload) : {};
    return str(payload.cwd) ?? null;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => {});
  }
}

/**
 * Discover Codex rollout sessions under the YYYY/MM/DD tree, newest first.
 * With projectPath set, restricts to sessions whose session_meta.cwd matches
 * (first ~8KB of each candidate is read to recover it).
 */
export async function discoverCodexSessions(
  opts: { sessionsDir?: string; projectPath?: string; limit?: number } = {},
): Promise<CodexSessionRef[]> {
  const root = opts.sessionsDir ?? findCodexSessionsDir();
  if (!root) throw new Error('Codex sessions directory not found (~/.codex/sessions)');

  const candidates: { filePath: string; mtimeMs: number }[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    let entries: fsSync.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of entries) {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) {
        if (depth < 8) await walk(p, depth + 1);
      } else if (d.isFile() && /^rollout-.+\.jsonl$/.test(d.name)) {
        try {
          const st = await fsp.stat(p);
          candidates.push({ filePath: p, mtimeMs: st.mtimeMs });
        } catch {
          /* vanished between readdir and stat */
        }
      }
    }
  }
  await walk(root, 0);
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const wantProject = opts.projectPath !== undefined ? normalizeProjectPath(opts.projectPath) : null;
  const limit = Math.max(1, opts.limit ?? 20);
  const sessions: CodexSessionRef[] = [];
  for (const cand of candidates) {
    if (sessions.length >= limit) break;
    const project = await readFirstLineCwd(cand.filePath);
    if (wantProject !== null && (project === null || normalizeProjectPath(project) !== wantProject)) {
      continue;
    }
    sessions.push({
      sessionId: path.basename(cand.filePath).replace(/\.jsonl$/, ''),
      filePath: cand.filePath,
      ...(project !== null ? { project } : {}),
      mtimeMs: cand.mtimeMs,
    });
  }
  return sessions;
}
