from typing import Any

from rich.table import Table


def handle_memory(shell: Any, args: list[str]) -> bool:
    """Displays project memory state and recorded tasks."""
    mem = shell.orchestrator.memory
    tasks = mem.get_recorded_tasks() if hasattr(mem, "get_recorded_tasks") else getattr(mem, "tasks", [])

    try:
        table = Table(title="Project Memory", show_header=True, header_style="bold cyan")
        table.add_column("Index", style="dim white", width=8)
        table.add_column("Task Summary", style="bold white", width=30)
        table.add_column("Result / Notes", style="yellow")

        if not tasks:
            table.add_row("1", "Session Memory Initialized", "No past tasks recorded yet.")
        else:
            for idx, item in enumerate(tasks, 1):
                prompt = item.get("prompt", "") if isinstance(item, dict) else str(item)
                summary = item.get("summary", "") if isinstance(item, dict) else ""
                table.add_row(str(idx), prompt[:30], summary[:50])

        shell.console.print(table)
        shell.console.print()
    except Exception:
        print(f"Project Memory: {len(tasks)} items recorded.\n")

    return False


def register_memory_command(registry: Any) -> None:
    from forge.cli.commands.registry import SlashCommand
    registry.register(SlashCommand(
        name="memory",
        description="Show current project memory state",
        handler=handle_memory
    ))
