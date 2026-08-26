import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverClaudeSessions, findClaudeProjectsDir } from '../adapters/claude-code.js';

/**
 * Agent detection registry.
 *
 * Forge only ever REPORTS what it can actually do: an entry with
 * `supported: true` has a working import adapter today. Presence-only
 * detections (Codex, Gemini, OpenCode) are surfaced honestly so the CLI can
 * say "detected, but native import is not available yet" instead of pretending.
 * Adding a future agent = one more block here + an adapter.
 */

export type AgentId = 'claude-code' | 'codex' | 'gemini' | 'opencode';

export interface AgentDetection {
  id: AgentId;
  name: string;
  /** A working import adapter exists for this agent today. */
  supported: boolean;
  /** Recent sessions discoverable for the current project (supported agents). */
  sessions?: number;
  /** Honest status note for detected-but-unsupported agents. */
  note?: string;
}

export interface DetectOptions {
  /** Override home dir (tests). Default: os.homedir() */
  home?: string;
  /** Project path used to count that project's Claude sessions. Default: cwd */
  projectPath?: string;
  /** Override the Claude Code projects dir (tests). Default: auto-discovered. */
  claudeProjectsDir?: string | null;
}

export async function detectAgents(opts: DetectOptions = {}): Promise<AgentDetection[]> {
  const home = opts.home ?? os.homedir();
  const projectPath = opts.projectPath ?? process.cwd();
  const out: AgentDetection[] = [];

  const claudeDir =
    'claudeProjectsDir' in opts ? opts.claudeProjectsDir : findClaudeProjectsDir();
  if (typeof claudeDir === 'string' && claudeDir !== '' && fs.existsSync(claudeDir)) {
    let sessions: number | undefined;
    try {
      sessions = (
        await discoverClaudeSessions({ projectsDir: claudeDir, projectPath, limit: 50 })
      ).length;
    } catch {
      sessions = undefined; // detection must never crash the CLI
    }
    out.push({ id: 'claude-code', name: 'Claude Code', supported: true, sessions });
  }

  const has = (...p: string[]): boolean => fs.existsSync(path.join(home, ...p));
  if (has('.codex')) {
    out.push({
      id: 'codex',
      name: 'Codex CLI',
      supported: false,
      note: 'native import is not available yet - connect it via the generic event interface (docs/events.md)',
    });
  }
  if (has('.gemini')) {
    out.push({
      id: 'gemini',
      name: 'Gemini CLI',
      supported: false,
      note: 'native import is not available yet - connect it via the generic event interface (docs/events.md)',
    });
  }
  if (has('.config', 'opencode') || has('.opencode')) {
    out.push({
      id: 'opencode',
      name: 'OpenCode',
      supported: false,
      note: 'native import is not available yet - connect it via the generic event interface (docs/events.md)',
    });
  }
  return out;
}
