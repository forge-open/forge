import tempfile
from pathlib import Path
from forge.tools.file_tools import ReadFileTool, WriteFileTool, EditFileTool, ListDirectoryTool
from forge.tools.terminal_tools import RunCommandTool

def test_file_tools():
    with tempfile.TemporaryDirectory() as tmpdir:
        test_file = Path(tmpdir) / "sample.txt"
        
        # Write
        writer = WriteFileTool()
        wres = writer.execute(path=str(test_file), content="Hello World")
        assert wres.get("status") == "success"

        # Read
        reader = ReadFileTool()
        rres = reader.execute(path=str(test_file))
        assert rres.get("content") == "Hello World"

        # Edit
        editor = EditFileTool()
        eres = editor.execute(path=str(test_file), target_content="World", replacement_content="Forge")
        assert eres.get("status") == "success"
        assert test_file.read_text(encoding="utf-8") == "Hello Forge"

        # List
        lister = ListDirectoryTool()
        lres = lister.execute(path=tmpdir)
        assert len(lres.get("items", [])) == 1

def test_terminal_tool_safe_mode():
    tool = RunCommandTool(safe_mode=True)
    res = tool.execute(command="rm -rf /")
    assert "error" in res
    assert "Safe Mode" in res["error"]
