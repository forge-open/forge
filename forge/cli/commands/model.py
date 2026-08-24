from pathlib import Path
from typing import Any

from rich.table import Table

from forge.benchmarks import BenchmarkRunner, BenchmarkStore
from forge.models.manager import ModelManager
from forge.utils.vault import ModelVault


def _print(shell: Any, message: str) -> None:
    if hasattr(shell, "console"):
        shell.console.print(message)
    else:
        print(message)


def _manager(shell: Any) -> ModelManager:
    return getattr(shell.orchestrator, "model_manager", None) or ModelManager()


def _vault(shell: Any) -> ModelVault:
    path = getattr(shell.orchestrator.config, "drive_vault_path", None)
    return ModelVault(path or str(Path.cwd() / ".forge" / "model-vault"))


def _benchmark_store(shell: Any) -> BenchmarkStore:
    path = getattr(shell.orchestrator.config, "benchmark_path", None)
    return BenchmarkStore(path or Path.cwd() / ".forge" / "benchmarks.json")


def _use_model(shell: Any, model_id: str) -> None:
    shell.orchestrator.router.set_active_model(model_id)
    shell.orchestrator.config.model = model_id
    _print(shell, f"Active model set to: {model_id}")


def _model_status(shell: Any) -> None:
    manager = _manager(shell)
    manifest = _vault(shell).load_manifest()
    active = shell.orchestrator.get_active_model_name()
    try:
        table = Table(title="Forge Models", show_header=True, header_style="bold cyan")
        table.add_column("Model")
        table.add_column("Runtime")
        table.add_column("Vault")
        for spec in manager.list_available():
            entry = manifest.get(spec.model_id) or manifest.get(spec.name)
            table.add_row(spec.model_id, "active" if spec.model_id == active else "available", entry.status if entry else "not in vault")
        shell.console.print(table)
    except Exception:
        _print(shell, "Forge Models")
        for spec in manager.list_available():
            entry = manifest.get(spec.model_id) or manifest.get(spec.name)
            _print(shell, f"  {spec.model_id}: vault={entry.status if entry else 'not in vault'}")


def _benchmark_model(shell: Any, model_id: str) -> None:
    store = _benchmark_store(shell)

    def generate(prompt: str) -> Any:
        provider = shell.orchestrator.router.get_provider(model_id)
        response = provider.generate(messages=[{"role": "user", "content": prompt}], tools=[])
        return getattr(response, "content", response)

    result = BenchmarkRunner(store).run(model_id, generate=generate)
    _print(shell, f"Benchmark {result.status}: {model_id} | {result.total_time:.2f}s total | {result.tokens_per_second:.1f} tok/s | saved to {store.path}")


def handle_model(shell: Any, args: list[str]) -> bool:
    """Show, select, install, stage, use, or benchmark a model."""
    if not args:
        shell.print_model_info()
        return False
    action = args[0].lower()
    if action == "status":
        _model_status(shell)
        return False
    if action in {"install", "stage", "use", "benchmark"}:
        if len(args) < 2:
            _print(shell, f"Usage: /model {action} <model-id>")
            return False
        model_id = args[1]
        if action == "install":
            _print(shell, _manager(shell).install_model(model_id)["message"])
        elif action == "stage":
            ready = _vault(shell).is_model_downloaded(model_id)
            _print(shell, f"Model '{model_id}' is {'staged and ready' if ready else 'not available in the vault'}.")
        elif action == "use":
            _use_model(shell, model_id)
        else:
            _benchmark_model(shell, model_id)
        return False
    _use_model(shell, args[0])
    return False


def handle_models(shell: Any, args: list[str]) -> bool:
    """Queries available models and displays them."""
    health = shell.orchestrator.check_server_status()
    active = shell.orchestrator.get_active_model_name()
    detected = health.get("models", []) or ([active] if active else [])
    try:
        table = Table(title="Available Models", show_header=True, header_style="bold cyan")
        table.add_column("Model", style="bold white", width=30)
        table.add_column("Status", style="green", width=14)
        table.add_column("Context", style="yellow", width=12)
        context = f"{getattr(shell.orchestrator.config, 'max_tokens', 2048) * 8:,}"
        for model_id in detected or ["Model"]:
            table.add_row(shell.format_model_display_name(model_id), "Active" if model_id == active else "Available", context)
        shell.console.print(table)
    except Exception:
        _print(shell, "Available Models:")
        for model_id in detected:
            _print(shell, f"  - {model_id}")
    return False


def handle_backends(shell: Any, args: list[str]) -> bool:
    """Displays detected/configured backend status."""
    backends = shell.orchestrator.backend_manager.discover_backends() if hasattr(shell.orchestrator, "backend_manager") else {}
    try:
        shell.console.print("[bold yellow]FORGE BACKENDS[/bold yellow]")
        if not backends:
            shell.console.print("[dim]No backends detected.[/dim]")
        for backend in backends.values():
            shell.console.print(f"{'Connected' if backend.status == 'connected' else 'Unavailable'}: {backend.name} ({backend.endpoint})")
    except Exception:
        _print(shell, "FORGE BACKENDS:")
        for backend in backends.values():
            _print(shell, f"  {backend.name} ({backend.status}): {backend.endpoint}")
    return False


def register_model_commands(registry: Any) -> None:
    from forge.cli.commands.registry import SlashCommand
    registry.register(SlashCommand(name="model", description="Show, select, install, stage, or benchmark a model", handler=handle_model, accepts_args=True))
    registry.register(SlashCommand(name="models", description="List available models", handler=handle_models))
    registry.register(SlashCommand(name="backends", description="List detected and configured inference backends", handler=handle_backends, aliases=["backend"]))
