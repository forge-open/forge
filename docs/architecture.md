# Forge Architecture Overview

Forge is designed as a modular, provider-decoupled AI coding harness and CLI for open-weight models (such as Qwen3.8 27B FP8, GLM 5.2, and Kimi K2.5).

```
 ┌─────────────────────────────────────────────────────────────┐
 │                      User Input (CLI)                       │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │                 Forge Shell & UI Layer                      │
 │   • prompt_toolkit Interactive Input & Slash Palette        │
 │   • Rich Live Streaming Panel & Metrics Formatter           │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │                    SlashCommandRegistry                     │
 │   • /help, /status, /model, /models, /context, /files...    │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │                   Agent Orchestrator                        │
 │   • Tool Execution Registry (Files, Terminal, Git)         │
 │   • ConversationManager & Project Memory                    │
 │   • Context Builder                                         │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │                 OpenAICompatibleProvider                    │
 │   • Dynamic Model Discovery (/v1/models)                    │
 │   • Streaming Response Generator (/v1/chat/completions)     │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │             Remote vLLM / SGLang Backend                    │
 │   • SSH Tunnel → Remote GPU (e.g. NVIDIA L40S 48GB)         │
 └─────────────────────────────────────────────────────────────┘
```

## Key Layers

1. **CLI Layer (`forge.cli`)**:
   - `main.py`: Entrypoint CLI callback using Typer.
   - `shell.py`: Interactive REPL loop, bordered input box, slash autocomplete menu, thinking state, streaming panels, and metrics.
   - `commands/`: Modular slash command system.

2. **Agent Orchestrator (`forge.agent`)**:
   - Manages execution loops, conversation history, memory persistence, context selection, and agent tools.

3. **Providers & Router (`forge.providers`, `forge.router`)**:
   - Standardized interface for any OpenAI-compatible API endpoint (`/v1/chat/completions`).
   - Dynamic model detection from `/v1/models`.

4. **Tools (`forge.tools`)**:
   - Safe workspace operations: `ReadFileTool`, `WriteFileTool`, `EditFileTool`, `RunCommandTool`, `RunTestsTool`, `GitStatusTool`, `GitDiffTool`, `GitLogTool`.
