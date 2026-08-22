import time
from unittest.mock import MagicMock, patch

from rich.markdown import Markdown
from rich.panel import Panel

from forge.agent.orchestrator import AgentOrchestrator
from forge.cli.shell import (
    ExecutionMetrics,
    ForgeShell,
    count_tokens,
    strip_internal_reasoning,
)
from forge.config.settings import ForgeConfig, load_config


def test_token_counting():
    assert count_tokens("") == 0
    assert count_tokens("Hello world") == 2
    assert count_tokens("def reverse_string(s):\n    return s[::-1]") == 14


def test_strip_internal_reasoning():
    # 1. Strip think tags
    text_with_think = "<think>Let me analyze the problem first...</think>\nHello! Here is the Python function."
    assert strip_internal_reasoning(text_with_think) == "Hello! Here is the Python function."

    # 2. Strip internal planning sentences
    text_with_planning = "We need answer the user directly with code.\ndef add(a, b):\n    return a + b"
    assert "We need answer the user" not in strip_internal_reasoning(text_with_planning)
    assert "def add" in strip_internal_reasoning(text_with_planning)


def test_metrics_formatting():
    metrics = ExecutionMetrics(
        ttft=0.067,
        total_time=13.7,
        token_count=256,
        tokens_per_second=18.7
    )
    formatted = metrics.format_display()
    assert "⚡ 0.067s TTFT" in formatted
    assert "13.7s total" in formatted
    assert "18.7 tok/s" in formatted
    assert "256 tokens" in formatted


def test_system_prompt_behavior():
    config = load_config()
    assert "direct" in config.system_prompt.lower()
    assert "internal planning" in config.system_prompt.lower() or "meta commentary" in config.system_prompt.lower()
    assert "never expose internal thoughts" in config.system_prompt.lower() or "direct" in config.system_prompt.lower()


def test_bordered_prompt_and_input_handling():
    config = ForgeConfig()
    orchestrator = AgentOrchestrator(config)
    shell = ForgeShell(orchestrator)

    # Test input prompt box header/footer rendering with mocked input
    with patch("builtins.input", return_value="test prompt"):
        shell.session = None
        shell._disable_prompt_session = True
        user_input = shell.get_user_input()
        assert user_input == "test prompt"


def test_thinking_state_and_ttft_measurement():
    config = ForgeConfig()
    orchestrator = AgentOrchestrator(config)

    def mock_stream(prompt, use_history=True):
        time.sleep(0.02)
        yield "def "
        time.sleep(0.01)
        yield "hello(): pass"

    orchestrator.stream_task = MagicMock(side_effect=mock_stream)
    shell = ForgeShell(orchestrator)

    res = shell._stream_response("write hello function", use_history=False)
    metrics = res["metrics"]

    assert metrics.ttft > 0
    assert metrics.total_time >= metrics.ttft
    assert metrics.token_count > 0
    assert metrics.tokens_per_second > 0
    assert "def hello(): pass" in res["response"]


def test_markdown_rendering():
    md = Markdown("```python\ndef foo():\n    return 42\n```", code_theme="monokai")
    panel = Panel(md, title="Forge", border_style="cyan")
    assert panel.title == "Forge"
    assert panel.border_style == "cyan"


def test_slash_command_preservation():
    config = ForgeConfig()
    orchestrator = AgentOrchestrator(config)
    shell = ForgeShell(orchestrator)

    assert shell._handle_slash_command("/help") is False
    assert shell._handle_slash_command("/model") is False
    assert shell._handle_slash_command("/status") is False

    with patch.object(orchestrator, "clear_conversation") as mock_clear:
        assert shell._handle_slash_command("/clear") is False
        mock_clear.assert_called_once()

    assert shell._handle_slash_command("/exit") is True
    assert shell._handle_slash_command("/quit") is True


def test_non_interactive_execution():
    config = ForgeConfig()
    orchestrator = AgentOrchestrator(config)

    def mock_stream(prompt, use_history=False):
        yield "Hello world from non-interactive prompt"

    orchestrator.stream_task = MagicMock(side_effect=mock_stream)
    orchestrator.remote_manager = MagicMock()
    shell = ForgeShell(orchestrator)
    shell.remote_manager = orchestrator.remote_manager

    shell.run_single_prompt("Test non-interactive")
    assert shell.last_metrics is not None
    assert shell.last_metrics.token_count > 0
