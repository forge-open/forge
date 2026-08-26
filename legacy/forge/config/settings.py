import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Any, Optional
import yaml

@dataclass
class ModelConfig:
    name: str
    provider: str = "openai-compatible"
    base_url: str = "http://localhost:8000/v1"
    api_key: str = "local-key"
    temperature: float = 0.2
    top_p: float = 0.95
    max_tokens: int = 4096

@dataclass
class ForgeConfig:
    primary_model: str = "glm"
    secondary_model: str = "kimi"
    safe_mode: bool = True
    drive_vault_path: str = "/content/drive/MyDrive/AI Model Vault"
    models: Dict[str, ModelConfig] = field(default_factory=dict)

    def get_primary_model(self) -> ModelConfig:
        return self.models.get(self.primary_model, ModelConfig(name="GLM-5.2"))

    def get_secondary_model(self) -> ModelConfig:
        return self.models.get(self.secondary_model, ModelConfig(name="Kimi-K2.5", base_url="http://localhost:8001/v1"))

def load_config(config_path: Optional[str] = None) -> ForgeConfig:
    """Loads configuration from environment variables, yaml config, or defaults."""
    cfg = ForgeConfig()
    
    # Initialize default models
    cfg.models["glm"] = ModelConfig(
        name="GLM-5.2",
        provider="openai-compatible",
        base_url=os.getenv("GLM_BASE_URL") or os.getenv("GLM_ENDPOINT") or "http://localhost:8000/v1",
        api_key=os.getenv("GLM_API_KEY") or "local-key",
    )
    cfg.models["kimi"] = ModelConfig(
        name="Kimi-K2.5",
        provider="openai-compatible",
        base_url=os.getenv("KIMI_BASE_URL") or os.getenv("KIMI_ENDPOINT") or "http://localhost:8001/v1",
        api_key=os.getenv("KIMI_API_KEY") or "local-key",
    )

    # Check potential config locations
    paths_to_check = []
    if config_path:
        paths_to_check.append(Path(config_path))
    paths_to_check.extend([
        Path.cwd() / ".forge" / "config.yaml",
        Path.home() / ".forge" / "config.yaml"
    ])

    for p in paths_to_check:
        if p.exists() and p.is_file():
            try:
                with open(p, "r", encoding="utf-8") as f:
                    data = yaml.safe_load(f) or {}
                if "primary_model" in data:
                    cfg.primary_model = data["primary_model"]
                if "secondary_model" in data:
                    cfg.secondary_model = data["secondary_model"]
                if "safe_mode" in data:
                    cfg.safe_mode = bool(data["safe_mode"])
                if "drive_vault_path" in data:
                    cfg.drive_vault_path = data["drive_vault_path"]
                if "models" in data and isinstance(data["models"], dict):
                    for key, mdata in data["models"].items():
                        if isinstance(mdata, dict):
                            cfg.models[key] = ModelConfig(
                                name=mdata.get("name", key),
                                provider=mdata.get("provider", "openai-compatible"),
                                base_url=mdata.get("base_url") or mdata.get("endpoint") or "http://localhost:8000/v1",
                                api_key=mdata.get("api_key", "local-key"),
                                temperature=float(mdata.get("temperature", 0.2)),
                                top_p=float(mdata.get("top_p", 0.95)),
                                max_tokens=int(mdata.get("max_tokens", 4096)),
                            )
                break
            except Exception:
                pass

    # Environment variable overrides
    if os.getenv("FORGE_PRIMARY_MODEL"):
        cfg.primary_model = os.getenv("FORGE_PRIMARY_MODEL")
    if os.getenv("FORGE_SAFE_MODE"):
        cfg.safe_mode = os.getenv("FORGE_SAFE_MODE").lower() in ("true", "1", "yes")
    if os.getenv("FORGE_DRIVE_VAULT_PATH"):
        cfg.drive_vault_path = os.getenv("FORGE_DRIVE_VAULT_PATH")

    return cfg
