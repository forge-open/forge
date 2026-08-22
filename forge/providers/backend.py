from __future__ import annotations

import os
from dataclasses import dataclass, field

from forge.config.settings import ForgeConfig, ModelConfig, load_config
from forge.providers.base import BaseProvider
from forge.providers.ollama_provider import OllamaProvider
from forge.providers.openai_provider import OpenAICompatibleProvider
from forge.remote.config import RemoteConfig
from forge.remote.manager import RemoteManager, get_remote_manager


@dataclass
class BackendInfo:
    id: str  # "ollama", "vllm", "lightning"
    name: str  # "Ollama", "vLLM", "Lightning AI"
    backend_type: str  # "local" or "remote"
    location: str  # "Local", "forge-qwen", etc.
    endpoint: str  # "http://localhost:11434", etc.
    model: str  # Primary active model ID (e.g. "gemma3:4b-it-qat", "deepseek-r1:14b")
    status: str  # "connected", "stopped", "unreachable", "not detected"
    gpu: str = ""  # "NVIDIA L40S 48 GB" or ""
    discovered_models: list[str] = field(default_factory=list)
    provider: BaseProvider | None = field(default=None, repr=False)
    action_hint: str = ""

    def is_available(self) -> bool:
        return self.status == "connected"


class BackendManager:
    """Discovers, manages, and selects inference backends dynamically across Ollama, vLLM, and Lightning AI."""

    def __init__(
        self,
        config: ForgeConfig | None = None,
        remote_manager: RemoteManager | None = None,
    ):
        self.config = config or load_config()
        self.remote_manager = remote_manager or get_remote_manager(self.config.remote)
        self.backends: dict[str, BackendInfo] = {}
        self._active_backend_id: str | None = None

    def discover_backends(self) -> dict[str, BackendInfo]:
        """Probes all configured local and remote backends and discovers installed models dynamically."""
        discovered: dict[str, BackendInfo] = {}

        # 1. Ollama Dynamic Probe
        ollama_url = (
            os.getenv("FORGE_OLLAMA_BASE_URL")
            or os.getenv("FORGE_LOCAL_BASE_URL")
            or getattr(self.config, "ollama_base_url", "http://localhost:11434")
        )
        if ":8000" in ollama_url and not os.getenv("FORGE_OLLAMA_BASE_URL"):
            ollama_url = "http://localhost:11434"

        ollama_provider = OllamaProvider(base_url=ollama_url)
        ollama_health = ollama_provider.check_health()
        if ollama_health.get("reachable"):
            models = ollama_health.get("models", [])
            primary_model = ollama_health.get("detected_model") or (models[0] if models else "")
            discovered["ollama"] = BackendInfo(
                id="ollama",
                name="Ollama",
                backend_type="local",
                location="Local",
                endpoint=ollama_url,
                model=primary_model,
                status="connected",
                discovered_models=models,
                provider=ollama_provider,
            )
        else:
            discovered["ollama"] = BackendInfo(
                id="ollama",
                name="Ollama",
                backend_type="local",
                location="Local",
                endpoint=ollama_url,
                model="",
                status="unreachable",
                discovered_models=[],
                provider=ollama_provider,
                action_hint=(
                    "Make sure the Ollama Docker container or service is running.\n"
                    "For example:\n"
                    "  docker ps\n"
                    "or:\n"
                    "  docker start ollama"
                ),
            )

        # 2. vLLM / Local OpenAI-compatible Dynamic Probe
        vllm_url = (
            os.getenv("FORGE_LOCAL_VLLM_BASE_URL")
            or getattr(self.config, "base_url", "http://localhost:8000/v1")
        )
        vllm_provider = OpenAICompatibleProvider(ModelConfig(name="", base_url=vllm_url))
        vllm_health = vllm_provider.check_health()
        lightning_running = (
            hasattr(self.remote_manager, "_provider")
            and self.remote_manager._provider.is_running()
        )
        if vllm_health.get("reachable") and not lightning_running:
            models = vllm_health.get("models", [])
            primary_model = vllm_health.get("detected_model") or (models[0] if models else "")
            discovered["vllm"] = BackendInfo(
                id="vllm",
                name="vLLM",
                backend_type="local",
                location="Local",
                endpoint=vllm_url,
                model=primary_model,
                status="connected",
                discovered_models=models,
                provider=vllm_provider,
            )
        else:
            discovered["vllm"] = BackendInfo(
                id="vllm",
                name="vLLM",
                backend_type="local",
                location="Local",
                endpoint=vllm_url,
                model="",
                status="not detected",
                discovered_models=[],
                provider=vllm_provider,
                action_hint="vLLM local server is not running.",
            )

        # 3. Lightning AI Remote Dynamic Probe
        remote_cfg: RemoteConfig = self.config.remote
        lightning_status_obj = self.remote_manager.get_status()
        if lightning_status_obj.status in ("connected", "running") and self.remote_manager.check_backend_available():
            remote_model = self.remote_manager.detect_remote_model()
            discovered["lightning"] = BackendInfo(
                id="lightning",
                name="Lightning AI",
                backend_type="remote",
                location=remote_cfg.studio,
                endpoint=f"http://{remote_cfg.remote_host}:{remote_cfg.remote_port}/v1",
                model=remote_model,
                status="connected",
                gpu=remote_cfg.gpu,
                discovered_models=[remote_model] if remote_model else [],
                action_hint="",
            )
        else:
            discovered["lightning"] = BackendInfo(
                id="lightning",
                name="Lightning AI",
                backend_type="remote",
                location=remote_cfg.studio,
                endpoint=f"SSH Tunnel (port {remote_cfg.remote_port})",
                model="",
                status="stopped",
                gpu=remote_cfg.gpu,
                discovered_models=[],
                action_hint="Start remote GPU via interactive startup prompt or '/remote start'.",
            )

        self.backends = discovered
        return discovered

    def select_active_backend(self, backend_id: str) -> BackendInfo | None:
        """Explicitly selects an active backend by ID ('ollama', 'vllm', 'lightning')."""
        if not self.backends:
            self.discover_backends()

        if backend_id in self.backends:
            self._active_backend_id = backend_id
            return self.backends[backend_id]
        return None

    def get_active_backend(self) -> BackendInfo | None:
        """Returns current active BackendInfo."""
        if not self.backends:
            self.discover_backends()

        if self._active_backend_id and self._active_backend_id in self.backends:
            return self.backends[self._active_backend_id]

        # Auto-selection prioritizing connected backends:
        if self.backends.get("ollama") and self.backends["ollama"].is_available():
            self._active_backend_id = "ollama"
            return self.backends["ollama"]

        if self.backends.get("lightning") and self.backends["lightning"].is_available():
            self._active_backend_id = "lightning"
            return self.backends["lightning"]

        if self.backends.get("vllm") and self.backends["vllm"].is_available():
            self._active_backend_id = "vllm"
            return self.backends["vllm"]

        if "ollama" in self.backends:
            self._active_backend_id = "ollama"
            return self.backends["ollama"]

        return list(self.backends.values())[0] if self.backends else None

    def get_active_provider(self) -> BaseProvider | None:
        """Returns BaseProvider instance corresponding to current active backend."""
        active = self.get_active_backend()
        if not active:
            return None

        if active.provider is not None:
            return active.provider

        if active.id == "ollama":
            p = OllamaProvider(base_url=active.endpoint, model_name=active.model)
            active.provider = p
            return p
        else:
            cfg = ModelConfig(name=active.model, base_url=active.endpoint)
            p = OpenAICompatibleProvider(cfg)
            active.provider = p
            return p
