from pathlib import Path
from typing import Any

from forge.tools.base import BaseTool


def _workspace_root(workspace_root: str | Path | None = None) -> Path:
    return Path(workspace_root or Path.cwd()).resolve()


def _resolve_within_workspace(path: str, workspace_root: Path) -> tuple[Path | None, str | None]:
    requested = Path(path)
    resolved = (requested if requested.is_absolute() else workspace_root / requested).resolve()
    try:
        resolved.relative_to(workspace_root)
    except ValueError:
        return None, f"Path '{path}' is outside the configured workspace root."
    return resolved, None


class ReadFileTool(BaseTool):
    name = "read_file"
    description = "Read contents of a file at target relative or absolute path."
    parameters = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "File path to read"}
        },
        "required": ["path"]
    }

    def __init__(self, workspace_root: str | Path | None = None):
        self.workspace_root = _workspace_root(workspace_root)

    def execute(self, path: str, **kwargs) -> dict[str, Any]:
        p, error = _resolve_within_workspace(path, self.workspace_root)
        if error:
            return {"error": error}
        if not p.exists() or not p.is_file():
            return {"error": f"File '{path}' does not exist or is not a file."}
        try:
            content = p.read_text(encoding="utf-8", errors="replace")
            return {"path": str(p), "content": content}
        except Exception as e:
            return {"error": f"Failed to read file: {e}"}

class WriteFileTool(BaseTool):
    name = "write_file"
    description = "Create or overwrite a file with given content."
    parameters = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Target file path"},
            "content": {"type": "string", "description": "Text content to write"}
        },
        "required": ["path", "content"]
    }

    def __init__(self, workspace_root: str | Path | None = None):
        self.workspace_root = _workspace_root(workspace_root)

    def execute(self, path: str, content: str, **kwargs) -> dict[str, Any]:
        p, error = _resolve_within_workspace(path, self.workspace_root)
        if error:
            return {"error": error}
        try:
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(content, encoding="utf-8")
            return {"status": "success", "path": str(p), "bytes_written": len(content)}
        except Exception as e:
            return {"error": f"Failed to write file: {e}"}

class EditFileTool(BaseTool):
    name = "edit_file"
    description = "Replace specific old content block with new content block in target file."
    parameters = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Target file path"},
            "target_content": {"type": "string", "description": "Exact text to replace"},
            "replacement_content": {"type": "string", "description": "New replacement text"}
        },
        "required": ["path", "target_content", "replacement_content"]
    }

    def __init__(self, workspace_root: str | Path | None = None):
        self.workspace_root = _workspace_root(workspace_root)

    def execute(self, path: str, target_content: str, replacement_content: str, **kwargs) -> dict[str, Any]:
        p, error = _resolve_within_workspace(path, self.workspace_root)
        if error:
            return {"error": error}
        if not p.exists():
            return {"error": f"File '{path}' does not exist."}
        try:
            content = p.read_text(encoding="utf-8")
            if target_content not in content:
                return {"error": "Target content snippet not found in file."}
            new_content = content.replace(target_content, replacement_content, 1)
            p.write_text(new_content, encoding="utf-8")
            return {"status": "success", "path": str(p)}
        except Exception as e:
            return {"error": f"Failed to edit file: {e}"}

class SearchFilesTool(BaseTool):
    name = "search_files"
    description = "Search for a query pattern in files within directory."
    parameters = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "String query to search"},
            "dir_path": {"type": "string", "description": "Directory to search in", "default": "."}
        },
        "required": ["query"]
    }

    def __init__(self, workspace_root: str | Path | None = None):
        self.workspace_root = _workspace_root(workspace_root)

    def execute(self, query: str, dir_path: str = ".", **kwargs) -> dict[str, Any]:
        matches: list[dict[str, Any]] = []
        root, error = _resolve_within_workspace(dir_path, self.workspace_root)
        if error:
            return {"error": error}
        if not root.exists():
            return {"error": f"Directory '{dir_path}' does not exist."}
        if not root.is_dir():
            return {"error": f"Directory '{dir_path}' does not exist."}

        for path in root.rglob("*"):
            rel_parts = path.relative_to(self.workspace_root).parts
            if path.is_file() and not any(part.startswith(".") or part.lower() in ("__pycache__", "venv", ".venv", "build", "dist", "node_modules", "opsra") for part in rel_parts):
                try:
                    text = path.read_text(encoding="utf-8", errors="ignore")
                    if query in text:
                        matches.append({"path": str(path)})
                except Exception:
                    continue
            if len(matches) >= 50:
                break
        return {"query": query, "matches": matches, "total_matches": len(matches)}

class ListDirectoryTool(BaseTool):
    name = "list_directory"
    description = "List files and subdirectories in target path."
    parameters = {
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Directory path", "default": "."}
        }
    }

    def __init__(self, workspace_root: str | Path | None = None):
        self.workspace_root = _workspace_root(workspace_root)

    def execute(self, path: str = ".", **kwargs) -> dict[str, Any]:
        p, error = _resolve_within_workspace(path, self.workspace_root)
        if error:
            return {"error": error}
        if not p.exists() or not p.is_dir():
            return {"error": f"Directory '{path}' does not exist."}
        try:
            items = []
            for entry in p.iterdir():
                items.append({
                    "name": entry.name,
                    "is_dir": entry.is_dir(),
                    "size": entry.stat().st_size if entry.is_file() else 0
                })
            return {"path": str(p), "items": items}
        except Exception as e:
            return {"error": f"Failed to list directory: {e}"}
