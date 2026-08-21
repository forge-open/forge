from typing import Any, List
from rich.table import Table


def handle_git(shell: Any, args: List[str]) -> bool:
    """Displays git repository status and recent commit information."""
    git_mgr = shell.orchestrator.git
    branch = git_mgr.get_current_branch() or "Unknown / Not a Git repository"
    status_summary = git_mgr.get_status_summary()

    try:
        table = Table(title="Git Repository Status", show_header=True, header_style="bold green")
        table.add_column("Property", style="bold white", width=18)
        table.add_column("Details", style="yellow")

        table.add_row("Branch", branch)
        table.add_row("Status", status_summary if status_summary else "Clean working directory")

        shell.console.print(table)
        shell.console.print()
    except Exception:
        print(f"Git Status:\n  Branch: {branch}\n  Status: {status_summary}\n")

    return False


def register_git_command(registry: Any) -> None:
    from forge.cli.commands.registry import SlashCommand
    registry.register(SlashCommand(
        name="git",
        description="Git status and repository information",
        handler=handle_git
    ))
