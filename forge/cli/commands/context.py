import os
from typing import Any

from rich.table import Table


def handle_context(shell: Any, args: list[str]) -> bool:
    """Displays current repository context summary."""
    cwd = os.getcwd()
    git_branch = shell.orchestrator.git.get_current_branch() or "main"
    root_files = [f for f in os.listdir(cwd) if not f.startswith(".")]

    try:
        table = Table(title="Repository Context", show_header=True, header_style="bold cyan")
        table.add_column("Property", style="bold white", width=20)
        table.add_column("Value", style="yellow")

        table.add_row("Working Directory", cwd)
        table.add_row("Git Branch", git_branch)
        table.add_row("Root Items", f"{len(root_files)} files/folders")
        table.add_row("Active System Prompt", shell.orchestrator.config.system_prompt[:60] + "...")

        shell.console.print(table)
        shell.console.print()
    except Exception:
        print(f"Repository Context:\n  CWD: {cwd}\n  Git Branch: {git_branch}\n")

    return False


def register_context_command(registry: Any) -> None:
    from forge.cli.commands.registry import SlashCommand
    registry.register(SlashCommand(
        name="context",
        description="Show current repository context",
        handler=handle_context
    ))
