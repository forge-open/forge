from __future__ import annotations

import json
import time
from collections.abc import Generator
from typing import Any

from forge.agent.conversation import ConversationManager
from forge.agent.prompts import FORGE_PRIMARY_SYSTEM_PROMPT, FORGE_REVIEW_SYSTEM_PROMPT
from forge.config.settings import ForgeConfig
from forge.context.context_builder import ContextBuilder
from forge.git.git_manager import GitManager
from forge.memory.project_memory import ProjectMemory
from forge.providers.backend import BackendManager
from forge.remote.manager import RemoteManager, get_remote_manager
from forge.router.model_router import ModelRouter, RoutingDecision
from forge.tools.base import ToolRegistry
from forge.tools.file_tools import (
    EditFileTool,
    ListDirectoryTool,
    ReadFileTool,
    SearchFilesTool,
    WriteFileTool,
)
from forge.tools.git_tools import GitDiffTool, GitLogTool, GitStatusTool
from forge.tools.terminal_tools import RunCommandTool, RunTestsTool
from forge.utils.logging import logger

MAX_TOOL_ITERATIONS = 8


class AgentOrchestrator:
    """Core Agent Orchestrator managing model routing, context, tools, and execution loops."""

    def __init__(self, config: ForgeConfig):
        self.config = config
        self.remote_manager: RemoteManager = get_remote_manager(config.remote)
        self.backend_manager = BackendManager(config, self.remote_manager)
        self.router = ModelRouter(config, backend_manager=self.backend_manager)
        self.registry = ToolRegistry()
        self.context_builder = ContextBuilder()
        self.memory = ProjectMemory()
        self.git = GitManager()
        self.conversation = ConversationManager(system_prompt=config.system_prompt)
        self.last_routing: RoutingDecision | None = None
        self._register_default_tools()

    def _register_default_tools(self) -> None:
        workspace_root = self.git.repo_dir.resolve()
        self.registry.register(ReadFileTool(workspace_root))
        self.registry.register(WriteFileTool(workspace_root))
        self.registry.register(EditFileTool(workspace_root))
        self.registry.register(SearchFilesTool(workspace_root))
        self.registry.register(ListDirectoryTool(workspace_root))
        self.registry.register(RunCommandTool(safe_mode=self.config.safe_mode, workspace_root=workspace_root))
        self.registry.register(RunTestsTool(workspace_root))
        self.registry.register(GitStatusTool(workspace_root))
        self.registry.register(GitDiffTool(workspace_root))
        self.registry.register(GitLogTool(workspace_root))

    def clear_conversation(self) -> None:
        """Clears current session conversation history."""
        self.conversation.reset()

    def check_server_status(self) -> dict[str, Any]:
        """Checks reachability and status of the primary active model backend."""
        active = self.backend_manager.get_active_backend()
        if active and active.provider and hasattr(active.provider, "check_health"):
            return active.provider.check_health()
        provider = self.router.get_provider()
        if hasattr(provider, "check_health"):
            return provider.check_health()
        return {"status": "unknown", "reachable": True}

    def get_active_model_name(self) -> str:
        """Returns the detected or configured active model name/ID."""
        active = self.backend_manager.get_active_backend()
        if active and active.model:
            return active.model
        provider = self.router.get_provider()
        if hasattr(provider, "detect_model"):
            return provider.detect_model()
        return self.router.active_model_key

    def run_task(self, prompt: str, stream: bool = False, use_history: bool = True) -> dict[str, Any]:
        """Executes a coding task using routed model and tool loops."""
        routing = self.router.route_task(prompt)
        self.last_routing = routing
        provider = self.router.get_provider(routing.selected_model_id)

        if use_history:
            self.conversation.add_user_message(prompt)
            messages = self.conversation.get_messages()
        else:
            messages = [
                {"role": "system", "content": self.config.system_prompt},
                {"role": "user", "content": prompt}
            ]

        logger.info(f"Orchestrator running task with routed model '{routing.selected_model_id}'...")
        tools = self.registry.get_schemas()
        executed_tools: list[dict[str, Any]] = []
        all_tool_calls: list[Any] = []
        model_time = 0.0
        response = None

        for iteration in range(MAX_TOOL_ITERATIONS):
            start_time = time.perf_counter()
            response = provider.generate(messages=messages, tools=tools)
            model_time += time.perf_counter() - start_time

            tool_calls = getattr(response, "tool_calls", []) or []
            all_tool_calls.extend(tool_calls)

            if not tool_calls:
                break

            messages.append(self._assistant_tool_call_message(response.content, tool_calls))

            for tool_call in tool_calls:
                result = self.registry.execute(tool_call.function_name, tool_call.arguments)
                executed_tool = {
                    "id": tool_call.id,
                    "name": tool_call.function_name,
                    "arguments": tool_call.arguments,
                    "result": result,
                }
                executed_tools.append(executed_tool)
                messages.append(self._tool_result_message(tool_call.id, tool_call.function_name, result))

        else:
            logger.warning("Stopping tool loop after reaching max tool iterations.")

        final_content = response.content if response is not None else ""

        if use_history:
            self.conversation.messages = messages
            if final_content and (not messages or messages[-1].get("role") != "assistant"):
                self.conversation.add_assistant_message(final_content)

        self.memory.record_task(prompt, final_content[:200] if final_content else "")

        return {
            "model": routing.model_name,
            "routing": routing,
            "content": final_content,
            "tool_calls": all_tool_calls,
            "executed_tools": executed_tools,
            "model_time": model_time,
        }

    def _assistant_tool_call_message(self, content: str, tool_calls: list[Any]) -> dict[str, Any]:
        """Formats assistant tool requests for OpenAI-compatible chat history."""
        return {
            "role": "assistant",
            "content": content or "",
            "tool_calls": [
                {
                    "id": tool_call.id,
                    "type": "function",
                    "function": {
                        "name": tool_call.function_name,
                        "arguments": json.dumps(tool_call.arguments),
                    },
                }
                for tool_call in tool_calls
            ],
        }

    def _tool_result_message(self, tool_call_id: str, name: str, result: dict[str, Any]) -> dict[str, Any]:
        """Formats local tool results for the follow-up model call."""
        return {
            "role": "tool",
            "tool_call_id": tool_call_id,
            "name": name,
            "content": json.dumps(result),
        }

    def stream_task(self, prompt: str, use_history: bool = True) -> Generator[str, None, None]:
        """Streams response tokens from the active model, updating conversation history."""
        routing = self.router.route_task(prompt)
        self.last_routing = routing
        provider = self.router.get_provider(routing.selected_model_id)

        if use_history:
            self.conversation.add_user_message(prompt)
            messages = self.conversation.get_messages()
        else:
            messages = [
                {"role": "system", "content": self.config.system_prompt},
                {"role": "user", "content": prompt}
            ]

        full_response = []
        for chunk in provider.generate_stream(messages=messages, tools=self.registry.get_schemas()):
            full_response.append(chunk)
            yield chunk

        accumulated = "".join(full_response)
        if use_history and accumulated:
            self.conversation.add_assistant_message(accumulated)

    def run_review_collaboration(self, prompt: str) -> dict[str, Any]:
        """Runs collaborative workflow: Primary implementation -> Secondary code review -> Refinement."""
        logger.info("Starting collaborative review workflow...")

        primary_provider = self.router.get_primary_provider()
        context_prompt = self.context_builder.build_context(prompt)
        messages_primary = [
            {"role": "system", "content": FORGE_PRIMARY_SYSTEM_PROMPT},
            {"role": "user", "content": context_prompt}
        ]
        primary_res = primary_provider.generate(messages=messages_primary, tools=self.registry.get_schemas())

        secondary_provider = self.router.get_secondary_provider()
        messages_review = [
            {"role": "system", "content": FORGE_REVIEW_SYSTEM_PROMPT},
            {"role": "user", "content": f"Task: {prompt}\n\nProposed Implementation:\n{primary_res.content}\n\nPlease review this implementation, check for bugs, and provide recommendations."}
        ]
        review_res = secondary_provider.generate(messages=messages_review)

        messages_refine = [
            {"role": "system", "content": FORGE_PRIMARY_SYSTEM_PROMPT},
            {"role": "user", "content": f"Original Task: {prompt}\n\nYour First Draft:\n{primary_res.content}\n\nCode Review Feedback:\n{review_res.content}\n\nPlease finalize the code implementation addressing the code review points."}
        ]
        final_res = primary_provider.generate(messages=messages_refine, tools=self.registry.get_schemas())

        self.memory.record_task(prompt, "Collaborative review workflow completed.")

        return {
            "workflow": "Forge Collaborative Review",
            "primary_draft": primary_res.content,
            "review_feedback": review_res.content,
            "final_implementation": final_res.content,
        }
