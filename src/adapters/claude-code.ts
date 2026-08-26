import fsp from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeTs } from '../core/events.js';
import type { ForgeEvent, ParseResult } from '../core/model.js';

/**
 * Claude Code adapter.
 *
 * Converts local Claude Code session transcripts
 * (~/.claude/projects/<munged-project-path>/<session-id>.jsonl) into canonical
 * Forge events. Pure converter below; discovery helpers touch the filesystem.
 *
 * Vendor noise (mode/permission-mode/file-history-snapshot/attachment/system...)
 * is tallied, not converted. Malformed lines never abort an import.
 *
 * Privacy: events carry metadata only. The sole free-text field is taskTitle
 * (first <=120 chars of the user prompt, control-stripped, secret-scrubbed).
 * Bash commands are classified (commit/test/build) but never stored verbatim.
 */

// ---------------------------------------------------------------------------
// transcript shape (subset we understand)
// ---------------------------------------------------------------------------

interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  is_error?: boolean;
}

interface TranscriptRecord {
  type?: string;
  timestamp?: unknown;
  uuid?: string;
  cwd?: string;
  version?: string;
  sessionId?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  isApiErrorMessage?: boolean;
  message?: {
    id?: string;
    model?: string;
    role?: string;
    stop_reason?: string | null;
    content?: string | ContentBlock[];
    usage?: Record<string, unknown>;
  };
}

const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
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
  // Control characters (ANSI escapes, OSC) are stripped: paths are display data.
  const normalized = p
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, '')
    .replace(/\\/g, '/');
  return normalized.length > 1024 ? normalized.slice(0, 1024) : normalized;
}

/** Bounded identifier: hostile transcripts must not bloat events with huge strings. */
function ident(v: string | undefined, max = 200): string | undefined {
  return v === undefined ? undefined : v.length > max ? v.slice(0, max) : v;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function contentBlocks(message: TranscriptRecord['message']): ContentBlock[] {
  if (!message) return [];
  if (Array.isArray(message.content)) return message.content;
  return [];
}

function extractPromptText(message: TranscriptRecord['message']): string | null {
  if (!message) return null;
  if (typeof message.content === 'string') return message.content;
  const parts = contentBlocks(message)
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string);
  return parts.length > 0 ? parts.join(' ') : null;
}

// ---------------------------------------------------------------------------
// converter state machine
// ---------------------------------------------------------------------------

interface OpenTask {
  callId: string;
  label: string;
  agentId: string;
}

interface PendingCall {
  ts: string;
  agentId: string;
  taskId?: string;
  category: 'plain' | 'task' | 'commit' | 'test' | 'build';
}

class Converter {
  private readonly mainAgentId: string;
  private readonly events: ForgeEvent[] = [];
  private readonly warnings: string[] = [];
  private readonly agentFirst = new Map<string, string>();
  private readonly agentLast = new Map<string, string>();
  private readonly agentName = new Map<string, string>();
  private readonly pending = new Map<string, PendingCall>();
  private readonly unsupported = new Map<string, number>();
  /** Parent agent id for spawned sub-agents (swarm tree) */
  private readonly parentByAgent = new Map<string, string>();
  /**
   * FIFO of open Task-tool calls awaiting sidechain activity / completion.
   * `openTasksById` keeps removal O(1) so hostile transcripts cannot trigger
   * quadratic filtering; the array lazily evicts closed entries from the front.
   */
  private openTasks: OpenTask[] = [];
  private readonly openTasksById = new Map<string, OpenTask>();
  private readonly subCounterByLabel = new Map<string, number>();
  private unknownSubCounter = 0;
  private droppedCount = 0;

  private taskCounter = 0;
  private openMainTask: { id: string; errors: number } | null = null;

  constructor(mainAgentId?: string) {
    this.mainAgentId = mainAgentId || 'claude-main';
    this.agentName.set(this.mainAgentId, 'Claude Code');
  }

  /** Bounded so multi-megabyte garbage transcripts cannot balloon memory/console. */
  private warn(msg: string): void {
    if (this.warnings.length < 100) this.warnings.push(msg);
  }

  private note(kind: string): void {
    this.unsupported.set(kind, (this.unsupported.get(kind) ?? 0) + 1);
  }

