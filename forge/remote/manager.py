from __future__ import annotations

import time
from typing import Any

import httpx
from rich.console import Console
from rich.panel import Panel

from forge.remote.base import RemoteProvider, RemoteStatus
from forge.remote.config import RemoteConfig, load_remote_config
from forge.remote.lightning import LightningProvider
from forge.utils.logging import logger


def format_duration(seconds: float) -> str:
    """Formats elapsed seconds into clean human readable duration (e.g., '1h 42m' or '42s')."""
    if seconds <= 0:
        return "0s"
    total_sec = int(seconds)
    hours = total_sec // 3600
    minutes = (total_sec % 3600) // 60
    secs = total_sec % 60

    if hours > 0:
        return f"{hours}h {minutes}m"
    if minutes > 0:
        return f"{minutes}m {secs}s"
    return f"{secs}s"


class RemoteManager:
    """High-level manager orchestrating remote GPU provider lifecycle, CLI prompts, and session tracking."""

    def __init__(
        self,
        config: RemoteConfig | None = None,
        provider: RemoteProvider | None = None,
        console: Console | None = None,
    ):
        self.config = config or load_remote_config()
        self.console = console or Console()
        self._provider = provider or self._create_provider()
        self.started_by_forge: bool = False
        self.session_start_time: float | None = None
        self._connected_model: str = ""

    def _create_provider(self) -> RemoteProvider:
        prov_name = self.config.provider.lower()
        if prov_name in ("lightning", "lightningai", "lightning-ai"):
            return LightningProvider(self.config)
        # Default fallback
        return LightningProvider(self.config)

    def get_provider(self) -> RemoteProvider:
        return self._provider

    def check_backend_available(self) -> bool:
        """Checks if local vLLM endpoint is responding."""
        url = f"http://{self.config.remote_host}:{self.config.remote_port}/v1/models"
        try:
            headers = {}
            if self.config.api_key:
                headers["Authorization"] = f"Bearer {self.config.api_key}"
            with httpx.Client(timeout=2.0) as client:
                resp = client.get(url, headers=headers)
                return resp.status_code == 200
        except Exception:
            return False

    def detect_remote_model(self) -> str:
        """Queries /v1/models to detect available active model ID."""
        url = f"http://{self.config.remote_host}:{self.config.remote_port}/v1/models"
        try:
            headers = {}
            if self.config.api_key:
                headers["Authorization"] = f"Bearer {self.config.api_key}"
            with httpx.Client(timeout=3.0) as client:
                resp = client.get(url, headers=headers)
                if resp.status_code == 200:
                    data = resp.json()
                    models = data.get("data", [])
                    if models and isinstance(models[0], dict):
                        return models[0].get("id", "Qwen3.8 27B FP8")
        except Exception:
            pass
        return "Qwen3.8 27B FP8"

    def render_startup_prompt(self) -> str:
        """Displays interactive Rich box prompt when remote GPU is not running."""
        prompt_panel = Panel(
            "[bold white]Forge needs the remote GPU to continue.[/bold white]\n\n"
            f"[dim]Provider:[/dim] [cyan]{self.config.provider.capitalize()} AI[/cyan]\n"
            f"[dim]Studio:[/dim]   [white]{self.config.studio}[/white]\n"
            f"[dim]GPU:[/dim]      [yellow]{self.config.gpu}[/yellow]\n"
            f"[dim]Model:[/dim]    [bright_white]Qwen3.8 27B FP8[/bright_white]\n\n"
            "[bold green][ Enter ][/bold green] Start remote GPU\n"
            "[bold yellow][ L ][/bold yellow]     Use local backend\n"
            "[bold red][ C ][/bold red]     Cancel",
            title="[bold yellow]⚡ Remote GPU required[/bold yellow]",
            border_style="yellow",
            padding=(1, 2),
            expand=False,
        )

        try:
            self.console.print()
            self.console.print(prompt_panel)
            self.console.print()
        except Exception:
            print("\n⚡ Remote GPU required\nForge needs the remote GPU to continue.\n")

        # Interactive input capture
        try:
            choice = input("Select option [Enter/L/C]: ").strip().lower()
        except (KeyboardInterrupt, EOFError):
            return "cancel"

        if choice in ("", "e", "enter", "s", "start", "y", "yes"):
            return "start"
        if choice in ("l", "local"):
            return "local"
        if choice in ("c", "cancel", "q", "quit"):
            return "cancel"
        return "start"

    def ensure_remote_gpu(self, interactive: bool = True, orchestrator: Any = None) -> bool:
        """Orchestrates remote GPU detection, interactive prompt, readiness polling, and model connection."""
        # 1. First check if backend is already available
        if self.check_backend_available():
            self.started_by_forge = False
            self._connected_model = self.detect_remote_model()
            if orchestrator and hasattr(orchestrator, "router"):
                orchestrator.router.set_active_model(self._connected_model)
            return True

        # 2. Check if provider is running (e.g. tunnel was down)
        if self._provider.is_running():
            self.started_by_forge = False
            try:
                self._provider.connect()
                if self.check_backend_available():
                    self._connected_model = self.detect_remote_model()
                    if orchestrator and hasattr(orchestrator, "router"):
                        orchestrator.router.set_active_model(self._connected_model)
                    return True
            except Exception as e:
                logger.debug(f"Tunnel reconnect attempt error: {e}")

        # 3. Remote GPU is stopped - Prompt user if interactive mode
        if not interactive:
            if self.config.auto_start:
                try:
                    return self.start_remote_gpu(orchestrator=orchestrator)
                except Exception as e:
                    logger.warning(f"Remote GPU startup attempt in non-interactive mode failed: {e}")
                    return False
            return False

        choice = self.render_startup_prompt()
        if choice == "start":
            return self.start_remote_gpu(orchestrator=orchestrator)
        if choice == "local":
            try:
                self.console.print("[yellow]Switching to local backend...[/yellow]\n")
            except Exception:
                print("Switching to local backend...\n")
            if orchestrator and hasattr(orchestrator, "backend_manager"):
                orchestrator.backend_manager.select_active_backend("ollama")
            return False
        if choice == "cancel":
            try:
                self.console.print("[red]Operation cancelled by user.[/red]\n")
            except Exception:
                print("Operation cancelled by user.\n")
            return False

        return False

    def start_remote_gpu(self, orchestrator: Any = None) -> bool:
        """Executes full remote GPU startup with Rich progress indicators."""
        self.started_by_forge = True
        self.session_start_time = time.time()

        def status_callback(stage: str, message: str) -> None:
            try:
                if stage.endswith("_ready") or stage == "ready":
                    self.console.print(f"[bold green]{message}[/bold green]")
                elif stage == "error":
                    self.console.print(f"[bold red]❌ {message}[/bold red]")
                else:
                    self.console.print(f"[cyan]{message}[/cyan]")
            except Exception:
                print(message)

        try:
            self.console.print()
            self._provider.wait_until_ready(
                timeout=self.config.startup_timeout,
                retry_interval=self.config.retry_interval,
                progress_callback=status_callback,
            )

            # Detect connected model
            self._connected_model = self.detect_remote_model()
            if orchestrator and hasattr(orchestrator, "router"):
                orchestrator.router.set_active_model(self._connected_model)

            self.console.print()
            self.console.print("[bold green]✓ Lightning AI started[/bold green]")
            self.console.print(f"[bold green]✓ {self.config.gpu} ready[/bold green]")
            self.console.print("[bold green]✓ vLLM ready[/bold green]")
            self.console.print(f"[bold green]✓ {self._connected_model} connected[/bold green]\n")

            return True

        except Exception as e:
            self.console.print()
            self.console.print("[bold red]❌ Remote GPU Startup Failed[/bold red]")
            self.console.print(f"[yellow]Details: {e}[/yellow]\n")
            return False

    def get_session_duration(self) -> float:
        """Returns elapsed session duration in seconds."""
        if self.session_start_time is None:
            return 0.0
        return max(0.0, time.time() - self.session_start_time)

    def get_formatted_session_duration(self) -> str:
        """Returns formatted session duration string."""
        return format_duration(self.get_session_duration())

    def get_status(self) -> RemoteStatus:
        """Returns provider status enriched with manager session tracking metadata."""
        status = self._provider.get_status()
        status.started_by_forge = self.started_by_forge
        status.session_duration = self.get_session_duration()
        status.model_name = self._connected_model or self.detect_remote_model()
        return status

    def shutdown(self, explicit_stop: bool = False) -> None:
        """Gracefully disconnects tunnel and stops remote GPU if owned by Forge."""
        duration_str = self.get_formatted_session_duration()
        should_stop_gpu = (self.started_by_forge and self.config.auto_stop) or explicit_stop

        try:
            self._provider.disconnect()
        except Exception as e:
            logger.debug(f"Disconnect error during shutdown: {e}")

        if should_stop_gpu:
            try:
                self.console.print("\n[bold yellow]⚡ Stopping Remote GPU Studio...[/bold yellow]")
                self._provider.stop()
                self.console.print("[bold green]✓ Forge session ended[/bold green]")
                if duration_str and duration_str != "0s":
                    self.console.print(f"[bold cyan]⚡ Remote GPU session: {duration_str}[/bold cyan]")
                self.console.print(f"[bold green]✓ {self.config.provider.capitalize()} AI Studio stopped[/bold green]")
                self.console.print("[bold green]✓ GPU resources released[/bold green]\n")
            except Exception as e:
                self.console.print(f"[yellow]Warning stopping GPU: {e}[/yellow]\n")
            finally:
                self.started_by_forge = False
                self.session_start_time = None
        else:
            try:
                self.console.print("[bold green]✓ Forge session ended[/bold green]")
                if self.check_backend_available() or self._provider.is_running():
                    self.console.print("[dim]ℹ Remote GPU Studio was already running and will remain active.[/dim]\n")
            except Exception:
                pass


_global_remote_manager: RemoteManager | None = None


def get_remote_manager(config: RemoteConfig | None = None) -> RemoteManager:
    """Returns global singleton instance of RemoteManager."""
    global _global_remote_manager
    if _global_remote_manager is None or config is not None:
        _global_remote_manager = RemoteManager(config=config)
    return _global_remote_manager
