# Forge

**Your agents are working. Forge tells you how well.**

An open-source, CLI-first observability layer for AI coding agents. Forge detects
the agents on your machine, records what they actually do, and turns a run into
one clear report — tasks, tokens, cost, errors, outcomes.

```text
Claude Code / Codex / other agents
              ↓
            Forge
              ↓
      One clear report
```

## Why

One agent is easy to keep track of. Five or ten running in parallel aren't: what
did each one do, what did it cost, which tasks failed, where did work get
duplicated? Forge answers that from recorded evidence, not vibes — in your
terminal, with no account and nothing leaving your machine.

## Quick start

> [!TIP]
> No agents or API keys needed for a first look — `forge demo` prints a full
> report from a synthetic 5-agent run.

```bash
git clone https://github.com/forge-open/forge
cd forge
npm install && npm run build && npm link
forge demo
```

Real output:

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
    Observed: Task "Flaky e2e suite stabilization attempts" (t06) hit 5 retries
              and 0 errors. 1 further task(s) also exceeded 3 combined
              retries/errors.

RECOMMENDATIONS
  → Retry-heavy tasks usually have vague acceptance criteria - split them into
    smaller verifiable steps next run.
```

## Using it for real

Two commands, ever:

```bash
forge          # in your project: detects agents, asks once, sets up
forge report   # what happened lately? (auto-imports the newest session)
```

`forge report` reads your agent's local session data, so you never touch
transcripts, imports, or IDs. Work normally; report when you're curious.

```bash
forge report --verbose    # + task table, file overlap, engineering signals
forge report --json       # machine-readable, for scripts and CI
forge runs                # list imported runs
forge open                # open the HTML report in a browser
```

### Agent support

| Agent        | Status                                              |
| ------------ | --------------------------------------------------- |
| Claude Code  | ✅ Works today — reads local session transcripts     |
| Codex CLI    | ⚠️ Detected, native import planned                   |
| Gemini CLI   | ⚠️ Detected, native import planned                   |
| OpenCode     | ⚠️ Detected, native import planned                   |

Unsupported agents can still be wired up today through Forge's generic event
format — a dozen JSONL event kinds, one emitter function
([docs/events.md](docs/events.md)):

```bash
forge import jsonl .forge/my-agent-run.jsonl
```

> [!NOTE]
> Power users can always import explicitly:
> `forge import claude --project <path> --session <id> --all`.

## What's in a report

- **Run overview** — agents, tasks, runtime, tokens, estimated cost, outcomes
- **Agent performance** — per-agent success rate, tokens/cost, tools, retries,
  and the parent/child swarm tree
- **What happened** — findings with the numbers they're based on
- **Recommendations** — rule-based suggestions, always separated from facts

Costs are estimates from a built-in public price table, overridable in
`.forge/prices.json`; unknown models render as unknown rather than guessed.

## Where data lives

```text
your-project/
└── .forge/
    └── runs/
```

Local-first: run data stays in your project (gitignored), reports are plain
files, and Forge makes zero network calls.

## Current capabilities

- CLI-first: terminal, SSH and CI friendly, ASCII fallback for any terminal
- Claude Code transcript import + generic JSONL event import
- Agent/task tracking with parent-child swarm tree
- Token tracking and cost estimation
- Errors, retries, file changes, commits, test/build signals
- Terminal, Markdown, HTML and JSON reports

Not here yet: native Codex/Gemini/OpenCode adapters, live capture while agents
work, run-to-run comparison.

## Roadmap

- Native Codex CLI and Gemini CLI adapters
- Live capture via agent hooks (no report-time import)
- Run-to-run comparison ("was this run better than the last one?")
- Deeper optimization insights as evidence accumulates

## Development

```bash
npm install
npm test          # 39/39 tests currently pass
npm run build
npm run demo      # end-to-end: synthetic swarm run -> report
```

TypeScript, zero runtime dependencies. Curious why the repo contains a `legacy/`
Python harness? [RESET.md](RESET.md) tells the story of the pivot from agent
runtime to observability layer.
