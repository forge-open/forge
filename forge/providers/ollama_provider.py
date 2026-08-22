from __future__ import annotations

import json
from collections.abc import Generator
from typing import Any

import httpx

from forge.config.settings import ModelConfig
from forge.providers.base import BaseProvider, CompletionResponse, ToolCall
from forge.utils.logging import logger


class OllamaProvider(BaseProvider):
    """Provider for Ollama local inference engine."""

    def __init__(
        self,
        config: ModelConfig | None = None,
        base_url: str | None = None,
        model_name: str | None = None,
    ):
        if config is not None:
            self.config = config
            self.base_url = (config.base_url or "http://localhost:11434").rstrip("/")
            self.model_name = config.name
        else:
            self.base_url = (base_url or "http://localhost:11434").rstrip("/")
            self.model_name = model_name or ""
            self.config = ModelConfig(
                name=self.model_name,
                provider="ollama",
                base_url=self.base_url,
            )

        self.tags_url = f"{self.base_url}/api/tags"
        self.chat_url = f"{self.base_url}/api/chat"

    def check_health(self) -> dict[str, Any]:
        """Checks reachability of Ollama server and retrieves installed models."""
        try:
            with httpx.Client(timeout=3.0) as client:
                resp = client.get(self.tags_url)
                if resp.status_code == 200:
                    data = resp.json()
                    raw_models = data.get("models", [])
                    model_names = [
                        m.get("name")
                        for m in raw_models
                        if isinstance(m, dict) and "name" in m
                    ]

                    detected = self.model_name
                    if not detected and model_names:
                        detected = model_names[0]

                    return {
                        "status": "connected",
                        "reachable": True,
                        "provider": "ollama",
                        "backend": "Ollama",
                        "models": model_names,
                        "detected_model": detected,
                        "url": self.base_url,
                    }
                return {
                    "status": f"HTTP {resp.status_code}",
                    "reachable": False,
                    "provider": "ollama",
                    "backend": "Ollama",
                    "error": f"Server responded with status code {resp.status_code}",
                    "url": self.base_url,
                    "action": (
                        "Make sure the Ollama Docker container or service is running.\n"
                        "For example:\n"
                        "  docker ps\n"
                        "or:\n"
                        "  docker start ollama"
                    ),
                }
        except Exception as e:
            return {
                "status": "unreachable",
                "reachable": False,
                "provider": "ollama",
                "backend": "Ollama",
                "error": str(e),
                "url": self.base_url,
                "action": (
                    "Make sure the Ollama Docker container or service is running.\n"
                    "For example:\n"
                    "  docker ps\n"
                    "or:\n"
                    "  docker start ollama"
                ),
            }

    def detect_model(self) -> str:
        """Detects available model name from /api/tags or returns configured name."""
        if self.model_name:
            return self.model_name
        health = self.check_health()
        if health.get("reachable") and health.get("detected_model"):
            return health["detected_model"]
        return ""

    def _generate_openai_fallback(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        temperature: float | None = None,
        top_p: float | None = None,
        max_tokens: int | None = None,
        model_id: str = "",
    ) -> CompletionResponse:
        """Fallback to OpenAI-compatible endpoint if /api/chat is not supported."""
        from forge.providers.openai_provider import OpenAICompatibleProvider

        fallback_cfg = ModelConfig(
            name=model_id,
            base_url=f"{self.base_url}/v1",
            temperature=temperature if temperature is not None else self.config.temperature,
            top_p=top_p if top_p is not None else self.config.top_p,
            max_tokens=max_tokens if max_tokens is not None else self.config.max_tokens,
        )
        provider = OpenAICompatibleProvider(fallback_cfg)
        return provider.generate(messages, tools, temperature, top_p, max_tokens)

    def generate(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        temperature: float | None = None,
        top_p: float | None = None,
        max_tokens: int | None = None,
    ) -> CompletionResponse:
        model_id = self.model_name or self.detect_model()
        options: dict[str, Any] = {}
        temp = temperature if temperature is not None else getattr(self.config, "temperature", 0.1)
        if temp is not None:
            options["temperature"] = temp
        top = top_p if top_p is not None else getattr(self.config, "top_p", 0.95)
        if top is not None:
            options["top_p"] = top
        mt = max_tokens if max_tokens is not None else getattr(self.config, "max_tokens", 2048)
        if mt is not None:
            options["num_predict"] = mt

        payload: dict[str, Any] = {
            "model": model_id,
            "messages": messages,
            "stream": False,
            "options": options,
        }
        if tools:
            payload["tools"] = tools

        try:
            with httpx.Client(timeout=60.0) as client:
                response = client.post(self.chat_url, json=payload)
                if response.status_code == 200:
                    resp_json = response.json()
                    msg = resp_json.get("message", {})
                    content = msg.get("content") or ""
                    tool_calls = []
                    for tc in msg.get("tool_calls", []):
                        fn = tc.get("function", {})
                        args = fn.get("arguments", {})
                        tool_calls.append(
                            ToolCall(
                                id=tc.get("id", "call_0"),
                                function_name=fn.get("name", ""),
                                arguments=args if isinstance(args, dict) else {},
                            )
                        )
                    return CompletionResponse(
                        content=content,
                        role=msg.get("role", "assistant"),
                        tool_calls=tool_calls,
                        raw_response=resp_json,
                    )
                elif response.status_code == 404:
                    return self._generate_openai_fallback(
                        messages, tools, temperature, top_p, max_tokens, model_id
                    )
                else:
                    return CompletionResponse(
                        content=f"[Error: Ollama returned status {response.status_code}]",
                        role="assistant",
                    )
        except Exception as e:
            logger.warning(f"Failed to connect to Ollama endpoint {self.chat_url}: {e}")
            return CompletionResponse(
                content=f"[Offline Mode / Ollama Endpoint Unreachable: {model_id} at {self.base_url}]",
                role="assistant",
            )

    def generate_stream(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        temperature: float | None = None,
        top_p: float | None = None,
        max_tokens: int | None = None,
    ) -> Generator[str, None, None]:
        model_id = self.model_name or self.detect_model()
        options: dict[str, Any] = {}
        temp = temperature if temperature is not None else getattr(self.config, "temperature", 0.1)
        if temp is not None:
            options["temperature"] = temp
        top = top_p if top_p is not None else getattr(self.config, "top_p", 0.95)
        if top is not None:
            options["top_p"] = top
        mt = max_tokens if max_tokens is not None else getattr(self.config, "max_tokens", 2048)
        if mt is not None:
            options["num_predict"] = mt

        payload: dict[str, Any] = {
            "model": model_id,
            "messages": messages,
            "stream": True,
            "options": options,
        }
        if tools:
            payload["tools"] = tools

        try:
            with httpx.Client(timeout=60.0) as client:
                with client.stream("POST", self.chat_url, json=payload) as response:
                    if response.status_code != 200:
                        yield f"[Error: Ollama returned status {response.status_code}]"
                        return

                    for line in response.iter_lines():
                        line_str = line.strip()
                        if not line_str:
                            continue
                        try:
                            chunk = json.loads(line_str)
                            msg = chunk.get("message", {})
                            content = msg.get("content")
                            if content:
                                yield content
                        except Exception:
                            continue
        except Exception as e:
            logger.warning(f"Failed streaming from Ollama endpoint {self.chat_url}: {e}")
            yield f"[Offline Mode / Ollama Endpoint Unreachable: {model_id}]"
