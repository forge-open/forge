import os
from typing import Any

import yaml


def handle_init(shell: Any, args: list[str]) -> bool:
    """Initializes Forge configuration directory and files for current workspace."""
    cwd = os.getcwd()
    forge_dir = os.path.join(cwd, ".forge")
    config_file = os.path.join(forge_dir, "config.yaml")

    os.makedirs(forge_dir, exist_ok=True)

    if not os.path.exists(config_file):
        default_cfg = {
            "base_url": shell.orchestrator.config.base_url,
            "model": shell.orchestrator.config.model or "qwen3.8-27b-fp8",
            "temperature": shell.orchestrator.config.temperature,
            "max_tokens": shell.orchestrator.config.max_tokens,
            "safe_mode": shell.orchestrator.config.safe_mode,
        }
        with open(config_file, "w", encoding="utf-8") as f:
            yaml.dump(default_cfg, f, default_flow_style=False)
        msg = f"✓ Initialized Forge configuration at {config_file}"
    else:
        msg = f"✓ Forge configuration already exists at {config_file}"

    try:
        shell.console.print(f"[bold green]{msg}[/bold green]\n")
    except Exception:
        print(f"{msg}\n")

    return False


def register_init_command(registry: Any) -> None:
    from forge.cli.commands.registry import SlashCommand
    registry.register(SlashCommand(
        name="init",
        description="Initialize Forge configuration for current workspace",
        handler=handle_init
    ))
