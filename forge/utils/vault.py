import json
from dataclasses import asdict, dataclass
from pathlib import Path

from forge.utils.logging import logger


@dataclass
class ModelManifestEntry:
    name: str
    repository: str
    revision: str
    quantization: str
    size: str
    local_path: str
    engine: str
    status: str  # e.g., "available", "downloading", "missing", "corrupted"

class ModelVault:
    """Manages Google Drive or local filesystem model vault storage and manifest."""

    def __init__(self, vault_path: str = "/content/drive/MyDrive/AI Model Vault"):
        self.vault_path = Path(vault_path)
        self.models_dir = self.vault_path / "models"
        self.configs_dir = self.vault_path / "configs"
        self.cache_dir = self.vault_path / "cache"
        self.logs_dir = self.vault_path / "logs"
        self.manifest_file = self.configs_dir / "models.json"

    def initialize_structure(self) -> None:
        """Creates the vault folder structure if accessible."""
        try:
            self.models_dir.mkdir(parents=True, exist_ok=True)
            self.configs_dir.mkdir(parents=True, exist_ok=True)
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            self.logs_dir.mkdir(parents=True, exist_ok=True)
            if not self.manifest_file.exists():
                self.save_manifest({})
        except Exception as e:
            logger.warning(f"Could not initialize vault directories at {self.vault_path}: {e}")

    def load_manifest(self) -> dict[str, ModelManifestEntry]:
        """Loads models.json manifest."""
        if not self.manifest_file.exists():
            return {}
        try:
            with open(self.manifest_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            entries = {}
            for name, entry_data in data.items():
                entries[name] = ModelManifestEntry(**entry_data)
            return entries
        except Exception as e:
            logger.error(f"Error reading manifest {self.manifest_file}: {e}")
            return {}

    def save_manifest(self, manifest: dict[str, ModelManifestEntry]) -> None:
        """Saves models.json manifest."""
        try:
            self.configs_dir.mkdir(parents=True, exist_ok=True)
            serializable = {k: asdict(v) for k, v in manifest.items()}
            with open(self.manifest_file, "w", encoding="utf-8") as f:
                json.dump(serializable, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save manifest to {self.manifest_file}: {e}")

    def is_model_downloaded(self, model_name: str) -> bool:
        """Checks if a model is complete and ready in the vault."""
        manifest = self.load_manifest()
        if model_name in manifest:
            entry = manifest[model_name]
            if entry.status == "available" and Path(entry.local_path).exists():
                # Verify non-empty folder
                files = list(Path(entry.local_path).glob("*"))
                if len(files) > 0:
                    return True
        
        # Check conventional path fallback
        expected_path = self.models_dir / model_name
        return bool(expected_path.exists() and any(expected_path.iterdir()))

    def register_model(self, entry: ModelManifestEntry) -> None:
        """Registers or updates a model entry in the manifest."""
        manifest = self.load_manifest()
        manifest[entry.name] = entry
        self.save_manifest(manifest)
        logger.info(f"Registered model {entry.name} in vault manifest.")
