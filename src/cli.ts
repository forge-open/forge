#!/usr/bin/env node
/**
 * Forge CLI — local-first observability for AI coding-agent swarms.
 *
 *   forge                           detect agents, analyze recent activity,
 *                                   print one report
 *   forge [--verbose | --json]      deeper detail / machine-readable
 *   forge report [<run-id>]         same analysis for a specific stored run
 *   forge runs | show | open        inspect stored runs
 *   forge import claude|codex|jsonl explicit imports (power users)
 *
 * Zero runtime dependencies. Everything stays under <project>/.forge/.
 */
import fsSync from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

import {
  createRun,
  appendEvents,
  listRuns,
  resolveRunRef,
  runDirFor,
  ensureForgeDir,
} from './core/store.js';
import { detectAgents } from './core/detect.js';
import { makeStyle, termCaps } from './term.js';
import { jsonlToEvents } from './adapters/jsonl.js';
import {
  claudeTranscriptToEvents,
  discoverClaudeSessions,
  findClaudeProjectsDir,
} from './adapters/claude-code.js';
import {
  codexSessionToEvents,
  discoverCodexSessions,
  findCodexSessionsDir,
} from './adapters/codex.js';
import { generateReport } from './pipeline.js';
import { ascii } from './report/format.js';

const VERSION = '2.0.0-alpha.1';

// ---------------------------------------------------------------------------
// tiny arg parsing (no deps)
// ---------------------------------------------------------------------------

interface Args {
  flags: Record<string, string | boolean>;
  pos: string[];
}

function parseArgs(argv: string[]): Args {
  const flags: Record<string, string | boolean> = {};
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--') && a.length > 2) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      pos.push(a);
    }
  }
  return { flags, pos };
}

const HELP = `forge ${VERSION}  -  your agents are working. Forge tells you how well.

START
  forge                       Detect agents, analyze their recent work in this
                              project, and print one report
      --verbose               full detail: tasks, files, signals, notes
      --json                  machine-readable output for scripts and CI
      --project <path>        analyze a different project directory

INSPECT
  forge report [<run-id>]     report for a specific stored run
  forge runs                  list stored runs
  forge show [<run-id>]       reprint a stored report (writes nothing)
  forge open [<run-id>]       open the HTML report in your browser

ADVANCED
  forge init                  create .forge/ manually
  forge import claude         explicit Claude Code import
                              [--project <path>] [--session <id>] [--all]
  forge import codex          explicit Codex CLI import (same flags)
  forge import jsonl <file...>
                              generic Forge-event JSONL (docs/events.md)
  forge help | version

NOTES                        Local-first: no account, no API key, no network.
                             Costs are ESTIMATES from built-in public list
                             prices; override in .forge/prices.json.

DOCS                         https://github.com/forge-open/forge`;

function die(msg: string, code = 1): never {
  console.error(`forge: ${msg}`);
  process.exit(code);
}

function flagStr(args: Args, key: string): string | undefined {
  const v = args.flags[key];
  return typeof v === 'string' ? v : undefined;
}

async function importOneSource(
  sourceLabel: string,
  readText: () => Promise<string>,
  convert: (text: string) => ReturnType<typeof jsonlToEvents>,
  opts: { project?: string; generator?: string; quiet?: boolean },
): Promise<string | null> {
  let text: string;
  try {
    text = await readText();
  } catch (err) {
    console.error(`forge: cannot read source (${err instanceof Error ? err.message : String(err)})`);
    process.exitCode = 1;
    return null;
  }
  const parsed = convert(text);
  if (parsed.events.length === 0) {
    if (!opts.quiet) {
      console.error(`forge: no usable events found  -  skipping (${sourceLabel})`);
      for (const w of parsed.warnings.slice(0, 5)) console.error(`  warning: ${ascii(w)}`);
    }
    process.exitCode = process.exitCode || 1;
    return null;
  }
  const run = await createRun(sourceLabel, opts);
  await appendEvents(run.dir, parsed.events);
  if (!opts.quiet) {
    console.log(`run ${run.meta.runId} created: ${parsed.events.length} events`);
    if (parsed.dropped > 0) console.log(`  dropped ${parsed.dropped} unusable records`);
    for (const w of parsed.warnings.slice(0, 5)) console.log(`  warning: ${ascii(w)}`);
    console.log(`next: forge report ${run.meta.runId}`);
  }
  return run.meta.runId;
}

