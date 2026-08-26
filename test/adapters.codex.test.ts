import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  codexSessionToEvents,
  discoverCodexSessions,
  findCodexSessionsDir,
} from '../src/adapters/codex.js';

// Deterministic synthetic Codex rollout mirroring the field names verified in
// real ~/.codex/sessions files (cli_version 0.112 -> 0.149 shape variants).
const T = (min: number, sec = 0) => `2026-08-26T10:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.000Z`;

function line(obj: unknown): string {
  return JSON.stringify(obj);
}

// Raw apply_patch input exactly as stored in older rollouts (real newlines).
const PATCH_INPUT = [
  '*** Begin Patch',
  '*** Update File: src/auth/login.ts',
  '+ PATCH BODY LINE MUST-NOT-LEAK',
  '*** Add File: src/auth/new.ts',
  '+ export const x = 1',
].join('\n');

// Newest builds route patches through the `exec` tool as sandboxed JS where
// newlines are "\n" escape sequences inside a JS string literal.
const EXEC_JS_PATCH_INPUT =
  'const patch = "*** Begin Patch\\n*** Delete File: src/auth/old.ts\\n"; text(await tools.apply_patch(patch));';

const ROLLOUT = [
  // session metadata + per-turn model context
  line({
    timestamp: T(0),
    type: 'session_meta',
    payload: {
      session_id: '01a033d3-7408-7663-ab19-a934f6c29ccc',
      cwd: 'C:\\proj\\alpha',
      cli_version: '0.149.1',
      originator: 'codex-tui',
      source: 'cli',
      model_provider: 'openai',
    },
  }),
  line({
    timestamp: T(0, 1),
    type: 'turn_context',
    payload: { turn_id: 'turn_1', cwd: 'C:\\proj\\alpha', model: 'gpt-5.6-luna', effort: 'medium' },
  }),
  line({ timestamp: T(0, 2), type: 'world_state', payload: { full: true, state: {} } }),
  // injected user-role blocks must never open tasks or carry titles
  line({
    timestamp: T(0, 3),
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: '<environment_context> sandbox workspace-write' }],
    },
  }),
  // the real prompt (title source)
  line({
    timestamp: T(0, 4),
    type: 'response_item',
    payload: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text: 'Fix the login bug in the auth module' }],
    },
  }),
  // turn boundary events are the authoritative task window
  line({
    timestamp: T(0, 5),
    type: 'event_msg',
    payload: { type: 'task_started', turn_id: 'turn_1', model_context_window: 272000 },
  }),
  line({
    timestamp: T(0, 10),
    type: 'response_item',
    payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'On it.' }] },
  }),
  line({
    timestamp: T(0, 20),
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        last_token_usage: { input_tokens: 1200, output_tokens: 300, cached_input_tokens: 8000, reasoning_output_tokens: 150, total_tokens: 9500 },
        total_token_usage: { input_tokens: 1200, output_tokens: 300, cached_input_tokens: 8000, reasoning_output_tokens: 150, total_tokens: 9500 },
        model_context_window: 272000,
      },
    },
  }),
  // apply_patch custom tool call + matching output
  line({
    timestamp: T(1),
    type: 'response_item',
    payload: { type: 'custom_tool_call', call_id: 'call_p1', name: 'apply_patch', status: 'completed', input: PATCH_INPUT },
  }),
  line({
    timestamp: T(1, 30),
    type: 'response_item',
    payload: { type: 'custom_tool_call_output', call_id: 'call_p1', output: 'patch applied' },
  }),
  // shell_command function call classified as a commit (command never stored)
  line({
    timestamp: T(2),
    type: 'response_item',
    payload: { type: 'function_call', call_id: 'call_s1', name: 'shell_command', arguments: JSON.stringify({ command: 'git commit -m "fix auth"', workdir: null }) },
  }),
  line({
    timestamp: T(2, 30),
    type: 'response_item',
    payload: { type: 'function_call_output', call_id: 'call_s1', output: '"ok"' },
  }),
  // newest-style exec tool embedding a patch in JS source
  line({
    timestamp: T(2, 40),
    type: 'response_item',
    payload: { type: 'custom_tool_call', call_id: 'call_e1', name: 'exec', status: 'completed', input: EXEC_JS_PATCH_INPUT },
  }),
  line({
    timestamp: T(2, 50),
    type: 'response_item',
    payload: { type: 'custom_tool_call_output', call_id: 'call_e1', output: '[{"type":"output_text","text":"done"}]' },
  }),
  // failing test run: exec_command_end correlates failure by call_id
  line({
    timestamp: T(3),
    type: 'response_item',
    payload: { type: 'function_call', call_id: 'call_t1', name: 'shell_command', arguments: JSON.stringify({ command: 'npm test', workdir: null }) },
  }),
  line({
    timestamp: T(3, 20),
    type: 'event_msg',
    payload: { type: 'exec_command_end', call_id: 'call_t1', command: ['npm', 'test'], exit_code: 1, status: 'failed', duration: { secs: 2, nanos: 0 } },
  }),
  line({
    timestamp: T(3, 30),
    type: 'response_item',
    payload: { type: 'function_call_output', call_id: 'call_t1', output: 'tests failed' },
  }),
  // user interrupts the turn -> retry + partial task
  line({
    timestamp: T(4),
    type: 'event_msg',
    payload: { type: 'turn_aborted', turn_id: 'turn_1', reason: 'interrupted' },
  }),
  line({
    timestamp: T(4, 10),
    type: 'turn_context',
    payload: { turn_id: 'turn_1b', cwd: 'C:\\proj\\alpha', model: 'gpt-5.7-mini' },
  }),
  line({
    timestamp: T(4, 20),
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        last_token_usage: { input_tokens: 500, output_tokens: 200, cached_input_tokens: 1000, cache_write_input_tokens: 50, reasoning_output_tokens: 40, total_tokens: 1750 },
        total_token_usage: { input_tokens: 1700, output_tokens: 500, cached_input_tokens: 9000, cache_write_input_tokens: 50, reasoning_output_tokens: 190, total_tokens: 11250 },
        model_context_window: 400000,
      },
    },
  }),
  line({
    timestamp: T(5),
    type: 'event_msg',
    payload: { type: 'task_complete', turn_id: 'turn_1', duration_ms: 42000, last_agent_message: 'fixed' },
  }),
  // noise the adapter must tally, and one malformed line it must drop
  line({ timestamp: T(5, 1), type: 'compacted', payload: { message: 'context compacted', window_number: 1 } }),
  '{oops',
].join('\n');

