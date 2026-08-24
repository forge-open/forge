"""Safe, process-free model staging and runtime launch plans.

This module deliberately does not start inference servers.  It prepares a
local cache and returns an argv-based plan that callers can approve and run.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Mapping, Sequence

from forge.utils.vault import ModelManifestEntry, ModelVault


@dataclass(frozen=True)
class HardwareInfo:
    """Hardware facts used for compatibility decisions."""

    ram_gb: float = 0.0
    vram_gb: float = 0.0
    gpu_available: bool = False
    gpu_vendor: str = ""


@dataclass(frozen=True)
class RuntimeProfile:
    """Metadata and command construction rules for an inference runtime."""

    name: str
    command: tuple[str, ...]
    supported_engines: frozenset[str] = frozenset()
    supported_quantizations: frozenset[str] = frozenset()
    min_ram_gb: float = 0.0
    min_vram_gb: float = 0.0
    requires_gpu: bool = False
    supports_tools: bool = True
    default_host: str = "127.0.0.1"
    default_port: int = 8000
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def compatible_with(
        self, entry: ModelManifestEntry, hardware: HardwareInfo
    ) -> tuple[bool, str]:
        if self.supported_engines and entry.engine.lower() not in {
            value.lower() for value in self.supported_engines
        }:
            return False, f"runtime {self.name} does not support engine {entry.engine}"
        if self.supported_quantizations and entry.quantization.lower() not in {
            value.lower() for value in self.supported_quantizations
        }:
            return False, f"runtime {self.name} does not support quantization {entry.quantization}"
        if self.requires_gpu and not hardware.gpu_available:
            return False, f"runtime {self.name} requires a GPU"
        if hardware.ram_gb and hardware.ram_gb < self.min_ram_gb:
            return False, f"runtime {self.name} requires at least {self.min_ram_gb:g} GB RAM"
        if hardware.vram_gb and hardware.vram_gb < self.min_vram_gb:
            return False, f"runtime {self.name} requires at least {self.min_vram_gb:g} GB VRAM"
        return True, "compatible"


@dataclass(frozen=True)
class StageResult:
    model: str
    path: Path
    status: str
    checksum: str
    reused: bool
    files: int


@dataclass(frozen=True)
class LaunchPlan:
    runtime: str
    model: str
    model_path: Path
    argv: tuple[str, ...]
    cwd: Path
    env: Mapping[str, str]
    endpoint: str | None
    supports_tools: bool


def _tree_checksum(root: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    count = 0
    for path in sorted(item for item in root.rglob("*") if item.is_file()):
        relative = path.relative_to(root).as_posix().encode("utf-8")
        digest.update(relative)
        digest.update(b"\0")
        with path.open("rb") as handle:
            for block in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(block)
        count += 1
    return digest.hexdigest(), count


def _entry_checksum(entry: ModelManifestEntry) -> str | None:
    for key in ("checksum", "sha256", "content_hash"):
        value = getattr(entry, key, None)
        if value:
            return str(value)
    metadata = getattr(entry, "metadata", None)
    if isinstance(metadata, Mapping):
        for key in ("checksum", "sha256", "content_hash"):
            if metadata.get(key):
                return str(metadata[key])
    return None


class ModelRuntimeManager:
    """Stages vault models into a cache and creates safe launch plans."""

    def __init__(
        self,
        vault: ModelVault,
        cache_dir: str | Path | None = None,
        hardware: HardwareInfo | None = None,
        profiles: Sequence[RuntimeProfile] | None = None,
    ) -> None:
        self.vault = vault
        self.cache_dir = Path(cache_dir) if cache_dir else vault.vault_path / "runtime-cache"
        self.hardware = hardware or self.detect_hardware()
        self.profiles = {profile.name: profile for profile in (profiles or self.default_profiles())}

    @staticmethod
    def detect_hardware() -> HardwareInfo:
        ram_gb = 0.0
        try:
            import psutil

            ram_gb = psutil.virtual_memory().total / (1024**3)
        except (ImportError, OSError):
            pass
        return HardwareInfo(
            ram_gb=ram_gb,
            vram_gb=float(os.getenv("FORGE_VRAM_GB", "0") or 0),
            gpu_available=os.getenv("FORGE_GPU_AVAILABLE", "").lower() in {"1", "true", "yes"},
            gpu_vendor=os.getenv("FORGE_GPU_VENDOR", ""),
        )

    @staticmethod
    def default_profiles() -> tuple[RuntimeProfile, ...]:
        return (
            RuntimeProfile(
                name="ollama",
                command=("ollama", "serve"),
                supported_engines=frozenset({"ollama", "gguf", "ggml"}),
                min_ram_gb=4,
                default_port=11434,
                metadata={"model_argument": "managed-by-ollama"},
            ),
            RuntimeProfile(
                name="vllm",
                command=(sys.executable, "-m", "vllm.entrypoints.openai.api_server"),
                supported_engines=frozenset({"vllm", "safetensors", "transformers"}),
                min_ram_gb=8,
                min_vram_gb=4,
                requires_gpu=True,
                default_port=8000,
            ),
            RuntimeProfile(
                name="sglang",
                command=(sys.executable, "-m", "sglang.launch_server"),
                supported_engines=frozenset({"sglang", "safetensors", "transformers"}),
                min_ram_gb=8,
                min_vram_gb=4,
                requires_gpu=True,
                default_port=30000,
            ),
        )

    def _resolve_entry(self, entry_or_name: ModelManifestEntry | str) -> ModelManifestEntry:
        if isinstance(entry_or_name, ModelManifestEntry):
            return entry_or_name
        entry = self.vault.load_manifest().get(entry_or_name)
        if entry is None:
            raise KeyError(f"model is not present in vault manifest: {entry_or_name}")
        return entry

    def stage_model(self, entry_or_name: ModelManifestEntry | str) -> StageResult:
        entry = self._resolve_entry(entry_or_name)
        source = Path(entry.local_path).expanduser().resolve()
        if not source.is_dir():
            raise FileNotFoundError(f"vault model directory does not exist: {source}")
        checksum, files = _tree_checksum(source)
        expected = _entry_checksum(entry)
        if expected and expected.lower().removeprefix("sha256:") != checksum.lower():
            raise ValueError(f"checksum mismatch for {entry.name}")

        destination = (self.cache_dir / entry.name).resolve()
        metadata_path = destination / ".forge-stage.json"
        if metadata_path.exists():
            try:
                metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                metadata = {}
            if metadata.get("checksum") == checksum and destination.is_dir():
                return StageResult(entry.name, destination, "reused", checksum, True, files)

        self.cache_dir.mkdir(parents=True, exist_ok=True)
        temporary = self.cache_dir / f".{entry.name}.staging"
        if temporary.exists():
            shutil.rmtree(temporary)
        shutil.copytree(source, temporary)
        if destination.exists():
            shutil.rmtree(destination)
        temporary.replace(destination)
        metadata_path.write_text(
            json.dumps({"model": entry.name, "source": str(source), "checksum": checksum, "files": files}, indent=2),
            encoding="utf-8",
        )
        return StageResult(entry.name, destination, "staged", checksum, False, files)

    def compatibility(self, entry_or_name: ModelManifestEntry | str) -> dict[str, tuple[bool, str]]:
        entry = self._resolve_entry(entry_or_name)
        return {name: profile.compatible_with(entry, self.hardware) for name, profile in self.profiles.items()}

    def launch_plan(
        self,
        entry_or_name: ModelManifestEntry | str,
        runtime: str,
        host: str | None = None,
        port: int | None = None,
        extra_args: Sequence[str] = (),
        env: Mapping[str, str] | None = None,
    ) -> LaunchPlan:
        entry = self._resolve_entry(entry_or_name)
        profile = self.profiles.get(runtime)
        if profile is None:
            raise ValueError(f"unsupported runtime profile: {runtime}")
        compatible, reason = profile.compatible_with(entry, self.hardware)
        if not compatible:
            raise ValueError(reason)
        staged = self.stage_model(entry)
        selected_host = host or profile.default_host
        selected_port = port or profile.default_port
        argv = list(profile.command)
        if runtime == "ollama":
            argv.extend(("--host", f"{selected_host}:{selected_port}"))
        elif runtime == "vllm":
            argv.extend(("--model", str(staged.path), "--host", selected_host, "--port", str(selected_port)))
        elif runtime == "sglang":
            argv.extend(("--model-path", str(staged.path), "--host", selected_host, "--port", str(selected_port)))
        argv.extend(str(argument) for argument in extra_args)
        endpoint = f"http://{selected_host}:{selected_port}"
        return LaunchPlan(runtime, entry.name, staged.path, tuple(argv), staged.path, dict(env or {}), endpoint, profile.supports_tools)
