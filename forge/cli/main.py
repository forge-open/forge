import sys
import typer
from typing import Optional, List

# Reconfigure stdout/stderr encoding for Windows PowerShell UTF-8 compatibility
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
if hasattr(sys.stderr, "reconfigure"):
    try:
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

from forge.config.settings import load_config
from forge.agent.orchestrator import AgentOrchestrator
from forge.cli.shell import ForgeShell

app = typer.Typer(
    name="forge",
    help="Forge: Lightweight, polished AI coding CLI.",
    add_completion=False,
    invoke_without_command=True,
)


@app.callback()
def main_cli(
    ctx: typer.Context,
    model: Optional[str] = typer.Option(None, "--model", "-m", help="Specify active model ID or key"),
    base_url: Optional[str] = typer.Option(None, "--base-url", "-u", help="Specify vLLM server base URL"),
    prompt: Optional[List[str]] = typer.Argument(None, help="Optional prompt to execute non-interactively"),
) -> None:
    if ctx.invoked_subcommand is not None:
        return

    config = load_config()
    if base_url:
        config.base_url = base_url
    if model:
        config.model = model

    orchestrator = AgentOrchestrator(config)
    if model:
        orchestrator.router.set_active_model(model)

    shell = ForgeShell(orchestrator)

    if prompt:
        prompt_text = " ".join(prompt)
        shell.run_single_prompt(prompt_text)
    else:
        shell.run()


def main() -> None:
    """Console script entrypoint."""
    app()


if __name__ == "__main__":
    main()
