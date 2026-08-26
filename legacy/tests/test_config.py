import os
from forge.config.settings import load_config, ForgeConfig, ModelConfig

def test_load_config_defaults():
    cfg = load_config()
    assert isinstance(cfg, ForgeConfig)
    assert cfg.primary_model == "glm"
    assert cfg.secondary_model == "kimi"
    assert cfg.safe_mode is True
    assert "glm" in cfg.models
    assert "kimi" in cfg.models

def test_config_env_overrides(monkeypatch):
    monkeypatch.setenv("FORGE_PRIMARY_MODEL", "kimi")
    monkeypatch.setenv("FORGE_SAFE_MODE", "false")
    cfg = load_config()
    assert cfg.primary_model == "kimi"
    assert cfg.safe_mode is False
