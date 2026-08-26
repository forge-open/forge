import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  claudeTranscriptToEvents,
  discoverClaudeSessions,
  findClaudeProjectsDir,
  mungeProjectPath,
} from '../src/adapters/claude-code.js';

// Deterministic synthetic Claude Code transcript exercising every mapping rule.
const T = (min: number, sec = 0) => `2026-08-26T10:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.000Z`;

function line(obj: unknown): string {
  return JSON.stringify(obj);
}

const TRANSCRIPT = [
  // noise records the adapter must skip silently (tallied into warnings)
  line({ type: 'file-history-snapshot', messageId: 'm1', snapshot: {} }),
  line({ type: 'system', subtype: 'init', timestamp: T(0, 5) }),
  // t1 opens
  line({
    type: 'user', timestamp: T(0), sessionId: 's1', cwd: 'C:\\proj', version: '1.0',
    message: { role: 'user', content: 'Fix the login bug in the auth module' },
  }),
  line({
    type: 'assistant', timestamp: T(0, 30),
    message: {
      id: 'msg_1', model: 'claude-sonnet-4-5-20250929', role: 'assistant',
      content: [
        { type: 'text', text: 'Looking at the handler.' },
        { type: 'tool_use', id: 'call_1', name: 'Edit', input: { file_path: 'src\\auth\\login.ts' } },
      ],
      usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 5000, cache_creation_input_tokens: 250 },
    },
  }),
  line({
    type: 'user', timestamp: T(1),
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', is_error: false }] },
  }),
  line({
    type: 'assistant', timestamp: T(1, 30),
    message: {
      id: 'msg_2', model: 'claude-sonnet-4-5-20250929', role: 'assistant',
      content: [{ type: 'tool_use', id: 'call_T', name: 'Task', input: { subagent_type: 'Explore', prompt: 'find all callers of verifyLogin' } }],
      usage: { input_tokens: 800, output_tokens: 100 },
    },
  }),
  // sidechain activity -> attributed to subagent:Explore#1
  line({
    type: 'assistant', timestamp: T(2), isSidechain: true,
    message: {
      id: 'msg_s1', model: 'claude-opus-4', role: 'assistant', content: [{ type: 'text', text: 'searching' }],
      usage: { input_tokens: 2000, output_tokens: 400 },
    },
  }),
  line({
    type: 'assistant', timestamp: T(2, 20), isSidechain: true,
    message: { id: 'msg_s2', role: 'assistant', content: [{ type: 'tool_use', id: 'call_g', name: 'Grep', input: { pattern: 'verifyLogin' } }] },
  }),
  line({
    type: 'user', timestamp: T(2, 40), isSidechain: true,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_g', is_error: false }] },
  }),
  // git commit + API error inside t1's window
  line({
    type: 'assistant', timestamp: T(3),
    message: { id: 'msg_3', role: 'assistant', content: [{ type: 'tool_use', id: 'call_b', name: 'Bash', input: { command: 'git commit -m "fix auth"' } }] },
  }),
  line({
    type: 'user', timestamp: T(3, 10),
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_b', is_error: false }] },
  }),
  line({
    type: 'assistant', timestamp: T(3, 30), isApiErrorMessage: true,
    message: { id: 'msg_err', model: 'claude-sonnet-4-5-20250929', role: 'assistant', content: 'API Error 500: overloaded' },
  }),
  line({
    type: 'assistant', timestamp: T(3, 40),
    message: {
      id: 'msg_4', model: 'claude-sonnet-4-5-20250929', role: 'assistant', content: [{ type: 'text', text: 'done' }],
      usage: { input_tokens: 900, output_tokens: 150 },
    },
  }),
  // t2 opens; npm test fails
  line({
    type: 'user', timestamp: T(4),
    message: { role: 'user', content: 'Now write tests for it' },
  }),
  line({
    type: 'assistant', timestamp: T(4, 10),
    message: { id: 'msg_5', role: 'assistant', content: [{ type: 'tool_use', id: 'call_t', name: 'Bash', input: { command: 'npm test' } }] },
  }),
  line({
    type: 'user', timestamp: T(4, 40),
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_t', is_error: true }] },
  }),
  // malformed line must be dropped with a warning, never fatal
  '{oops',
].join('\n');

function byKind(events: ReturnType<typeof claudeTranscriptToEvents>['events'], kind: string) {
  return events.filter((e) => e.kind === kind);
}

