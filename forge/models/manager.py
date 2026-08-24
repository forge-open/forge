from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from forge.models.registry import ModelSpec, get_model_registry


@dataclass
class ModelSource:
    """Represents an installation or distribution source for models."""
    source_type: str  # "remote_server", "local_file", "cloud_gpu", "api_provider", "registry"
    location: str
    is_active: bool = False
    metadata: Dict[str, Any] = field(default_factory=dict)


class ModelManager:
    """Manages model sources, installed checkpoints, and distribution infrastructure separately from inference providers."""

    def __init__(self) -> None:
        self.registry = get_model_registry()
        self.sources: Dict[str, ModelSource] = {
            "vllm_remote": ModelSource(
                source_type="remote_server",
                location="http://localhost:8000/v1",
                is_active=True,
                metadata={"gpu": "NVIDIA L40S 48GB", "engine": "vLLM"}
            )
        }

    def list_available(self) -> List[ModelSpec]:
        """Lists all supported model specifications from registry."""
        return self.registry.list_models()

    def list_installed(self) -> List[Dict[str, Any]]:
        """Lists installed or currently available models across all sources."""
        installed = []
        for spec in self.registry.list_models():
            installed.append({
                "name": spec.name,
                "model_id": spec.model_id,
                "availability": spec.availability,
                "status": "Installed / Available" if spec.availability == "remote" else "Available for Install",
                "provider": spec.provider,
                "context": f"{spec.context_size:,}"
            })
        return installed

    def install_model(self, model_identifier: str) -> Dict[str, Any]:
        """Reports model availability without pretending to install files or downloads."""
        spec = self.registry.get(model_identifier)
        model_name = spec.name if spec else model_identifier
        known_model = model_identifier.lower().strip() in {
            model.model_id.lower() for model in self.registry.list_models()
        }
        return {
            "status": "not_implemented",
            "model": model_name,
            "known_model": known_model,
            "availability": spec.availability if spec else "unknown",
            "changed": False,
            "message": (
                f"Model '{model_name}' is registered for routing, but ModelManager does not "
                "download or install model files. No filesystem changes were made."
            )
        }

    def remove_model(self, model_identifier: str) -> Dict[str, Any]:
        """Reports that model removal is not managed here and no files were changed."""
        spec = self.registry.get(model_identifier)
        model_name = spec.name if spec else model_identifier
        known_model = model_identifier.lower().strip() in {
            model.model_id.lower() for model in self.registry.list_models()
        }
        return {
            "status": "not_implemented",
            "model": model_name,
            "known_model": known_model,
            "availability": spec.availability if spec else "unknown",
            "changed": False,
            "message": (
                f"ModelManager does not track or remove cached checkpoints for '{model_name}'. "
                "No filesystem changes were made."
            )
        }


_GLOBAL_MODEL_MANAGER: Optional[ModelManager] = None


def get_model_manager() -> ModelManager:
    """Singleton getter for global ModelManager."""
    global _GLOBAL_MODEL_MANAGER
    if _GLOBAL_MODEL_MANAGER is None:
        _GLOBAL_MODEL_MANAGER = ModelManager()
    return _GLOBAL_MODEL_MANAGER
