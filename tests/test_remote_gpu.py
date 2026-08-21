from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from forge.cli.commands.registry import SlashCommandRegistry
from forge.cli.commands.remote import handle_remote, register_remote_command
from forge.config.settings import load_config
from forge.remote.config import RemoteConfig, load_remote_config
from forge.remote.lightning import LightningProvider
from forge.remote.manager import RemoteManager, format_duration
from forge.remote.tunnel import SSHTunnelManager


def test_remote_config_defaults_and_env_overrides(monkeypatch):
    """Tests loading remote configuration with defaults and environment variable overrides."""
    monkeypatch.delenv("FORGE_REMOTE_PROVIDER", raising=False)
    monkeypatch.delenv("FORGE_LIGHTNING_STUDIO", raising=False)
    monkeypatch.delenv("FORGE_LIGHTNING_GPU", raising=False)
    monkeypatch.delenv("FORGE_REMOTE_PORT", raising=False)
    monkeypatch.delenv("FORGE_LIGHTNING_API_KEY", raising=False)
    monkeypatch.delenv("LIGHTNING_API_KEY", raising=False)

    cfg = load_remote_config()
    assert cfg.provider == "lightning"
    assert cfg.studio == "forge-qwen"
    assert cfg.gpu == "NVIDIA L40S 48 GB"
    assert cfg.remote_port == 8000
    assert cfg.auto_start is True
    assert cfg.auto_stop is True

    # Test overrides
    monkeypatch.setenv("FORGE_REMOTE_PROVIDER", "lightning")
    monkeypatch.setenv("FORGE_LIGHTNING_STUDIO", "custom-studio")
    monkeypatch.setenv("FORGE_LIGHTNING_GPU", "A100")
    monkeypatch.setenv("FORGE_REMOTE_PORT", "9000")
    monkeypatch.setenv("FORGE_LIGHTNING_API_KEY", "secret-api-key-12345")
    monkeypatch.setenv("FORGE_REMOTE_AUTO_START", "false")
    monkeypatch.setenv("FORGE_REMOTE_AUTO_STOP", "false")

    cfg_overridden = load_remote_config()
    assert cfg_overridden.studio == "custom-studio"
    assert cfg_overridden.gpu == "A100"
    assert cfg_overridden.remote_port == 9000
    assert cfg_overridden.api_key == "secret-api-key-12345"
    assert cfg_overridden.auto_start is False
    assert cfg_overridden.auto_stop is False
    assert cfg_overridden.get_masked_api_key() == "secr...2345"


def test_remote_config_yaml_merging():
    """Tests merging remote settings from yaml dictionary data."""
    yaml_data = {
        "remote": {
            "provider": "lightning",
            "studio": "yaml-studio",
            "gpu": "L40S",
            "remote_port": 8888,
            "auto_start": True,
            "auto_stop": False,
        }
    }
    cfg = load_remote_config(yaml_data)
    assert cfg.studio == "yaml-studio"
    assert cfg.gpu == "L40S"
    assert cfg.remote_port == 8888
    assert cfg.auto_start is True
    assert cfg.auto_stop is False


def test_ssh_tunnel_manager_mock_and_lifecycle():
    """Tests SSHTunnelManager lifecycle in mock/test mode."""
    tunnel = SSHTunnelManager(
        ssh_host="ssh.lightning.ai",
        ssh_user="forge-qwen",
        remote_port=8000,
        local_port=8000,
    )
    assert tunnel.get_ssh_target() == "forge-qwen@ssh.lightning.ai"

    tunnel._is_mock = True
    assert tunnel.start() is True
    assert tunnel.is_alive() is True
    assert tunnel.ensure_alive() is True

    tunnel.stop()
    assert tunnel.is_alive() is False


def test_lightning_provider_lifecycle():
    """Tests LightningProvider methods with mocked SDK/network interactions."""
    cfg = RemoteConfig(studio="forge-qwen", gpu="NVIDIA L40S 48 GB", remote_port=8000)
    provider = LightningProvider(cfg)
    provider._mock_mode = True
    provider.tunnel._is_mock = True

    assert provider.is_running() is False
    assert provider.start() is True
    assert provider.is_running() is True

    assert provider.connect() is True
    status = provider.get_status()
    assert status.provider == "Lightning AI"
    assert status.studio_name == "forge-qwen"
    assert status.gpu_type == "NVIDIA L40S 48 GB"
    assert status.status in ("running", "connected")

    assert provider.stop() is True
    assert provider.is_running() is False


def test_lightning_provider_wait_until_ready_success():
    """Tests wait_until_ready success path through all stages."""
    cfg = RemoteConfig(startup_timeout=10.0, retry_interval=0.01)
    provider = LightningProvider(cfg)
    provider._mock_mode = True
    provider.tunnel._is_mock = True

    stages_hit = []

    def callback(stage: str, msg: str):
        stages_hit.append(stage)

    res = provider.wait_until_ready(progress_callback=callback)
    assert res is True
    assert "start_studio" in stages_hit
    assert "studio_ready" in stages_hit
    assert "gpu_ready" in stages_hit
    assert "tunnel_ready" in stages_hit
    assert "vllm_ready" in stages_hit
    assert "ready" in stages_hit