  private emit(e: ForgeEvent): void {
    this.events.push(e);
    if (e.agentId) {
      const prevFirst = this.agentFirst.get(e.agentId);
      if (!prevFirst || e.ts < prevFirst) this.agentFirst.set(e.agentId, e.ts);
      const prevLast = this.agentLast.get(e.agentId);
      if (!prevLast || e.ts > prevLast) this.agentLast.set(e.agentId, e.ts);
    }
  }

  /** Lazily declare agents so every referenced agentId has started. */
  private ensureStarted(agentId: string, ts: string): void {
    if (!this.agentFirst.has(agentId)) {
      const parent = this.parentByAgent.get(agentId);
      this.emit({
        ts,
        kind: 'agent_started',
        agentId,
        agentName: this.agentName.get(agentId) ?? agentId,
        ...(parent ? { parentAgentId: parent } : {}),
      });
    }
  }

  private subAgentFor(sidechain: boolean, ts: string): string {
    if (!sidechain) return this.mainAgentId;
    // Lazily drop closed tasks from the FIFO front so the oldest-open lookup
    // stays correct without scanning the whole array per record.
    while (this.openTasks.length > 0 && !this.openTasksById.has(this.openTasks[0].callId)) {
      this.openTasks.shift();
    }
    const open = this.openTasks[0];
    if (!open) {
      this.unknownSubCounter++;
      const id = `subagent:unknown#${this.unknownSubCounter}`;
      this.parentByAgent.set(id, this.mainAgentId);
      this.ensureStarted(id, ts);
      return id;
    }
    this.ensureStarted(open.agentId, ts);
    return open.agentId;
  }

  private classifyBash(cmd: string): PendingCall['category'] {
    if (/git commit/.test(cmd)) return 'commit';
    if (TEST_RE.test(cmd)) return 'test';
    if (BUILD_RE.test(cmd)) return 'build';
    return 'plain';
  }

  private closeOpenMainTask(ts: string): void {
    if (!this.openMainTask) return;
    this.emit({
      ts,
      kind: 'task_finished',
      agentId: this.mainAgentId,
      taskId: this.openMainTask.id,
      status: this.openMainTask.errors > 0 ? 'partial' : 'success',
    });
    this.openMainTask = null;
  }

