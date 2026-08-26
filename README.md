# Forge

**Your agents are working. Forge tells you how well.**

Forge is an open-source, CLI-first observability layer for AI coding agents. It
watches the agents you already use, tracks their tasks, tokens, cost, errors and
outcomes, and turns the whole run into one report.

```text
Claude Code / Codex / other agents
              ↓
            Forge
              ↓
      One clear report
```

## Why Forge?

Running one AI coding agent is easy to understand.

Running 5, 10 or 20 agents in parallel isn't. You quickly lose track of what each
agent actually did, how much it cost, which tasks failed, where agents duplicated
work, and whether the swarm was worth running at all.

Forge turns the entire run into one report, in your terminal.

## What Forge gives you

This is real output from `forge demo` (see below):

```text
=== RUN OVERVIEW ===
agents 5 | tasks 12 | duration 47m 00s
tokens 1.2M (in 668k / out 150.4k / cache 400.8k)
outcomes 9 success / 2 partial / 1 failure / 0 unknown
est. cost (estimated): $10.16

=== WHAT HAPPENED ===
+ 9 tasks completed
! 2 tasks partially completed
x 1 task failed

[!] 2 tasks required repeated retries
[!] 1 task failed

=== RECOMMENDATIONS ===
-> Retry-heavy tasks usually have vague acceptance criteria - split them into
   smaller verifiable steps next run.
```

Facts come from recorded events. Suggestions are rule-based inferences, always
labeled as such. Cost figures are estimates from built-in public list prices.

## Installation

Requires Node.js 18+.

```bash
git clone https://github.com/forge-open/forge
cd forge
npm install
npm run build
npm link
```

Then check it works:

```bash
forge --help
```

## Try it in 30 seconds

```bash
forge demo
```

This creates a synthetic multi-agent run — 5 agents, 12 tasks, known tokens,
failures and retries — and prints the full report. No API keys, no agent setup.

## Use Forge with a real run

Setup differs per agent, because agents record their work differently.

### Claude Code — works today, zero config

Forge reads the session transcripts Claude Code already writes on your machine
(`~/.claude/projects/`). No hooks, no wrappers.

```text
Claude Code (work normally)
    ↓
session transcript on disk
    ↓
forge import claude
    ↓
forge report
```

```bash
forge init              # once per project: creates .forge/
forge import claude     # import your most recent session here
forge report            # print the report + write report.md and report.html
```

Useful variants:

```bash
forge import claude --project C:\path\to\repo   # import another project's sessions
forge import claude --session <id>              # one specific session
forge import claude --all                       # up to 10 most recent sessions
```

### Codex CLI — via generic events, native adapter planned

Forge cannot read Codex session files yet. Today you have two honest options:

1. **Wait for the adapter** (planned — see the roadmap below).
2. **Emit Forge events yourself.** Any tool that writes the simple JSONL schema in
   [docs/events.md](docs/events.md) can be imported:

   ```bash
   forge import jsonl .forge/my-codex-run.jsonl
   forge report
   ```

### Gemini CLI — same status as Codex

No native adapter yet. Same path: emit the generic event format, then
`forge import jsonl`.

### OpenCode / custom harnesses / your own scripts

The generic JSONL format **is** the integration boundary, and it works today.
A dozen event kinds, one emitter function, then `forge import jsonl`.
See [docs/events.md](docs/events.md).

## View the report

```bash
forge report              # concise human-readable report (+ report.md / report.html)
forge report --verbose    # deeper: task table, file overlap, engineering signals
forge report --json       # machine-readable output for scripts and CI
```

Related commands: `forge runs` lists imported runs, `forge show` reprints a
report without writing files, `forge open` opens the HTML report in your browser.

## Where does Forge store data?

```text
your-project/
└── .forge/
    └── runs/
```

Everything is local-first: no account, no cloud, no telemetry. Run data stays in
your project (the `.forge/` folder is gitignored), and reports are plain files.

## What Forge currently supports

```text
✓ CLI-first (terminal, SSH, CI friendly)
✓ Local runs, no account
✓ Claude Code transcript import
✓ Generic JSONL event import
✓ Agent / task tracking with parent-child swarm tree
✓ Token tracking and cost estimation (overridable pricing)
✓ Errors, retries, file changes, commits, test/build signals
✓ Terminal, Markdown, HTML and JSON reports
```

Not supported yet: native Codex/Gemini/OpenCode adapters, live capture while
agents run, run-to-run comparison.

## What's next

These are future directions, not current features:

- Native Codex CLI and Gemini CLI adapters
- Live capture via agent hooks (no post-run import step)
- Run-to-run comparison ("was this run better than the last one?")
- Deeper optimization insights as evidence accumulates
- CI integration examples

## Development

```bash
npm install
npm test          # 34/34 tests currently pass
npm run build
npm run demo      # end-to-end: synthetic run -> report
```

TypeScript, zero runtime dependencies. See [CONTRIBUTING.md](CONTRIBUTING.md)
and [RESET.md](RESET.md) for how this project pivoted from an agent harness to
an observability layer.

## License

[MIT](LICENSE)