test('adapter: maps prompts, tools, tokens, subagents, errors onto canonical events', () => {
  const res = claudeTranscriptToEvents(TRANSCRIPT, { projectPath: 'C:\\proj' });

  assert.equal(res.dropped, 1);
  assert.ok(res.warnings.some((w) => w.includes('invalid JSON')));
  assert.ok(res.warnings.some((w) => w.includes('file-history-snapshot')));

  const kinds = Object.fromEntries(res.events.map((e) => [e.kind, 0]));
  for (const e of res.events) kinds[e.kind]++;
  // hand-counted expectations
  assert.equal(kinds['task_started'], 2);
  assert.equal(kinds['task_finished'], 2);
  assert.equal(kinds['token_usage'], 4); // 3 main + 1 sidechain
  assert.equal(kinds['file_changed'], 1);
  assert.equal(kinds['commit_created'], 1);
  assert.equal(kinds['retry'], 1);
  assert.equal(kinds['test_started'], 1);
  assert.equal(kinds['test_finished'], 1);

  // timestamps strictly sortable ascending
  const sorted = [...res.events].sort((a, b) => a.ts.localeCompare(b.ts));
  assert.deepEqual(res.events, sorted);

  // tasks
  const t1 = res.events.find((e) => e.kind === 'task_started');
  assert.equal(t1?.taskId, 't1');
  assert.equal(t1?.taskTitle, 'Fix the login bug in the auth module');
  const finishes = byKind(res.events, 'task_finished');
  assert.deepEqual(finishes.map((f) => `${f.taskId}:${f.status}`).sort(), ['t1:partial', 't2:success']);

  // swarm tree: subagent linked to main via parentAgentId
  const subStart = byKind(res.events, 'agent_started').find((e) => e.agentId === 'subagent:Explore#1');
  assert.ok(subStart, 'subagent started');
  assert.equal(subStart.parentAgentId, 'claude-main');

  // token attribution per agent
  let mainTokens = 0;
  let subTokens = 0;
  for (const e of byKind(res.events, 'token_usage')) {
    if (e.agentId === 'claude-main') {
      mainTokens += (e.tokens?.input ?? 0) + (e.tokens?.output ?? 0) + (e.tokens?.cacheRead ?? 0) + (e.tokens?.cacheWrite ?? 0);
      assert.equal(e.taskId, e.ts < T(4) ? 't1' : 't2');
    } else {
      subTokens += (e.tokens?.input ?? 0) + (e.tokens?.output ?? 0);
      assert.equal(e.agentId, 'subagent:Explore#1');
      assert.equal(e.taskId, undefined);
    }
  }
  assert.equal(mainTokens, 2700 + 450 + 5000 + 250);
  assert.equal(subTokens, 2400);

  // files normalized to forward slashes
  const fc = byKind(res.events, 'file_changed')[0];
  assert.deepEqual(fc.files, ['src/auth/login.ts']);
  assert.equal(fc.taskId, 't1');

  // engineering signals present as events
  assert.equal(byKind(res.events, 'test_finished')[0]?.status, 'failure');

  // privacy: raw commands and subagent prompt text never leak into events
  const blob = JSON.stringify(res.events);
  assert.ok(!blob.includes('git commit'));
  assert.ok(!blob.includes('npm test'));
  assert.ok(!blob.includes('find all callers'));
});

test('adapter: empty and whitespace inputs produce zero events without throwing', () => {
  for (const input of ['', '\n\n   \n']) {
    const res = claudeTranscriptToEvents(input);
    assert.equal(res.events.length, 0);
    assert.equal(res.dropped, 0);
  }
});

test('adapter: unpaired tool calls are warned about', () => {
  const transcript = [
    line({ type: 'user', timestamp: T(0), message: { role: 'user', content: 'do it' } }),
    line({
      type: 'assistant', timestamp: T(0, 10),
      message: { id: 'm', role: 'assistant', content: [{ type: 'tool_use', id: 'x1', name: 'Read', input: {} }] },
    }),
  ].join('\n');
  const res = claudeTranscriptToEvents(transcript);
  assert.ok(res.warnings.some((w) => w.includes('never received a result')));
});

test('discovery: munges paths like Claude Code and finds sessions in a temp projects dir', async () => {
  assert.equal(mungeProjectPath('C:\\Users\\Dhu\\Documents\\Forge'), 'C--Users-Dhu-Documents-Forge');
  assert.equal(mungeProjectPath('/home/u/proj'), '-home-u-proj');

  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-claude-test-'));
  try {
    const projDir = path.join(tmp, 'C--Users-Dhu-Documents-Forge');
    await fsp.mkdir(projDir);
    const p1 = path.join(projDir, 'aaa.jsonl');
    await fsp.writeFile(p1, '');
    await fsp.writeFile(path.join(projDir, 'bbb.jsonl'), '');
    // backdate aaa so bbb is newest
    await fsp.utimes(p1, new Date(1000000), new Date(1000000));

    const sessions = await discoverClaudeSessions({ projectsDir: tmp, projectPath: 'C:\\Users\\Dhu\\Documents\\Forge' });
    assert.equal(sessions.length, 2);
    assert.equal(sessions[0].sessionId, 'bbb'); // newest first
    assert.ok(sessions.every((s) => s.filePath.startsWith(projDir)));

    // unrelated project path matches nothing
    const none = await discoverClaudeSessions({ projectsDir: tmp, projectPath: '/somewhere/else' });
    assert.equal(none.length, 0);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test('findClaudeProjectsDir honors CLAUDE_PROJECTS_DIR override', () => {
  const prev = process.env.CLAUDE_PROJECTS_DIR;
  process.env.CLAUDE_PROJECTS_DIR = path.join(os.tmpdir());
  try {
    assert.equal(findClaudeProjectsDir(), path.join(os.tmpdir()));
    process.env.CLAUDE_PROJECTS_DIR = path.join(os.tmpdir(), 'definitely-missing-dir-xyz');
    assert.equal(findClaudeProjectsDir(), null);
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_PROJECTS_DIR;
    else process.env.CLAUDE_PROJECTS_DIR = prev;
  }
});
