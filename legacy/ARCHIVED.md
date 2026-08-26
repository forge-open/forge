# Forge v1 (archived)

This directory contains the **original Forge harness**, archived verbatim on 2026-08-26
during the Forge v2 reset. The repository was not under version control at the time of
the reset, so nothing was deleted — the entire old product was moved here intact
(only `__pycache__`/`.pytest_cache` build artifacts were dropped; they are regenerable).
`README.md` below is v1's original readme, kept as part of the archive.

## What this was

Forge v1 (`forge-ai` 0.1.0) was a personal-first **AI coding-agent harness** for
self-hosted open-weight models (GLM 5.2 primary / Kimi K2.5 secondary) served through
OpenAI-compatible endpoints (vLLM/SGLang on Colab or cloud GPUs). It shipped an
interactive CLI/REPL, a tool loop, a model router, a two-model "collaborative review"
workflow, repo context building, project memory, and GPU deployment guides.

That direction — Forge as an agent runtime/harness — is retired. See `../RESET.md`.

## Layout

| Path | What it is |
|---|---|
| `forge/cli/` | argparse entrypoint + interactive REPL shell |
| `forge/agent/` | `AgentOrchestrator` (tool loop), system prompts for GLM/Kimi roles |
| `forge/router/` | Model routing between primary (GLM 5.2) and secondary (Kimi K2.5) |
| `forge/providers/` | OpenAI-compatible chat-completions client abstraction |
| `forge/tools/` | File / terminal / git tools with safe-mode confirmation |
| `forge/context/` | Repository map, file selection, token-efficient context builder |
| `forge/memory/` | Project memory persisted in `.forge/state.json` |
| `forge/git/`, `forge/config/`, `forge/utils/` | Git helpers, YAML config loader, Drive "Model Vault", logger |
| `deploy/` | Colab notebook + local/cloud GPU deployment guides, Modal smoke test |
| `configs/` | Default YAML config; `models.json` manifest of quantized checkpoints |
| `benchmarks/` | Endpoint latency/token-throughput benchmark runner |
| `tests/` | Pytest suite for the harness units |
| `harness-state/` | The old `.forge/` runtime state captured at archive time |

## Preservation assessment

Inspected before archiving, per the reset instructions. Verdict per area:

- **Nothing here implements events, tracing, runs, cost accounting, or reporting** —
  the entire codebase is agent-runtime concerns, which v2 explicitly does not own.
  No module was ported wholesale.
- **Kept at repo root:** `LICENSE` (MIT) and an adapted `.gitignore`.
- **Kept as a convention:** the project-local `.forge/` state directory. v1 used it for
  agent memory; v2 uses it for run data (`.forge/runs/<run-id>/…`). Keeping Forge state
  local to the project was a good idea and survives.
- **Potentially useful later (left untouched here):**
  - `forge/context/repository_map.py` + `file_selector.py` — if v2 ever needs to detect
    *which* repo areas agents worked on, this repo-mapping approach is a reference.
  - `configs/models.json` — example of a declarative model-manifest pattern.
  - `forge/providers/base.py` — clean provider-interface shape, though v2's adapters
    face *transcripts/events*, not inference APIs.
- **Not useful going forward:** orchestrator/router/prompts/tools/deploy/benchmarks —
  they implement exactly the "own the runtime" posture the reset removes.

To run v1 as it was: `cd legacy && pip install -e . && pytest`.