// ---------------------------------------------------------------------------
// explicit imports (power users)
// ---------------------------------------------------------------------------

async function cmdImportClaude(args: Args): Promise<void> {
  const projectPath = flagStr(args, 'project') ?? process.cwd();
  const sessionId = flagStr(args, 'session');
  const takeAll = args.flags.all === true;

  const projectsDir = findClaudeProjectsDir();
  if (!projectsDir) {
    die(
      'no Claude Code projects directory found (~/.claude/projects).\n' +
        '  If Claude Code stores transcripts elsewhere, set CLAUDE_PROJECTS_DIR.',
    );
  }

  const sessions = await discoverClaudeSessions({
    projectsDir,
    ...(sessionId ? {} : { projectPath }),
    limit: takeAll ? 10 : 50,
  });
  const picked = sessionId
    ? sessions.filter((s) => s.sessionId.startsWith(sessionId))
    : takeAll
      ? sessions.slice(0, 10)
      : sessions.slice(0, 1);

  if (picked.length === 0) {
    die(
      sessionId
        ? `no Claude Code session matching "${sessionId}"`
        : `no Claude Code sessions found for ${projectPath}\n` +
          '  Run Claude Code in this project first, or point --project at a directory that has sessions.',
    );
  }

  for (const s of picked) {
    console.log(`importing claude-code session ${ascii(s.sessionId)} ...`);
    await importOneSource(
      'claude-code',
      () => fsp.readFile(s.filePath, 'utf8'),
      (text) => claudeTranscriptToEvents(text, { projectPath }),
      {
        project: s.project ?? projectPath,
        generator: `claude-code session ${s.sessionId}`,
      },
    );
  }
}

async function cmdImportCodex(args: Args): Promise<void> {
  const projectPath = flagStr(args, 'project') ?? process.cwd();
  const sessionId = flagStr(args, 'session');
  const takeAll = args.flags.all === true;

  const sessionsDir = findCodexSessionsDir();
  if (!sessionsDir) {
    die(
      'no Codex CLI sessions directory found (~/.codex/sessions).\n' +
        '  If Codex stores sessions elsewhere, set CODEX_SESSIONS_DIR.',
    );
  }

  const sessions = await discoverCodexSessions({
    sessionsDir,
    ...(sessionId ? {} : { projectPath }),
    limit: takeAll ? 10 : 50,
  });
  const picked = sessionId
    ? sessions.filter((s) => s.sessionId.startsWith(sessionId))
    : takeAll
      ? sessions.slice(0, 10)
      : sessions.slice(0, 1);

  if (picked.length === 0) {
    die(
      sessionId
        ? `no Codex session matching "${sessionId}"`
        : `no Codex sessions found for ${projectPath}\n` +
          '  Run Codex in this project first, or point --project at a directory that has sessions.',
    );
  }

  for (const s of picked) {
    console.log(`importing codex session ${ascii(s.sessionId)} ...`);
    await importOneSource(
      'codex',
      () => fsp.readFile(s.filePath, 'utf8'),
      (text) => codexSessionToEvents(text, { projectPath }),
      {
        project: s.project ?? projectPath,
        generator: `codex session ${s.sessionId}`,
      },
    );
  }
}

