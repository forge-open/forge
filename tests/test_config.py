from forge.config.settings import ForgeConfig, load_config


def test_load_config_defaults():
    cfg = load_config()
    assert isinstance(cfg, ForgeConfig)
    assert cfg.base_url == "http://localhost:8000/v1"
    assert cfg.temperature == 0.1
    assert cfg.max_tokens == 2048
    assert "qwen" in cfg.models


def test_config_env_overrides(monkeypatch):
    monkeypatch.setenv("FORGE_BASE_URL", "http://custom-host:9000/v1")
    monkeypatch.setenv("FORGE_MODEL", "qwen-custom-test")
    monkeypatch.setenv("FORGE_TEMPERATURE", "0.7")
    monkeypatch.setenv("FORGE_MAX_TOKENS", "1024")
    monkeypatch.setenv("FORGE_SAFE_MODE", "false")

    cfg = load_config()
    assert cfg.base_url == "http://custom-host:9000/v1"
    assert cfg.model == "qwen-custom-test"
    assert cfg.temperature == 0.7
    assert cfg.max_tokens == 1024
    assert cfg.safe_mode is False
