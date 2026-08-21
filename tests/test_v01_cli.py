from unittest.mock import MagicMock, patch

import httpx

from forge.agent.conversation import ConversationManager
from forge.config.settings import ModelConfig, load_config
from forge.providers.openai_provider import OpenAICompatibleProvider


def test_api_health_check():
    cfg = ModelConfig(name="qwen3.8-27b-fp8", base_url="http://localhost:8000/v1")
    provider = OpenAICompatibleProvider(cfg)

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "object": "list",
        "data": [{"id": "/teamspace/studios/this_studio/forge-models/qwen3.8-27b-fp8"}]
    }

    with patch.object(httpx.Client, "get", return_value=mock_resp):
        health = provider.check_health()
        assert health["reachable"] is True
        assert health["status"] == "connected"
        assert len(health["models"]) == 1
        assert health["detected_model"] == "/teamspace/studios/this_studio/forge-models/qwen3.8-27b-fp8"


def test_model_discovery():
    cfg = ModelConfig(name="", base_url="http://localhost:8000/v1")
    provider = OpenAICompatibleProvider(cfg)

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "object": "list",
        "data": [{"id": "discovered-qwen-model-id"}]
    }

    with patch.object(httpx.Client, "get", return_value=mock_resp):
        model_id = provider.detect_model()
        assert model_id == "discovered-qwen-model-id"


def test_successful_chat_completion():
    cfg = ModelConfig(name="qwen3.8-27b-fp8", base_url="http://localhost:8000/v1")
    provider = OpenAICompatibleProvider(cfg)

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "choices": [
            {
                "message": {"role": "assistant", "content": "def add(a, b):\n    return a + b"},
                "finish_reason": "stop"
            }
        ]
    }

    with patch.object(httpx.Client, "post", return_value=mock_resp):
        res = provider.generate([{"role": "user", "content": "Write add function"}])
        assert "def add" in res.content
        assert res.role == "assistant"


def test_streaming_response_parsing():
    cfg = ModelConfig(name="qwen3.8-27b-fp8", base_url="http://localhost:8000/v1")
    provider = OpenAICompatibleProvider(cfg)

    lines = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}',
        'data: {"choices":[{"delta":{"content":" World"}}]}',
        'data: [DONE]'
    ]

    mock_stream_resp = MagicMock()
    mock_stream_resp.status_code = 200
    mock_stream_resp.iter_lines.return_value = lines

    class MockStreamContext:
        def __enter__(self):
            return mock_stream_resp

        def __exit__(self, exc_type, exc_val, exc_tb):
            pass

    with patch.object(httpx.Client, "stream", return_value=MockStreamContext()):
        chunks = list(provider.generate_stream([{"role": "user", "content": "Hi"}]))
        assert chunks == ["Hello", " World"]


def test_connection_failure_handling():
    cfg = ModelConfig(name="qwen3.8-27b-fp8", base_url="http://localhost:8000/v1")
    provider = OpenAICompatibleProvider(cfg)

    with patch.object(httpx.Client, "get", side_effect=httpx.ConnectError("Connection refused")):
        health = provider.check_health()
        assert health["reachable"] is False
        assert health["status"] == "unreachable"

    with patch.object(httpx.Client, "post", side_effect=httpx.ConnectError("Connection refused")):
        res = provider.generate([{"role": "user", "content": "Hi"}])
        assert "Offline Mode" in res.content or "Unreachable" in res.content


def test_conversation_history():
    conv = ConversationManager(system_prompt="System Prompt Test")
    assert len(conv.get_messages()) == 1
    assert conv.get_messages()[0]["role"] == "system"

    conv.add_user_message("User Msg 1")
    conv.add_assistant_message("Assistant Msg 1")

    msgs = conv.get_messages()
    assert len(msgs) == 3
    assert msgs[1]["content"] == "User Msg 1"
    assert msgs[2]["content"] == "Assistant Msg 1"
    assert conv.turn_count == 1


def test_conversation_clear():
    conv = ConversationManager(system_prompt="System Prompt Test")
    conv.add_user_message("User Msg 1")
    conv.add_assistant_message("Assistant Msg 1")
    assert len(conv.get_messages()) == 3

    conv.reset()
    assert len(conv.get_messages()) == 1
    assert conv.get_messages()[0]["role"] == "system"


def test_configuration_loading(monkeypatch):
    monkeypatch.setenv("FORGE_BASE_URL", "http://test-server:8000/v1")
    monkeypatch.setenv("FORGE_MODEL", "qwen-test")
    monkeypatch.setenv("FORGE_TEMPERATURE", "0.2")
    monkeypatch.setenv("FORGE_MAX_TOKENS", "4096")

    cfg = load_config()
    assert cfg.base_url == "http://test-server:8000/v1"
    assert cfg.model == "qwen-test"
    assert cfg.temperature == 0.2
    assert cfg.max_tokens == 4096
