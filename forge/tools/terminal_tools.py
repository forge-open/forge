import subprocess
import sys
from typing import Dict, Any, Optional
from forge.tools.base import BaseTool

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

    def __init__(self, safe_mode: bool = True):
        self.safe_mode = safe_mode

    def is_destructive(self, command: str) -> bool:
        cmd_lower = command.lower()
        dangerous_keywords = ["rm -rf", "del /f", "git reset --hard", "format", "pip install -g", "sudo"]
        return any(k in cmd_lower for k in dangerous_keywords)

    def execute(self, command: str, cwd: str = ".", auto_confirm: bool = False, **kwargs) -> Dict[str, Any]:
        if self.safe_mode and self.is_destructive(command) and not auto_confirm:
            return {
                "error": f"Command '{command}' blocked by Safe Mode (destructive operation). Pass auto_confirm or use --auto mode to proceed."
            }
        try:
            res = subprocess.run(
                command,
                shell=True,
                cwd=cwd,
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

    def execute(self, test_path: str = "tests", **kwargs) -> Dict[str, Any]:
        cmd = f"{sys.executable} -m pytest {test_path}"
        try:
            res = subprocess.run(
                cmd,
                shell=True,
                capture_output=True,
                text=True,
                timeout=180
            )
            return {
                "command": cmd,
                "exit_code": res.returncode,
                "passed": res.returncode == 0,
                "stdout": res.stdout,
                "stderr": res.stderr,
            }
        except Exception as e:
            return {"error": f"Failed to run pytest suite: {e}"}
