from typing import List, Dict, Any, Optional, Generator
from forge.config.settings import ForgeConfig
from forge.router.model_router import ModelRouter
from forge.tools.base import ToolRegistry
from forge.tools.file_tools import ReadFileTool, WriteFileTool, EditFileTool, SearchFilesTool, ListDirectoryTool
from forge.tools.terminal_tools import RunCommandTool, RunTestsTool
from forge.tools.git_tools import GitStatusTool, GitDiffTool, GitLogTool
from forge.context.context_builder import ContextBuilder
from forge.memory.project_memory import ProjectMemory
from forge.git.git_manager import GitManager
from forge.agent.prompts import GLM_PRIMARY_SYSTEM_PROMPT, KIMI_REVIEW_SYSTEM_PROMPT
from forge.utils.logging import logger

class AgentOrchestrator:
    """Core Agent Orchestrator managing model routing, context, tools, and execution loops."""

    def __init__(self, config: ForgeConfig):
        self.config = config
        self.router = ModelRouter(config)
        self.registry = ToolRegistry()
        self.context_builder = ContextBuilder()
        self.memory = ProjectMemory()
        self.git = GitManager()
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

    def run_task(self, prompt: str, stream: bool = False) -> Dict[str, Any]:
        """Executes a coding task using the primary active model (default: GLM 5.2)."""
        provider = self.router.get_provider()
        context_prompt = self.context_builder.build_context(prompt)
        messages = [
            {"role": "system", "content": GLM_PRIMARY_SYSTEM_PROMPT},
            {"role": "user", "content": context_prompt}
        ]

        logger.info(f"Orchestrator running task with active model '{self.router.active_model_key}'...")
        response = provider.generate(messages=messages, tools=self.registry.get_schemas())

        # Execute tool calls if returned by model
        executed_tools = []
        if response.tool_calls:
            for tc in response.tool_calls:
                tool_res = self.registry.execute(tc.function_name, tc.arguments)
                executed_tools.append({"tool": tc.function_name, "args": tc.arguments, "result": tool_res})

        # Save to memory
        self.memory.record_task(prompt, response.content[:200])

        return {
            "model": self.router.active_model_key,
            "content": response.content,
            "tool_calls": response.tool_calls,
            "executed_tools": executed_tools,
        }

    def stream_task(self, prompt: str) -> Generator[str, None, None]:
        """Streams response tokens from the active model."""
        provider = self.router.get_provider()
        context_prompt = self.context_builder.build_context(prompt)
        messages = [
            {"role": "system", "content": GLM_PRIMARY_SYSTEM_PROMPT},
            {"role": "user", "content": context_prompt}
        ]
        yield from provider.generate_stream(messages=messages)

    def run_review_collaboration(self, prompt: str) -> Dict[str, Any]:
        """Runs collaborative workflow: GLM 5.2 -> Implementation -> Kimi K2.5 Review -> GLM Refinement."""
        logger.info("Starting GLM 5.2 + Kimi K2.5 collaborative review workflow...")

        # 1. Primary Model (GLM 5.2) Implementation
        primary_provider = self.router.get_primary_provider()
        context_prompt = self.context_builder.build_context(prompt)
        messages_primary = [
            {"role": "system", "content": GLM_PRIMARY_SYSTEM_PROMPT},
            {"role": "user", "content": context_prompt}
        ]
        primary_res = primary_provider.generate(messages=messages_primary, tools=self.registry.get_schemas())

        # 2. Secondary Model (Kimi K2.5) Review
        secondary_provider = self.router.get_secondary_provider()
        messages_review = [
            {"role": "system", "content": KIMI_REVIEW_SYSTEM_PROMPT},
            {"role": "user", "content": f"Task: {prompt}\n\nProposed Implementation by GLM 5.2:\n{primary_res.content}\n\nPlease review this implementation, check for bugs, and provide recommendations."}
        ]
        review_res = secondary_provider.generate(messages=messages_review)

        # 3. GLM 5.2 Refinement with Kimi Feedback
        messages_refine = [
            {"role": "system", "content": GLM_PRIMARY_SYSTEM_PROMPT},
            {"role": "user", "content": f"Original Task: {prompt}\n\nYour First Draft:\n{primary_res.content}\n\nKimi K2.5 Code Review Feedback:\n{review_res.content}\n\nPlease finalize the code implementation addressing the code review points."}
        ]
        final_res = primary_provider.generate(messages=messages_refine, tools=self.registry.get_schemas())

        self.memory.record_task(prompt, "Collaborative review workflow completed.")

        return {
            "workflow": "GLM + Kimi Collaboration",
            "primary_draft": primary_res.content,
            "kimi_review": review_res.content,
            "final_implementation": final_res.content,
        }
