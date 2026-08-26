import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { coerceEvent, isValidIsoTimestamp, parseEventsJsonl, serializeEvent } from '../src/core/events.js';
import { DEFAULT_PRICES, estimateCost, priceFor, sanitizePriceTable } from '../src/core/cost.js';

test('events: coercion validates, normalizes and minimizes', () => {
  const ok = coerceEvent({
    ts: '2026-08-26T09:00:00Z',
    kind: 'task_started',
    taskId: 't1',
    taskTitle: 'x'.repeat(500),
    bogusField: 'dropped',
    status: 'not-a-status',
  });
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.event.kind, 'task_started');
    assert.equal(ok.event.taskId, 't1');
    assert.ok(ok.event.taskTitle!.length <= 120);
    assert.equal((ok.event as Record<string, unknown>).bogusField, undefined);
    assert.equal(ok.event.status, undefined);
  }

  assert.equal(coerceEvent({ kind: 'note' }).ok, false); // missing ts
  assert.equal(coerceEvent({ ts: 'nope', kind: 'note' }).ok, false);
  assert.equal(coerceEvent({ ts: '2026-08-26T09:00:00Z', kind: 'alien_kind' }).ok, false);
  assert.equal(coerceEvent(null).ok, false);

  const epoch = coerceEvent({ ts: 1789000000000, kind: 'note', note: 'hello' });
  assert.ok(epoch.ok && isValidIsoTimestamp(epoch.ok ? epoch.event.ts : ''));
});

test('events: jsonl parsing is lenient and sorts deterministically', () => {
  const text = [
    JSON.stringify({ ts: '2026-08-26T09:00:02Z', kind: 'run_finished' }),
    'not json at all',
    JSON.stringify({ ts: '2026-08-26T09:00:01Z', kind: 'run_started' }),
  ].join('\n');
  const res = parseEventsJsonl(text);
  assert.equal(res.events.length, 2);
  assert.equal(res.dropped, 1);
  assert.deepEqual(res.events.map((e) => e.kind), ['run_started', 'run_finished']);
});

test('events: serialization is stable and round-trips through the parser', () => {
  const e = {
    ts: '2026-08-26T09:00:00.000Z',
    kind: 'token_usage' as const,
    agentId: 'a1',
    tokens: { input: 10, output: 5 },
  };
  const line1 = serializeEvent(e);
  const line2 = serializeEvent({ ...e });
  assert.equal(line1, line2);
  const back = parseEventsJsonl(line1);
  assert.equal(back.events.length, 1);
  assert.deepEqual(back.events[0].tokens, { input: 10, output: 5 });
});

test('cost: longest-prefix model matching and estimates', () => {
  assert.ok(priceFor('gpt-5-mini-2026-01') === DEFAULT_PRICES['gpt-5-mini']);
  assert.ok(priceFor('GPT-5', DEFAULT_PRICES) !== null, 'case-insensitive');
  assert.equal(priceFor('unknown-model-xyz'), null);
  assert.equal(priceFor(undefined), null);

  const c = estimateCost('claude-sonnet-4-5-20250929', { input: 1_000_000, output: 1_000_000 });
  assert.ok(Math.abs((c ?? 0) - 18) < 1e-9); // $3 + $15
  assert.equal(estimateCost('mystery', { input: 100 }), null);
  assert.equal(estimateCost('claude-opus-4', {}), 0); // priced model, no tokens
});

