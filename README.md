# Forge 🛠️

An open source AI coding agent that intelligently routes tasks across models and runs on your local GPU, cloud infrastructure, or your own API.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python 3.9+](https://img.shields.io/badge/python-3.9%2B-blue.svg)](pyproject.toml)
[![Version 0.2.0](https://img.shields.io/badge/version-0.2.0-cyan.svg)](pyproject.toml)
[![CI](https://github.com/forge-open/forge/actions/workflows/tests.yml/badge.svg)](https://github.com/forge-open/forge/actions/workflows/tests.yml)

```text
╭──────────────────────────────────────────────╮
│                                              │
│   ███████╗ ██████╗ ██████╗  ██████╗ ███████╗ │
│   ██╔════╝██╔═══██╗██╔══██╗██╔════╝ ██╔════╝ │
│   █████╗  ██║   ██║██████╔╝██║  ███╗█████╗   │
│   ██╔══╝  ██║   ██║██╔══██╗██║   ██║██╔══╝   │
│   ██║     ╚██████╔╝██║  ██║╚██████╔╝███████╗ │
│   ╚═╝      ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝ │
│                                              │
│        ⚡ AI CODING AGENT                    │
│        Qwen3.8 27B FP8  •  vLLM             │
│                                              │
╰──────────────────────────────────────────────╯
```

---

## 💡 Why Forge Exists

Open-weight foundation models have reached state-of-the-art software engineering capabilities. However, developers running open-weight models on local workstations or cloud GPU instances often lack a refined, responsive command-line interface tailored for interactive coding workflows.

Forge bridges this gap by providing:
- **Modern Terminal UX**: Bordered dynamic input boxes, floating slash command palettes, non-blocking thinking indicators, live streaming markdown rendering with code syntax highlighting, and real-time inference performance metrics.
- **Provider Agnostic Engine**: Connects to any standard OpenAI-compatible `/v1/chat/completions` endpoint with dynamic model discovery (`/v1/models`).
- **Bring Your Own Compute (BYOC)**: Host your models on your own hardware, cloud instances, or remote GPU studios without lock-in.
- **Developer Safety**: Safe execution mode requiring explicit user confirmation before executing shell commands or altering local repository state.

---

## 🏗️ Architecture

```mermaid
graph TD
    User([User / Terminal]) --> CLI[Forge CLI Shell]
    CLI --> UI[Bordered Input Box & prompt_toolkit Menu]
    CLI --> CmdReg[SlashCommandRegistry]
    CmdReg --> CoreCmds[/help, /status, /model, /models, /context...]
    CLI --> Orchestrator[Agent Orchestrator]
    Orchestrator --> Tools[Tools: Files, Terminal, Git, Tests]
    Orchestrator --> Memory[Project Memory & ConversationManager]
    Orchestrator --> Router[Model Router]
    Router --> Provider[OpenAICompatibleProvider]
    Provider --> Endpoint[OpenAI-Compatible /v1 API]
    Endpoint --> Backend[vLLM / SGLang / Ollama Server]
    Backend --> Model[Open-Weight Model: Qwen3.8 27B FP8 / GLM 5.2]
```

---

## ⚡ How Forge Works

Forge acts as an agentic harness between your workspace and an inference backend:
1. **Context & Intent**: Captures your terminal prompt and builds a minimal, token-efficient repository context.
2. **Streaming Execution**: Streams tokens in real-time inside a formatted Rich response panel with syntax-highlighted code blocks.
3. **Performance Auditing**: Audits Time To First Token (TTFT), total generation duration, token counts, and decode speed (tok/s).
4. **Tool Loop Integration**: Interacts safely with local workspace tools (file editing, terminal commands, test runners, git status).

---

## 📊 CURRENT vs. ROADMAP

### CURRENT (v0.2.0)
- [x] **OpenAI Compatible API Client**: Generic `/v1` provider supporting vLLM, SGLang, Ollama, and Cloud endpoints.
- [x] **Dynamic Model Discovery**: Queries `GET /v1/models` automatically to detect active backend models.
- [x] **Modern Terminal UX**: Bordered prompt input box, non-blocking thinking status indicator (`✦ Forge is thinking...`), live markdown streaming panel, and inference metrics (`⚡ 0.067s TTFT · 13.7s total · 18.7 tok/s · 256 tokens`).
- [x] **Slash Command System**: Interactive floating autocomplete menu (`/help`, `/status`, `/model`, `/models`, `/context`, `/files`, `/git`, `/history`, `/clear`, `/new`, `/config`, `/doctor`, `/version`, `/exit`).
- [x] **Conversation & Memory**: ConversationManager maintaining multi-turn context and persistent session memory.
- [x] **Workspace Tools**: Safe file editing, command execution, test runner, git diff/status tools.
- [x] **Offline Test Suite**: 41 passing unit tests running purely offline with mocks.

### ROADMAP
- [ ] **Intelligent Model Routing**: Dynamic task dispatching between primary coding models and secondary reviewer models.
- [ ] **Model Registry**: Built-in catalog of recommended open-weight checkpoints and quantization profiles.
- [ ] **One-Command Model Installation**: Automated local/remote setup scripts for vLLM & SGLang servers.
- [ ] **Automatic GPU & Hardware Detection**: Auditing local VRAM, CUDA capability, and throughput.
- [ ] **Local Model Management**: Launching and managing background model servers directly from Forge.
- [ ] **Forge Cloud Integration**: Optional managed infrastructure for team deployments.

---

## 🖥️ Local & Remote Backend Setup

### Option A: Remote vLLM (Cloud GPU / SSH Tunnel)

If your model (e.g. `Qwen3.8 27B FP8`) is hosted on a remote cloud GPU (NVIDIA L40S 48GB):

1. **Launch vLLM on Remote GPU**:
   ```bash
   python -m vllm.entrypoints.openai.api_server \
       --model /path/to/qwen3.8-27b-fp8 \
       --port 8000
   ```

2. **Establish SSH Tunnel**:
   ```bash
   ssh -L 8000:localhost:8000 user@remote-gpu-host
   ```

3. **Configure Forge**:
   Set environment variables or edit `~/.forge/config.yaml`:
   ```yaml
   base_url: "http://localhost:8000/v1"
   model: "qwen3.8-27b-fp8"
   temperature: 0.1
   max_tokens: 2048
   safe_mode: true
   ```

### Option B: Local GPU (Ollama / vLLM / Local Server)

```bash
# Ollama
ollama run qwen2.5-coder

# Configure Forge to point to local server
forge --base-url http://localhost:11434/v1
```

---

## 📥 Installation & Quick Start

```bash
# 1. Clone repository
git clone https://github.com/forge-open/forge.git
cd forge

# 2. Install Forge CLI in editable mode
pip install -e ".[dev]"

# 3. Start interactive shell
forge

# Target specific base URL or model ID
forge --base-url http://localhost:8000/v1 --model qwen3.8-27b-fp8

# Execute a single prompt non-interactively
forge "Write a Python function to reverse a string"
```

---

## ⌨️ Slash Commands

Type `/` inside the interactive shell to trigger the interactive command palette:

```text
╭─ Commands ────────────────────────────────────────────────────╮
│ › /help       Show available commands                         │
│   /models     List available models                           │
│   /model      Show or change active model                    │
│   /status     Check backend and GPU connection               │
│   /context    Show current repository context                │
│   /files      Inspect repository files                       │
│   /git        Git status and repository information            │
│   /history    Show conversation history                       │
│   /clear      Clear conversation                              │
│   /new        Start a new conversation                         │
│   /config     Show Forge configuration                         │
│   /doctor     Diagnose Forge setup                            │
│   /version    Show Forge version                              │
│   /exit       Exit Forge                                      │
╰───────────────────────────────────────────────────────────────╯
```

---

## 🧪 Development Setup & Testing

All unit tests use mocks and do **not** require access to a live model or GPU:

```bash
# Run pytest suite
python -m pytest

# Run ruff linting
ruff check forge/ tests/
```

---

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details on code style, structure, and submission guidelines.

Please review our [Code of Conduct](CODE_OF_CONDUCT.md) and [Security Policy](SECURITY.md).

---

## 📜 License

Licensed under the [MIT License](LICENSE).
