#!/usr/bin/env node
/**
 * Forge CLI  -  local-first observability for AI coding-agent swarms.
 *
 *   forge init                      create .forge/ in the current project
 *   forge import claude [flags]     import Claude Code session(s) as run(s)
 *   forge import jsonl <file...>    import canonical event JSONL as a run
 *   forge report [<run-id>]         analyze a run + write report.md/.html
 *   forge show [<run-id>]           print the terminal report
 *   forge runs                      list imported runs
 *   forge open [<run-id>]           open the HTML report in a browser
 *   forge demo                      import a synthetic demo run + report
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
import { confirm, makeStyle, termCaps } from './term.js';
import { jsonlToEvents } from './adapters/jsonl.js';
import {
  claudeTranscriptToEvents,
  discoverClaudeSessions,
  findClaudeProjectsDir,
} from './adapters/claude-code.js';
import { generateReport } from './pipeline.js';
import { createDemoRun } from './demo.js';
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

GET STARTED
  forge                       Detect agents in this project, set up Forge,
                              and tell you what happens next
  forge report                Report on the latest agent run
                              (auto-imports your newest Claude Code session)
      --verbose               full detail: tasks, files, signals, notes
      --json                  machine-readable output for scripts and CI
  forge demo                  Instant demo report from a synthetic swarm run

ALSO USEFUL
  forge runs                  List imported runs
  forge show [<run-id>]       Reprint a run's report without writing files
  forge open [<run-id>]       Open the HTML report in your browser

ADVANCED
  forge init                  Create .forge/ manually
  forge import claude         Import Claude Code session transcript(s)
                              [--project <path>] [--session <id>] [--all]
  forge import jsonl <file...>
                              Import canonical Forge-event JSONL (docs/events.md)
  forge help | version

PRICING                      Cost figures are ESTIMATES from built-in public
                             list prices. Override in .forge/prices.json.

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
    process.exitCode = 1;
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
// forge (bare) — detect, confirm, initialize, hand off to `forge report`
// ---------------------------------------------------------------------------

async function cmdStart(caps: { unicode: boolean; color: boolean }): Promise<void> {
  const style = makeStyle(caps.color);
  const g = caps.unicode ? { ok: '✓', warn: '!', box: '─' } : { ok: '+', warn: '!', box: '-' };
  const project = path.basename(process.cwd());
  const isGitRepo = fsSync.existsSync(path.join(process.cwd(), '.git'));

  console.log('');
  if (caps.unicode) {
    const title = 'FORGE';
    const sub = 'observability for AI coding agents';
    const innerPlain = `  ${title}  ${sub}`;
    const innerStyled = `  ${title}  ${style.dim(sub)}`;
    console.log(`╭${g.box.repeat(44)}╮`);
    console.log(`│${innerStyled}${' '.repeat(Math.max(0, 44 - innerPlain.length))}│`);
    console.log(`╰${g.box.repeat(44)}╯`);
  } else {
    console.log('FORGE  -  observability for AI coding agents');
    console.log(style.dim(g.box.repeat(46)));
  }
  console.log('');
  console.log(`Project: ${project}${isGitRepo ? style.dim(' (git repo)') : ''}`);
  console.log('');
  console.log('Detecting agents...');

  const detections = await detectAgents({ projectPath: process.cwd() });
  const supported = detections.filter((d) => d.supported);
  const detectedUnsupported = detections.filter((d) => !d.supported);

  if (supported.length === 0) {
    console.log(`${style.warn(g.warn)} No supported coding agent detected.`);
    console.log('');
    console.log('Forge currently supports:');
    console.log(`  ${style.ok(g.ok)} Claude Code (session transcript import)`);
    if (detectedUnsupported.length > 0) {
      for (const d of detectedUnsupported) {
        console.log(`  ${style.warn(g.warn)} ${d.name}: ${d.note ?? 'not supported yet'}`);
      }
    }
    console.log('');
    console.log('Other agents can be connected through the generic event interface:');
    console.log('  docs/events.md  ->  forge import jsonl <file>');
    console.log('');
    console.log(`Want to see what a report looks like?  ${style.dim('forge demo')}`);
    return;
  }

  for (const d of detections) {
    if (d.supported) {
      const sessions = d.sessions === undefined ? '' : ` - ${d.sessions} recent session${d.sessions === 1 ? '' : 's'} here`;
      console.log(`${style.ok(g.ok)} ${d.name}${style.dim(sessions)}`);
    } else {
      console.log(`${style.warn(g.warn)} ${d.name}${style.dim(` - ${d.note ?? 'not supported yet'}`)}`);
    }
  }
  console.log('');
  const claude = supported.find((d) => d.id === 'claude-code');
  const hasSessions = (claude?.sessions ?? 0) > 0;

  if (!hasSessions) {
    console.log(`No Claude Code sessions found for this project yet.`);
    console.log(`Work with Claude Code here first - Forge will read the session it writes.`);
    console.log('');
    console.log(`Want to see what a report looks like right now?  ${style.dim('forge demo')}`);
  }

  const proceed = await confirm(process.stdin, 'Start observing this project?', true);
  if (!proceed) {
    console.log('OK - nothing was written. Run `forge` when you are ready.');
    return;
  }
  const root = ensureForgeDir();
  console.log('');
  console.log(`${style.ok(g.ok)} Forge is ready: ${style.dim(path.relative(process.cwd(), root) || root)}`);
  console.log('');
  console.log('Forge observes locally. No account, no API key.');
  if (hasSessions) {
    console.log('You already have sessions here - preview one any time:');
  } else {
    console.log('Continue working normally with Claude Code.');
    console.log('When you are done:');
  }
  console.log(`  ${style.dim('forge report')}`);
}

/**
 * `forge report` with no explicit run id should reflect the most recent work:
 * import the newest Claude session for this project when it is newer than the
 * newest stored run (or when nothing is stored yet). Never fatal.
 */
