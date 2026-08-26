import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { serializeEvent } from './events.js';
import type { ForgeEvent, RunMeta } from './model.js';

/**
 * Local-first run storage under `<project>/.forge/runs/<run-id>/`:
 *   meta.json      — RunMeta
 *   events.jsonl   — append-only canonical events
 *   report.md/html — generated artifacts (written by `forge report`)
 * Override the base directory with FORGE_HOME (used by tests).
 */

export function forgeRoot(cwd: string = process.cwd()): string {
  return process.env.FORGE_HOME ? path.resolve(process.env.FORGE_HOME) : path.join(cwd, '.forge');
}

export function runsRoot(cwd: string = process.cwd()): string {
  return path.join(forgeRoot(cwd), 'runs');
}

function newRunId(when = new Date()): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  const stamp =
    `${when.getFullYear()}${pad(when.getMonth() + 1)}${pad(when.getDate())}` +
    `-${pad(when.getHours())}${pad(when.getMinutes())}${pad(when.getSeconds())}`;
  const rand = Math.random().toString(16).slice(2, 6);
  return `${stamp}-${rand}`;
}

export interface CreatedRun {
  meta: RunMeta;
  dir: string;
}

export async function createRun(
  source: string,
  opts: { project?: string; generator?: string; baseDir?: string; createdAt?: Date } = {},
): Promise<CreatedRun> {
  const root = opts.baseDir ?? forgeRoot();
  const runsDir = path.join(root, 'runs');
  await fsp.mkdir(runsDir, { recursive: true });
  const meta: RunMeta = {
    runId: newRunId(opts.createdAt),
    source,
    ...(opts.project ? { project: opts.project } : {}),
    createdAt: (opts.createdAt ?? new Date()).toISOString(),
    ...(opts.generator ? { generator: opts.generator } : {}),
  };
  const dir = path.join(runsDir, meta.runId);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');
  await fsp.writeFile(path.join(dir, 'events.jsonl'), '', 'utf8');
  return { meta, dir };
}

export async function appendEvents(dir: string, events: ForgeEvent[]): Promise<void> {
  if (events.length === 0) return;
  const payload = events.map(serializeEvent).join('\n') + '\n';
  await fsp.appendFile(path.join(dir, 'events.jsonl'), payload, 'utf8');
}

export function runDirFor(runId: string, cwd: string = process.cwd()): string {
  // runId is validated against a strict pattern before hitting the filesystem.
  if (!isValidRunId(runId)) throw new Error(`invalid run id: ${runId}`);
  return path.join(runsRoot(cwd), runId);
}

/**
 * meta.json lives in user-writable project space, so its contents are treated as
 * untrusted: ids must match this pattern, and '.'/'..' style names are rejected.
 */
export function isValidRunId(runId: unknown): runId is string {
  return (
    typeof runId === 'string' &&
    runId.length > 0 &&
    runId.length <= 64 &&
    /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(runId) &&
    !runId.startsWith('.')
  );
}

/** Validate a parsed meta.json against the RunMeta shape; null when nonconforming. */
function coerceRunMeta(raw: unknown): RunMeta | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!isValidRunId(r.runId)) return null;
  if (typeof r.source !== 'string' || r.source.length === 0 || r.source.length > 100) return null;
  if (typeof r.createdAt !== 'string' || Number.isNaN(Date.parse(r.createdAt))) return null;
  const meta: RunMeta = {
    // The DIRECTORY name is authoritative; a lying meta.runId can never widen paths.
    runId: r.runId,
    source: r.source,
    createdAt: new Date(r.createdAt).toISOString(),
  };
  if (typeof r.project === 'string' && r.project.length <= 1024) meta.project = r.project;
  if (typeof r.generator === 'string' && r.generator.length <= 200) meta.generator = r.generator;
  return meta;
}

export async function loadRunMeta(runId: string, cwd?: string): Promise<RunMeta | null> {
  try {
    const raw = await fsp.readFile(path.join(runDirFor(runId, cwd), 'meta.json'), 'utf8');
    const meta = coerceRunMeta(JSON.parse(raw));
    // The directory name is the authoritative run id everywhere Forge speaks
    // about a run; a differing meta.runId is never surfaced.
    return meta ? { ...meta, runId } : null;
  } catch {
    return null;
  }
}

export async function readRunEvents(runId: string, cwd?: string): Promise<{ text: string }> {
  const file = path.join(runDirFor(runId, cwd), 'events.jsonl');
  return { text: await fsp.readFile(file, 'utf8') };
}

export interface RunListing extends RunMeta {
  eventCount: number;
}

export async function listRuns(cwd?: string): Promise<RunListing[]> {
  const runsDir = runsRoot(cwd);
  let entries: string[];
  try {
    entries = await fsp.readdir(runsDir);
  } catch {
    return [];
  }
  const listings: RunListing[] = [];
  for (const id of entries.sort().reverse()) {
    const meta = await loadRunMeta(id, cwd);
    if (!meta) continue;
    let eventCount = 0;
    try {
      const buf = await fsp.readFile(path.join(runsDir, id, 'events.jsonl'), 'utf8');
      eventCount = buf.split('\n').filter((l) => l.trim() !== '').length;
    } catch {
      /* run without events yet */
    }
    listings.push({ ...meta, runId: id, eventCount });
  }
  // Newest first by validated createdAt (sub-second ISO), then by id — never by
  // random id suffixes, which made same-second creation order unstable.
  listings.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.runId.localeCompare(a.runId));
  return listings;
}

/** Resolve a run reference: undefined/"latest" → newest run; otherwise exact id (prefix allowed). */
export async function resolveRunRef(ref?: string, cwd?: string): Promise<RunMeta | null> {
  const all = await listRuns(cwd);
  if (!ref || ref === 'latest') return all[0] ?? null;
  const exact = all.find((r) => r.runId === ref);
  if (exact) return exact;
  const prefixed = all.filter((r) => r.runId.startsWith(ref));
  return prefixed.length === 1 ? prefixed[0] : null;
}

export function ensureForgeDir(cwd: string = process.cwd()): string {
  const root = forgeRoot(cwd);
  fs.mkdirSync(path.join(root, 'runs'), { recursive: true });
  return root;
}
