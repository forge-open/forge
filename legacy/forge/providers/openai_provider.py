import json
import urllib.request
import urllib.error
from typing import List, Dict, Any, Optional, Generator
from forge.providers.base import BaseProvider, CompletionResponse, ToolCall
from forge.config.settings import ModelConfig
from forge.utils.logging import logger

class OpenAICompatibleProvider(BaseProvider):
    """Provider for any OpenAI-compatible API endpoint (vLLM, SGLang, Ollama, etc.)."""

    def __init__(self, config: ModelConfig):
        self.config = config
        self.base_url = config.base_url.rstrip("/")
        self.endpoint = f"{self.base_url}/chat/completions" if not self.base_url.endswith("/chat/completions") else self.base_url

    def _build_headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.config.api_key:
            headers["Authorization"] = f"Bearer {self.config.api_key}"
        return headers

    def generate(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        temperature: Optional[float] = None,
        top_p: Optional[float] = None,
        max_tokens: Optional[int] = None,
    ) -> CompletionResponse:
        payload: Dict[str, Any] = {
            "model": self.config.name,
            "messages": messages,
            "temperature": temperature if temperature is not None else self.config.temperature,
            "top_p": top_p if top_p is not None else self.config.top_p,
            "max_tokens": max_tokens if max_tokens is not None else self.config.max_tokens,
            "stream": False,
        }
        if tools:
            payload["tools"] = tools

        data_bytes = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(self.endpoint, data=data_bytes, headers=self._build_headers(), method="POST")

        try:
            with urllib.request.urlopen(req, timeout=60) as response:
                resp_json = json.loads(response.read().decode("utf-8"))
                
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
        except urllib.error.URLError as e:
            logger.warning(f"Failed to connect to endpoint {self.endpoint}: {e}")
            # Mock / Fallback response for offline development shell
            return CompletionResponse(
                content=f"[Offline Mode / Model Endpoint Unreachable: {self.config.name} at {self.endpoint}]",
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
        payload: Dict[str, Any] = {
            "model": self.config.name,
            "messages": messages,
            "temperature": temperature if temperature is not None else self.config.temperature,
            "top_p": top_p if top_p is not None else self.config.top_p,
            "max_tokens": max_tokens if max_tokens is not None else self.config.max_tokens,
            "stream": True,
        }
        if tools:
            payload["tools"] = tools

        data_bytes = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(self.endpoint, data=data_bytes, headers=self._build_headers(), method="POST")

        try:
            with urllib.request.urlopen(req, timeout=60) as response:
                for line in response:
                    line_str = line.decode("utf-8").strip()
                    if line_str.startswith("data: "):
                        data_str = line_str[6:]
                        if data_str == "[DONE]":
                            break
                        try:
                            chunk = json.loads(data_str)
                            delta = chunk.get("choices", [{}])[0].get("delta", {})
                            content = delta.get("content")
                            if content:
                                yield content
                        except Exception:
                            continue
        except urllib.error.URLError as e:
            logger.warning(f"Failed streaming from endpoint {self.endpoint}: {e}")
            yield f"[Offline Mode / Model Endpoint Unreachable: {self.config.name}]"
