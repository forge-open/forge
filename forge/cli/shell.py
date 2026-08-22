from __future__ import annotations

import re
import shutil
import time
from dataclasses import dataclass
from typing import Any

from rich.console import Console
from rich.live import Live
from rich.markdown import Markdown
from rich.panel import Panel

try:
    from prompt_toolkit import PromptSession
    from prompt_toolkit.completion import Completer, Completion
    from prompt_toolkit.formatted_text import HTML
    from prompt_toolkit.styles import Style
    HAS_PROMPT_TOOLKIT = True
except ImportError:
    HAS_PROMPT_TOOLKIT = False

from forge.agent.orchestrator import AgentOrchestrator
from forge.cli.commands.registry import SlashCommandRegistry, create_default_registry

# Initialize Rich console with UTF-8 legacy fallback handling
try:
    console = Console(legacy_windows=False)
except Exception:
    console = Console()

BANNER_ART = """[cyan]╭──────────────────────────────────────────────╮[/cyan]
[cyan]│                                              │[/cyan]
[cyan]│   [bold bright_cyan]███████╗ ██████╗ ██████╗  ██████╗ ███████╗[/bold bright_cyan] │[/cyan]
[cyan]│   [bold bright_cyan]██╔════╝██╔═══██╗██╔══██╗██╔════╝ ██╔════╝[/bold bright_cyan] │[/cyan]
[cyan]│   [bold bright_cyan]█████╗  ██║   ██║██████╔╝██║  ███╗█████╗  [/bold bright_cyan] │[/cyan]
[cyan]│   [bold bright_cyan]██╔══╝  ██║   ██║██╔══██╗██║   ██║██╔══╝  [/bold bright_cyan] │[/cyan]
[cyan]│   [bold bright_cyan]██║     ╚██████╔╝██║  ██║╚██████╔╝███████╗[/bold bright_cyan] │[/cyan]
[cyan]│   [bold bright_cyan]╚═╝      ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝[/bold bright_cyan] │[/cyan]
[cyan]│                                              │[/cyan]
[cyan]│        [bold yellow]⚡ AI CODING AGENT[/bold yellow]                    │[/cyan]
[cyan]│        [bold white]Qwen3.8 27B FP8  •  L40S[/bold white]             │[/cyan]
[cyan]│                                              │[/cyan]
[cyan]╰──────────────────────────────────────────────╯[/cyan]"""


def generate_banner_art(subtitle: str) -> str:
    """Generates ASCII banner with dynamically centered subtitle."""
    sub_text = subtitle[:42].center(42)
    return f"""[cyan]╭──────────────────────────────────────────────╮[/cyan]
[cyan]│                                              │[/cyan]
[cyan]│   [bold bright_cyan]███████╗ ██████╗ ██████╗  ██████╗ ███████╗[/bold bright_cyan] │[/cyan]
[cyan]│   [bold bright_cyan]██╔════╝██╔═══██╗██╔══██╗██╔════╝ ██╔════╝[/bold bright_cyan] │[/cyan]
[cyan]│   [bold bright_cyan]█████╗  ██║   ██║██████╔╝██║  ███╗█████╗  [/bold bright_cyan] │[/cyan]
[cyan]│   [bold bright_cyan]██╔══╝  ██║   ██║██╔══██╗██║   ██║██╔══╝  [/bold bright_cyan] │[/cyan]
[cyan]│   [bold bright_cyan]██║     ╚██████╔╝██║  ██║╚██████╔╝███████╗[/bold bright_cyan] │[/cyan]
[cyan]│   [bold bright_cyan]╚═╝      ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝[/bold bright_cyan] │[/cyan]
[cyan]│                                              │[/cyan]
[cyan]│        [bold yellow]⚡ AI CODING AGENT[/bold yellow]                    │[/cyan]
[cyan]│        [bold white]{sub_text}[/bold white]      │[/cyan]
[cyan]│                                              │[/cyan]
[cyan]╰──────────────────────────────────────────────╯[/cyan]"""


