from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum

from forge.config.settings import ForgeConfig, ModelConfig
from forge.models.registry import get_model_registry
from forge.providers.base import BaseProvider
from forge.providers.openai_provider import OpenAICompatibleProvider
from forge.utils.logging import logger


class TaskCategory(str, Enum):
    SIMPLE_QUESTION = "simple question"
    SMALL_CODING_TASK = "small coding task"
    CODE_EXPLANATION = "code explanation"
    NORMAL_CODING_TASK = "normal coding task"
    LARGE_CODING_TASK = "large coding task"
    REPOSITORY_LEVEL_TASK = "repository level task"
    DEBUGGING = "debugging"
    REFACTORING = "refactoring"


@dataclass
class RoutingDecision:
    """Transparent metadata explaining model selection for a given task."""
    selected_model_id: str
    model_name: str
    category: str
    reasoning: str
    provider_config: ModelConfig


def classify_task(prompt: str, context_files_count: int = 0) -> TaskCategory:
    """Classifies user request into a task category based on length, intent keywords, and context complexity."""
    if not prompt:
        return TaskCategory.SIMPLE_QUESTION

    text_lower = prompt.lower()

    # Repository level task
    if context_files_count > 5 or any(k in text_lower for k in ["repository", "architecture", "entire codebase", "all files"]):
        return TaskCategory.REPOSITORY_LEVEL_TASK

    # Debugging
    if any(k in text_lower for k in ["error", "traceback", "exception", "bug", "crash", "fix error", "debug"]):
        return TaskCategory.DEBUGGING

    # Refactoring
    if any(k in text_lower for k in ["refactor", "optimize", "clean up", "restructure", "simplify"]):
        return TaskCategory.REFACTORING

    # Code explanation / Simple question
    if any(k in text_lower for k in ["explain", "what is", "how does", "why does", "meaning of"]):
        if len(prompt) < 150:
            return TaskCategory.CODE_EXPLANATION
        return TaskCategory.SIMPLE_QUESTION

    # Large coding task
    if len(prompt) > 400 or any(k in text_lower for k in ["build a complete", "create a full", "implement system"]):
        return TaskCategory.LARGE_CODING_TASK

    # Small vs Normal coding task
    if len(prompt) < 100 or re.search(r"write a (?:short|simple|one-line) function", text_lower):
        return TaskCategory.SMALL_CODING_TASK

    return TaskCategory.NORMAL_CODING_TASK


class ModelRouter:
    """Intelligent task-based model router for Forge."""

    def __init__(self, config: ForgeConfig):
        self.config = config
        self._providers: dict[str, BaseProvider] = {}
        self.registry = get_model_registry()
        self.active_model_key: str = config.primary_model or "qwen3.8-27b-fp8"

    def set_active_model(self, model_key: str) -> None:
        """Sets active model key explicitly."""
        spec = self.registry.get(model_key)
        if spec:
            self.active_model_key = spec.model_id
        else:
            self.active_model_key = model_key
        logger.info(f"Model router active model set to: {self.active_model_key}")

    def route_task(self, prompt: str, context_files_count: int = 0) -> RoutingDecision:
        """Intelligently routes a user task to the optimal available model with transparent reasoning."""
        category = classify_task(prompt, context_files_count)
        active_spec = self.registry.get(self.active_model_key) or self.registry.get_default()

        # If user explicitly configured an active model or if task demands primary model
        selected_spec = active_spec
        reasoning = f"Task categorized as '{category.value}'. Selected '{selected_spec.name}' for robust performance."

        # If small task and a fast small model is explicitly registered and available in config
        if category in (TaskCategory.SMALL_CODING_TASK, TaskCategory.CODE_EXPLANATION, TaskCategory.SIMPLE_QUESTION):
            small_spec = self.registry.get("gemma-2-9b") or self.registry.get("qwen2.5-coder-7b")
            if small_spec and small_spec.model_id in self.config.models:
                selected_spec = small_spec
                reasoning = f"Task categorized as lightweight '{category.value}'. Selected fast model '{selected_spec.name}'."

        provider_cfg = self.config.models.get(
            selected_spec.model_id,
            ModelConfig(
                name=selected_spec.model_id,
                base_url=self.config.base_url,
                temperature=self.config.temperature,
                max_tokens=self.config.max_tokens,
            )
        )

        return RoutingDecision(
            selected_model_id=selected_spec.model_id,
            model_name=selected_spec.name,
            category=category.value,
            reasoning=reasoning,
            provider_config=provider_cfg
        )

    def get_provider(self, model_key: str | None = None) -> BaseProvider:
        """Gets or creates provider for model key."""
        key = model_key or self.active_model_key
        if key not in self._providers:
            model_cfg = self.config.models.get(key)
            if not model_cfg:
                model_cfg = ModelConfig(
                    name=key,
                    base_url=self.config.base_url,
                    temperature=self.config.temperature,
                    max_tokens=self.config.max_tokens,
                )
            self._providers[key] = OpenAICompatibleProvider(model_cfg)
        return self._providers[key]

    def get_primary_provider(self) -> BaseProvider:
        return self.get_provider(self.config.primary_model)

    def get_secondary_provider(self) -> BaseProvider:
        return self.get_provider(self.config.secondary_model)
