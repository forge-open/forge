from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

from forge.agent.orchestrator import AgentOrchestrator
from forge.config.settings import ForgeConfig
from forge.providers.base import CompletionResponse, ToolCall
from forge.tools.base import BaseTool


class EchoTool(BaseTool):
    name = "echo_tool"
    description = "Echo back the provided text."
    parameters = {
        "type": "object",
        "properties": {
            "text": {"type": "string", "description": "Text to echo back"}
        },
        "required": ["text"],
    }

    def execute(self, text: str, **kwargs):
        return {"echo": text}


def test_run_task_executes_tool_calls_and_reprompts_with_tool_results():
    orchestrator = AgentOrchestrator(ForgeConfig())
    orchestrator.registry.register(EchoTool())

    routing = SimpleNamespace(selected_model_id="mock-model", model_name="mock-model")
    orchestrator.router.route_task = MagicMock(return_value=routing)

    provider = MagicMock()
    provider.generate.side_effect = [
        CompletionResponse(
            content="I should call a tool first.",
            tool_calls=[
                ToolCall(
                    id="call_1",
                    function_name="echo_tool",
                    arguments={"text": "hello forge"},
                )
            ],
        ),
        CompletionResponse(content="Tool loop completed."),
    ]
    orchestrator.router.get_provider = MagicMock(return_value=provider)

    result = orchestrator.run_task("Echo the text back", use_history=False)

    assert result["content"] == "Tool loop completed."
    assert len(result["tool_calls"]) == 1
    assert len(result["executed_tools"]) == 1
    assert result["executed_tools"][0]["name"] == "echo_tool"
    assert result["executed_tools"][0]["result"] == {"echo": "hello forge"}

    assert provider.generate.call_count == 2

    first_call = provider.generate.call_args_list[0]
    first_tools = first_call.kwargs["tools"]
    assert any(tool["function"]["name"] == "echo_tool" for tool in first_tools)

    second_call = provider.generate.call_args_list[1]
    second_messages = second_call.kwargs["messages"]
    assert second_messages[-2]["role"] == "assistant"
    assert second_messages[-2]["tool_calls"][0]["function"]["name"] == "echo_tool"
    assert second_messages[-1]["role"] == "tool"
    assert second_messages[-1]["name"] == "echo_tool"
