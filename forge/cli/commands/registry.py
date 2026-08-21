from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable


@dataclass
class SlashCommand:
    """Dataclass representing a registered Forge CLI slash command."""
    name: str
    description: str
    handler: Callable[[Any, list[str]], Any]
    aliases: list[str] = field(default_factory=list)
    accepts_args: bool = False


class SlashCommandRegistry:
    """Registry managing command lookup, aliases, autocomplete list, and execution."""

    def __init__(self) -> None:
        self._commands: dict[str, SlashCommand] = {}
        self._aliases: dict[str, str] = {}

    def register(self, command: SlashCommand) -> None:
        """Registers a new slash command and its aliases."""
        primary_name = command.name.lower().lstrip("/")
        self._commands[primary_name] = command
        for alias in command.aliases:
            alias_clean = alias.lower().lstrip("/")
            self._aliases[alias_clean] = primary_name

    def get(self, name: str) -> SlashCommand | None:
        """Looks up a command by name or alias."""
        clean_name = name.lower().lstrip("/")
        if clean_name in self._commands:
            return self._commands[clean_name]
        if clean_name in self._aliases:
            return self._commands[self._aliases[clean_name]]
        return None

    def list_commands(self) -> list[SlashCommand]:
        """Returns all registered commands sorted by primary name."""
        unique_cmds = {}
        for cmd in self._commands.values():
            if cmd.name not in unique_cmds:
                unique_cmds[cmd.name] = cmd
        return sorted(unique_cmds.values(), key=lambda c: c.name)

    def execute(self, cmd_line: str, shell: Any) -> bool:
        """Executes a command line string. Returns True if the shell loop should exit."""
        parts = cmd_line.strip().split()
        if not parts:
            return False

        raw_cmd = parts[0]
        cmd_name = raw_cmd.lstrip("/")
        args = parts[1:]

        command = self.get(cmd_name)
        if command is None:
            if hasattr(shell, "console"):
                shell.console.print(f"[bold red]Unknown command '/{cmd_name}'.[/bold red] Type [cyan]/help[/cyan] for available commands.\n")
            else:
                print(f"Unknown command '/{cmd_name}'. Type /help for available commands.\n")
            return False

        result = command.handler(shell, args)
        return bool(result)


def create_default_registry() -> SlashCommandRegistry:
    """Instantiates and registers all standard Forge CLI commands."""
    from forge.cli.commands.config import register_config_command
    from forge.cli.commands.context import register_context_command
    from forge.cli.commands.doctor import register_doctor_command
    from forge.cli.commands.files import register_files_command
    from forge.cli.commands.git import register_git_command
    from forge.cli.commands.help import register_help_command
    from forge.cli.commands.history import register_history_commands
    from forge.cli.commands.init import register_init_command
    from forge.cli.commands.memory import register_memory_command
    from forge.cli.commands.model import register_model_commands
    from forge.cli.commands.status import register_status_command
    from forge.cli.commands.version import register_version_command

    registry = SlashCommandRegistry()

    register_help_command(registry)
    register_status_command(registry)
    register_model_commands(registry)
    register_history_commands(registry)
    register_context_command(registry)
    register_files_command(registry)
    register_git_command(registry)
    register_config_command(registry)
    register_doctor_command(registry)
    register_version_command(registry)
    register_memory_command(registry)
    register_init_command(registry)

    # Register exit / quit commands
    def exit_handler(shell: Any, args: list[str]) -> bool:
        if hasattr(shell, "console"):
            shell.console.print("[yellow]Exiting Forge. Goodbye![/yellow]\n")
        else:
            print("Exiting Forge. Goodbye!\n")
        return True

    registry.register(SlashCommand(
        name="exit",
        description="Exit Forge CLI",
        handler=exit_handler,
        aliases=["quit"]
    ))

    return registry
