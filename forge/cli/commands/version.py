from typing import Any, List

FORGE_VERSION = "0.2.0"


def handle_version(shell: Any, args: List[str]) -> bool:
    """Displays current Forge CLI version."""
    try:
        shell.console.print(f"[bold cyan]Forge AI Coding CLI[/bold cyan] [bold white]v{FORGE_VERSION}[/bold white]\n")
    except Exception:
        print(f"Forge AI Coding CLI v{FORGE_VERSION}\n")
    return False


def register_version_command(registry: Any) -> None:
    from forge.cli.commands.registry import SlashCommand
    registry.register(SlashCommand(
        name="version",
        description="Show Forge version",
        handler=handle_version
    ))
