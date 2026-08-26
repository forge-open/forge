# Forge

**Your agents are working. Forge tells you how well.**

Forge is an open-source, CLI-first observability layer for AI coding agents. It
detects the agents on your machine, watches the work they do, and turns a run
into one clear report — tasks, tokens, cost, errors, outcomes.

```text
Claude Code / Codex / other agents
              ↓
            Forge
              ↓
      One clear report
```

## Why Forge?

Running one AI coding agent is easy to understand.

Running 5, 10 or 20 in parallel isn't. You lose track of what each agent did,
what it cost, which tasks failed, and where agents duplicated work.

Forge turns the entire run into one report, in your terminal.

## What Forge gives you

Real output from `forge demo` (see below):

```text
╭──────────────────────────────────────────────────────────────────────────────╮
│ FORGE RUN  demo-workspace · demo                                             │
╰──────────────────────────────────────────────────────────────────────────────╯

AGENTS   TASKS   RUNTIME   TOKENS   COST
5        12      47m 00s   1.2M     $10.16

OUTCOMES
  ✓ 9 successful
  ! 2 partial
  ✕ 1 failed

WHAT HAPPENED
  ! 2 tasks required repeated retries

RECOMMENDATIONS
  → Retry-heavy tasks usually have vague acceptance criteria - split them into
    smaller verifiable steps next run.
```

Facts come from recorded events. Suggestions are rule-based inferences, always
labeled as such. Costs are estimates from built-in public list prices.

## Installation

Requires Node.js 18+. No account, no API key.

```bash
git clone https://github.com/forge-open/forge
cd forge
npm install
npm run build
npm link
```

```bash
forge --help
```

## Try it in 30 seconds

```bash
forge demo
```

That's a synthetic 5-agent run — known tokens, failures, retries — printed as a
full report. No setup of any kind.

## Use Forge with a real run

The normal workflow is two commands, ever:

```bash
forge          # once, in your project: detects agents and sets up
forge report   # whenever you want to know what happened
```

`forge` detects your agents, creates `.forge/` (it asks first), and tells you
what to do next. `forge report` automatically imports your newest agent session,
so you never have to think about transcripts, imports, or IDs.

### Per-agent setup

**Claude Code — works today, zero config.**
Forge reads the session transcripts Claude Code already writes on your machine
(`~/.claude/projects/`). No hooks, no wrappers. Work normally, then `forge report`.

**Codex CLI — detected, native import planned.**
Forge will tell you it detected Codex but cannot import its sessions yet. You can
bridge the gap today by emitting Forge's generic event format
([docs/events.md](docs/events.md)) and running `forge import jsonl <file>`.

**Gemini CLI — same status as Codex.**

**OpenCode / custom harnesses — generic events work today.**
The JSONL event format is the integration boundary: a dozen event kinds, one
emitter function, then `forge import jsonl <file>`.

## View the report

```bash
forge report              # concise human-readable report (+ report.md / report.html)
forge report --verbose    # deeper: task table, file overlap, engineering signals
forge report --json       # machine-readable output for scripts and CI
```

Related: `forge runs` lists imported runs, `forge show` reprints a report,
`forge open` opens the HTML file in your browser.

Power users can always import explicitly:
`forge import claude [--project <path>] [--session <id>] [--all]`.

## Where does Forge store data?

```text
your-project/
└── .forge/
    └── runs/
```

Local-first: everything stays in your project (`.forge/` is gitignored), reports
are plain files, and nothing is ever uploaded.

## What Forge currently supports

```text
✓ CLI-first (terminal, SSH, CI friendly)
✓ Local runs, no account
✓ Agent detection (Claude Code, Codex, Gemini CLI, OpenCode)
✓ Claude Code transcript import
✓ Generic JSONL event import
✓ Agent / task tracking with parent-child swarm tree
✓ Token tracking and cost estimation (overridable pricing)
✓ Errors, retries, file changes, commits, test/build signals
✓ Terminal, Markdown, HTML and JSON reports
```

## What's next

Future directions, not current features:

- Native Codex CLI and Gemini CLI adapters
- Live capture while agents work (no report-time import)
- Run-to-run comparison ("was this run better than the last one?")
- Deeper optimization insights as evidence accumulates

## Development

```bash
npm install
npm test          # 39/39 tests currently pass
npm run build
npm run demo
```

TypeScript, zero runtime dependencies. See [CONTRIBUTING.md](CONTRIBUTING.md)
and [RESET.md](RESET.md) for how this project pivoted from an agent harness to
an observability layer.

## License

[MIT](LICENSE)
