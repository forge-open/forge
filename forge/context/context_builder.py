from pathlib import Path
from typing import List, Dict, Any, Optional
from forge.context.repository_map import RepositoryMap
from forge.context.file_selector import FileSelector

class ContextBuilder:
    """Assembles prompt contexts with minimal token overhead."""

    def __init__(self, root_dir: str = "."):
        self.root_dir = Path(root_dir)
        self.repo_map = RepositoryMap(root_dir)
        self.file_selector = FileSelector(root_dir)

    def build_context(self, task_prompt: str, explicit_files: Optional[List[str]] = None) -> str:
        parts: List[str] = []
        
        # 1. Repo Map Overview
        parts.append("=== REPOSITORY MAP ===")
        parts.append(self.repo_map.build_map(max_depth=2))

        # 2. File Context
        target_files = set(explicit_files or [])
        if not target_files:
            target_files.update(self.file_selector.select_relevant_files(task_prompt))

        if target_files:
            parts.append("\n=== RELEVANT FILE CONTENTS ===")
            for fpath in target_files:
                p = self.root_dir / fpath if not Path(fpath).is_absolute() else Path(fpath)
                if p.exists() and p.is_file():
                    try:
                        content = p.read_text(encoding="utf-8", errors="replace")
                        # Truncate large files if necessary
                        if len(content) > 4000:
                            content = content[:4000] + "\n... [Truncated long file]"
                        parts.append(f"\n--- FILE: {fpath} ---\n{content}")
                    except Exception as e:
                        parts.append(f"\n--- FILE: {fpath} (Error reading: {e}) ---")

        parts.append(f"\n=== USER TASK ===\n{task_prompt}")
        return "\n".join(parts)