def test_lightning_provider_wait_until_ready_stage_failures():
    """Tests wait_until_ready failure handling at specific stages."""
    cfg = RemoteConfig(startup_timeout=0.1, retry_interval=0.01)

    # Stage 1 Failure (Studio start exception)
    provider1 = LightningProvider(cfg)
    provider1._mock_mode = True
    provider1._mock_fail_stage = "start"
    with pytest.raises(RuntimeError, match="Failed to start Lightning Studio"):
        provider1.wait_until_ready()

    # Stage 2 Failure (GPU readiness)
    provider2 = LightningProvider(cfg)
    provider2._mock_mode = True
    provider2._mock_fail_stage = "gpu"
    with pytest.raises(TimeoutError, match="Stage 2 Failed"):
        provider2.wait_until_ready()

    # Stage 3 Failure (SSH Tunnel connection error)
    provider3 = LightningProvider(cfg)
    provider3._mock_mode = True
    provider3._mock_fail_stage = "tunnel"
    with pytest.raises(ConnectionError, match="Stage 3 Failed"):
        provider3.wait_until_ready()

    # Stage 4 Failure (vLLM health check failure)
    provider4 = LightningProvider(cfg)
    provider4._mock_mode = True
    provider4._mock_fail_stage = "vllm"
    with pytest.raises(TimeoutError, match="Stage 4 Failure"):
        provider4.wait_until_ready()


def test_remote_manager_already_running():
    """Tests RemoteManager behavior when remote GPU is ALREADY running."""
    cfg = RemoteConfig(studio="forge-qwen")
    provider = LightningProvider(cfg)
    provider._mock_mode = True
    provider.tunnel._is_mock = True
    provider._internal_status = "running"

    manager = RemoteManager(config=cfg, provider=provider)

    with patch.object(manager, "check_backend_available", return_value=True):
        res = manager.ensure_remote_gpu(interactive=True)
        assert res is True
        assert manager.started_by_forge is False

        # Shutdown should NOT stop the GPU if Forge didn't start it
        manager.shutdown()
        assert provider.is_running() is True


def test_remote_manager_forge_started_lifecycle_and_auto_stop():
    """Tests RemoteManager starting GPU programmatically and auto-stopping on exit."""
    cfg = RemoteConfig(studio="forge-qwen", auto_stop=True)
    provider = LightningProvider(cfg)
    provider._mock_mode = True
    provider.tunnel._is_mock = True
    provider._internal_status = "stopped"

    manager = RemoteManager(config=cfg, provider=provider)

    with patch.object(manager, "check_backend_available", side_effect=[False, True]):
        with patch.object(manager, "render_startup_prompt", return_value="start"):
            res = manager.ensure_remote_gpu(interactive=True)
            assert res is True
            assert manager.started_by_forge is True
            assert manager.session_start_time is not None
            assert provider.is_running() is True

            # Perform shutdown - should stop GPU because Forge started it
            manager.shutdown()
            assert provider.is_running() is False
            assert manager.started_by_forge is False


def test_session_duration_formatting():
    """Tests session duration calculation and string formatting."""
    assert format_duration(0) == "0s"
    assert format_duration(42) == "42s"
    assert format_duration(125) == "2m 5s"
    assert format_duration(6120) == "1h 42m"


def test_remote_slash_command():
    """Tests /remote slash command subcommands (status, start, stop, restart)."""
    registry = SlashCommandRegistry()
    register_remote_command(registry)
    cmd = registry.get("remote")
    assert cmd is not None

    cfg = RemoteConfig(studio="forge-qwen")
    provider = LightningProvider(cfg)
    provider._mock_mode = True
    provider.tunnel._is_mock = True
    manager = RemoteManager(config=cfg, provider=provider)

    mock_orchestrator = MagicMock()
    mock_orchestrator.remote_manager = manager
    mock_orchestrator.config = load_config()

    class DummyConsole:
        def print(self, *args, **kwargs):
            pass

    mock_shell = MagicMock()
    mock_shell.orchestrator = mock_orchestrator
    mock_shell.console = DummyConsole()

    # /remote status
    res_status = handle_remote(mock_shell, ["status"])
    assert res_status is False

    # /remote start
    res_start = handle_remote(mock_shell, ["start"])
    assert res_start is False
    assert provider.is_running() is True
    assert manager.started_by_forge is True

    # /remote stop
    res_stop = handle_remote(mock_shell, ["stop"])
    assert res_stop is False
    assert provider.is_running() is False

    # /remote restart
    res_restart = handle_remote(mock_shell, ["restart"])
    assert res_restart is False
    assert provider.is_running() is True
