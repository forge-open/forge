from pathlib import Path

from forge.tools.file_tools import EditFileTool, ListDirectoryTool, ReadFileTool, SearchFilesTool, WriteFileTool
from forge.tools.terminal_tools import RunCommandTool


def test_file_tools_reject_paths_outside_workspace_root(tmp_path: Path):
    workspace_root = tmp_path
    outside_file = workspace_root.parent / "forge-boundary-outside.txt"

    outside_file.write_text("should not be accessed", encoding="utf-8")

    read_result = ReadFileTool(workspace_root=workspace_root).execute(path="../forge-boundary-outside.txt")
    write_result = WriteFileTool(workspace_root=workspace_root).execute(
        path=str(outside_file),
        content="new content",
    )
    edit_result = EditFileTool(workspace_root=workspace_root).execute(
        path=str(outside_file),
        target_content="should not be accessed",
        replacement_content="blocked",
    )
    search_result = SearchFilesTool(workspace_root=workspace_root).execute(query="should not be accessed", dir_path="../")
    list_result = ListDirectoryTool(workspace_root=workspace_root).execute(path="../")

    for result in (read_result, write_result, edit_result, search_result, list_result):
        assert "outside the configured workspace root" in result["error"]


def test_terminal_tool_rejects_cwd_outside_workspace_root(tmp_path: Path):
    tool = RunCommandTool(safe_mode=True, workspace_root=tmp_path)

    result = tool.execute(command="echo hello", cwd="../")

    assert result["error"] == "Path '../' is outside the configured workspace root."
