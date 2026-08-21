from typing import Any


def handle_status(shell: Any, args: list[str]) -> bool:
    """Executes server status check and renders backend details."""
    shell.print_status()
    return False


def register_status_command(registry: Any) -> None:
    from forge.cli.commands.registry import SlashCommand
    registry.register(SlashCommand(
        name="status",
        description="Check backend and GPU connection",
        handler=handle_status
    ))