def format_model_display_name(model_id: str) -> str:
    """Dynamically formats any model ID for clean UI display without hardcoded model strings."""
    if not model_id:
        return "Model"
    clean_id = model_id.rstrip("/").split("/")[-1]
    tokens = clean_id.replace(":", " ").replace("-", " ").replace("_", " ").split()
    formatted = []
    for token in tokens:
        token_upper = token.upper()
        if token_upper in ("IT", "QAT", "FP8", "FP16", "BF16", "AWQ", "GPTQ", "AI", "LLM", "R1", "V1", "V2", "V3"):
            formatted.append(token_upper)
        elif token_upper.endswith("B") and token_upper[:-1].replace(".", "").isdigit():
            formatted.append(token_upper)
        elif any(c.isupper() for c in token):
            formatted.append(token)
        else:
            formatted.append(token.capitalize())
    return " ".join(formatted) if formatted else clean_id


def count_tokens(text: str) -> int:
    """Counts output tokens using standard word and punctuation regex matching."""
    if not text:
        return 0
    return len(re.findall(r"\w+|[^\w\s]", text))


def strip_internal_reasoning(text: str) -> str:
    """Removes internal reasoning (<think>...</think>) and meta commentary/planning."""
    if not text:
        return ""
    cleaned = re.sub(r"<think>.*?(?:</think>|$)", "", text, flags=re.DOTALL)
    planning_patterns = [
        r"^(?:We need answer|Need produce final answer|Need think through|Need answer).*?\n*",
        r"^(?:I need to answer|Let's think through).*?\n*",
    ]
    for pattern in planning_patterns:
        cleaned = re.sub(pattern, "", cleaned, flags=re.IGNORECASE | re.DOTALL)
    return cleaned.strip()


@dataclass
class ExecutionMetrics:
    ttft: float = 0.0
    total_time: float = 0.0
    token_count: int = 0
    tokens_per_second: float = 0.0

    def format_display(self) -> str:
        return (
            f"⚡ {self.ttft:.3f}s TTFT · {self.total_time:.1f}s total · "
            f"{self.tokens_per_second:.1f} tok/s · {self.token_count} tokens"
        )


if HAS_PROMPT_TOOLKIT:
    class SlashCommandCompleter(Completer):
        """Prompt_toolkit autocompleter for Forge slash commands."""
        def __init__(self, registry: SlashCommandRegistry):
            self.registry = registry

        def get_completions(self, document, complete_event):
            text = document.text_before_cursor
            if text.startswith("/"):
                query = text[1:].lower()
                for cmd in self.registry.list_commands():
                    if cmd.name.startswith(query) or any(a.startswith(query) for a in cmd.aliases):
                        yield Completion(
                            text=f"/{cmd.name}",
                            start_position=-len(text),
                            display=f"/{cmd.name}",
                            display_meta=cmd.description
                        )


