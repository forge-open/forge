# Forge v2 — Reset Record

**Date:** 2026-08-26
**What changed:** Forge pivoted from *"an agent execution harness"* to:

> **An open-source observability and optimization layer for AI coding-agent swarms.**

Forge no longer runs your agents. You keep using Claude Code, Codex, Gemini CLI,
OpenCode — whoever does the work stays yours. Forge sits alongside and answers,
from evidence: *what ran, what it cost, what it touched, what to change next run.*

Core loop: **OBSERVE → EVALUATE → OPTIMIZE → RUN AGAIN**

## What happened to v1

The v1 Python harness (orchestrator, GLM/Kimi router, providers, tools, Colab/GPU
deploys) implements exactly the "own the runtime" posture this reset removes. Per the
reset instructions it was **not** incrementally patched and **not** deleted: since the
repo had no git history to preserve, the whole product was moved intact to
[`legacy/`](legacy/ARCHIVED.md) with a per-module preservation assessment.

Carried forward from v1: MIT `LICENSE`, an adapted `.gitignore`, and the project-local
`.forge/` state directory convention (now holding run data instead of agent memory).

## v2 architecture (small and modular on purpose)

```
your agents (unchanged)
   │  transcripts / event streams
   ▼
adapters/        vendor-specific → canonical Forge events (one file per vendor)
   ▼
core/events      tiny canonical event model (JSONL)
core/store       append-only run storage in <project>/.forge/runs/<run-id>/
core/metrics     aggregations: agents, tasks, tokens, cost, files, errors
core/insights    rule-based recommendations, each backed by observed evidence
report/          one report, three surfaces: terminal, Markdown, self-contained HTML
cli.ts           forge import | report | show | open | runs
```

Design rules honored by this tree:

- local-first: everything lives under `<project>/.forge/`, no accounts, no network
- vendor-neutral: only `adapters/*` know a vendor's format; core never does
- zero runtime dependencies (Node ≥ 18); dev tooling is TypeScript + tsx + node:test
- the **report is the product**: `forge report` is one command after a normal run
- measurable signals over AI-judged scores; insights cite their evidence or don't fire

Explicit non-goals (per reset): SaaS/billing, teams/RBAC, marketplace, auto model
routing, autonomous optimization, LLM-as-judge, elaborate dashboards.

## Where to look next

- [`README.md`](README.md) — using Forge v2
- `src/core/events.ts` — the canonical event model
- `src/adapters/claude-code.ts` — how vendor data becomes events today
