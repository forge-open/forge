from __future__ import annotations

import re
from dataclasses import dataclass
from enum import Enum
from typing import Any

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
    supports_tools: bool = False
    latency_target_ms: int | None = None
    context_size: int = 0
    escalation_level: int = 0


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

    def __init__(self, config: ForgeConfig, backend_manager: Any = None):
        self.config = config
        self.backend_manager = backend_manager
        self._providers: dict[str, BaseProvider] = {}
        self.registry = get_model_registry()
        self.active_model_key: str = config.primary_model or ""

    def set_active_model(self, model_key: str) -> None:
        """Sets active model key explicitly."""
        spec = self.registry.get(model_key)
        if spec:
            self.active_model_key = spec.model_id
        else:
            self.active_model_key = model_key
        logger.info(f"Model router active model set to: {self.active_model_key}")

    def route_task(
        self,
        prompt: str,
        context_files_count: int = 0,
        *,
        requires_tools: bool = False,
        latency_budget_ms: int | None = None,
        required_context_size: int | None = None,
        hardware: str | list[str] | None = None,
        warm_models: set[str] | list[str] | dict[str, bool] | None = None,
        model_override: str | None = None,
        backend_override: str | None = None,
    ) -> RoutingDecision:
        category = classify_task(prompt, context_files_count)
        required_context = required_context_size or (context_files_count * 4096 if context_files_count else 0)
        warm = self._normalize_warm_models(warm_models)
        requested_hardware = self._normalize_hardware(hardware)
        preferred_backend = backend_override or getattr(self.config, "active_backend", "auto")

        explicit_key = model_override or self.active_model_key or self.config.model or self.config.primary_model
        if model_override:
            selected_spec = self.registry.get(model_override)
            if selected_spec is None:
                selected_spec = self.registry.get_default()
            reasoning = f"Explicit model override selected '{selected_spec.name}'."
        else:
            available_ids = self._available_model_ids(preferred_backend)
            candidates = [spec for spec in self.registry.list_models() if not available_ids or spec.model_id.lower() in available_ids]
            compatible = [spec for spec in candidates if self._is_compatible(spec, category, requires_tools, latency_budget_ms, required_context, requested_hardware)]
            if not compatible:
                # Explicit/configured model is the last-resort choice; otherwise report the
                # closest registered model rather than silently returning an incompatible one.
                fallback = self.registry.get(explicit_key) if explicit_key else None
                selected_spec = fallback or self.registry.get_default()
                reasoning = f"No fully compatible model met the requested constraints; selected closest fallback '{selected_spec.name}'."
            else:
                selected_spec = min(
                    compatible,
                    key=lambda spec: (0 if spec.model_id.lower() in warm else 1, spec.parameter_billions or 9999, -spec.coding_capability),
                )
                warm_note = "warm " if selected_spec.model_id.lower() in warm else ""
                reasoning = f"Task categorized as '{category.value}'. Selected the smallest compatible {warm_note}model '{selected_spec.name}'."

        self.active_model_key = selected_spec.model_id
        escalation_level = self._escalation_level(selected_spec)

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
            provider_config=provider_cfg,
            supports_tools=bool(selected_spec.supports_tools),
            latency_target_ms=selected_spec.latency_target_ms,
            context_size=selected_spec.context_size,
            escalation_level=escalation_level,
        )

    # Convenience alias for callers that prefer to pass a constraints dictionary.
    def route_task_with_constraints(self, prompt: str, context_files_count: int = 0, **constraints: Any) -> RoutingDecision:
        return self.route_task(prompt, context_files_count, **constraints)

    def _available_model_ids(self, backend_id: str) -> set[str]:
        if self.backend_manager is None:
            return set()
        active = self.backend_manager.get_active_backend()
        if not active or (backend_id not in ("auto", active.id)) or not active.discovered_models:
            return set()
        return {model.lower() for model in active.discovered_models}

    @staticmethod
    def _normalize_warm_models(warm_models: set[str] | list[str] | dict[str, bool] | None) -> set[str]:
        if isinstance(warm_models, dict):
            return {key.lower() for key, value in warm_models.items() if value}
        return {item.lower() for item in (warm_models or set())}

    @staticmethod
    def _normalize_hardware(hardware: str | list[str] | None) -> set[str]:
        if not hardware:
            return set()
        return {hardware.lower()} if isinstance(hardware, str) else {item.lower() for item in hardware}

    @staticmethod
    def _is_compatible(spec, category, requires_tools, latency_budget_ms, required_context, hardware) -> bool:
        if requires_tools and not spec.supports_tools:
            return False
        if required_context and spec.context_size < required_context:
            return False
        if latency_budget_ms is not None and spec.latency_target_ms is not None and spec.latency_target_ms > latency_budget_ms:
            return False
        if hardware and not hardware.intersection(spec.hardware):
            return False
        return not spec.task_categories or category.value in spec.task_categories

    @staticmethod
    def _escalation_level(spec) -> int:
        if spec.parameter_billions >= 60:
            return 3
        if spec.parameter_billions >= 20:
            return 2
        if spec.parameter_billions >= 5:
            return 1
        return 0

    def get_provider(self, model_key: str | None = None) -> BaseProvider:
        """Gets or creates provider for model key or active backend."""
        if self.backend_manager is not None:
            active_backend = self.backend_manager.get_active_backend()
            if active_backend and active_backend.is_available():
                active_prov = self.backend_manager.get_active_provider()
                if active_prov is not None:
                    return active_prov

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
