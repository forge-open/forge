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
    # Routing metadata. Defaults preserve compatibility with user-defined specs.
    supports_tools: bool | None = None
    latency_target_ms: int | None = None
    hardware: List[str] = field(default_factory=lambda: ["cpu"])
    engines: List[str] = field(default_factory=list)
    parameter_billions: float = 0.0
    task_categories: List[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        """Normalize metadata while keeping capabilities as the legacy source."""
        if self.supports_tools is None:
            self.supports_tools = "tool_use" in self.capabilities
        self.hardware = [item.lower() for item in self.hardware]
        self.engines = [item.lower() for item in self.engines]


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
            description="Primary high-capability open-weight coding and reasoning model running on remote L40S GPU.",
            supports_tools=True, latency_target_ms=2500,
            hardware=["gpu", "remote", "48gb-vram"], engines=["vllm", "openai-compatible"],
            parameter_billions=27, task_categories=["large coding task", "repository level task", "debugging", "refactoring"]
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
            description="Fast local open-weight model for lightweight coding tasks and explanations.",
            supports_tools=False, latency_target_ms=1200,
            hardware=["cpu", "gpu", "local"], engines=["ollama", "vllm"],
            parameter_billions=7, task_categories=["small coding task", "code explanation"]
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
            description="Compact model suited for fast explanations and lightweight questions.",
            supports_tools=False, latency_target_ms=1000,
            hardware=["cpu", "gpu", "local"], engines=["ollama", "vllm"],
            parameter_billions=9, task_categories=["simple question", "code explanation"]
        ))

        self.register(ModelSpec(
            name="Gemma 3 4B IT QAT",
            model_id="gemma3:4b-it-qat",
            provider="ollama",
            capabilities=["code_generation", "refactoring", "debugging", "code_explanation", "tool_use"],
            coding_capability=8,
            reasoning_capability=8,
            speed="fast",
            context_size=8192,
            availability="local",
            description="Quantized local instruction-tuned Gemma 3 4B model running on Ollama.",
            supports_tools=False, latency_target_ms=1000,
            hardware=["cpu", "gpu", "local"], engines=["ollama"],
            parameter_billions=4, task_categories=["simple question", "code explanation", "small coding task"]
        ))

        # Curated profiles used by the capability-aware router.
        self.register(ModelSpec(
            name="Qwen Coder SLM",
            model_id="qwen2.5-coder-1.5b-instruct",
            provider="ollama",
            capabilities=["small_coding_task", "code_explanation"],
            coding_capability=7, reasoning_capability=6, speed="fast",
            context_size=32768, availability="local",
            description="Small, fast coding model for low-latency local edits and explanations.",
            supports_tools=False, latency_target_ms=700,
            hardware=["cpu", "gpu", "local"], engines=["ollama", "vllm"],
            parameter_billions=1.5, task_categories=["simple question", "code explanation", "small coding task"]
        ))
        self.register(ModelSpec(
            name="Qwen3-Coder 30B A3B Instruct",
            model_id="qwen3-coder-30b-a3b-instruct",
            provider="openai-compatible",
            capabilities=["code_generation", "refactoring", "debugging", "repository_level_task", "reasoning", "tool_use"],
            coding_capability=10, reasoning_capability=9, speed="medium",
            context_size=262144, availability="remote",
            description="Agentic coding model with a sparse architecture and long context.",
            supports_tools=True, latency_target_ms=2500,
            hardware=["gpu", "remote", "24gb-vram"], engines=["vllm", "openai-compatible"],
            parameter_billions=30.5, task_categories=["normal coding task", "large coding task", "repository level task", "debugging", "refactoring"]
        ))
        self.register(ModelSpec(
            name="Qwen3-Coder Next",
            model_id="qwen3-coder-next",
            provider="openai-compatible",
            capabilities=["code_generation", "refactoring", "debugging", "repository_level_task", "reasoning", "tool_use"],
            coding_capability=10, reasoning_capability=10, speed="slow",
            context_size=262144, availability="remote",
            description="Largest remote coding tier for difficult repository-scale work.",
            supports_tools=True, latency_target_ms=5000,
            hardware=["gpu", "remote", "48gb-vram"], engines=["vllm", "openai-compatible"],
            parameter_billions=80, task_categories=["large coding task", "repository level task", "debugging", "refactoring"]
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

        # Dynamic Spec for discovered local models (e.g., custom Ollama model tags)
        return ModelSpec(
            name=model_id_or_key,
            model_id=model_id_or_key,
            provider="ollama" if ":" in model_id_or_key else "openai-compatible",
            capabilities=["code_generation", "tool_use"],
            coding_capability=8,
            reasoning_capability=8,
            speed="fast",
            context_size=8192,
            availability="local",
            description=f"Discovered model {model_id_or_key}."
        )

    def get_default(self) -> ModelSpec:
        """Returns default model spec dynamically from registry."""
        if self._registry:
            return list(self._registry.values())[0]
        return ModelSpec(
            name="Model",
            model_id="default",
            provider="openai-compatible",
            capabilities=["code_generation", "tool_use"],
            coding_capability=8,
            reasoning_capability=8,
            speed="fast",
            context_size=8192,
            availability="local",
            description="Default dynamic model specification."
        )

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