  processRecord(raw: unknown): void {
    if (typeof raw !== 'object' || raw === null) {
      this.warn('skipped non-object record');
      return;
    }
    const rec = raw as TranscriptRecord;
    if (rec.type !== 'user' && rec.type !== 'assistant') {
      this.note(rec.type ?? 'unknown');
      return;
    }
    const ts = normalizeTs(rec.timestamp);
    if (!ts) {
      this.warn(`skipped ${String(rec.type)} record without valid timestamp`);
      return;
    }
    const sidechain = rec.isSidechain === true;
    const agentId = this.subAgentFor(sidechain, ts);
    if (!sidechain) this.ensureStarted(agentId, ts);
    const blocks = contentBlocks(rec.message);

    if (rec.isApiErrorMessage) {
      const errText =
        typeof rec.message?.content === 'string'
          ? rec.message.content
          : blocks.find((b) => b.type === 'text')?.text ?? '';
      this.emit({
        ts,
        kind: 'retry',
        agentId,
        ...(rec.message?.model ? { model: rec.message.model } : {}),
        ...(!sidechain && this.openMainTask ? { taskId: this.openMainTask.id } : {}),
        error: scrub(errText, 200),
      });
      if (this.openMainTask && !sidechain) this.openMainTask.errors++;
      return;
    }

    if (rec.type === 'assistant') {
      const model = rec.message?.model;
      const u = rec.message?.usage ?? {};
      const tokens = {
        input: num(u.input_tokens),
        output: num(u.output_tokens),
        cacheRead: num(u.cache_read_input_tokens),
        cacheWrite: num(u.cache_creation_input_tokens),
      };
      const anyToken =
        (tokens.input ?? 0) + (tokens.output ?? 0) + (tokens.cacheRead ?? 0) + (tokens.cacheWrite ?? 0) > 0;
      if (anyToken) {
        this.emit({
          ts,
          kind: 'token_usage',
          agentId,
          ...(model ? { model: ident(model) } : {}),
          ...(!sidechain && this.openMainTask ? { taskId: this.openMainTask.id } : {}),
          tokens: Object.fromEntries(Object.entries(tokens).filter(([, v]) => v !== undefined)),
        });
      }
      for (const b of blocks) {
        if (b.type !== 'tool_use' || typeof b.id !== 'string' || typeof b.name !== 'string') continue;
        const input = b.input ?? {};
        const taskId = !sidechain && this.openMainTask ? this.openMainTask.id : undefined;
        let category: PendingCall['category'] = 'plain';
        if (b.name === 'Task') {
          category = 'task';
          const rawLabel = typeof input.subagent_type === 'string' && input.subagent_type ? input.subagent_type : 'agent';
          // Identifier, not free text: bound it so hostile transcripts cannot
          // smuggle bulk content into agent ids/names.
          const label = scrub(rawLabel, 60).replace(/[^A-Za-z0-9_.-]/g, '') || 'agent';
          const n = (this.subCounterByLabel.get(label) ?? 0) + 1;
          this.subCounterByLabel.set(label, n);
          const subId = `subagent:${label}#${n}`;
          this.parentByAgent.set(subId, this.mainAgentId);
          const openTask: OpenTask = { callId: b.id, label, agentId: subId };
          this.openTasks.push(openTask);
          this.openTasksById.set(b.id, openTask);
          this.agentName.set(subId, `${label} subagent`);
        } else if (FILE_TOOLS.has(b.name)) {
          const file = normPath(input.file_path);
          if (file) {
            this.emit({ ts, kind: 'file_changed', agentId, ...(taskId ? { taskId } : {}), files: [file] });
          }
        } else if (b.name === 'Bash' && typeof input.command === 'string') {
          category = this.classifyBash(input.command);
          if (category === 'commit') {
            this.emit({ ts, kind: 'commit_created', agentId, ...(taskId ? { taskId } : {}) });
          } else if (category === 'test' || category === 'build') {
            this.emit({
              ts,
              kind: category === 'test' ? 'test_started' : 'build_started',
              agentId,
              ...(taskId ? { taskId } : {}),
            });
          }
        }
        this.emit({
          ts,
          kind: 'tool_called',
          agentId,
          ...(taskId ? { taskId } : {}),
          tool: ident(b.name),
          toolCallId: ident(b.id),
        });
        this.pending.set(b.id, { ts, agentId, ...(taskId ? { taskId } : {}), category });
      }
      return;
    }

    // rec.type === 'user'
    if (blocks.some((b) => b.type === 'tool_result')) {
      for (const b of blocks) {
        if (b.type !== 'tool_result' || typeof b.tool_use_id !== 'string') continue;
        const call = this.pending.get(b.tool_use_id);
        this.pending.delete(b.tool_use_id);
        if (!call) continue;
        const status = b.is_error ? 'failure' : 'success';
        const durationMs = Math.max(0, Date.parse(ts) - Date.parse(call.ts));
        this.emit({
          ts,
          kind: 'tool_finished',
          agentId: call.agentId,
          toolCallId: b.tool_use_id,
          status,
          durationMs,
        });
        if (call.category === 'test' || call.category === 'build') {
          this.emit({
            ts,
            kind: call.category === 'test' ? 'test_finished' : 'build_finished',
            agentId: call.agentId,
            ...(call.taskId ? { taskId: call.taskId } : {}),
            status,
          });
        }
        if (call.category === 'task') {
          this.openTasksById.delete(b.tool_use_id);
          if (this.agentFirst.has(call.agentId)) {
            this.emit({ ts, kind: 'agent_finished', agentId: call.agentId, status });
          }
        }
      }
      return;
    }

    // Real prompt on the main thread opens a task; sidechain prompts are internal noise.
    if (sidechain || rec.isMeta === true) return;
    const text = extractPromptText(rec.message);
    if (text === null || text.trim() === '') return;
    // Slash-command plumbing wrapped by the CLI is session mechanics, not user work.
    const trimmed = text.trim();
    if (trimmed.startsWith('<command-name>') || trimmed.startsWith('<local-command')) {
      this.note('command-message');
      return;
    }
    this.closeOpenMainTask(ts);
    this.taskCounter++;
    const taskId = `t${this.taskCounter}`;
    this.emit({
      ts,
      kind: 'task_started',
      agentId: this.mainAgentId,
      taskId,
      taskTitle: scrub(trimmed, 120),
    });
    this.openMainTask = { id: taskId, errors: 0 };
  }

