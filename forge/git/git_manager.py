import subprocess
from pathlib import Path


class GitManager:
    """Helper for managing git operations in the project repo."""

    def __init__(self, repo_dir: str = "."):
        self.repo_dir = Path(repo_dir)

    def is_git_repo(self) -> bool:
        res = subprocess.run("git rev-parse --is-inside-work-tree", shell=True, cwd=self.repo_dir, capture_output=True, text=True)
        return res.returncode == 0 and res.stdout.strip() == "true"

    def get_current_branch(self) -> str:
        res = subprocess.run("git rev-parse --abbrev-ref HEAD", shell=True, cwd=self.repo_dir, capture_output=True, text=True)
        return res.stdout.strip() if res.returncode == 0 else "unknown"

    def get_status_summary(self) -> str:
        res = subprocess.run("git status --short", shell=True, cwd=self.repo_dir, capture_output=True, text=True)
        return res.stdout.strip()
