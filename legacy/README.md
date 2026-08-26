# Forge 🛠️

**Forge** is a personal-first, open-source AI coding harness and interactive CLI built for open weight models. It enables developers to host and run state-of-the-art open-weight models (such as **GLM 5.2** and **Kimi K2.5**) on their own GPU hardware, Google Colab, or cloud GPU providers (RunPod, Lambda, Vast.ai).

> **Note on Model Hosting:** Forge allows users to bring their own GPU infrastructure (local or remote) to host open-weight inference endpoints via OpenAI-compatible APIs (vLLM / SGLang). Forge does not bundle hosted API services.

---

## 🌟 Key Features

1. **Dual Model Vault Strategy**:
   - **GLM 5.2** (Primary Model): Code writing, reasoning, debugging, and long-horizon software development.
   - **Kimi K2.5** (Secondary Model): Code review, second opinions, alternative architectures, and automated model collaboration.
2. **Model Collaboration (`forge --review`)**:
   - Automated workflow where GLM 5.2 builds features and Kimi K2.5 reviews diffs and provides critical feedback before final verification.
3. **Decoupled Architecture**:
   - Core agent is provider-agnostic and talks to any standard OpenAI-compatible API endpoint (`/v1/chat/completions`).
4. **Google Drive & Colab Infrastructure**:
   - Google Drive persistent Model Vault (`AI Model Vault/models/...`) to store quantized checkpoints safely without re-downloading across sessions.
   - Automated GPU, VRAM, CUDA, PyTorch, and RAM hardware compatibility auditing.
5. **Safe & Autonomous Execution Modes**:
   - **Safe Mode (Default)**: Explicit user confirmation required before running terminal commands, deleting files, or modifying git history.
   - **Auto Mode (`--auto`)**: Autonomous agent mode for trusted local sandboxes.
6. **Smart Context Builder**:
   - Selective repository mapping, file selection, dependency tracing, and diff evaluation to construct minimal, token-efficient prompt contexts.

---

## 🏗️ Architecture Overview

```
User Input
    │
    ▼
┌──────────────┐
│  Forge CLI   │  (Interactive REPL & Commands)
└──────┬───────┘
       │
       ▼
┌──────────────────────┐
│ Agent Orchestrator   │  (Tool loop, plan, context & project memory)
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│    Model Router      │  (Routes tasks: Primary vs Secondary vs Collab)
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│ Provider Interface   │  (OpenAI Compatible API client)
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│ Remote/Local Server  │  (vLLM / SGLang on Google Colab or Cloud GPU)
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│ GLM 5.2 / Kimi K2.5  │  (Open Weight Checkpoints)
└──────────────────────┘
```

---

## 📂 Repository Structure

```
forge/
├── README.md
├── LICENSE
├── CONTRIBUTING.md
├── .env.example
├── pyproject.toml
├── forge/
│   ├── cli/             # Interactive shell & CLI entrypoint
│   ├── agent/           # Agent orchestrator & prompt templates
│   ├── router/          # Model router (GLM vs Kimi routing)
│   ├── providers/       # Generic OpenAI-compatible provider abstraction
│   ├── tools/           # File, terminal, testing & git agent tools
│   ├── memory/          # Persistent project state & memory (.forge/)
│   ├── context/         # Repo mapping & context selection
│   ├── git/             # Git workflow utilities
│   ├── config/          # Configuration & environment loader
│   └── utils/           # Drive Model Vault & logger
├── deploy/
│   ├── colab/           # Google Colab notebooks & deployment scripts
│   ├── local/           # Local GPU deployment documentation
│   └── cloud/           # Cloud GPU deployment guides
├── configs/             # Default yaml configs & models.json manifest
├── benchmarks/          # Performance benchmarks & timing suite
└── tests/              # Pytest test suite
```

---

## ⚡ Quick Start

### 1. Installation

```bash
# Clone repository
git clone https://github.com/yourusername/forge.git
cd forge

# Install in editable mode
pip install -e .
```

### 2. Configuration

Copy `.env.example` to `.env` or set up `~/.forge/config.yaml`:

```yaml
primary_model: glm

models:
  glm:
    name: GLM-5.2
    provider: openai-compatible
    base_url: http://localhost:8000/v1
    api_key: local-key

  kimi:
    name: Kimi-K2.5
    provider: openai-compatible
    base_url: http://localhost:8001/v1
    api_key: local-key
```

### 3. Usage

```bash
# Start interactive shell (default model: GLM 5.2)
forge

# Target specific primary or secondary models
forge --model glm
forge --model kimi

# Run collaborative code review workflow
forge --review

# Run in autonomous mode (bypass tool confirmation prompts)
forge --auto
```

---

## 🚀 Google Colab Deployment Workflow

To deploy inference endpoints on Google Colab:

1. Open `deploy/colab/setup.ipynb`.
2. Connect your Google Drive (`AI Model Vault/`).
3. Run `hardware_check.py` to inspect GPU VRAM, CUDA version, RAM, and disk space.
4. Run `model_check.py` to evaluate GLM 5.2 / Kimi K2.5 checkpoint VRAM fit.
5. Confirm model download to Google Drive.
6. Launch vLLM / SGLang server using `start_server.py`.
7. Configure `GLM_ENDPOINT` in your local `.env`.

---

## 🛡️ Safety & Execution Modes

Forge runs in **Safe Mode** by default. Any file deletion, package installation, destructive shell command, or git push requires interactive confirmation. Use `--auto` for isolated local sandboxes.

---

## 🧪 Benchmarking

Run standard latency, token throughput, and memory benchmarks:

```bash
python -m benchmarks.benchmark_runner
```

---

## 📜 License

Licensed under the [MIT License](LICENSE).
