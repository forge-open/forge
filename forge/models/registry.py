from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass
class ModelSpec:
    """Dataclass holding authoritative metadata for a supported model."""
    name: str
    model_id: str
    provider: str = "openai-compatible"
    capabilities: List[str] = field(default_factory=lambda: ["code_generation", "tool_use"])
    coding_capability: int = 8  # Rating 1-10
    reasoning_capability: int = 8  # Rating 1-10
    speed: str = "medium"  # "fast", "medium", "slow"
    context_size: int = 16384
    availability: str = "remote"  # "remote" or "local"
    description: str = ""


class ModelRegistry:
    """Single source of truth for supported model metadata and specifications in Forge."""

    def __init__(self) -> None:
        self._registry: Dict[str, ModelSpec] = {}
        self._register_default_models()

    def _register_default_models(self) -> None:
        """Registers default supported models."""
        self.register(ModelSpec(
            name="Qwen3 27B FP8",
            model_id="qwen3.8-27b-fp8",
            provider="openai-compatible",
            capabilities=["code_generation", "refactoring", "debugging", "repository_level_task", "reasoning", "tool_use"],
            coding_capability=9,
            reasoning_capability=9,
            speed="medium",
            context_size=16384,
            availability="remote",
            description="Primary high-capability open-weight coding and reasoning model running on remote L40S GPU."
        ))

        self.register(ModelSpec(
            name="Qwen2.5 Coder 7B",
            model_id="qwen2.5-coder-7b-instruct",
            provider="openai-compatible",
            capabilities=["small_coding_task", "code_explanation", "simple_question"],
            coding_capability=8,
            reasoning_capability=7,
            speed="fast",
            context_size=16384,
            availability="local",
            description="Fast local open-weight model for lightweight coding tasks and explanations."
        ))

        self.register(ModelSpec(
            name="Gemma 2 9B",
            model_id="gemma-2-9b-it",
            provider="openai-compatible",
            capabilities=["simple_question", "code_explanation", "small_coding_task"],
            coding_capability=7,
            reasoning_capability=7,
            speed="fast",
            context_size=8192,
            availability="local",
            description="Compact model suited for fast explanations and lightweight questions."
        ))

    def register(self, spec: ModelSpec) -> None:
        """Registers a new ModelSpec by its model_id and clean lowercase keys."""
        key = spec.model_id.lower()
        self._registry[key] = spec

    def get(self, model_id_or_key: str) -> Optional[ModelSpec]:
        """Retrieves a ModelSpec by exact model_id, key, or alias."""
        if not model_id_or_key:
            return self.get_default()

        clean_key = model_id_or_key.lower().strip()
        if clean_key in self._registry:
            return self._registry[clean_key]

        # Partial matching fallback
        for key, spec in self._registry.items():
            if clean_key in key or clean_key in spec.name.lower():
                return spec

        return None

    def get_default(self) -> ModelSpec:
        """Returns the primary default model spec (Qwen3 27B FP8)."""
        return self._registry.get("qwen3.8-27b-fp8") or list(self._registry.values())[0]

    def list_models(self) -> List[ModelSpec]:
        """Returns all registered ModelSpec objects."""
        return list(self._registry.values())

    def get_supported_model_ids(self) -> List[str]:
        """Returns a list of all supported model IDs."""
        return [spec.model_id for spec in self._registry.values()]


_GLOBAL_MODEL_REGISTRY: Optional[ModelRegistry] = None


def get_model_registry() -> ModelRegistry:
    """Singleton getter for the global ModelRegistry."""
    global _GLOBAL_MODEL_REGISTRY
    if _GLOBAL_MODEL_REGISTRY is None:
        _GLOBAL_MODEL_REGISTRY = ModelRegistry()
    return _GLOBAL_MODEL_REGISTRY
