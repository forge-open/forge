import type { EventKind, ForgeEvent, ParseResult } from './model.js';
import { EVENT_KINDS } from './model.js';

/**
 * Canonical event I/O helpers: strict-enough validation, lenient parsing.
 * Bad lines are warned about and dropped, never silently ignored and never fatal —
 * an observability tool must not make importing a run fail.
 */

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;

export function isValidIsoTimestamp(ts: unknown): ts is string {
  if (typeof ts !== 'string') return false;
  if (!ISO_RE.test(ts)) {
    // Accept epoch-millis strings/numbers too; normalize later.
    return /^\d{12,19}$/.test(ts) || typeof ts === 'number';
  }
  const t = Date.parse(ts);
  return Number.isFinite(t);
}

/** Normalize accepted timestamp forms to ISO-8601 UTC ("…Z"). Returns null if unparseable. */
export function normalizeTs(ts: unknown): string | null {
  if (typeof ts === 'number' && Number.isFinite(ts)) return new Date(ts).toISOString();
  if (typeof ts !== 'string') return null;
  if (/^\d{12,19}$/.test(ts)) {
    const n = Number(ts);
    // Heuristic: seconds vs millis vs micros vs nanos by digit count.
    const ms =
      ts.length <= 13 ? n : ts.length <= 16 ? Math.floor(n / 1e3) : Math.floor(n / 1e6);
    return new Date(ms).toISOString();
  }
  const t = Date.parse(ts);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function nonEmptyString(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function finiteNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

const SECRET_RE =
  /\b(sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{20,}|gh[spo]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[bap]-[A-Za-z0-9-]{10,}|glpat-[A-Za-z0-9_-]{15,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})\b/g;

function sanitizeText(v: unknown, max = 300): string | undefined {
  if (typeof v !== 'string') return undefined;
  // Defense-in-depth: telemetry must never carry secrets or bulk content.
  const cleaned = v.replace(SECRET_RE, '[REDACTED]');
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, Math.max(0, max - 3)) + '...';
}

/** Identifier-ish fields: bounded so hostile sources cannot smuggle bulk content. */
function boundedString(v: string | undefined, max: number): string | undefined {
  if (v === undefined) return undefined;
  return v.length > max ? v.slice(0, max) : v;
}

/**
 * Validate one parsed JSON object as a ForgeEvent.
 * Unknown kinds are rejected (caller warns); unknown extra fields are dropped.
 * Returns the normalized event or a short reason why it was rejected.
 */
export function coerceEvent(input: unknown): { ok: true; event: ForgeEvent } | { ok: false; reason: string } {
  if (!isRecord(input)) return { ok: false, reason: 'not an object' };
  const ts = normalizeTs(input.ts ?? input.timestamp ?? input.time);
  if (!ts) return { ok: false, reason: 'missing/invalid ts' };
  const kind = input.kind;
  if (typeof kind !== 'string' || !EVENT_KINDS.includes(kind as EventKind)) {
    const shown = typeof kind === 'string' ? kind.slice(0, 40) : JSON.stringify(kind)?.slice(0, 40);
    return { ok: false, reason: `unknown kind ${shown}` };
  }
  const event: ForgeEvent = { ts, kind: kind as EventKind };
  const runId = boundedString(nonEmptyString(input.runId), 200);
  if (runId) event.runId = runId;
  const agentId = boundedString(nonEmptyString(input.agentId), 200);
  if (agentId) event.agentId = agentId;
  const agentName = sanitizeText(input.agentName, 200);
  if (agentName) event.agentName = agentName;
  const parentAgentId = boundedString(nonEmptyString(input.parentAgentId), 200);
  if (parentAgentId) event.parentAgentId = parentAgentId;
  const model = boundedString(nonEmptyString(input.model), 200);
  if (model) event.model = model;
  const taskId = boundedString(nonEmptyString(input.taskId), 200);
  if (taskId) event.taskId = taskId;
  const taskTitle = sanitizeText(input.taskTitle, 120);
  if (taskTitle) event.taskTitle = taskTitle;
  if (input.status === 'success' || input.status === 'failure' || input.status === 'partial') {
    event.status = input.status;
  }
  const tool = boundedString(nonEmptyString(input.tool), 200);
  if (tool) event.tool = tool;
  const toolCallId = boundedString(nonEmptyString(input.toolCallId), 200);
  if (toolCallId) event.toolCallId = toolCallId;
  if (isRecord(input.tokens)) {
    const tokens = {
      input: finiteNumber(input.tokens.input),
      output: finiteNumber(input.tokens.output),
      cacheRead: finiteNumber(input.tokens.cacheRead),
      cacheWrite: finiteNumber(input.tokens.cacheWrite),
    };
    if (Object.values(tokens).some((v) => v !== undefined)) {
      event.tokens = Object.fromEntries(Object.entries(tokens).filter(([, v]) => v !== undefined));
    }
  }
  const costUsd = finiteNumber(input.costUsd);
  if (costUsd !== undefined) event.costUsd = costUsd;
  if (Array.isArray(input.files)) {
    const files = input.files
      .filter((f): f is string => typeof f === 'string' && f.length > 0)
      .map((f) => (f.length > 1024 ? f.slice(0, 1024) : f));
    if (files.length > 0) event.files = [...new Set(files)].slice(0, 100);
  }
  const error = sanitizeText(input.error);
  if (error) event.error = error;
  const durationMs = finiteNumber(input.durationMs);
  if (durationMs !== undefined) event.durationMs = durationMs;
  const note = sanitizeText(input.note);
  if (note) event.note = note;
  return { ok: true, event };
}

/** Parse newline-delimited JSON containing Forge events. Never throws on bad lines. */
const MAX_WARNINGS = 100;

export function parseEventsJsonl(text: string): ParseResult {
  const events: ForgeEvent[] = [];
  const warnings: string[] = [];
  let dropped = 0;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === '') continue;
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      dropped++;
      if (warnings.length < MAX_WARNINGS) warnings.push(`line ${i + 1}: invalid JSON`);
      continue;
    }
    const res = coerceEvent(obj);
    if (res.ok) {
      events.push(res.event);
    } else {
      dropped++;
      if (warnings.length < MAX_WARNINGS) warnings.push(`line ${i + 1}: ${res.reason}`);
    }
  }
  events.sort((a, b) => a.ts.localeCompare(b.ts));
  return { events, warnings, dropped };
}

/** Serialize one event as a JSONL line with stable key order (undefined fields omitted). */
export function serializeEvent(e: ForgeEvent): string {
  const out: Record<string, unknown> = { ts: e.ts, kind: e.kind };
  const keys = [
    'runId', 'agentId', 'agentName', 'parentAgentId', 'model', 'taskId', 'taskTitle',
    'status', 'tool', 'toolCallId', 'tokens', 'costUsd', 'files', 'error', 'durationMs', 'note',
  ] as const;
  for (const k of keys) {
    const v = e[k];
    if (v !== undefined) out[k] = v;
  }
  return JSON.stringify(out);
}
