from __future__ import annotations

from unittest.mock import MagicMock, patch

import httpx
import pytest

from forge.agent.orchestrator import AgentOrchestrator
from forge.cli.commands.model import handle_backends, handle_model, handle_models
from forge.cli.shell import ForgeShell, format_model_display_name, generate_banner_art
from forge.config.settings import ForgeConfig
from forge.providers.backend import BackendInfo, BackendManager
from forge.providers.ollama_provider import OllamaProvider


@pytest.fixture
def mock_config():
    return ForgeConfig(
        base_url="http://localhost:11434",
        ollama_base_url="http://localhost:11434",
    )


def test_ollama_detection(mock_config):
    provider = OllamaProvider(base_url="http://localhost:11434")

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "models": [
            {"name": "gemma3:4b-it-qat", "model": "gemma3:4b-it-qat"}
        ]
    }

    with patch("httpx.Client.get", return_value=mock_resp):
        health = provider.check_health()
        assert health["reachable"] is True
        assert health["status"] == "connected"
        assert health["provider"] == "ollama"


def test_ollama_model_discovery(mock_config):
    provider = OllamaProvider(base_url="http://localhost:11434")

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "models": [
            {"name": "gemma3:4b-it-qat"},
            {"name": "qwen2.5:7b"}
        ]
    }

    with patch("httpx.Client.get", return_value=mock_resp):
        health = provider.check_health()
        assert "gemma3:4b-it-qat" in health["models"]
        assert "qwen2.5:7b" in health["models"]
        assert provider.detect_model() == "gemma3:4b-it-qat"


def test_ollama_connection_failure():
    provider = OllamaProvider(base_url="http://localhost:11434")

    with patch("httpx.Client.get", side_effect=httpx.ConnectError("Connection refused")):
        health = provider.check_health()
        assert health["reachable"] is False
        assert health["status"] == "unreachable"
        assert "docker start ollama" in health["action"]


def test_ollama_timeout():
    provider = OllamaProvider(base_url="http://localhost:11434")

    with patch("httpx.Client.get", side_effect=httpx.TimeoutException("Read timed out")):
        health = provider.check_health()
        assert health["reachable"] is False
        assert health["status"] == "unreachable"


def test_ollama_empty_model_list():
    provider = OllamaProvider(base_url="http://localhost:11434")

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"models": []}

    with patch("httpx.Client.get", return_value=mock_resp):
        health = provider.check_health()
        assert health["reachable"] is True
        assert health["models"] == []
        assert provider.detect_model() == ""


def test_ollama_generation():
    provider = OllamaProvider(base_url="http://localhost:11434", model_name="gemma3:4b-it-qat")

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "model": "gemma3:4b-it-qat",
        "message": {"role": "assistant", "content": "def reverse(s): return s[::-1]"},
        "done": True
    }

    with patch("httpx.Client.post", return_value=mock_resp):
        res = provider.generate([{"role": "user", "content": "reverse string"}])
        assert "def reverse" in res.content
        assert res.role == "assistant"


def test_local_backend_selection(mock_config):
    bm = BackendManager(config=mock_config)

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "models": [{"name": "gemma3:4b-it-qat"}]
    }

    with patch("httpx.Client.get", return_value=mock_resp):
        bm.discover_backends()
        selected = bm.select_active_backend("ollama")
        assert selected is not None
        assert selected.id == "ollama"
        assert selected.model == "gemma3:4b-it-qat"
        assert selected.is_available() is True


def test_lightning_backend_selection(mock_config):
    bm = BackendManager(config=mock_config)
    bm.backends["lightning"] = BackendInfo(
        id="lightning",
        name="Lightning AI",
        backend_type="remote",
        location="forge-qwen",
        endpoint="http://localhost:8000/v1",
        model="Qwen3.8 27B FP8",
        status="connected",
        gpu="NVIDIA L40S 48 GB"
    )

    selected = bm.select_active_backend("lightning")
    assert selected is not None
    assert selected.id == "lightning"
    assert selected.name == "Lightning AI"


def test_backend_switching(mock_config):
    bm = BackendManager(config=mock_config)
    bm.backends["ollama"] = BackendInfo(
        id="ollama",
        name="Ollama",
        backend_type="local",
        location="Local",
        endpoint="http://localhost:11434",
        model="gemma3:4b-it-qat",
        status="connected"
    )
    bm.backends["lightning"] = BackendInfo(
        id="lightning",
        name="Lightning AI",
        backend_type="remote",
        location="forge-qwen",
        endpoint="http://localhost:8000/v1",
        model="Qwen3.8 27B FP8",
        status="connected"
    )

    bm.select_active_backend("ollama")
    assert bm.get_active_backend().id == "ollama"

    bm.select_active_backend("lightning")
    assert bm.get_active_backend().id == "lightning"


def test_dynamic_model_display():
    assert format_model_display_name("gemma3:4b-it-qat") == "Gemma 3 4B IT QAT"
    assert format_model_display_name("qwen3.8-27b-fp8") == "Qwen3.8 27B FP8"

    banner_ollama = generate_banner_art("Gemma 3 4B IT QAT • Ollama • Local")
    assert "Gemma 3 4B IT QAT" in banner_ollama
    assert "Ollama" in banner_ollama

    banner_lightning = generate_banner_art("Qwen3.8 27B FP8 • L40S • Lightning AI")
    assert "Lightning AI" in banner_lightning


def test_model_command(mock_config):
    orchestrator = AgentOrchestrator(mock_config)
    shell = ForgeShell(orchestrator)

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"models": [{"name": "gemma3:4b-it-qat"}]}

    with patch("httpx.Client.get", return_value=mock_resp):
        orchestrator.backend_manager.discover_backends()
        orchestrator.backend_manager.select_active_backend("ollama")

        res_model = handle_model(shell, [])
        assert res_model is False

        res_models = handle_models(shell, [])
        assert res_models is False


def test_backends_command(mock_config):
    orchestrator = AgentOrchestrator(mock_config)
    shell = ForgeShell(orchestrator)

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"models": [{"name": "gemma3:4b-it-qat"}]}

    with patch("httpx.Client.get", return_value=mock_resp):
        res = handle_backends(shell, [])
        assert res is False
