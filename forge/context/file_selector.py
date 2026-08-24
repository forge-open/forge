from pathlib import Path


class FileSelector:
    """Selects relevant project files matching task query."""

    def __init__(self, root_dir: str = "."):
        self.root_dir = Path(root_dir)

    def select_relevant_files(self, task_query: str, max_files: int = 5) -> list[str]:
        keywords = [k.lower() for k in task_query.split() if len(k) > 3]
        scored_files: list[tuple[int, Path]] = []

        if not keywords:
            return []

        ignored = {"venv", ".venv", "__pycache__", "build", "dist", "node_modules", "opsra"}
        for p in self.root_dir.rglob("*"):
            if p.is_file() and p.stat().st_size <= 512 * 1024 and not any(part.startswith(".") or part.lower() in ignored for part in p.parts):
                rel_str = str(p.relative_to(self.root_dir)).lower()
                score = sum(3 for kw in keywords if kw in rel_str)
                if p.suffix.lower() in {".py", ".md", ".yaml", ".yml", ".toml", ".json", ".ts", ".tsx", ".js"}:
                    try:
                        content = p.read_text(encoding="utf-8", errors="ignore").lower()
                        score += sum(kw in content for kw in keywords)
                    except OSError:
                        pass
                if score:
                    scored_files.append((score, p))

        return [str(p) for _, p in sorted(scored_files, key=lambda item: (-item[0], str(item[1])))[:max_files]]
