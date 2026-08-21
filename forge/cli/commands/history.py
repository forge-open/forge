import os
from typing import Any, List
from rich.table import Table


def handle_history(shell: Any, args: List[str]) -> bool:
    """Displays current session conversation history."""
    conv = shell.orchestrator.conversation
    messages = conv.get_messages()

    try:
        table = Table(title=f"Conversation History ({conv.turn_count} turns)", show_header=True, header_style="bold magenta")
        table.add_column("Role", style="cyan", width=12)
        table.add_column("Message Preview", style="white")

        for msg in messages:
            role = msg.get("role", "unknown").capitalize()
            content = msg.get("content", "").replace("\n", " ")
            preview = (content[:80] + "...") if len(content) > 80 else content
            if role == "System":
                continue
            table.add_row(role, preview)

        shell.console.print(table)
        shell.console.print()
    except Exception:
        print(f"Conversation History ({conv.turn_count} turns):")
        for msg in messages:
            if msg.get("role") != "system":
                print(f"  [{msg.get('role')}]: {msg.get('content')[:60]}")
        print()

    return False


def handle_clear(shell: Any, args: List[str]) -> bool:
    """Clears conversation history and terminal screen."""
    os.system("cls" if os.name == "nt" else "clear")
    shell.orchestrator.clear_conversation()
    shell.print_banner()
    try:
        shell.console.print("[bold green]✓ Conversation history cleared.[/bold green]\n")
    except Exception:
        print("✓ Conversation history cleared.\n")
    return False


def handle_new(shell: Any, args: List[str]) -> bool:
    """Starts a new conversation session."""
    shell.orchestrator.clear_conversation()
    try:
        shell.console.print("[bold green]✓ Started new conversation session.[/bold green]\n")
    except Exception:
        print("✓ Started new conversation session.\n")
    return False


def register_history_commands(registry: Any) -> None:
    from forge.cli.commands.registry import SlashCommand
    registry.register(SlashCommand(
        name="history",
        description="Show conversation history",
        handler=handle_history
    ))
    registry.register(SlashCommand(
        name="clear",
        description="Clear conversation history & screen",
        handler=handle_clear
    ))
    registry.register(SlashCommand(
        name="new",
        description="Start a new conversation",
        handler=handle_new
    ))
