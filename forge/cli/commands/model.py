from typing import Any, List
from rich.table import Table
from rich.panel import Panel


def handle_model(shell: Any, args: List[str]) -> bool:
    """Handles /model command: displays current active model details or changes active model if argument provided."""
    if args:
        new_model = args[0]
        shell.orchestrator.router.set_active_model(new_model)
        shell.orchestrator.config.model = new_model
        try:
            shell.console.print(f"[bold green]✓ Active model set to:[/bold green] [bold white]{new_model}[/bold white]\n")
        except Exception:
            print(f"✓ Active model set to: {new_model}\n")
        return False

    shell.print_model_info()
    return False


def handle_models(shell: Any, args: List[str]) -> bool:
    """Handles /models command: queries GET /v1/models and displays available models table."""
    health = shell.orchestrator.check_server_status()
    active_model_id = shell.orchestrator.get_active_model_name()
    detected_models = health.get("models", [])

    if not detected_models and active_model_id:
        detected_models = [active_model_id]

    try:
        table = Table(title="Available Models", show_header=True, header_style="bold cyan")
        table.add_column("Model", style="bold white", width=30)
        table.add_column("Status", style="green", width=14)
        table.add_column("Context", style="yellow", width=12)

        if not detected_models:
            table.add_row("Qwen3.8 27B FP8", "● Offline", "16,384")
        else:
            for m_id in detected_models:
                display_name = shell.format_model_display_name(m_id)
                is_active = (m_id == active_model_id or display_name == shell.format_model_display_name(active_model_id))
                status_str = "● Active" if is_active else "○ Available"
                context_len = f"{shell.orchestrator.config.max_tokens * 8:,}" if hasattr(shell.orchestrator.config, "max_tokens") else "16,384"
                table.add_row(display_name, status_str, context_len)

        shell.console.print(table)
        shell.console.print()
    except Exception:
        print("Available Models:")
        for m_id in (detected_models or ["Qwen3.8 27B FP8"]):
            print(f"  - {m_id}")
        print()

    return False


def register_model_commands(registry: Any) -> None:
    from forge.cli.commands.registry import SlashCommand
    registry.register(SlashCommand(
        name="model",
        description="Show or change active model",
        handler=handle_model,
        accepts_args=True
    ))
    registry.register(SlashCommand(
        name="models",
        description="List available models",
        handler=handle_models
    ))