function byKind(events: ReturnType<typeof codexSessionToEvents>['events'], kind: string) {
  return events.filter((e) => e.kind === kind);
}

test('adapter: maps turns, tokens, tools, patches, aborts onto canonical events', () => {
  const res = codexSessionToEvents(ROLLOUT, { projectPath: 'C:\\proj\\alpha' });

  assert.equal(res.dropped, 1);
  assert.ok(res.warnings.some((w) => w.includes('invalid JSON')));
  assert.ok(res.warnings.some((w) => w.includes('non-conversation record(s) skipped')));

  const kinds: Record<string, number> = {};
  for (const e of res.events) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
  // hand-counted expectations for the fixture above
  assert.equal(kinds['agent_started'], 1);
  assert.equal(kinds['agent_finished'], 1);
  assert.equal(kinds['task_started'], 1);
  assert.equal(kinds['task_finished'], 1);
  assert.equal(kinds['token_usage'], 2);
  assert.equal(kinds['tool_called'], 4);
  assert.equal(kinds['tool_finished'], 4);
  assert.equal(kinds['file_changed'], 2);
  assert.equal(kinds['commit_created'], 1);
  assert.equal(kinds['test_started'], 1);
  assert.equal(kinds['test_finished'], 1);
  assert.equal(kinds['retry'], 1);

  // timestamps strictly sortable ascending
  const sorted = [...res.events].sort((a, b) => a.ts.localeCompare(b.ts));
  assert.deepEqual(res.events, sorted);

  // agent identity + lifecycle at the edges of mapped activity
  const started = byKind(res.events, 'agent_started')[0];
  const finished = byKind(res.events, 'agent_finished')[0];
  assert.equal(started?.agentId, 'codex');
  assert.equal(started?.agentName, 'Codex CLI');
  assert.ok(started.ts <= (res.events.find((e) => e.kind === 'task_started')?.ts ?? ''));
  assert.equal(finished?.ts, res.events[res.events.length - 1].ts);

  // task window from event_msg boundaries; aborted mid-turn -> partial
  const tStart = byKind(res.events, 'task_started')[0];
  const tFinish = byKind(res.events, 'task_finished')[0];
  assert.equal(tStart.taskId, 't1');
  assert.equal(tStart.taskTitle, 'Fix the login bug in the auth module');
  assert.equal(tFinish.taskId, 't1');
  assert.equal(tFinish.status, 'partial');
  assert.equal(tFinish.durationMs, 42000);

  // token attribution follows turn_context.model and the open task
  const tok = byKind(res.events, 'token_usage');
  const first = tok.find((e) => e.model === 'gpt-5.6-luna');
  const second = tok.find((e) => e.model === 'gpt-5.7-mini');
  assert.ok(first && second);
  assert.deepEqual(first.tokens, { input: 1200, output: 300, cacheRead: 8000 });
  assert.deepEqual(second.tokens, { input: 500, output: 200, cacheRead: 1000, cacheWrite: 50 });
  assert.equal(first.taskId, 't1');
  assert.equal(second.taskId, 't1');

  // tool pairing, statuses, durations (30s deltas), classification side-events
  const finishes = byKind(res.events, 'tool_finished');
  assert.deepEqual(
    finishes.map((f) => `${f.toolCallId}:${f.status}:${f.durationMs}`).sort(),
    ['call_e1:success:10000', 'call_p1:success:30000', 'call_s1:success:30000', 'call_t1:failure:30000'].sort(),
  );
  const calledTools = byKind(res.events, 'tool_called').map((c) => c.tool).sort();
  assert.deepEqual(calledTools, ['apply_patch', 'exec', 'shell_command', 'shell_command']);
  assert.ok(byKind(res.events, 'commit_created').length === 1);
  assert.equal(byKind(res.events, 'test_started').length, 1);
  assert.equal(byKind(res.events, 'test_finished')[0]?.status, 'failure');
  assert.equal(byKind(res.events, 'test_finished')[0]?.taskId, 't1');

  // file paths extracted from raw patch headers AND from JS-embedded patches,
  // normalized to forward slashes
  const files = byKind(res.events, 'file_changed').flatMap((e) => e.files);
  assert.deepEqual(files.sort(), ['src/auth/login.ts', 'src/auth/new.ts', 'src/auth/old.ts']);

  // interruption mapped to retry with sanitized reason text
  const retry = byKind(res.events, 'retry')[0];
  assert.equal(retry.error, 'interrupted');

  // privacy: raw commands, patch bodies, and prompts (beyond the scrubbed
  // taskTitle) never leak into the event stream
  const blob = JSON.stringify(res.events);
  assert.ok(!blob.includes('git commit'));
  assert.ok(!blob.includes('npm test'));
  assert.ok(!blob.includes('PATCH BODY LINE MUST-NOT-LEAK'));
  assert.ok(!blob.includes('export const x = 1'));
});

