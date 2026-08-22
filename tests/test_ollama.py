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
            {"name": "deepseek-r1:14b", "model": "deepseek-r1:14b"}
        ]
    }

    with patch("httpx.Client.get", return_value=mock_resp):
        health = provider.check_health()
        assert health["reachable"] is True
        assert health["status"] == "connected"
        assert health["provider"] == "ollama"
        assert health["detected_model"] == "deepseek-r1:14b"


def test_ollama_multi_model_discovery(mock_config):
    provider = OllamaProvider(base_url="http://localhost:11434")

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "models": [
            {"name": "qwen3:14b"},
            {"name": "llama3.1:8b"},
            {"name": "deepseek-r1:14b"}
        ]
    }

    with patch("httpx.Client.get", return_value=mock_resp):
        health = provider.check_health()
        assert len(health["models"]) == 3
        assert "qwen3:14b" in health["models"]
        assert "llama3.1:8b" in health["models"]
        assert "deepseek-r1:14b" in health["models"]
        assert provider.detect_model() == "qwen3:14b"


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
    provider = OllamaProvider(base_url="http://localhost:11434", model_name="llama3.1:8b")

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "model": "llama3.1:8b",
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
        "models": [{"name": "deepseek-r1:14b"}, {"name": "llama3.1:8b"}]
    }

    with patch("httpx.Client.get", return_value=mock_resp):
        bm.discover_backends()
        selected = bm.select_active_backend("ollama")
        assert selected is not None
        assert selected.id == "ollama"
        assert selected.model == "deepseek-r1:14b"
        assert len(selected.discovered_models) == 2
        assert selected.is_available() is True


def test_lightning_backend_selection(mock_config):
    bm = BackendManager(config=mock_config)
    bm.backends["lightning"] = BackendInfo(
        id="lightning",
        name="Lightning AI",
        backend_type="remote",
        location="forge-studio",
        endpoint="http://localhost:8000/v1",
        model="custom-model-70b",
        status="connected",
        gpu="NVIDIA H100 80 GB"
    )

    selected = bm.select_active_backend("lightning")
    assert selected is not None
    assert selected.id == "lightning"
    assert selected.name == "Lightning AI"
    assert selected.model == "custom-model-70b"


def test_backend_switching(mock_config):
    bm = BackendManager(config=mock_config)
    bm.backends["ollama"] = BackendInfo(
        id="ollama",
        name="Ollama",
        backend_type="local",
        location="Local",
        endpoint="http://localhost:11434",
        model="qwen3:14b",
        status="connected"
    )
    bm.backends["lightning"] = BackendInfo(
        id="lightning",
        name="Lightning AI",
        backend_type="remote",
        location="forge-studio",
        endpoint="http://localhost:8000/v1",
        model="custom-model-70b",
        status="connected"
    )

    bm.select_active_backend("ollama")
    assert bm.get_active_backend().id == "ollama"

    bm.select_active_backend("lightning")
    assert bm.get_active_backend().id == "lightning"


def test_dynamic_model_display():
    assert format_model_display_name("gemma3:4b-it-qat") == "Gemma3 4B IT QAT"
    assert format_model_display_name("qwen3:14b") == "Qwen3 14B"
    assert format_model_display_name("llama3.1:8b") == "Llama3.1 8B"
    assert format_model_display_name("deepseek-r1:14b") == "Deepseek R1 14B"

    banner_ollama = generate_banner_art("Deepseek R1 14B • Ollama • Local")
    assert "Deepseek R1 14B" in banner_ollama
    assert "Ollama" in banner_ollama


def test_model_command(mock_config):
    orchestrator = AgentOrchestrator(mock_config)
    shell = ForgeShell(orchestrator)

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "models": [{"name": "qwen3:14b"}, {"name": "deepseek-r1:14b"}]
    }

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
    mock_resp.json.return_value = {
        "models": [{"name": "qwen3:14b"}]
    }

    with patch("httpx.Client.get", return_value=mock_resp):
        res = handle_backends(shell, [])
        assert res is False