  /** Ingest raw transcript text line by line; bad lines are warned and dropped. */
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
      if (typeof obj !== 'object' || obj === null) {
        this.droppedCount++;
        this.warn(`line ${i + 1}: skipped non-object record`);
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

  finish(): { events: ForgeEvent[]; warnings: string[]; dropped: number } {
    // Close trailing windows using the latest observed timestamp.
    let lastTs = '';
    for (const e of this.events) if (e.ts > lastTs) lastTs = e.ts;
    this.closeOpenMainTask(lastTs || new Date(0).toISOString());
    for (const agentId of [...this.agentFirst.keys()].sort()) {
      this.emit({ ts: this.agentLast.get(agentId) ?? lastTs, kind: 'agent_finished', agentId });
    }
    if (this.pending.size > 0) {
      this.warnings.push(`${this.pending.size} tool call(s) never received a result`);
    }
    if (this.unsupported.size > 0) {
      const total = [...this.unsupported.values()].reduce((a, b) => a + b, 0);
      this.warnings.push(
        `${total} non-conversation record(s) skipped (${[...this.unsupported.keys()].sort().join(', ')})`,
      );
    }
    this.events.sort((a, b) => a.ts.localeCompare(b.ts) || a.kind.localeCompare(b.kind));
    return { events: this.events, warnings: [...this.warnings], dropped: this.droppedCount };
  }
}

/** Pure converter: transcript JSONL text -> canonical events + warnings. No fs access. */
export function claudeTranscriptToEvents(text: string, opts: { projectPath?: string; mainAgentId?: string } = {}): ParseResult {
  void opts.projectPath;
  const conv = new Converter(opts.mainAgentId);
  conv.ingest(text);
  const { events, warnings, dropped } = conv.finish();
  return { events, warnings, dropped };
}

// ---------------------------------------------------------------------------
// filesystem discovery
// ---------------------------------------------------------------------------

/** Locate the Claude Code projects directory (~/.claude/projects) or null. */
export function findClaudeProjectsDir(): string | null {
  const override = process.env.CLAUDE_PROJECTS_DIR;
  if (override) return fsSync.existsSync(override) ? override : null;
  const dir = path.join(os.homedir(), '.claude', 'projects');
  return fsSync.existsSync(dir) ? dir : null;
}

export interface ClaudeSessionRef {
  sessionId: string;
  filePath: string;
  project?: string;
  mtimeMs: number;
}

/** Munging mirrors Claude Code's project-dir scheme: every non-alphanumeric char -> '-'. */
export function mungeProjectPath(projectPath: string): string {
  return projectPath.replace(/[^A-Za-z0-9]/g, '-');
}

/**
 * Discover session transcripts, newest first. With projectPath set, restricts to
 * the munged directory Claude Code derives from that absolute path.
 */
export async function discoverClaudeSessions(
  opts: { projectsDir?: string; projectPath?: string; limit?: number } = {},
): Promise<ClaudeSessionRef[]> {
  const root = opts.projectsDir ?? findClaudeProjectsDir();
  if (!root) throw new Error('Claude Code projects directory not found (~/.claude/projects)');
  let scoped = root;
  if (opts.projectPath) {
    const munged = mungeProjectPath(path.resolve(opts.projectPath)).toLowerCase();
    const entries = await fsp.readdir(root, { withFileTypes: true });
    const match = entries.find(
      (d) => d.isDirectory() && (d.name.toLowerCase() === munged || d.name.toLowerCase().endsWith(munged)),
    );
    if (!match) return [];
    scoped = path.join(root, match.name);
  }
  const dirents = await fsp.readdir(scoped, { withFileTypes: true });
  const sessions: ClaudeSessionRef[] = [];
  for (const d of dirents) {
    if (!d.isFile() || !d.name.endsWith('.jsonl')) continue;
    const filePath = path.join(scoped, d.name);
    const st = await fsp.stat(filePath);
    sessions.push({
      sessionId: d.name.slice(0, -'.jsonl'.length),
      filePath,
      mtimeMs: st.mtimeMs,
    });
  }
  sessions.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return sessions.slice(0, Math.max(1, opts.limit ?? 20));
}
