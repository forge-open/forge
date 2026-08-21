import os
import sys
from typing import Any

from rich.table import Table


def handle_doctor(shell: Any, args: list[str]) -> bool:
    """Runs diagnostics on Python environment, dependencies, configuration, and backend connection."""
    health = shell.orchestrator.check_server_status()
    reachable = health.get("reachable", False)

    try:
        table = Table(title="Forge Doctor Diagnostics", show_header=True, header_style="bold green")
        table.add_column("Check Component", style="bold white", width=24)
        table.add_column("Status", style="bold", width=14)
        table.add_column("Details", style="dim white")

        # Python version check
        py_ver = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
        table.add_row("Python Version", "[green]✓ PASS[/green]", f"Python {py_ver}")

        # Core dependencies check
        try:
            import httpx  # noqa: F401
            import prompt_toolkit  # noqa: F401
            import rich  # noqa: F401
            import typer  # noqa: F401
            table.add_row("Dependencies", "[green]✓ PASS[/green]", "typer, rich, httpx, prompt_toolkit loaded")
        except ImportError as e:
            table.add_row("Dependencies", "[red]❌ FAIL[/red]", f"Missing dependency: {e}")

        # Config check
        config_path = os.path.join(os.getcwd(), ".forge", "config.yaml")
        if os.path.exists(config_path):
            table.add_row("Local Config", "[green]✓ PASS[/green]", f"Found {config_path}")
        else:
            table.add_row("Local Config", "[yellow]! WARN[/yellow]", "No local .forge/config.yaml (using defaults)")

        # Backend Connection check
        if reachable:
            table.add_row("Backend Server", "[green]✓ PASS[/green]", f"Connected at {shell.orchestrator.config.base_url}")
        else:
            table.add_row("Backend Server", "[red]❌ FAIL[/red]", f"Unreachable at {shell.orchestrator.config.base_url} (Check SSH tunnel)")

        shell.console.print(table)
        shell.console.print()
    except Exception:
        print(f"Doctor Diagnostics:\n  Python: {sys.version}\n  Backend Reachable: {reachable}\n")

    return False


def register_doctor_command(registry: Any) -> None:
    from forge.cli.commands.registry import SlashCommand
    registry.register(SlashCommand(
        name="doctor",
        description="Diagnose Forge setup",
        handler=handle_doctor
    ))
