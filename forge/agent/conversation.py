from __future__ import annotations

DEFAULT_SYSTEM_PROMPT = (
    "You are Forge, an intelligent, helpful AI coding assistant. "
    "You write clean, high-quality, and robust code. Provide clear explanations when asked."
)


class ConversationManager:
    """Manages multi-turn conversation history for REPL sessions."""

    def __init__(self, system_prompt: str | None = None):
        self.system_prompt = system_prompt or DEFAULT_SYSTEM_PROMPT
        self.messages: list[dict[str, str]] = []
        self.reset()

    def reset(self) -> None:
        """Clears conversation history and re-applies system prompt."""
        self.messages = [{"role": "system", "content": self.system_prompt}]

    def add_user_message(self, content: str) -> None:
        """Appends a user prompt to history."""
        self.messages.append({"role": "user", "content": content})

    def add_assistant_message(self, content: str) -> None:
        """Appends an assistant response to history."""
        self.messages.append({"role": "assistant", "content": content})

    def get_messages(self) -> list[dict[str, str]]:
        """Returns full list of conversation messages."""
        return list(self.messages)

    @property
    def turn_count(self) -> int:
        """Returns number of user-assistant interaction pairs."""
        return sum(1 for m in self.messages if m["role"] == "user")