test('adapter: empty and whitespace inputs produce zero events without throwing', () => {
  for (const input of ['', '\n\n   \n']) {
    const res = codexSessionToEvents(input);
    assert.equal(res.events.length, 0);
    assert.equal(res.dropped, 0);
  }
});

test('adapter: unpaired tool calls are warned about', () => {
  const transcript = [
    line({ timestamp: T(0), type: 'session_meta', payload: { cwd: 'C:\\x', cli_version: '0.149.1' } }),
    line({
      timestamp: T(0, 1),
      type: 'response_item',
      payload: { type: 'custom_tool_call', call_id: 'lonely', name: 'apply_patch', input: '*** Update File: a.txt' },
    }),
  ].join('\n');
  const res = codexSessionToEvents(transcript);
  assert.ok(res.warnings.some((w) => w.includes('never received a result')));
  assert.equal(byKind(res.events, 'tool_finished').length, 0);
});

test('adapter: two clean turns produce two successful tasks with per-model token sums', () => {
  const transcript = [
    line({ timestamp: T(0), type: 'session_meta', payload: { cwd: 'C:\\x', cli_version: '0.133.0' } }),
    line({ timestamp: T(0, 1), type: 'turn_context', payload: { turn_id: 'a', model: 'm-1' } }),
    line({ timestamp: T(0, 2), type: 'event_msg', payload: { type: 'task_started', turn_id: 'a' } }),
    line({
      timestamp: T(0, 3), type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'first thing' }] },
    }),
    line({
      timestamp: T(1), type: 'event_msg',
      payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 10, output_tokens: 5, cached_input_tokens: 0 }, total_token_usage: {} } },
    }),
    line({ timestamp: T(1, 1), type: 'event_msg', payload: { type: 'task_complete', turn_id: 'a', duration_ms: 1000 } }),
    line({ timestamp: T(1, 2), type: 'turn_context', payload: { turn_id: 'b', model: 'm-2' } }),
    line({ timestamp: T(1, 3), type: 'event_msg', payload: { type: 'task_started', turn_id: 'b' } }),
    line({
      timestamp: T(1, 4), type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<user_instructions>AGENTS.md content' }] },
    }),
    line({
      timestamp: T(2), type: 'event_msg',
      payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 20, output_tokens: 7, cached_input_tokens: 3 }, total_token_usage: {} } },
    }),
    line({ timestamp: T(2, 1), type: 'event_msg', payload: { type: 'task_complete', turn_id: 'b' } }),
  ].join('\n');
  const res = codexSessionToEvents(transcript);

  const starts = byKind(res.events, 'task_started');
  const finishes = byKind(res.events, 'task_finished');
  assert.equal(starts.length, 2);
  assert.equal(finishes.length, 2);
  assert.equal(starts[0].taskId, 't1');
  // the prompt arrived just after task_started and was backfilled onto t1
  assert.equal(starts[0].taskTitle, 'first thing');
  // turn b only received an injected instructions block -> never retitled,
  // and the earlier prompt cannot resurface as a stale title
  assert.equal(starts[1].taskTitle, 'untitled turn');
  assert.ok(finishes.every((f) => f.status === 'success'));
  assert.equal(finishes[0].durationMs, 1000);
  assert.equal(finishes[1].durationMs, undefined); // older builds lack duration_ms

  const sumsByModel: Record<string, { in: number; out: number; cache: number }> = {};
  for (const e of byKind(res.events, 'token_usage')) {
    const m = e.model ?? '?';
    sumsByModel[m] ??= { in: 0, out: 0, cache: 0 };
    sumsByModel[m].in += e.tokens?.input ?? 0;
    sumsByModel[m].out += e.tokens?.output ?? 0;
    sumsByModel[m].cache += e.tokens?.cacheRead ?? 0;
  }
  assert.deepEqual(sumsByModel, {
    'm-1': { in: 10, out: 5, cache: 0 },
    'm-2': { in: 20, out: 7, cache: 3 },
  });
});

