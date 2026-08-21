import json
from typing import List, Dict, Any, Optional, Generator
import httpx

from forge.providers.base import BaseProvider, CompletionResponse, ToolCall
from forge.config.settings import ModelConfig
from forge.utils.logging import logger


class OpenAICompatibleProvider(BaseProvider):
    """Provider for any OpenAI-compatible API endpoint (vLLM, SGLang, Ollama, etc.)."""

    def __init__(self, config: ModelConfig):
        self.config = config
        self.base_url = config.base_url.rstrip("/")
        if self.base_url.endswith("/chat/completions"):
            self.endpoint = self.base_url
            self.models_url = self.base_url.replace("/chat/completions", "/models")
        elif self.base_url.endswith("/v1"):
            self.endpoint = f"{self.base_url}/chat/completions"
            self.models_url = f"{self.base_url}/models"
        else:
            self.endpoint = f"{self.base_url}/v1/chat/completions"
            self.models_url = f"{self.base_url}/v1/models"

    def _build_headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.config.api_key:
            headers["Authorization"] = f"Bearer {self.config.api_key}"
        return headers

    def check_health(self) -> Dict[str, Any]:
        """Checks reachability of the vLLM server at /v1/models endpoint."""
        try:
            with httpx.Client(timeout=5.0) as client:
                resp = client.get(self.models_url, headers=self._build_headers())
                if resp.status_code == 200:
                    data = resp.json()
                    raw_models = data.get("data", [])
                    model_ids = [m.get("id") for m in raw_models if isinstance(m, dict) and "id" in m]
                    first_model = model_ids[0] if model_ids else None
                    return {
                        "status": "connected",
                        "reachable": True,
                        "models": model_ids,
                        "detected_model": first_model,
                        "url": self.models_url,
                    }
                return {
                    "status": f"HTTP {resp.status_code}",
                    "reachable": False,
                    "error": f"Server responded with status code {resp.status_code}",
                    "url": self.models_url,
                }
        except Exception as e:
            return {
                "status": "unreachable",
                "reachable": False,
                "error": str(e),
                "url": self.models_url,
            }

    def detect_model(self) -> str:
        """Detects available model ID from /v1/models or returns configured name."""
        if self.config.name and self.config.name not in ("glm", "kimi", "GLM-5.2", "Kimi-K2.5", ""):
            return self.config.name
        health = self.check_health()
        if health.get("reachable") and health.get("detected_model"):
            return health["detected_model"]
        return self.config.name or "/teamspace/studios/this_studio/forge-models/qwen3.8-27b-fp8"

    def _resolve_model_name(self) -> str:
        if self.config.name and self.config.name not in ("glm", "kimi", "GLM-5.2", "Kimi-K2.5", ""):
            return self.config.name
        return self.detect_model()

    def generate(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        temperature: Optional[float] = None,
        top_p: Optional[float] = None,
        max_tokens: Optional[int] = None,
    ) -> CompletionResponse:
        model_id = self._resolve_model_name()
        payload: Dict[str, Any] = {
            "model": model_id,
            "messages": messages,
            "temperature": temperature if temperature is not None else self.config.temperature,
            "top_p": top_p if top_p is not None else self.config.top_p,
            "max_tokens": max_tokens if max_tokens is not None else self.config.max_tokens,
            "stream": False,
        }
        if tools:
            payload["tools"] = tools

        try:
            with httpx.Client(timeout=60.0) as client:
                response = client.post(self.endpoint, json=payload, headers=self._build_headers())
                if response.status_code != 200:
                    return CompletionResponse(
                        content=f"[Error: Server returned status {response.status_code}]",
                        role="assistant"
                    )
                resp_json = response.json()
                choice = resp_json.get("choices", [{}])[0]
                message = choice.get("message", {})
                content = message.get("content") or ""

                tool_calls = []
                for tc in message.get("tool_calls", []):
                    fn = tc.get("function", {})
                    args_str = fn.get("arguments", "{}")
                    try:
                        args = json.loads(args_str) if isinstance(args_str, str) else args_str
                    except Exception:
                        args = {"raw": args_str}
                    tool_calls.append(ToolCall(
                        id=tc.get("id", "call_0"),
                        function_name=fn.get("name", ""),
                        arguments=args
                    ))

                return CompletionResponse(
                    content=content,
                    role=message.get("role", "assistant"),
                    tool_calls=tool_calls,
                    finish_reason=choice.get("finish_reason"),
                    raw_response=resp_json
                )
        except Exception as e:
            logger.warning(f"Failed to connect to endpoint {self.endpoint}: {e}")
            return CompletionResponse(
                content=f"[Offline Mode / Model Endpoint Unreachable: {model_id} at {self.endpoint}]",
                role="assistant"
            )

    def generate_stream(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        temperature: Optional[float] = None,
        top_p: Optional[float] = None,
        max_tokens: Optional[int] = None,
    ) -> Generator[str, None, None]:
        model_id = self._resolve_model_name()
        payload: Dict[str, Any] = {
            "model": model_id,
            "messages": messages,
            "temperature": temperature if temperature is not None else self.config.temperature,
            "top_p": top_p if top_p is not None else self.config.top_p,
            "max_tokens": max_tokens if max_tokens is not None else self.config.max_tokens,
            "stream": True,
        }
        if tools:
            payload["tools"] = tools

        try:
            with httpx.Client(timeout=60.0) as client:
                with client.stream("POST", self.endpoint, json=payload, headers=self._build_headers()) as response:
                    if response.status_code != 200:
                        yield f"[Error: Server returned status {response.status_code}]"
                        return

                    for line in response.iter_lines():
                        line_str = line.strip()
                        if not line_str:
                            continue
                        if line_str.startswith("data: "):
                            data_str = line_str[6:].strip()
                            if data_str == "[DONE]":
                                break
                            try:
                                chunk = json.loads(data_str)
                                choices = chunk.get("choices", [])
                                if choices:
                                    delta = choices[0].get("delta", {})
                                    content = delta.get("content")
                                    if content:
                                        yield content
                            except Exception:
                                continue
        except Exception as e:
            logger.warning(f"Failed streaming from endpoint {self.endpoint}: {e}")
            yield f"[Offline Mode / Model Endpoint Unreachable: {model_id}]"
