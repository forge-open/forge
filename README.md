# Forge

**Your agents are working. Forge tells you how well.**

An open-source, CLI-first observability layer for AI coding agents. Forge detects
Claude Code and Codex CLI on your machine, analyzes their real work locally, and
gives you one report: tasks, tokens, cost, failures, retries, outcomes, and what
to change next run.

```text
Claude Code / Codex CLI
          ↓
        Forge
          ↓
    One clear report
```

## Install

```bash
npx @forge-open/forge
```

> [!NOTE]
> The package is not published to npm yet. Until it is, build from source:
>
> ```bash
> git clone https://forge-open/forge && cd forge
> npm install && npm run build && npm link
> ```
>
> (Requires Node.js 18+. The `forge` npm name is taken by an unrelated package —
> `@forge-open/forge` is the official one.)

## Use it

Run it in the project where your agent is working:

```bash
cd my-project
npx @forge-open/forge
```

That's it. Forge detects your agents, finds their recent sessions, analyzes the
real activity, and prints the report. No config, no adapters to pick, no account,
no API key — everything stays on your machine.

Real example, captured from an actual Codex session (project name elided):

```text
Project: minutz
Detecting agents...
+ Claude Code - 0 recent sessions here
+ Codex CLI - 16 recent sessions here

Found recent agent activity. Analyzing...
imported codex session rollout-2026-05-31T...

AGENTS   TASKS   RUNTIME   TOKENS   COST
1        12      2h 01m    24.9M    $18.06

OUTCOMES
  + 12 successful

WHAT HAPPENED
  · Long-running task: 6x the median
```

Missing evidence is shown as `unavailable`, never as a fake zero. Costs are
estimates from a built-in public price table (overridable in
`.forge/prices.json`); unknown pricing renders as unknown.

## Report modes

```bash
npx @forge-open/forge --verbose    # + task table, file overlap, signals, notes
npx @forge-open/forge --json       # machine-readable, for scripts and CI
npx @forge-open/forge report       # report for a specific stored run
```

Also available: `runs` (list stored runs), `show` (reprint without writing),
`open` (HTML report in your browser), and explicit imports for power users
(`import claude`, `import codex`, `import jsonl` — see
[docs/events.md](docs/events.md) for the generic event format other agents can
emit today).

## Agent support

| Agent        | Analysis                          |
| ------------ | --------------------------------- |
| Claude Code  | ✅ Native adapter — works today    |
| Codex CLI    | ✅ Native adapter — works today    |
| Gemini CLI   | Planned                           |
| OpenCode     | Planned                           |

Detection and analysis are different things: Forge can *see* other agents but
only reports what it can actually analyze. If a field is unavailable from a
source, Forge says `unavailable` — it never invents data.

## Where data lives

```text
your-project/
└── .forge/
    └── runs/
```

Local-first: run data stays in your project (gitignored), reports are plain
files, and the CLI makes zero network calls.

## Roadmap

- Gemini CLI and OpenCode adapters
- Live capture while agents work
- Run-to-run comparison ("was this run better than the last one?")
- Deeper optimization insights as evidence accumulates

## Development

```bash
git clone https://github.com/forge-open/forge && cd forge
npm install
npm test          # 45/45 tests currently pass
npm run build
```

TypeScript, zero runtime dependencies. See [CONTRIBUTING.md](CONTRIBUTING.md).
Curious why the repo contains a `legacy/` Python harness?
[RESET.md](RESET.md) tells the story of the pivot from agent runtime to
observability layer.
