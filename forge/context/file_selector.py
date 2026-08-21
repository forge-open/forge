from pathlib import Path


class FileSelector:
    """Selects relevant project files matching task query."""

    def __init__(self, root_dir: str = "."):
        self.root_dir = Path(root_dir)

    def select_relevant_files(self, task_query: str, max_files: int = 5) -> list[str]:
        keywords = [k.lower() for k in task_query.split() if len(k) > 3]
        matched_files = []

        if not keywords:
            return []

        for p in self.root_dir.rglob("*"):
            if p.is_file() and not any(part.startswith(".") or part in ("venv", "__pycache__", "build", "dist") for part in p.parts):
                rel_str = str(p.relative_to(self.root_dir)).lower()
                if any(kw in rel_str for kw in keywords):
                    matched_files.append(str(p))
                    if len(matched_files) >= max_files:
                        break

        return matched_files