async function cmdImportJsonl(args: Args): Promise<void> {
  if (args.pos.length === 0) die('usage: forge import jsonl <file...>   (schema: docs/events.md)');
  for (const file of args.pos) {
    console.log(`importing jsonl ${file} ...`);
    await importOneSource('jsonl', () => fsp.readFile(path.resolve(file), 'utf8'), jsonlToEvents, {
      project: process.cwd(),
      generator: `jsonl file ${path.basename(file)}`,
    });
  }
}

// ---------------------------------------------------------------------------
// forge (bare) — detect agents, analyze recent activity, one report
// ---------------------------------------------------------------------------

interface SourceAdapter {
  id: 'claude-code' | 'codex';
  available(): boolean;
  discoverNewest(projectPath: string): Promise<{ sessionId: string; filePath: string; project?: string } | null>;
  import(session: { filePath: string; project?: string; sessionId: string }, projectPath: string): Promise<string | null>;
}

const SOURCES: SourceAdapter[] = [
  {
    id: 'claude-code',
    available: () => findClaudeProjectsDir() !== null,
    discoverNewest: async (projectPath) => {
      const dir = findClaudeProjectsDir();
      if (!dir) return null;
      const [newest] = await discoverClaudeSessions({ projectsDir: dir, projectPath, limit: 1 });
      return newest ?? null;
    },
    import: (s, projectPath) =>
      importOneSource(
        'claude-code',
        () => fsp.readFile(s.filePath, 'utf8'),
        (text) => claudeTranscriptToEvents(text, { projectPath }),
        { project: s.project ?? projectPath, generator: `claude-code session ${s.sessionId}`, quiet: true },
      ),
  },
  {
    id: 'codex',
    available: () => findCodexSessionsDir() !== null,
    discoverNewest: async (projectPath) => {
      const dir = findCodexSessionsDir();
      if (!dir) return null;
      const [newest] = await discoverCodexSessions({ sessionsDir: dir, projectPath, limit: 1 });
      return newest ?? null;
    },
    import: (s, projectPath) =>
      importOneSource(
        'codex',
        () => fsp.readFile(s.filePath, 'utf8'),
        (text) => codexSessionToEvents(text, { projectPath }),
        { project: s.project ?? projectPath, generator: `codex session ${s.sessionId}`, quiet: true },
      ),
  },
];

/** Import every supported source whose newest session is newer than the newest stored run. */
async function autoImportNewest(projectPath: string, quiet: boolean): Promise<number> {
  let imported = 0;
  try {
    const latest = await resolveRunRef('latest');
    const latestMs = latest ? new Date(latest.createdAt).getTime() : 0;
    for (const source of SOURCES) {
      if (!source.available()) continue;
      const newest = await source.discoverNewest(projectPath);
      if (!newest) continue;
      const st = await fsp.stat(newest.filePath);
      if (latestMs >= st.mtimeMs) continue;
      const runId = await source.import(newest, projectPath);
      if (runId) {
        imported++;
        if (!quiet) console.log(`imported ${source.id} session ${ascii(newest.sessionId)}`);
      }
    }
  } catch {
    // Auto-import is a convenience: fall back to whatever is already stored.
  }
  return imported;
}

