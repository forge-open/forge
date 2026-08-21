from unittest.mock import patch

import httpx

from forge.config.settings import ModelConfig
from forge.providers.base import CompletionResponse
from forge.providers.openai_provider import OpenAICompatibleProvider


def test_openai_provider_offline_fallback():
    cfg = ModelConfig(name="qwen3.8-27b-fp8", base_url="http://localhost:9999/v1")
    provider = OpenAICompatibleProvider(cfg)
    messages = [{"role": "user", "content": "Hello"}]

    with patch.object(httpx.Client, "post", side_effect=httpx.ConnectError("Connection refused")):
        resp = provider.generate(messages)
        assert isinstance(resp, CompletionResponse)
        assert "Offline Mode" in resp.content or "Unreachable" in resp.content


def test_openai_provider_streaming_fallback():
    cfg = ModelConfig(name="qwen3.8-27b-fp8", base_url="http://localhost:9999/v1")
    provider = OpenAICompatibleProvider(cfg)
    messages = [{"role": "user", "content": "Hello"}]

    with patch.object(httpx.Client, "stream", side_effect=httpx.ConnectError("Connection refused")):
        chunks = list(provider.generate_stream(messages))
        assert len(chunks) > 0
        assert "Offline Mode" in chunks[0] or "Unreachable" in chunks[0]
