"""Manifest-driven persistent storage for Hugging Face model files."""

from __future__ import annotations

import hashlib
import json
import shutil
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from forge.utils.logging import logger

MANIFEST_STATUSES = frozenset({"planned", "downloading", "available", "staged", "corrupt", "failed"})


class VaultError(RuntimeError):
    """Raised when a vault operation cannot be completed safely."""


@dataclass
class ModelManifestEntry:
    name: str
    repository: str
    revision: str
    quantization: str
    size: str
    local_path: str
    engine: str
    status: str = "planned"
    required_files: list[str] = field(default_factory=list)
    checksums: dict[str, str] = field(default_factory=dict)
    staged_path: str | None = None
    staged_at: str | None = None
    error: str | None = None


Downloader = Callable[..., str | Path | None]


class ModelVault:
    """Manage a model vault whose model directory is the persistent source of truth."""

    def __init__(self, vault_path: str = "/content/drive/MyDrive/AI Model Vault"):
        self.vault_path = Path(vault_path)
        self.models_dir = self.vault_path / "models"
        self.configs_dir = self.vault_path / "configs"
        self.cache_dir = self.vault_path / "cache"
        self.logs_dir = self.vault_path / "logs"
        self.manifest_file = self.configs_dir / "models.json"

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()

    def initialize_structure(self) -> None:
        try:
            for directory in (self.models_dir, self.configs_dir, self.cache_dir, self.logs_dir):
                directory.mkdir(parents=True, exist_ok=True)
            if not self.manifest_file.exists():
                self.save_manifest({})
        except OSError as exc:
            raise VaultError(f"Cannot initialize model vault at {self.vault_path}: {exc}") from exc

    def load_manifest(self) -> dict[str, ModelManifestEntry]:
        if not self.manifest_file.exists():
            return {}
        try:
            data = json.loads(self.manifest_file.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                raise ValueError("manifest root must be an object")
            entries = {name: ModelManifestEntry(**entry) for name, entry in data.items()}
            invalid = [entry.name for entry in entries.values() if entry.status not in MANIFEST_STATUSES]
            if invalid:
                raise ValueError(f"invalid status for {', '.join(invalid)}")
            return entries
        except (OSError, json.JSONDecodeError, TypeError, ValueError) as exc:
            raise VaultError(f"Cannot read model manifest {self.manifest_file}: {exc}") from exc

    def save_manifest(self, manifest: dict[str, ModelManifestEntry]) -> None:
        self.configs_dir.mkdir(parents=True, exist_ok=True)
        serializable = {name: asdict(entry) for name, entry in manifest.items()}
        temporary = self.manifest_file.with_suffix(".json.tmp")
        try:
            temporary.write_text(json.dumps(serializable, indent=2, sort_keys=True), encoding="utf-8")
            temporary.replace(self.manifest_file)
        except OSError as exc:
            raise VaultError(f"Cannot save model manifest {self.manifest_file}: {exc}") from exc

    def plan_download(self, name: str, repository: str, revision: str = "main",
                      quantization: str = "unknown", size: str = "unknown",
                      engine: str = "auto", required_files: list[str] | None = None) -> ModelManifestEntry:
        """Create/update a plan without downloading files."""
        manifest = self.load_manifest()
        entry = manifest.get(name) or ModelManifestEntry(
            name, repository, revision, quantization, size, str(self.models_dir / name), engine
        )
        entry.repository, entry.revision = repository, revision
        entry.quantization, entry.size, entry.engine = quantization, size, engine
        if required_files is not None:
            entry.required_files = list(required_files)
        if entry.status not in {"available", "staged"}:
            entry.status = "planned"
        entry.error = None
        manifest[name] = entry
        self.save_manifest(manifest)
        return entry

    @staticmethod
    def _checksums(directory: Path) -> dict[str, str]:
        result: dict[str, str] = {}
        for path in sorted(p for p in directory.rglob("*") if p.is_file()):
            digest = hashlib.sha256()
            with path.open("rb") as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(block)
            result[str(path.relative_to(directory))] = digest.hexdigest()
        return result

    def validate_model(self, entry: ModelManifestEntry) -> bool:
        directory = Path(entry.local_path)
        if not directory.is_dir():
            return False
        files = self._checksums(directory)
        if not files or any(required not in files for required in entry.required_files):
            return False
        return not entry.checksums or all(files.get(path) == checksum for path, checksum in entry.checksums.items())

    def download_model(self, name: str, downloader: Downloader | None = None) -> ModelManifestEntry:
        """Download a planned model; existing valid files make this idempotent."""
        manifest = self.load_manifest()
        if name not in manifest:
            raise VaultError(f"Model {name!r} has no download plan")
        entry = manifest[name]
        if self.validate_model(entry):
            entry.status = "available"
            self.save_manifest(manifest)
            return entry
        entry.status, entry.error = "downloading", None
        self.save_manifest(manifest)
        target = Path(entry.local_path)
        target.mkdir(parents=True, exist_ok=True)
        try:
            if downloader is None:
                from huggingface_hub import snapshot_download
                try:
                    snapshot_download(repo_id=entry.repository, revision=entry.revision,
                                      local_dir=str(target), resume_download=True)
                except TypeError:
                    snapshot_download(repo_id=entry.repository, revision=entry.revision,
                                      local_dir=str(target))
            else:
                downloader(entry.repository, revision=entry.revision, local_dir=target)
            entry.checksums = self._checksums(target)
            if not self.validate_model(entry):
                raise VaultError("downloaded files are empty or missing required files")
            entry.status, entry.error = "available", None
        except Exception as exc:
            entry.status, entry.error = "failed", str(exc)
            self.save_manifest(manifest)
            raise VaultError(f"Failed to download {name!r}: {exc}") from exc
        self.save_manifest(manifest)
        return entry

    def stage_model(self, name: str, staging_path: str) -> ModelManifestEntry:
        """Copy a verified persistent model to a local staging directory."""
        manifest = self.load_manifest()
        if name not in manifest:
            raise VaultError(f"Model {name!r} is not registered")
        entry = manifest[name]
        if not self.validate_model(entry):
            entry.status, entry.error = "corrupt", "persistent model failed validation"
            self.save_manifest(manifest)
            raise VaultError(f"Cannot stage {name!r}: persistent model failed validation")
        destination = Path(staging_path) / name
        try:
            shutil.copytree(entry.local_path, destination, dirs_exist_ok=True)
        except OSError as exc:
            raise VaultError(f"Cannot stage {name!r} at {destination}: {exc}") from exc
        if self._checksums(destination) != self._checksums(Path(entry.local_path)):
            raise VaultError(f"Staging validation failed for {name!r}")
        entry.staged_path, entry.staged_at, entry.status, entry.error = str(destination), self._now(), "staged", None
        self.save_manifest(manifest)
        return entry

    def is_model_downloaded(self, model_name: str) -> bool:
        manifest = self.load_manifest()
        entry = manifest.get(model_name)
        if entry:
            return entry.status in {"available", "staged"} and self.validate_model(entry)
        expected_path = self.models_dir / model_name
        return expected_path.is_dir() and bool(self._checksums(expected_path))

    def register_model(self, entry: ModelManifestEntry) -> None:
        if entry.status not in MANIFEST_STATUSES:
            raise VaultError(f"Unsupported model status {entry.status!r}")
        manifest = self.load_manifest()
        manifest[entry.name] = entry
        self.save_manifest(manifest)
        logger.info(f"Registered model {entry.name} in vault manifest.")
