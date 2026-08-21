from typing import Any, List
from rich.table import Table


def handle_help(shell: Any, args: List[str]) -> bool:
    """Renders formatted table of all registered slash commands."""
    try:
        table = Table(title="Forge Commands", show_header=True, header_style="bold magenta")
        table.add_column("Command", style="cyan", width=14)
        table.add_column("Description", style="white")

        for cmd in shell.registry.list_commands():
            table.add_row(f"/{cmd.name}", cmd.description)

        shell.console.print(table)
        shell.console.print()
    except Exception:
        print("Forge Commands:")
        for cmd in shell.registry.list_commands():
            print(f"  /{cmd.name:<12} - {cmd.description}")
        print()
    return False


def register_help_command(registry: Any) -> None:
    from forge.cli.commands.registry import SlashCommand
    registry.register(SlashCommand(
        name="help",
        description="Show available commands",
        handler=handle_help
    ))