async function autoImportNewestSession(): Promise<void> {
  try {
    const projectsDir = findClaudeProjectsDir();
    if (!projectsDir) return;
    const latest = await resolveRunRef('latest');
    const [newest] = await discoverClaudeSessions({ projectsDir, projectPath: process.cwd(), limit: 1 });
    if (!newest) return;
    const st = await fsp.stat(newest.filePath);
    if (latest && new Date(latest.createdAt).getTime() >= st.mtimeMs) return;
    const runId = await importOneSource(
      'claude-code',
      () => fsp.readFile(newest.filePath, 'utf8'),
      (text) => claudeTranscriptToEvents(text, { projectPath: process.cwd() }),
      {
        project: newest.project ?? process.cwd(),
        generator: `claude-code session ${newest.sessionId}`,
        quiet: true,
      },
    );
    if (runId) console.log(`imported claude-code session ${ascii(newest.sessionId)}`);
  } catch {
    // Auto-import is a convenience: fall back to the latest stored run.
  }
}

async function cmdReport(args: Args): Promise<void> {
  const ref = args.pos[0];
  if (!ref) await autoImportNewestSession();
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
        : 'no runs yet. Work with your agent, then run forge report again.\n  Or preview instantly: forge demo',
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
    console.log('no runs yet.');
    console.log('try: forge import claude   (after running Claude Code here)');
    console.log('or:  forge demo            (synthetic example, zero setup)');
    return;
  }
  console.log('RUN ID              SOURCE        EVENTS  PROJECT / CREATED');
  for (const r of runs.slice(0, 30)) {
    const proj = r.project ? r.project : '-';
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

async function cmdDemo(caps: { unicode: boolean; color: boolean }): Promise<void> {
  const created = await createDemoRun();
  console.log(`run ${created.meta.runId} created (synthetic demo swarm)`);
  const gen = await generateReport(created.meta.runId, {
    writeFiles: true,
    unicode: caps.unicode,
    color: caps.color,
  });
  if (!gen) die('internal error: demo run vanished');
  console.log('');
  console.log(gen.terminal);
  console.log('');
  if (gen.htmlPath) console.log(`html:     ${gen.htmlPath}`);
  if (gen.markdownPath) console.log(`markdown: ${gen.markdownPath}`);
}

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

async function main(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv;
  const args = parseArgs(rest);
  const caps = termCaps();
  switch (cmd ?? 'start') {
    case 'start':
    case 'setup':
      await cmdStart(caps);
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
      else if (sub === 'jsonl') await cmdImportJsonl(args);
      else die('usage: forge import claude|jsonl ...');
      break;
    }
    case 'report':
      await cmdReport(args);
      break;
    case 'show':
      await cmdShow(args);
      break;
    case 'runs':
      await cmdRuns();
      break;
    case 'open':
      await cmdOpen(args);
      break;
    case 'demo':
      await cmdDemo(caps);
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
