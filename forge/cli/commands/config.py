from typing import Any, List
from rich.table import Table


def handle_config(shell: Any, args: List[str]) -> bool:
    """Displays Forge configuration settings."""
    cfg = shell.orchestrator.config
    try:
        table = Table(title="Forge Configuration", show_header=True, header_style="bold yellow")
        table.add_column("Setting", style="bold white", width=22)
        table.add_column("Value", style="cyan")

        table.add_row("Base URL", cfg.base_url)
        table.add_row("Model Key", cfg.model or "Default (Qwen3.8 27B FP8)")
        table.add_row("Temperature", str(cfg.temperature))
        table.add_row("Max Tokens", str(cfg.max_tokens))
        table.add_row("Safe Mode", "Enabled" if cfg.safe_mode else "Disabled")
        table.add_row("Primary Model", cfg.primary_model)
        table.add_row("Secondary Model", cfg.secondary_model)

        shell.console.print(table)
        shell.console.print()
    except Exception:
        print(f"Forge Config:\n  Base URL: {cfg.base_url}\n  Model: {cfg.model}\n")

    return False


def register_config_command(registry: Any) -> None:
    from forge.cli.commands.registry import SlashCommand
    registry.register(SlashCommand(
        name="config",
        description="Show Forge configuration",
        handler=handle_config
    ))