async function cmdAnalyze(args: Args): Promise<void> {
  const caps = termCaps();
  const style = makeStyle(caps.color);
  const g = caps.unicode ? { ok: '✓', warn: '!', box: '─' } : { ok: '+', warn: '!', box: '-' };
  const json = args.flags.json === true;
  const projectPath = flagStr(args, 'project') ?? process.cwd();
  const say = (s: string): void => {
    if (!json) console.log(s);
  };

  const project = path.basename(projectPath);
  if (!json) {
    console.log('');
    if (caps.unicode) {
      const title = 'FORGE';
      const sub = 'your agents are working. Forge tells you how well.';
      const innerPlain = ` ${title}  ${sub}`;
      const innerStyled = ` ${title}  ${style.dim(sub)}`;
      console.log(`╭${g.box.repeat(62)}╮`);
      console.log(`│${innerStyled}${' '.repeat(Math.max(0, 62 - innerPlain.length))}│`);
      console.log(`╰${g.box.repeat(62)}╯`);
      console.log('');
    }
    console.log(`Project: ${project}`);
    console.log('Detecting agents...');
  }

  const detections = await detectAgents({ projectPath });
  const supported = detections.filter((d) => d.supported);
  const detectedUnsupported = detections.filter((d) => !d.supported);

  if (supported.length === 0) {
    say(`${style.warn(g.warn)} No supported AI coding agent was detected.`);
    say('');
    say('Forge currently supports:');
    say(`  ${style.ok(g.ok)} Claude Code`);
    say(`  ${style.ok(g.ok)} Codex CLI`);
    for (const d of detectedUnsupported) {
      say(`  ${style.warn(g.warn)} ${d.name} - ${d.note ?? 'not supported yet'}`);
    }
    say('');
    say(`Start one of these agents in this project, give it a task,`);
    say(`then run:  ${style.dim('forge')}`);
    say('');
    say(style.dim('Other agents can be connected through the generic event interface (docs/events.md).'));
    return;
  }

  for (const d of detections) {
    if (d.supported) {
      const sessions = d.sessions === undefined ? '' : ` - ${d.sessions} recent session${d.sessions === 1 ? '' : 's'} here`;
      say(`${style.ok(g.ok)} ${d.name}${style.dim(sessions)}`);
    } else {
      say(`${style.warn(g.warn)} ${d.name}${style.dim(` - ${d.note ?? 'not supported yet'}`)}`);
    }
  }

  const totalSessions = supported.reduce((sum, d) => sum + (d.sessions ?? 0), 0);
  if (totalSessions === 0) {
    say('');
    say('No recent agent activity was found for this project.');
    const names = supported.map((d) => d.name).join(' or ');
    say(`Run ${names} here, complete some work, then run:  ${style.dim('forge')}`);
    return;
  }

  say('');
  say('Found recent agent activity. Analyzing...');
  ensureForgeDir();
  await autoImportNewest(projectPath, json);

  const gen = await generateReport(undefined, {
    writeFiles: true,
    verbose: args.flags.verbose === true,
    unicode: caps.unicode,
    color: caps.color,
  });
  if (!gen) {
    die('agent activity was found but could not be analyzed yet.\n  Check forge runs, or re-run after your agent finishes a task.');
  }
  if (json) {
    console.log(JSON.stringify(gen.report, null, 2));
    return;
  }
  console.log('');
  console.log(gen.terminal);
  console.log('');
  if (gen.markdownPath) console.log(`markdown: ${gen.markdownPath}`);
  if (gen.htmlPath) console.log(`html:     ${gen.htmlPath}`);
}

async function cmdReport(args: Args): Promise<void> {
  const ref = args.pos[0];
  if (!ref) await autoImportNewest(flagStr(args, 'project') ?? process.cwd(), args.flags.json === true);
  const json = args.flags.json === true;
  const caps = termCaps();
  const gen = await generateReport(ref, {
    writeFiles: true,
    verbose: args.flags.verbose === true,
    unicode: caps.unicode,
    color: caps.color,
  });
  if (!gen) {
    die(
      ref
        ? `no run matches "${ref}"  -  try: forge runs`
        : 'no runs yet. Work with your agent in this project, then run: forge',
    );
  }
  if (json) {
    // Machine-readable mode: stdout carries ONLY the JSON document.
    console.log(JSON.stringify(gen.report, null, 2));
    return;
  }
  console.log(gen.terminal);
  console.log('');
  if (gen.markdownPath) console.log(`markdown: ${gen.markdownPath}`);
  if (gen.htmlPath) console.log(`html:     ${gen.htmlPath}`);
}

