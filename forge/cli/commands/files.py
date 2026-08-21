import os
from typing import Any, List
from rich.table import Table


def handle_files(shell: Any, args: List[str]) -> bool:
    """Lists files and directories in current working directory."""
    cwd = os.getcwd()
    try:
        entries = sorted(os.listdir(cwd))
        table = Table(title=f"Files in {os.path.basename(cwd)}", show_header=True, header_style="bold blue")
        table.add_column("Type", style="cyan", width=10)
        table.add_column("Name", style="white")

        for name in entries:
            if name.startswith("."):
                continue
            full_path = os.path.join(cwd, name)
            is_dir = os.path.isdir(full_path)
            type_str = "[folder] dir" if is_dir else "file"
            table.add_row(type_str, name)

        shell.console.print(table)
        shell.console.print()
    except Exception as e:
        print(f"Files in {cwd}: {e}\n")

    return False


def register_files_command(registry: Any) -> None:
    from forge.cli.commands.registry import SlashCommand
    registry.register(SlashCommand(
        name="files",
        description="Inspect repository files",
        handler=handle_files
    ))
