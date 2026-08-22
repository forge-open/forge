from __future__ import annotations

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
        self.registry.register(ReadFileTool())
        self.registry.register(WriteFileTool())
        self.registry.register(EditFileTool())
        self.registry.register(SearchFilesTool())
        self.registry.register(ListDirectoryTool())
        self.registry.register(RunCommandTool(safe_mode=self.config.safe_mode))
        self.registry.register(RunTestsTool())
        self.registry.register(GitStatusTool())
        self.registry.register(GitDiffTool())
        self.registry.register(GitLogTool())

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
        start_time = time.perf_counter()
        response = provider.generate(messages=messages)
        model_time = time.perf_counter() - start_time

        if use_history and response.content:
            self.conversation.add_assistant_message(response.content)

        self.memory.record_task(prompt, response.content[:200] if response.content else "")

        return {
            "model": routing.model_name,
            "routing": routing,
            "content": response.content,
            "tool_calls": getattr(response, "tool_calls", []),
            "executed_tools": [],
            "model_time": model_time,
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
        for chunk in provider.generate_stream(messages=messages):
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
