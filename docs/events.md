# Forge Event Schema

Forge's core is a tiny, vendor-neutral event model. Everything a run report says is
derived from these events — nothing else.

```text
your agent(s)
   │  transcripts / event streams
   ▼
adapter  →  ForgeEvent JSONL  →  forge analyze  →  RunReport  →  terminal / md / html
```

## Format

One JSON object per line (JSONL), UTF-8:

```json
{"ts":"2026-08-26T09:14:03.120Z","kind":"task_started","agentId":"claude-main","taskId":"t1","taskTitle":"Fix login bug"}
{"ts":"2026-08-26T09:15:10.000Z","kind":"token_usage","agentId":"claude-main","taskId":"t1","model":"claude-sonnet-4-5","tokens":{"input":4200,"output":950,"cacheRead":3100}}
{"ts":"2026-08-26T09:16:44.900Z","kind":"tool_called","agentId":"subagent:Explore#1","parentAgentId":"claude-main","tool":"Edit","toolCallId":"call_01","files":["src/auth/login.ts"]}
```

Required: `ts` (ISO-8601; epoch numbers also accepted) and `kind`.
Everything else is optional and validated leniently — unknown fields are dropped,
unknown kinds are warned about, malformed lines never abort an import.

## Kinds

| kind | meaning | notable fields |
|---|---|---|
| `run_started` / `run_finished` | run boundaries | `status` |
| `agent_started` / `agent_finished` | an agent enters/leaves the swarm | `agentId`, `agentName`, `parentAgentId` (spawned sub-agent), `status` |
| `task_started` / `task_finished` | a unit of work opens/closes | `taskId`, `taskTitle`, `agentId`, `status: success/failure/partial` |
| `tool_called` / `tool_finished` | tool invocation + outcome (pair via `toolCallId`) | `tool`, `durationMs`, `status` |
| `token_usage` | one provider usage record | `model`, `tokens {input, output, cacheRead, cacheWrite}` |
| `error` | observed failure | sanitized `error` text |
| `retry` | retry signal (e.g. provider/API error) | sanitized `error` |
| `file_changed` | file written/edited | `files[]` |
| `commit_created` | VCS commit observed | `note` |
| `test_started` / `test_finished` | test-run activity | `status` |
| `build_started` / `build_finished` | build/typecheck activity | `status` |
| `note` | anything else worth recording | short factual `note` |

## Conventions

- **Agent identity:** stable `agentId` within the run (`"claude-main"`,
  `"subagent:Explore#1"`). Sub-agents point at their spawner via `parentAgentId`,
  which builds the swarm tree in the report.
- **Privacy:** events carry metadata, not content. Free-text fields (`taskTitle`,
  `error`, `note`) must stay short and are scrubbed of secret-shaped strings.
  Raw prompts/completions/commands are never stored.
- **Costs:** Forge estimates cost from `model` + `tokens` using built-in public list
  prices (approximate). Provide exact figures with `costUsd` or override pricing in
  `.forge/prices.json`. Estimates are always labeled as estimates.

## Integrating your agent

Point any tool at this schema and import with `forge import jsonl <file>`:

1. Emit one line per meaningful step to `<project>/.forge/<session>.jsonl`.
2. When the run ends: `forge import jsonl .forge/<session>.jsonl && forge report`.

Adapters shipped today:

- **Claude Code** (`src/adapters/claude-code.ts`) — reads local session transcripts
  from `~/.claude/projects/…` directly; no hooks needed.
- **Generic JSONL** (above) — the integration boundary for every other agent
  (Codex CLI, Gemini CLI, OpenCode, custom harnesses).
