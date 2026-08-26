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

USAGE
  forge <command> [options]

COMMANDS
  init                        Create .forge/ in the current project
  import claude               Import Claude Code session transcript(s) as a run
                              [--project <path>]  target a specific project dir (default: cwd)
                              [--session <id>]    import one session by id (prefix ok)
                              [--all]             import up to 10 most recent sessions
  import jsonl <file...>      Import canonical Forge-event JSONL file(s) as a run
  report [<run-id>]           Analyze a run, print the terminal report and write
                              report.md + report.html ("latest" default)
                              [--verbose]   full depth: tasks, files, signals, notes
                              [--json]      machine-readable RunReport on stdout
  show [<run-id>]             Print the terminal report for a run
                              [--verbose]   full depth
  runs                        List imported runs
  open [<run-id>]             Generate (if needed) and open the HTML report
  demo                        Import a synthetic multi-agent demo run and print its report

MORE
  help                        This text
  version                     Print version

PRICING                     Cost figures are ESTIMATES from built-in public list prices.
                            Override/extend in .forge/prices.json (model-prefix -> per-MTok rates).

DOCS                        https://github.com/forge-open/forge`;

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
  opts: { project?: string; generator?: string },
): Promise<void> {
  let text: string;
  try {
    text = await readText();
  } catch (err) {
    console.error(`forge: cannot read source (${err instanceof Error ? err.message : String(err)})`);
    process.exitCode = 1;
    return;
  }
  const parsed = convert(text);
  if (parsed.events.length === 0) {
    console.error(`forge: no usable events found  -  skipping (${sourceLabel})`);
    for (const w of parsed.warnings.slice(0, 5)) console.error(`  warning: ${ascii(w)}`);
    process.exitCode = 1;
    return;
  }
  const run = await createRun(sourceLabel, opts);
  await appendEvents(run.dir, parsed.events);
  console.log(`run ${run.meta.runId} created: ${parsed.events.length} events`);
  if (parsed.dropped > 0) console.log(`  dropped ${parsed.dropped} unusable records`);
  for (const w of parsed.warnings.slice(0, 5)) console.log(`  warning: ${ascii(w)}`);
  console.log(`next: forge report ${run.meta.runId}`);
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

async function cmdReport(args: Args): Promise<void> {
  const ref = args.pos[0];
  const json = args.flags.json === true;
  const gen = await generateReport(ref, {
    writeFiles: true,
    verbose: args.flags.verbose === true,
  });
  if (!gen) die(`no run matches "${ref ?? 'latest'}"  -  try: forge runs`);
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
  const gen = await generateReport(ref, {
    writeFiles: false,
    verbose: args.flags.verbose === true,
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

async function cmdDemo(): Promise<void> {
  const created = await createDemoRun();
  console.log(`run ${created.meta.runId} created (synthetic demo swarm)`);
  const gen = await generateReport(created.meta.runId, { writeFiles: true });
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
  switch (cmd ?? 'help') {
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
      await cmdDemo();
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
