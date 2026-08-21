import subprocess
from typing import Any

from forge.tools.base import BaseTool


class GitStatusTool(BaseTool):
    name = "git_status"
    description = "Get current git working tree status."
    parameters = {"type": "object", "properties": {}}

    def execute(self, **kwargs) -> dict[str, Any]:
        try:
            res = subprocess.run("git status --short", shell=True, capture_output=True, text=True)
            return {"status": res.stdout, "exit_code": res.returncode}
        except Exception as e:
            return {"error": f"Git status failed: {e}"}

class GitDiffTool(BaseTool):
    name = "git_diff"
    description = "Get git diff of uncommitted changes."
    parameters = {
        "type": "object",
        "properties": {
            "staged": {"type": "boolean", "description": "View staged diff if true", "default": False}
        }
    }

    def execute(self, staged: bool = False, **kwargs) -> dict[str, Any]:
        cmd = "git diff --staged" if staged else "git diff"
        try:
            res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
            return {"diff": res.stdout, "exit_code": res.returncode}
        except Exception as e:
            return {"error": f"Git diff failed: {e}"}

class GitLogTool(BaseTool):
    name = "git_log"
    description = "Get recent git commit log history."
    parameters = {
        "type": "object",
        "properties": {
            "max_count": {"type": "integer", "description": "Number of commits to retrieve", "default": 5}
        }
    }

    def execute(self, max_count: int = 5, **kwargs) -> dict[str, Any]:
        cmd = f"git log -n {max_count} --oneline"
        try:
            res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
            return {"log": res.stdout, "exit_code": res.returncode}
        except Exception as e:
            return {"error": f"Git log failed: {e}"}
