import json
from pathlib import Path
from typing import Any


class ProjectMemory:
    """Manages persistent project memory inside .forge/ directory."""

    def __init__(self, root_dir: str = "."):
        self.forge_dir = Path(root_dir) / ".forge"
        self.memory_dir = self.forge_dir / "memory"
        self.decisions_dir = self.forge_dir / "decisions"
        self.state_file = self.forge_dir / "state.json"
        self._ensure_dirs()

    def _ensure_dirs(self) -> None:
        try:
            self.memory_dir.mkdir(parents=True, exist_ok=True)
            self.decisions_dir.mkdir(parents=True, exist_ok=True)
            if not self.state_file.exists():
                self.save_state({"tasks": [], "conventions": [], "architecture_notes": []})
        except Exception:
            pass

    def load_state(self) -> dict[str, Any]:
        if not self.state_file.exists():
            return {"tasks": [], "conventions": [], "architecture_notes": []}
        try:
            with open(self.state_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {"tasks": [], "conventions": [], "architecture_notes": []}

    def save_state(self, state: dict[str, Any]) -> None:
        try:
            with open(self.state_file, "w", encoding="utf-8") as f:
                json.dump(state, f, indent=2)
        except Exception:
            pass

    def record_task(self, task_prompt: str, summary: str) -> None:
        state = self.load_state()
        tasks = state.get("tasks", [])
        tasks.append({"prompt": task_prompt, "summary": summary})
        state["tasks"] = tasks[-20:]  # Keep last 20 tasks
        self.save_state(state)

    def record_decision(self, title: str, description: str) -> None:
        decision_path = self.decisions_dir / f"{title.lower().replace(' ', '_')}.md"
        try:
            decision_path.write_text(f"# {title}\n\n{description}\n", encoding="utf-8")
        except Exception:
            pass
