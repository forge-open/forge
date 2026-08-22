from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

import yaml

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass


from forge.remote.config import RemoteConfig, load_remote_config


@dataclass
class ModelConfig:
    name: str
    provider: str = "openai-compatible"
    base_url: str = "http://localhost:8000/v1"
    api_key: str = "local-key"
    temperature: float = 0.1
    top_p: float = 0.95
    max_tokens: int = 2048


@dataclass
class ForgeConfig:
    base_url: str = "http://localhost:8000/v1"
    ollama_base_url: str = "http://localhost:11434"
    active_backend: str = "auto"
    model: str = ""
    temperature: float = 0.1
    max_tokens: int = 2048
    system_prompt: str = (
        "You are Forge, an intelligent, polished AI coding assistant. "
        "Provide direct, high-quality answers and clean code implementations. "
        "Answer directly without any internal planning, meta commentary, or reasoning outputs "
        "such as 'We need answer the user...', 'Need produce final answer...', or 'Need think through...'. "
        "Never expose internal thoughts or meta commentary."
    )
    primary_model: str = "qwen3.8-27b-fp8"
    secondary_model: str = "qwen2.5-coder-7b"
    safe_mode: bool = True
    drive_vault_path: str = "/content/drive/MyDrive/AI Model Vault"
    models: dict[str, ModelConfig] = field(default_factory=dict)
    remote: RemoteConfig = field(default_factory=RemoteConfig)

    def get_primary_model(self) -> ModelConfig:
        return self.models.get(
            self.primary_model,
            ModelConfig(
                name=self.model or "qwen3.8-27b-fp8",
                base_url=self.base_url,
                temperature=self.temperature,
                max_tokens=self.max_tokens,
            ),
        )

    def get_secondary_model(self) -> ModelConfig:
        return self.models.get(
            self.secondary_model,
            ModelConfig(name="qwen2.5-coder-7b", base_url=self.base_url),
        )


def load_config(config_path: str | None = None) -> ForgeConfig:
    """Loads configuration from environment variables, yaml config, or defaults."""
    base_url = os.getenv("FORGE_BASE_URL") or "http://localhost:8000/v1"
    model = os.getenv("FORGE_MODEL") or ""

    try:
        temperature = float(os.getenv("FORGE_TEMPERATURE", "0.1"))
    except ValueError:
        temperature = 0.1

    try:
        max_tokens = int(os.getenv("FORGE_MAX_TOKENS", "2048"))
    except ValueError:
        max_tokens = 2048

    cfg = ForgeConfig(
        base_url=base_url,
        model=model,
        temperature=temperature,
        max_tokens=max_tokens,
    )

    # Initialize default model entry
    cfg.models["qwen"] = ModelConfig(
        name=model or "Qwen3.8 27B FP8",
        provider="openai-compatible",
        base_url=base_url,
        api_key=os.getenv("FORGE_API_KEY") or "local-key",
        temperature=temperature,
        max_tokens=max_tokens,
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
                if "base_url" in data:
                    cfg.base_url = str(data["base_url"])
                if "model" in data:
                    cfg.model = str(data["model"])
                if "temperature" in data:
                    cfg.temperature = float(data["temperature"])
                if "max_tokens" in data:
                    cfg.max_tokens = int(data["max_tokens"])
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
                                base_url=mdata.get("base_url") or mdata.get("endpoint") or cfg.base_url,
                                api_key=mdata.get("api_key", "local-key"),
                                temperature=float(mdata.get("temperature", cfg.temperature)),
                                top_p=float(mdata.get("top_p", 0.95)),
                                max_tokens=int(mdata.get("max_tokens", cfg.max_tokens)),
                            )
                if "remote" in data and isinstance(data["remote"], dict):
                    cfg.remote = load_remote_config(data["remote"])
                break
            except Exception:
                pass

    if not hasattr(cfg, "remote") or cfg.remote is None:
        cfg.remote = load_remote_config()
    else:
        # Re-apply environment variable overrides onto cfg.remote
        cfg.remote = load_remote_config(cfg.remote.__dict__)

    # Environment variable overrides
    ollama_url = os.getenv("FORGE_OLLAMA_BASE_URL") or os.getenv("FORGE_LOCAL_BASE_URL")
    if ollama_url:
        cfg.ollama_base_url = ollama_url
    if os.getenv("FORGE_BACKEND"):
        cfg.active_backend = os.getenv("FORGE_BACKEND")
    if os.getenv("FORGE_PRIMARY_MODEL"):
        cfg.primary_model = os.getenv("FORGE_PRIMARY_MODEL")
    if os.getenv("FORGE_SAFE_MODE"):
        cfg.safe_mode = os.getenv("FORGE_SAFE_MODE").lower() in ("true", "1", "yes")
    if os.getenv("FORGE_DRIVE_VAULT_PATH"):
        cfg.drive_vault_path = os.getenv("FORGE_DRIVE_VAULT_PATH")

    return cfg