class ForgeShell:
    """Interactive REPL Shell for Forge AI Coding CLI v0.2."""

    def __init__(self, orchestrator: AgentOrchestrator):
        self.orchestrator = orchestrator
        self.console = console
        self.remote_manager = getattr(orchestrator, "remote_manager", None)
        self.registry = create_default_registry()
        self.last_metrics: ExecutionMetrics | None = None
        self.session = None

        if HAS_PROMPT_TOOLKIT:
            try:
                style = Style.from_dict({
                    'completion-menu.completion': 'bg:#1e1e2e #cdd6f4',
                    'completion-menu.completion.current': 'bg:#89b4fa #11111b bold',
                    'completion-menu.meta.completion': 'bg:#181825 #a6adc8',
                    'completion-menu.meta.completion.current': 'bg:#89b4fa #11111b bold',
                })
                self.session = PromptSession(
                    completer=SlashCommandCompleter(self.registry),
                    complete_while_typing=True,
                    style=style,
                )
            except Exception:
                self.session = None

    def print_banner(self) -> None:
        """Prints startup ASCII banner with dynamic model and backend information."""
        active = None
        if hasattr(self.orchestrator, "backend_manager"):
            active = self.orchestrator.backend_manager.get_active_backend()

        if active and active.is_available() and active.model:
            disp = format_model_display_name(active.model)
            if active.id == "ollama":
                subtitle = f"{disp} • Ollama • Local"
            elif active.id == "lightning":
                gpu_str = active.gpu or "Remote GPU"
                subtitle = f"{disp} • {gpu_str} • Lightning AI"
            else:
                subtitle = f"{disp} • {active.name} • {active.location}"
        else:
            remote_cfg = getattr(self.orchestrator.config, "remote", None)
            provider_name = getattr(remote_cfg, "provider", "Lightning").capitalize() if remote_cfg else "AI"
            subtitle = f"AI Coding Agent • {provider_name}"

        try:
            console.print(generate_banner_art(subtitle))
        except Exception:
            print(f"\n+----------------------------------------------+\n|   FORGE AI CODING AGENT                      |\n|   {subtitle.center(42)} |\n+----------------------------------------------+\n")
        print()

    def print_status(self, silent_if_ok: bool = False) -> None:
        """Checks and displays server connection status and backend details."""
        health = self.orchestrator.check_server_status()
        active = None
        if hasattr(self.orchestrator, "backend_manager"):
            active = self.orchestrator.backend_manager.get_active_backend()

        if health.get("reachable"):
            model_id = health.get("detected_model") or self.orchestrator.get_active_model_name()
            display_name = format_model_display_name(model_id)

            if active and active.id == "ollama":
                loc_str = "Ollama · Local"
            elif active and active.id == "lightning":
                gpu_str = active.gpu or "Remote GPU"
                loc_str = f"vLLM · Remote {gpu_str}"
            elif active:
                loc_str = f"{active.name} · {active.location}"
            else:
                loc_str = "Inference Server"

            try:
                console.print("[bold green]✓ Connected[/bold green]")
                console.print(f"[bold white]{display_name}[/bold white] [dim]·[/dim] [bold white]{loc_str}[/bold white]\n")
            except Exception:
                print(f"✓ Connected\n{display_name} · {loc_str}\n")
        else:
            url = health.get("url", "http://localhost:11434")
            backend_name = health.get("backend") or (active.name if active else "Backend")
            err = health.get("error", "Unable to connect to backend server.")
            action_hint = health.get("action") or (active.action_hint if active else "")

            try:
                console.print(f"[bold red]❌ {backend_name} Unavailable at {url}[/bold red]")
                if err:
                    console.print(f"[yellow]Details: {err}[/yellow]")
                if action_hint:
                    console.print(f"[dim]Action:\n{action_hint}[/dim]\n")
                else:
                    console.print("[dim]Action: Please make sure the backend server is running.[/dim]\n")
            except Exception:
                print(f"{backend_name} Unavailable at {url}: {err}\n")

    def print_help(self) -> None:
        """Displays available slash commands via registry."""
        from forge.cli.commands.help import handle_help
        handle_help(self, [])

    def print_model_info(self) -> None:
        """Displays detailed active backend and model configuration."""
        active = None
        if hasattr(self.orchestrator, "backend_manager"):
            active = self.orchestrator.backend_manager.get_active_backend()

        model_id = self.orchestrator.get_active_model_name()
        display_name = format_model_display_name(model_id)

        try:
            if active:
                console.print(f"[bold cyan]Active Backend:[/bold cyan] [bold white]{active.name}[/bold white]")
                if active.id == "lightning":
                    console.print(f"[dim]Studio:[/dim]         [white]{active.location}[/white]")
                    if active.gpu:
                        console.print(f"[dim]GPU:[/dim]            [yellow]{active.gpu}[/yellow]")
                else:
                    console.print(f"[dim]Location:[/dim]       [white]{active.location}[/white]")
                console.print(f"[dim]Endpoint:[/dim]       [white]{active.endpoint}[/white]")
                console.print(f"[dim]Model:[/dim]          [yellow]{active.model or model_id}[/yellow]")
                status_color = "green" if active.is_available() else "red"
                console.print(f"[dim]Status:[/dim]         [{status_color}]{active.status.capitalize()}[/{status_color}]\n")
            else:
                console.print(f"[bold cyan]Current Active Model:[/bold cyan] [bold white]{display_name}[/bold white]")
                console.print(f"[dim]Model ID:[/dim] [yellow]{model_id}[/yellow]")
                console.print(f"[dim]Base URL:[/dim] [white]{self.orchestrator.config.base_url}[/white]\n")
        except Exception:
            print(f"Active Backend: {active.name if active else 'LLM'}\nModel: {model_id}\n")

    def format_model_display_name(self, model_id: str) -> str:
        return format_model_display_name(model_id)

    def get_user_input(self) -> str:
        """Renders bordered prompt box adapting dynamically to terminal width."""
        term_width = shutil.get_terminal_size((80, 24)).columns
        border_width = max(20, term_width - 1)
        header_dashes = max(10, border_width - 10)
        footer_dashes = max(10, border_width - 2)

        box_header = f"╭─ Prompt {'─' * header_dashes}╮"
        box_footer = f"╰{'─' * footer_dashes}╯"

        try:
            console.print(f"[cyan]{box_header}[/cyan]")
        except Exception:
            print(box_header)

        user_text = ""
        try:
            if HAS_PROMPT_TOOLKIT and self.session is None and not getattr(self, "_disable_prompt_session", False):
                try:
                    style = Style.from_dict({
                        'completion-menu.completion': 'bg:#1e1e2e #cdd6f4',
                        'completion-menu.completion.current': 'bg:#89b4fa #11111b bold',
                        'completion-menu.meta.completion': 'bg:#181825 #a6adc8',
                        'completion-menu.meta.completion.current': 'bg:#89b4fa #11111b bold',
                    })
                    self.session = PromptSession(
                        completer=SlashCommandCompleter(self.registry),
                        complete_while_typing=True,
                        style=style,
                    )
                except Exception:
                    self.session = None
                    self._disable_prompt_session = True

            if self.session is not None:
                try:
                    user_text = self.session.prompt(
                        HTML("<cyan>│</cyan> : "),
                        prompt_continuation=HTML("<cyan>│</cyan>   ")
                    )
                except Exception:
                    user_text = input("│ : ")
            else:
                user_text = input("│ : ")
        except (KeyboardInterrupt, EOFError):
            try:
                console.print(f"[cyan]{box_footer}[/cyan]")
            except Exception:
                print(box_footer)
            raise

        try:
            console.print(f"[cyan]{box_footer}[/cyan]")
        except Exception:
            print(box_footer)

        return user_text.strip()

    def _stream_response(self, prompt: str, use_history: bool = True) -> dict[str, Any]:
        """Streams model output cleanly inside a Rich response panel with performance tracking."""
        start_time = time.perf_counter()
        ttft: float | None = None
        accumulated_chunks = []

        # 1. Show non-blocking thinking indicator before first token arrives
        status = None
        try:
            status = console.status(
                "[bold cyan]✦[/bold cyan] [bold white]Forge is thinking...[/bold white]",
                spinner="dots"
            )
            status.start()
        except Exception:
            status = None

        live = None
        try:
            for chunk in self.orchestrator.stream_task(prompt, use_history=use_history):
                accumulated_chunks.append(chunk)
                full_raw = "".join(accumulated_chunks)
                clean_text = strip_internal_reasoning(full_raw)

                if ttft is None and chunk.strip():
                    ttft = time.perf_counter() - start_time
                    if status is not None:
                        try:
                            status.stop()
                            status = None
                        except Exception:
                            pass

                    # Initialize live response panel
                    try:
                        live = Live(
                            Panel(
                                Markdown(clean_text or chunk, code_theme="monokai"),
                                title="[bold cyan]Forge[/bold cyan]",
                                border_style="cyan",
                                padding=(1, 2)
                            ),
                            console=console,
                            refresh_per_second=12,
                            vertical_overflow="visible"
                        )
                        live.start()
                    except Exception:
                        live = None

                if live is not None and clean_text:
                    try:
                        live.update(
                            Panel(
                                Markdown(clean_text, code_theme="monokai"),
                                title="[bold cyan]Forge[/bold cyan]",
                                border_style="cyan",
                                padding=(1, 2)
                            )
                        )
                    except Exception:
                        pass
        finally:
            if status is not None:
                try:
                    status.stop()
                except Exception:
                    pass
            if live is not None:
                try:
                    live.stop()
                except Exception:
                    pass

        end_time = time.perf_counter()
        total_time = end_time - start_time
        if ttft is None:
            ttft = total_time

        full_raw = "".join(accumulated_chunks)
        final_clean_text = strip_internal_reasoning(full_raw)

        # Fallback rendering if Live was not available (e.g. non-interactive test mode)
        if live is None and final_clean_text:
            try:
                console.print(
                    Panel(
                        Markdown(final_clean_text, code_theme="monokai"),
                        title="[bold cyan]Forge[/bold cyan]",
                        border_style="cyan",
                        padding=(1, 2)
                    )
                )
            except Exception:
                print(final_clean_text)

        # 2. Performance metrics calculation
        token_count = count_tokens(final_clean_text)
        decode_time = max(total_time - ttft, 0.001)
        tokens_per_second = token_count / decode_time if token_count > 0 else 0.0

        metrics = ExecutionMetrics(
            ttft=ttft,
            total_time=total_time,
            token_count=token_count,
            tokens_per_second=tokens_per_second
        )
        self.last_metrics = metrics

        try:
            console.print(f"[dim]{metrics.format_display()}[/dim]\n")
        except Exception:
            print(f"{metrics.format_display()}\n")

        return {
            "metrics": metrics,
            "response": final_clean_text
        }

    def run_single_prompt(self, prompt: str) -> None:
        """Executes a single non-interactive prompt with streaming response."""
        try:
            if hasattr(self.orchestrator, "backend_manager"):
                self.orchestrator.backend_manager.discover_backends()
                active = self.orchestrator.backend_manager.get_active_backend()
                if not active or not active.is_available():
                    if self.remote_manager:
                        res = self.remote_manager.ensure_remote_gpu(interactive=False, orchestrator=self.orchestrator)
                        if res:
                            self.orchestrator.backend_manager.select_active_backend("lightning")
            elif self.remote_manager:
                self.remote_manager.ensure_remote_gpu(interactive=False, orchestrator=self.orchestrator)

            self._stream_response(prompt, use_history=False)
        except KeyboardInterrupt:
            print("\n[Operation Cancelled]")
        except Exception as e:
            print(f"\nError executing prompt: {e}")
        finally:
            if self.remote_manager:
                self.remote_manager.shutdown()

    def _handle_slash_command(self, cmd: str) -> bool:
        """Helper delegating slash command execution to registry for backward compatibility."""
        return self.registry.execute(cmd, self)

    def run(self) -> None:
        """Main interactive REPL loop with intelligent backend discovery."""
        if hasattr(self.orchestrator, "backend_manager"):
            discovered = self.orchestrator.backend_manager.discover_backends()
            ollama = discovered.get("ollama")
            vllm = discovered.get("vllm")
            lightning = discovered.get("lightning")

            if ollama and ollama.is_available():
                self.orchestrator.backend_manager.select_active_backend("ollama")
                self.print_banner()
                disp_name = format_model_display_name(ollama.model)
                try:
                    console.print("[bold green]✓ Ollama detected[/bold green]")
                    console.print(f"[bold green]✓ {disp_name} connected[/bold green]\n")
                except Exception:
                    print(f"✓ Ollama detected\n✓ {disp_name} connected\n")
            elif vllm and vllm.is_available():
                self.orchestrator.backend_manager.select_active_backend("vllm")
                self.print_banner()
                self.print_status()
            elif lightning and lightning.is_available():
                self.orchestrator.backend_manager.select_active_backend("lightning")
                self.print_banner()
                self.print_status()
            else:
                self.print_banner()
                if self.remote_manager:
                    res = self.remote_manager.ensure_remote_gpu(interactive=True, orchestrator=self.orchestrator)
                    if res:
                        self.orchestrator.backend_manager.select_active_backend("lightning")
                    else:
                        self.orchestrator.backend_manager.select_active_backend("ollama")
                self.print_status()
        else:
            self.print_banner()
            if self.remote_manager:
                self.remote_manager.ensure_remote_gpu(interactive=True, orchestrator=self.orchestrator)
            self.print_status()

        try:
            while True:
                try:
                    prompt_input = self.get_user_input()
                    if not prompt_input:
                        continue

                    if prompt_input.startswith("/"):
                        should_exit = self.registry.execute(prompt_input, self)
                        if should_exit:
                            break
                        continue

                    self._stream_response(prompt_input, use_history=True)

                except KeyboardInterrupt:
                    print("\n^C (Cancelled command)\n")
                    continue
                except EOFError:
                    break
                except Exception as e:
                    print(f"\nUnexpected Error: {e}\n")
        finally:
            if self.remote_manager:
                self.remote_manager.shutdown()
