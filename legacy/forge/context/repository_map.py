from pathlib import Path
from typing import List

class RepositoryMap:
    """Generates condensed repository map representation."""

    def __init__(self, root_dir: str = "."):
        self.root_dir = Path(root_dir)

    def build_map(self, max_depth: int = 3) -> str:
        lines: List[str] = ["Repository Structure:"]
        self._traverse(self.root_dir, 0, max_depth, lines)
        return "\n".join(lines)

    def _traverse(self, current: Path, depth: int, max_depth: int, lines: List[str]) -> None:
        if depth > max_depth:
            return
        
        ignored = {".git", ".forge", "__pycache__", "venv", ".venv", "build", "dist", ".pytest_cache"}
        try:
            for item in sorted(current.iterdir(), key=lambda x: (not x.is_dir(), x.name)):
                if item.name in ignored or item.name.startswith("."):
                    continue
                indent = "  " * depth
                if item.is_dir():
                    lines.append(f"{indent}📁 {item.name}/")
                    self._traverse(item, depth + 1, max_depth, lines)
                else:
                    lines.append(f"{indent}📄 {item.name}")
        except Exception:
            pass