async function cmdShow(args: Args): Promise<void> {
  const ref = args.pos[0];
  const json = args.flags.json === true;
  const caps = termCaps();
  const gen = await generateReport(ref, {
    writeFiles: false,
    verbose: args.flags.verbose === true,
    unicode: caps.unicode,
    color: caps.color,
  });
  if (!gen) die(`no run matches "${ref ?? 'latest'}"  -  try: forge runs`);
  if (json) {
    console.log(JSON.stringify(gen.report, null, 2));
    return;
  }
  console.log(gen.terminal);
}

async function cmdRuns(): Promise<void> {
  const runs = await listRuns();
  if (runs.length === 0) {
    console.log('no stored runs yet.');
    console.log(`work with your agent in this project, then run:  forge`);
    return;
  }
  console.log('RUN ID               SOURCE        EVENTS  PROJECT / CREATED');
  for (const r of runs.slice(0, 30)) {
    const proj = r.project ? ascii(r.project) : '-';
    const when = r.createdAt.slice(0, 16).replace('T', ' ');
    console.log(
      `${r.runId.padEnd(21)}${r.source.padEnd(14)}${String(r.eventCount).padStart(6)}  ${proj} | ${when}`,
    );
  }
  console.log('');
  console.log('open a report with: forge report <run-id>');
}

function openInBrowser(file: string): void {
  const p = process.platform;
  if (p === 'win32') {
    // rundll32 avoids cmd.exe metacharacter parsing entirely; the path arrives
    // as a single argv entry with no shell interpretation.
    spawn('rundll32', ['url.dll,FileProtocolHandler', file], {
      detached: true,
      stdio: 'ignore',
      windowsVerbatimArguments: false,
    }).unref();
  } else if (p === 'darwin') {
    spawn('open', [file], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [file], { detached: true, stdio: 'ignore' }).unref();
  }
}

async function cmdOpen(args: Args): Promise<void> {
  const meta = await resolveRunRef(args.pos[0] ?? 'latest');
  if (!meta) die(`no run matches "${args.pos[0] ?? 'latest'}"  -  try: forge runs`);
  // Route through the strict run-id validation; never trust meta.json contents.
  const htmlPath = path.join(runDirFor(meta.runId), 'report.html');
  if (!fsSync.existsSync(htmlPath)) {
    const gen = await generateReport(meta.runId, { writeFiles: true });
    if (!gen || !gen.htmlPath) die(`could not generate a report for ${meta.runId}`);
  }
  openInBrowser(htmlPath);
  console.log(`opened: ${htmlPath}`);
}

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

async function main(argv: string[]): Promise<void> {
  let cmd: string | undefined = argv[0];
  let rest = argv.slice(1);
  // `forge --verbose` / `forge --json` / `forge --project <path>`: leading flags
  // belong to the default analyze command, not an unknown subcommand.
  if (cmd !== undefined && cmd.startsWith('--')) {
    rest = argv;
    cmd = undefined;
  }
  const args = parseArgs(rest);
  switch (cmd ?? 'analyze') {
    case 'analyze':
    case 'start':
    case 'setup':
      await cmdAnalyze(args);
      break;
    case 'report':
      await cmdReport(args);
      break;
    case 'init': {
      const root = ensureForgeDir();
      console.log(`forge is ready: ${root}`);
      console.log('runs land in .forge/runs/ and stay on this machine.');
      break;
    }
    case 'import': {
      const sub = args.pos.shift();
      if (sub === 'claude') await cmdImportClaude(args);
      else if (sub === 'codex') await cmdImportCodex(args);
      else if (sub === 'jsonl') await cmdImportJsonl(args);
      else die('usage: forge import claude|codex|jsonl ...');
      break;
    }
    case 'runs':
      await cmdRuns();
      break;
    case 'show':
      await cmdShow(args);
      break;
    case 'open':
      await cmdOpen(args);
      break;
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP);
      break;
    case 'version':
    case '--version':
      console.log(`forge ${VERSION}`);
      break;
    default:
      die(`unknown command "${cmd}"\n\n${HELP}`);
  }
}

main(process.argv.slice(2)).catch((err) => {
  console.error(`forge: unexpected failure: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(2);
});
