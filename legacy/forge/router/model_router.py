from typing import Dict, Any, Optional
from forge.config.settings import ForgeConfig, ModelConfig
from forge.providers.base import BaseProvider
from forge.providers.openai_provider import OpenAICompatibleProvider
from forge.utils.logging import logger

class ModelRouter:
    """Routes requests to Primary (GLM 5.2), Secondary (Kimi K2.5), or custom provider endpoints."""

    def __init__(self, config: ForgeConfig):
        self.config = config
        self._providers: Dict[str, BaseProvider] = {}
        self.active_model_key: str = config.primary_model

    def get_provider(self, model_key: Optional[str] = None) -> BaseProvider:
        key = model_key or self.active_model_key
        if key not in self._providers:
            model_cfg = self.config.models.get(key)
            if not model_cfg:
                # Fallback to GLM or default configuration
                model_cfg = ModelConfig(name=key)
            self._providers[key] = OpenAICompatibleProvider(model_cfg)
        return self._providers[key]

    def set_active_model(self, model_key: str) -> None:
        if model_key in ("glm", "glm-5.2", "primary"):
            self.active_model_key = "glm"
        elif model_key in ("kimi", "kimi-k2.5", "secondary"):
            self.active_model_key = "kimi"
        else:
            self.active_model_key = model_key
        logger.info(f"Model router active model switched to: {self.active_model_key}")

    def get_primary_provider(self) -> BaseProvider:
        return self.get_provider(self.config.primary_model)

    def get_secondary_provider(self) -> BaseProvider:
        return self.get_provider(self.config.secondary_model)
