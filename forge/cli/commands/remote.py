from __future__ import annotations

from typing import Any

from rich.panel import Panel
from rich.table import Table

from forge.cli.commands.registry import SlashCommand, SlashCommandRegistry
from forge.remote.manager import RemoteManager, get_remote_manager


def handle_remote(shell: Any, args: list[str]) -> bool:
    """Handler for /remote slash command."""
    manager: RemoteManager = getattr(shell.orchestrator, "remote_manager", None) or get_remote_manager(
        getattr(shell.orchestrator, "config", None).remote if hasattr(shell.orchestrator, "config") else None
    )

    subcmd = args[0].lower() if args else "status"

    if subcmd in ("status", "info"):
        status = manager.get_status()
        dur_str = manager.get_formatted_session_duration() if status.started_by_forge else "N/A"

        if hasattr(shell, "console"):
            grid = Table.grid(expand=True, padding=(0, 2))
            grid.add_column(justify="left", style="dim")
            grid.add_column(justify="left")

            grid.add_row("Provider:", f"[cyan]{status.provider}[/cyan]")
            grid.add_row("Studio:", f"[white]{status.studio_name}[/white]")
            grid.add_row("GPU:", f"[yellow]{status.gpu_type}[/yellow]")
            status_style = "bold green" if status.status in ("connected", "running") else "bold red"
            grid.add_row("Status:", f"[{status_style}]{status.status.capitalize()}[/{status_style}]")
            grid.add_row("Model:", f"[bright_white]{status.model_name or 'Remote Studio Model'}[/bright_white]")
            grid.add_row("Session Duration:", f"[cyan]{dur_str}[/cyan]")
            grid.add_row("Started By Forge:", f"[white]{'Yes' if status.started_by_forge else 'No'}[/white]")

            panel = Panel(
                grid,
                title="[bold yellow]⚡ Remote Backend Infrastructure[/bold yellow]",
                border_style="cyan",
                padding=(1, 2),
            )
            shell.console.print(panel)
            shell.console.print()
        else:
            print(f"Remote Backend: {status.provider}")
            print(f"Studio: {status.studio_name} | GPU: {status.gpu_type}")
            print(f"Status: {status.status} | Session: {dur_str}")
        return False

    elif subcmd == "start":
        if hasattr(shell, "console"):
            shell.console.print("[cyan]Starting remote GPU backend...[/cyan]")
        else:
            print("Starting remote GPU backend...")
        success = manager.start_remote_gpu(orchestrator=shell.orchestrator)
        if success:
            if hasattr(shell, "console"):
                shell.console.print("[bold green]✓ Remote GPU backend started and connected successfully.[/bold green]\n")
            else:
                print("✓ Remote GPU backend started and connected successfully.\n")
        else:
            if hasattr(shell, "console"):
                shell.console.print("[bold red]❌ Failed to start remote GPU backend.[/bold red]\n")
            else:
                print("❌ Failed to start remote GPU backend.\n")
        return False

    elif subcmd == "stop":
        if hasattr(shell, "console"):
            shell.console.print("[yellow]Stopping remote GPU backend...[/yellow]")
        else:
            print("Stopping remote GPU backend...")
        manager.shutdown(explicit_stop=True)
        return False

    elif subcmd == "restart":
        if hasattr(shell, "console"):
            shell.console.print("[yellow]Restarting remote GPU backend...[/yellow]")
        else:
            print("Restarting remote GPU backend...")
        manager.shutdown(explicit_stop=True)
        success = manager.start_remote_gpu(orchestrator=shell.orchestrator)
        if success and hasattr(shell, "console"):
            shell.console.print("[bold green]✓ Remote GPU backend restarted successfully.[/bold green]\n")
        return False

    else:
        if hasattr(shell, "console"):
            shell.console.print(f"[bold red]Unknown subcommand '/remote {subcmd}'.[/bold red] Options: status, start, stop, restart\n")
        else:
            print(f"Unknown subcommand '/remote {subcmd}'. Options: status, start, stop, restart\n")
        return False


def register_remote_command(registry: SlashCommandRegistry) -> None:
    """Registers the /remote command in the CLI slash command registry."""
    registry.register(
        SlashCommand(
            name="remote",
            description="Manage remote GPU backend lifecycle (status, start, stop, restart)",
            handler=handle_remote,
            aliases=["gpu"],
            accepts_args=True,
        )
    )
