# Forge

**Your agents are working. Forge tells you how well.**

Forge is an open-source, local-first **observability and optimization layer for AI
coding-agent swarms**. You keep using Claude Code, Codex, Gemini CLI, OpenCode —
whoever does the work stays yours. Forge sits alongside, captures what happened,
and produces one clear report:

```text
FORGE RUN — 5 agents · 12 tasks · 2.1M tokens · $14.08 estimated · 1h 52m

9 succeeded · 2 partial · 1 failed
[!] subagent:frontend#1 used 31% of tokens but completed only 8% of successful tasks
[!] claude-main and codex-bot both modified src/api/client.ts (possible duplicated work)
[i] 12 tasks ran with zero test activity
```

The core loop: **OBSERVE → EVALUATE → OPTIMIZE → RUN AGAIN**

---

## Why

Running multiple AI coding agents in parallel means losing sight of the swarm:
which tasks succeeded, which agents burned tokens without shipping, where work was
duplicated, how much the run cost, and what to change next time. Forge answers that
from recorded evidence — not vibes.

Forge is **CLI-first**: the primary experience happens in your terminal, next to
your existing agent workflow. No dashboard to babysit — `forge report` prints the
run summary directly (works over SSH and CI), `--verbose` goes deeper, and
`--json` emits the machine-readable report for scripts and pipelines. A static
self-contained `report.html` is also written for those who want to share it.

Forge is **not** another coding agent, model runner, tracing SaaS, or framework.
It owns measurement, not your runtime. It never sends your code anywhere: runs are
stored under `<project>/.forge/` and reports are plain files.

## Quick start

Requires Node ≥ 18.

```bash
git clone https://github.com/forge-open/forge && cd forge
npm install && npm run build && npm link     # installs the `forge` command
```

**Zero setup — see a full report in 10 seconds** (synthetic multi-agent swarm):

```bash
forge demo
```

**Claude Code users** — after working normally with Claude Code in this project:

```bash
forge init                # once per project
forge import claude       # imports your most recent session transcript
forge report              # terminal report + report.md + report.html
forge report --verbose    # adds task table, file overlap, engineering signals
forge report --json       # machine-readable output for scripts / CI
```

No hooks, no wrappers — Forge reads the session transcripts Claude Code already
writes locally (`~/.claude/projects/`).

**Any other agent** — emit Forge's canonical event lines and import them:

```bash
forge import jsonl .forge/my-session.jsonl
forge report
```

See [`docs/events.md`](docs/events.md) for the schema (a dozen event kinds,
agent parent/child links, token records). One small emitter function is all the
integration an agent needs.

## What the report tells you

| Section | Answers |
|---|---|
| Run overview | How many agents/tasks, duration, tokens, estimated cost, outcomes |
| Findings | Rule-based insights, each citing its observed evidence |
| Agents | Per-agent tasks, success rate, tokens/cost, tools, errors/retries, swarm tree |
| Tasks | Status, owner, duration, tokens, cost per unit of work |
| Files | What was touched by whom — overlap flags possible duplicated work |
| Engineering signals | Tests, builds/typechecks, commits, retries, errors |

Two hard rules baked into every surface:

1. **Observed facts and suggestions are visually separated.** Facts come from
   events; recommendations are rule-based inferences, labeled as such.
2. **Costs are estimates** from built-in public list prices (approximate), matched
   by model-id prefix. Override or extend in `.forge/prices.json`; unknown models
   render as unknown rather than invented numbers.

## Architecture

```text
your agents (unchanged)
   │  transcripts / event streams
   ▼
src/adapters/      vendor-specific → canonical ForgeEvent[] (claude-code, generic jsonl)
src/core/          events.ts (validation) · analyze.ts (aggregation + insights)
                   cost.ts (pricing abstraction, override-aware) · store.ts (.forge/runs/)
src/report/        terminal.ts · markdown.ts · html.ts (one self-contained file, offline)
src/cli.ts         forge import | report | show | runs | open | demo
```

- **Local-first:** everything lives in `.forge/`, no accounts, no network.
- **Vendor-neutral:** only adapters know vendor formats; core never does.
- **Small on purpose:** TypeScript, zero runtime dependencies, ~a dozen modules.
- **Honest:** deterministic signals over AI-judged scores; silence when evidence
  is too thin for an insight.

## Roadmap

Near term, in order: Codex CLI adapter · Gemini CLI adapter · live capture via
agent hooks (no post-run import step) · evaluator slots for custom deterministic
signals · optional run diffing ("was this run better than last one?").

Explicit non-goals: SaaS/billing, teams/RBAC, marketplace, autonomous optimization,
LLM-as-judge, dashboards-for-the-sake-of-dashboards.

## Project history

This repository previously contained an AI coding-agent harness (v0.x). That
direction was retired and archived intact — see [`RESET.md`](RESET.md) and
[`legacy/ARCHIVED.md`](legacy/ARCHIVED.md); git tag `v1-archive` preserves the old tip.

## Contributing & license

Issues and PRs welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md).
MIT — see [`LICENSE`](LICENSE).