test('cost: override tables are validated and merged by prefix', () => {
  const [clean, problems] = sanitizePriceTable({
    'my-model': { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
    bad: { input: 'lots' },
  });
  assert.deepEqual(problems.map((p) => p.slice(0, 3)), ['bad']);
  const table = { ...DEFAULT_PRICES, ...clean };
  assert.ok(Math.abs((estimateCost('my-model-v2', { input: 500_000 }, table) ?? -1) - 0.5) < 1e-9);
});

test('store: run lifecycle under an isolated FORGE_HOME', async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-store-test-'));
  const prevHome = process.env.FORGE_HOME;
  process.env.FORGE_HOME = tmp;
  try {
    const { createRun, appendEvents, listRuns, resolveRunRef, readRunEvents } = await import('../src/core/store.js');
    const r1 = await createRun('demo', { project: '/w/a' });
    await appendEvents(r1.dir, [
      { ts: '2026-08-26T09:00:01.000Z', kind: 'run_started', agentId: 'x' },
      { ts: '2026-08-26T09:00:02.000Z', kind: 'run_finished', agentId: 'x' },
    ]);
    const r2 = await createRun('jsonl', { project: '/w/b' });

    const listings = await listRuns();
    assert.equal(listings.length, 2);
    assert.equal(listings[0].runId, r2.meta.runId); // newest first
    assert.equal(listings.find((l) => l.runId === r1.meta.runId)?.eventCount, 2);

    const latest = await resolveRunRef();
    assert.equal(latest?.runId, r2.meta.runId);
    // short prefixes shared by several runs are ambiguous -> null, not a guess
    const ambiguous = await resolveRunRef('2026');
    assert.equal(ambiguous, null);
    const exact = await resolveRunRef(r1.meta.runId);
    assert.equal(exact?.runId, r1.meta.runId);
    assert.equal(await resolveRunRef('no-such-run'), null);

    const { text } = await readRunEvents(r1.meta.runId);
    assert.equal(text.trim().split('\n').length, 2);
  } finally {
    if (prevHome === undefined) delete process.env.FORGE_HOME;
    else process.env.FORGE_HOME = prevHome;
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// security behavior (defense-in-depth contracts)
// ---------------------------------------------------------------------------

test('events: free-text fields are secret-scrubbed and identifier fields bounded', () => {
  const res = coerceEvent({
    ts: '2026-08-26T09:00:00Z',
    kind: 'task_started',
    taskId: 't1',
    taskTitle: 'deploy key=sk-live-abcdef123456 to prod',
    agentName: 'x'.repeat(500),
    agentId: 'y'.repeat(500),
  });
  assert.ok(res.ok);
  if (res.ok) {
    assert.ok(!res.event.taskTitle!.includes('sk-live'), 'secret must be redacted');
    assert.ok(res.event.taskTitle!.includes('[REDACTED]'));
    assert.ok(res.event.taskTitle!.length <= 120);
    assert.ok(res.event.agentName!.length <= 200);
    assert.ok(res.event.agentId!.length <= 200);
  }

  // hostile files entries are capped per entry and in count
  const files = coerceEvent({
    ts: '2026-08-26T09:00:00Z',
    kind: 'file_changed',
    files: ['z'.repeat(5000), ...Array.from({ length: 150 }, (_, i) => `f${i}.ts`)],
  });
  assert.ok(files.ok);
  if (files.ok) {
    assert.ok(files.event.files![0].length <= 1024);
    assert.equal(files.event.files!.length, 100);
  }
});

test('events: warning collection is capped on hostile inputs', () => {
  const bad = Array.from({ length: 200 }, (_, i) => `{"kind":"alien-${i}"}`).join('\n');
  const res = parseEventsJsonl(bad);
  assert.equal(res.dropped, 200);
  assert.ok(res.warnings.length <= 100, `warnings ${res.warnings.length}`);
});

test('store: lying or malformed meta.json cannot widen paths or crash listings', async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-meta-test-'));
  const prevHome = process.env.FORGE_HOME;
  process.env.FORGE_HOME = tmp;
  try {
    const evilDir = path.join(tmp, 'runs', '20260101-000000-evil');
    await fsp.mkdir(evilDir, { recursive: true });
    await fsp.writeFile(
      path.join(evilDir, 'meta.json'),
      JSON.stringify({ runId: '..\..\elsewhere', source: 'x'.repeat(5000), createdAt: 123 }),
    );
    const { loadRunMeta, listRuns } = await import('../src/core/store.js');
    assert.equal(await loadRunMeta('20260101-000000-evil'), null, 'nonconforming meta rejected');
    assert.deepEqual(await listRuns(), [], 'nonconforming runs are not listed');

    // valid meta with a lying runId: directory name wins
    const goodDir = path.join(tmp, 'runs', '20260101-000001-ok');
    await fsp.mkdir(goodDir, { recursive: true });
    await fsp.writeFile(
      path.join(goodDir, 'meta.json'),
      JSON.stringify({ runId: 'totally-different', source: 'jsonl', createdAt: '2026-01-01T00:00:01Z' }),
    );
    const runs = await listRuns();
    assert.equal(runs.length, 1);
    assert.equal(runs[0].runId, '20260101-000001-ok');
    assert.equal((await loadRunMeta('20260101-000001-ok'))?.runId, '20260101-000001-ok');
  } finally {
    if (prevHome === undefined) delete process.env.FORGE_HOME;
    else process.env.FORGE_HOME = prevHome;
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});
