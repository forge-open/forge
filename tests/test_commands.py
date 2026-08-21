import os
from unittest.mock import MagicMock, patch
import pytest

from forge.config.settings import ForgeConfig
from forge.agent.orchestrator import AgentOrchestrator
from forge.cli.commands.registry import SlashCommand, SlashCommandRegistry, create_default_registry
from forge.cli.commands.help import handle_help
from forge.cli.commands.status import handle_status
from forge.cli.commands.model import handle_model, handle_models
from forge.cli.commands.history import handle_history, handle_clear, handle_new
from forge.cli.commands.context import handle_context
from forge.cli.commands.files import handle_files
from forge.cli.commands.git import handle_git
from forge.cli.commands.config import handle_config
from forge.cli.commands.doctor import handle_doctor
from forge.cli.commands.version import handle_version, FORGE_VERSION
from forge.cli.shell import ForgeShell, SlashCommandCompleter, HAS_PROMPT_TOOLKIT


def test_command_registry_basic():
    registry = SlashCommandRegistry()
    dummy_fn = lambda s, a: False
    cmd = SlashCommand(name="testcmd", description="Test description", handler=dummy_fn, aliases=["tcmd"])

    registry.register(cmd)

    assert registry.get("testcmd") == cmd
    assert registry.get("/testcmd") == cmd
    assert registry.get("tcmd") == cmd
    assert registry.get("nonexistent") is None
    assert len(registry.list_commands()) == 1


def test_default_registry_initialization():
    registry = create_default_registry()
    commands = {c.name for c in registry.list_commands()}

    required_commands = {
        "help", "status", "model", "models", "clear", "new",
        "history", "version", "exit", "context", "files", "git", "config", "doctor"
    }

    assert required_commands.issubset(commands)


def test_command_execution():
    registry = SlashCommandRegistry()
    mock_handler = MagicMock(return_value=False)
    registry.register(SlashCommand(name="ping", description="Ping command", handler=mock_handler))

    shell = MagicMock()
    result = registry.execute("/ping arg1 arg2", shell)

    assert result is False
    mock_handler.assert_called_once_with(shell, ["arg1", "arg2"])


def test_unknown_command_handling():
    registry = create_default_registry()
    shell = MagicMock()

    result = registry.execute("/unknowncommand", shell)
    assert result is False


@pytest.mark.skipif(not HAS_PROMPT_TOOLKIT, reason="prompt_toolkit required for autocompleter test")
def test_slash_command_completer():
    registry = create_default_registry()
    completer = SlashCommandCompleter(registry)

    mock_document = MagicMock()
    mock_document.text_before_cursor = "/mod"

    completions = list(completer.get_completions(mock_document, None))
    texts = [c.text for c in completions]

    assert "/model" in texts
    assert "/models" in texts


def test_help_command():
    config = ForgeConfig()
    orchestrator = AgentOrchestrator(config)
    shell = ForgeShell(orchestrator)

    assert handle_help(shell, []) is False


def test_status_command():
    config = ForgeConfig()
    orchestrator = AgentOrchestrator(config)
    shell = ForgeShell(orchestrator)

    with patch.object(orchestrator, "check_server_status", return_value={"reachable": True}):
        assert handle_status(shell, []) is False


def test_model_and_models_command():
    config = ForgeConfig()
    orchestrator = AgentOrchestrator(config)
    shell = ForgeShell(orchestrator)

    # Test /model display
    assert handle_model(shell, []) is False

    # Test /model <new_model>
    assert handle_model(shell, ["qwen3.8-switch-test"]) is False
    assert orchestrator.config.model == "qwen3.8-switch-test"

    # Test /models listing
    with patch.object(orchestrator, "check_server_status", return_value={"reachable": True, "models": ["m1", "m2"]}):
        assert handle_models(shell, []) is False


def test_history_clear_new_commands():
    config = ForgeConfig()
    orchestrator = AgentOrchestrator(config)
    shell = ForgeShell(orchestrator)

    orchestrator.conversation.add_user_message("Hello")
    orchestrator.conversation.add_assistant_message("Hi there")

    assert handle_history(shell, []) is False

    assert handle_clear(shell, []) is False
    assert len(orchestrator.conversation.get_messages()) == 1

    orchestrator.conversation.add_user_message("Hello again")
    assert handle_new(shell, []) is False
    assert len(orchestrator.conversation.get_messages()) == 1


def test_context_files_git_config_doctor_version():
    config = ForgeConfig()
    orchestrator = AgentOrchestrator(config)
    shell = ForgeShell(orchestrator)

    assert handle_context(shell, []) is False
    assert handle_files(shell, []) is False
    assert handle_git(shell, []) is False
    assert handle_config(shell, []) is False
    assert handle_doctor(shell, []) is False
    assert handle_version(shell, []) is False
