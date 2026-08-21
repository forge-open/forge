from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Generator
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ToolCall:
    id: str
    function_name: str
    arguments: dict[str, Any]

@dataclass
class CompletionResponse:
    content: str
    role: str = "assistant"
    tool_calls: list[ToolCall] = field(default_factory=list)
    finish_reason: str | None = None
    raw_response: dict[str, Any] | None = None

class BaseProvider(ABC):
    """Abstract interface for LLM providers."""

    @abstractmethod
    def generate(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        temperature: float | None = None,
        top_p: float | None = None,
        max_tokens: int | None = None,
    ) -> CompletionResponse:
        """Synchronous chat completion."""

    @abstractmethod
    def generate_stream(
        self,
        messages: list[dict[str, Any]],
        tools: list[dict[str, Any]] | None = None,
        temperature: float | None = None,
        top_p: float | None = None,
        max_tokens: int | None = None,
    ) -> Generator[str, None, None]:
        """Streaming response generator yielding chunks of text."""