test('discovery: finds rollout files newest-first in YYYY/MM/DD tree and filters by projectPath', async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-codex-test-'));
  try {
    const mk = async (rel: string, cwd: string) => {
      const p = path.join(tmp, rel);
      await fsp.mkdir(path.dirname(p), { recursive: true });
      await fsp.writeFile(
        p,
        line({ timestamp: '2026-08-26T00:00:00.000Z', type: 'session_meta', payload: { session_id: 's', cwd } }) + '\n',
        'utf8',
      );
      return p;
    };
    const oldFile = await mk(path.join('2026', '07', '09', 'rollout-2026-07-09T10-00-00-0000-aaaa.jsonl'), 'D:\\oldproj');
    const midFile = await mk(path.join('2026', '08', '24', 'rollout-2026-08-24T10-00-00-0000-bbbb.jsonl'), 'C:\\proj\\alpha');
    const newFile = await mk(path.join('2026', '08', '25', 'rollout-2026-08-25T10-00-00-0000-cccc.jsonl'), 'C:\\proj\\alpha');
    // decoys: wrong extension/prefix must be ignored
    await fsp.writeFile(path.join(tmp, '2026', '08', '25', 'not-a-rollout.jsonl'), '', 'utf8');
    await fsp.writeFile(path.join(tmp, '2026', '08', '25', 'rollout-skipme.txt'), '', 'utf8');

    await fsp.utimes(oldFile, new Date(1000000), new Date(1000000));
    await fsp.utimes(midFile, new Date(2000000), new Date(2000000));
    await fsp.utimes(newFile, new Date(3000000), new Date(3000000));

    const all = await discoverCodexSessions({ sessionsDir: tmp });
    assert.deepEqual(all.map((s) => s.sessionId), [
      'rollout-2026-08-25T10-00-00-0000-cccc',
      'rollout-2026-08-24T10-00-00-0000-bbbb',
      'rollout-2026-07-09T10-00-00-0000-aaaa',
    ]);
    assert.ok(all[0].mtimeMs >= all[all.length - 1].mtimeMs);
    assert.ok(all.every((s) => typeof s.project === 'string'));

    // projectPath filter matches normalized cwd and reports it as project
    const scoped = await discoverCodexSessions({ sessionsDir: tmp, projectPath: 'C:\\proj\\alpha' });
    assert.deepEqual(scoped.map((s) => s.sessionId.slice(-4)), ['cccc', 'bbbb']);
    assert.equal(scoped[0].project, 'C:\\proj\\alpha');

    const limited = await discoverCodexSessions({ sessionsDir: tmp, projectPath: 'C:\\proj\\alpha', limit: 1 });
    assert.equal(limited.length, 1);
    assert.equal(limited[0].sessionId.endsWith('cccc'), true);

    const none = await discoverCodexSessions({ sessionsDir: tmp, projectPath: '/somewhere/else' });
    assert.equal(none.length, 0);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test('findCodexSessionsDir honors CODEX_SESSIONS_DIR override', () => {
  const prev = process.env.CODEX_SESSIONS_DIR;
  process.env.CODEX_SESSIONS_DIR = path.join(os.tmpdir());
  try {
    assert.equal(findCodexSessionsDir(), path.join(os.tmpdir()));
    process.env.CODEX_SESSIONS_DIR = path.join(os.tmpdir(), 'definitely-missing-dir-xyz');
    assert.equal(findCodexSessionsDir(), null);
  } finally {
    if (prev === undefined) delete process.env.CODEX_SESSIONS_DIR;
    else process.env.CODEX_SESSIONS_DIR = prev;
  }
});
