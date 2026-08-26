import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { detectAgents } from '../src/core/detect.js';
import { makeStyle, termCaps } from '../src/term.js';

test('detect: claude-code and codex are supported; gemini/opencode stay presence-only', async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-detect-'));
  try {
    const claudeDir = path.join(tmp, 'claude-projects');
    const projDir = path.join(claudeDir, 'C--Users-Dhu-Documents-Forge');
    await fsp.mkdir(projDir, { recursive: true });
    await fsp.writeFile(path.join(projDir, 'session-a.jsonl'), '');
    await fsp.writeFile(path.join(projDir, 'session-b.jsonl'), '');

    const codexDir = path.join(tmp, 'codex-sessions', '2026', '08', '24');
    await fsp.mkdir(codexDir, { recursive: true });
    const meta = JSON.stringify({
      timestamp: '2026-08-24T18:00:00.000Z',
      type: 'session_meta',
      payload: { session_id: 's1', cwd: 'C:\\Users\\Dhu\\Documents\\Forge' },
    });
    await fsp.writeFile(path.join(codexDir, 'rollout-2026-08-24T18-00-00-s1.jsonl'), meta + '\n');

    const home = tmp;
    await fsp.mkdir(path.join(home, '.gemini'), { recursive: true });

    const detections = await detectAgents({
      home,
      projectPath: 'C:\\Users\\Dhu\\Documents\\Forge',
      claudeProjectsDir: claudeDir,
      codexSessionsDir: path.join(tmp, 'codex-sessions'),
    });

    const byId = new Map(detections.map((d) => [d.id, d]));
    const claude = byId.get('claude-code');
    assert.ok(claude?.supported);
    assert.equal(claude.sessions, 2);

    const codex = byId.get('codex');
    assert.ok(codex?.supported, 'codex has a working import adapter');
    assert.equal(codex.sessions, 1);

    assert.equal(byId.get('gemini')?.supported, false);
    assert.equal(byId.has('opencode'), false, 'opencode dir was not created');
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test('detect: empty environment reports nothing (never throws)', async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'forge-detect-empty-'));
  try {
    const detections = await detectAgents({
      home: tmp,
      claudeProjectsDir: null,
      codexSessionsDir: null,
    });
    assert.deepEqual(detections, []);
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true });
  }
});

test('termCaps: explicit overrides win; CI defaults to plain ASCII', () => {
  const tc = (env: Record<string, string | undefined>, isTTY: boolean, platform = 'linux') =>
    termCaps({ isTTY }, env, platform);

  assert.deepEqual(tc({ CI: '1' }, true), { unicode: false, color: false });
  assert.deepEqual(tc({ FORCE_ASCII: '1' }, true), { unicode: false, color: false });
  const forced = tc({ FORCE_UNICODE: '1' }, false);
  assert.equal(forced.unicode, true, 'FORCE_UNICODE works even without a TTY');
  assert.equal(forced.color, false, 'color still requires a TTY');
  // A TTY with xterm TERM gets unicode on win32; bare conhost does not.
  assert.equal(tc({ TERM: 'xterm-256color' }, true, 'win32').unicode, true);
  assert.equal(tc({}, true, 'win32').unicode, false);
  assert.equal(tc({}, true, 'linux').unicode, true);
  // piped/CI output never gets unicode, even when TERM suggests a capable terminal
  assert.equal(tc({ TERM: 'xterm-256color' }, false, 'win32').unicode, false);
});

test('makeStyle: color off returns identity, color on wraps in ANSI', () => {
  const off = makeStyle(false);
  assert.equal(off.dim('x'), 'x');
  assert.equal(off.ok('y'), 'y');
  const on = makeStyle(true);
  assert.equal(on.ok('y'), '\x1b[32my\x1b[0m');
  assert.equal(on.dim('z'), '\x1b[2mz\x1b[0m');
});
