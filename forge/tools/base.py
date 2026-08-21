from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class BaseTool(ABC):
    name: str
    description: str
    parameters: dict[str, Any]

    @abstractmethod
    def execute(self, **kwargs) -> dict[str, Any]:
        """Executes tool logic and returns JSON-serializable result."""

    def to_openai_schema(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            }
        }

class ToolRegistry:
    def __init__(self):
        self._tools: dict[str, BaseTool] = {}

    def register(self, tool: BaseTool) -> None:
        self._tools[tool.name] = tool

    def get(self, name: str) -> BaseTool | None:
        return self._tools.get(name)

    def get_schemas(self) -> list[dict[str, Any]]:
        return [t.to_openai_schema() for t in self._tools.values()]

    def execute(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        tool = self.get(name)
        if not tool:
            return {"error": f"Tool '{name}' not found."}
        try:
            return tool.execute(**arguments)
        except Exception as e:
            return {"error": f"Error executing '{name}': {e!s}"}
