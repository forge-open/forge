import subprocess
import sys
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


class RunCommandTool(BaseTool):
    name = "run_command"
    description = "Execute a shell command in the workspace terminal."
    parameters = {
        "type": "object",
        "properties": {
            "command": {"type": "string", "description": "Shell command to run"},
            "cwd": {"type": "string", "description": "Working directory", "default": "."}
        },
        "required": ["command"]
    }

    def __init__(self, safe_mode: bool = True, workspace_root: str | Path | None = None):
        self.safe_mode = safe_mode
        self.workspace_root = _workspace_root(workspace_root)

    def is_destructive(self, command: str) -> bool:
        cmd_lower = command.lower()
        dangerous_keywords = [
            "rm -rf", "rm -r", "del /f", "rmdir /s", "remove-item", "git reset --hard",
            "git clean", "format", "mkfs", "pip install -g", "sudo", "shutdown",
        ]
        return any(k in cmd_lower for k in dangerous_keywords)

    def execute(self, command: str, cwd: str = ".", auto_confirm: bool = False, **kwargs) -> dict[str, Any]:
        if self.safe_mode and self.is_destructive(command) and not auto_confirm:
            return {
                "error": f"Command '{command}' blocked by Safe Mode (destructive operation). Pass auto_confirm or use --auto mode to proceed."
            }
        resolved_cwd, error = _resolve_within_workspace(cwd, self.workspace_root)
        if error:
            return {"error": error}
        if not resolved_cwd.exists() or not resolved_cwd.is_dir():
            return {"error": f"Working directory '{cwd}' does not exist."}
        try:
            res = subprocess.run(
                command,
                shell=True,
                cwd=resolved_cwd,
                capture_output=True,
                text=True,
                timeout=120
            )
            return {
                "command": command,
                "exit_code": res.returncode,
                "stdout": res.stdout,
                "stderr": res.stderr,
            }
        except subprocess.TimeoutExpired:
            return {"error": f"Command '{command}' timed out after 120s."}
        except Exception as e:
            return {"error": f"Failed to execute command: {e}"}

class RunTestsTool(BaseTool):
    name = "run_tests"
    description = "Run pytest test suite in current workspace."
    parameters = {
        "type": "object",
        "properties": {
            "test_path": {"type": "string", "description": "Optional specific test path", "default": "tests"}
        }
    }

    def __init__(self, workspace_root: str | Path | None = None):
        self.workspace_root = _workspace_root(workspace_root)

    def execute(self, test_path: str = "tests", **kwargs) -> dict[str, Any]:
        resolved_path, error = _resolve_within_workspace(test_path, self.workspace_root)
        if error:
            return {"error": error}
        cmd = [sys.executable, "-m", "pytest", str(resolved_path)]
        try:
            res = subprocess.run(
                cmd,
                cwd=self.workspace_root,
                capture_output=True,
                text=True,
                timeout=180
            )
            return {
                "command": " ".join(cmd),
                "exit_code": res.returncode,
                "passed": res.returncode == 0,
                "stdout": res.stdout,
                "stderr": res.stderr,
            }
        except Exception as e:
            return {"error": f"Failed to run pytest suite: {e}"}
