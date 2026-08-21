# Forge Development Guide

This guide explains how to set up your environment, add new CLI commands, implement custom providers, and run tests.

---

## 🛠️ Environment Setup

```bash
# Clone the repository
git clone https://github.com/dhruvil-codes/forge.git
cd forge

# Create virtual environment
python -m venv venv

# Activate virtual environment
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

# Install in editable mode with development dependencies
pip install -e ".[dev]"
```

---

## 📁 Codebase Layout

- **`forge/cli/`**: Entrypoint, interactive shell UI, and modular slash command registry (`forge/cli/commands/`).
- **`forge/agent/`**: Agent Orchestrator managing tool execution loops, conversation history, and project memory.
- **`forge/providers/`**: Provider abstractions (OpenAI-compatible API client, vLLM endpoint handler).
- **`forge/router/`**: Model routing architecture.
- **`forge/context/`**: Codebase context builder and repository mapping.
- **`forge/tools/`**: Agent execution tools (File operations, Terminal commands, Git helpers).
- **`tests/`**: Pytest test suite.

---

## ➕ Adding a New CLI Command

1. Create a new handler file in `forge/cli/commands/my_command.py`:
   ```python
   from typing import Any, List

   def handle_my_command(shell: Any, args: List[str]) -> bool:
       shell.console.print("[cyan]My command executed![/cyan]\n")
       return False

   def register_my_command(registry: Any) -> None:
       from forge.cli.commands.registry import SlashCommand
       registry.register(SlashCommand(
           name="mycommand",
           description="Custom developer command",
           handler=handle_my_command
       ))
   ```

2. Register the command inside `create_default_registry()` in `forge/cli/commands/registry.py`.

3. Add a unit test in `tests/test_commands.py`.

---

## ➕ Adding a Provider

1. Extend `BaseProvider` in `forge/providers/base.py`.
2. Implement synchronous `generate()` and streaming `generate_stream()` methods.
3. Integrate provider initialization in `forge/router/model_router.py`.

---

## 🧪 Running Tests

```bash
# Run pytest test suite
python -m pytest

# Run linting check
ruff check forge/ tests/
```
