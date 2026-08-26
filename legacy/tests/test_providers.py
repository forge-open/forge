from forge.config.settings import ModelConfig
from forge.providers.openai_provider import OpenAICompatibleProvider
from forge.providers.base import CompletionResponse

def test_openai_provider_offline_fallback():
    cfg = ModelConfig(name="GLM-5.2", base_url="http://invalid-endpoint-12345.local/v1")
    provider = OpenAICompatibleProvider(cfg)
    messages = [{"role": "user", "content": "Hello"}]
    
    resp = provider.generate(messages)
    assert isinstance(resp, CompletionResponse)
    assert "[Offline Mode / Model Endpoint Unreachable" in resp.content

def test_openai_provider_streaming_fallback():
    cfg = ModelConfig(name="GLM-5.2", base_url="http://invalid-endpoint-12345.local/v1")
    provider = OpenAICompatibleProvider(cfg)
    messages = [{"role": "user", "content": "Hello"}]
    
    chunks = list(provider.generate_stream(messages))
    assert len(chunks) > 0
    assert "Offline Mode" in chunks[0]
