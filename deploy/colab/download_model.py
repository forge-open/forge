import sys

from forge.utils.vault import ModelManifestEntry, ModelVault


def download_model_interactive(
    model_name: str,
    repository: str,
    quantization: str = "AWQ-INT4",
    drive_vault_path: str = "/content/drive/MyDrive/AI Model Vault"
) -> bool:
    """Checks vault manifest and downloads model only after explicit user confirmation."""
    vault = ModelVault(drive_vault_path)
    vault.initialize_structure()

    print(f"\n--- Model Vault Check: {model_name} ---")
    if vault.is_model_downloaded(model_name):
        print(f"✅ Model '{model_name}' already exists in Google Drive Vault at {vault.models_dir / model_name}.")
        print("Skipping download to avoid redundant bandwidth usage.")
        return True

    print(f"⚠️ Model '{model_name}' (Repo: {repository}) is NOT present in Google Drive Vault.")
    print("Drive Vault Location:", vault.models_dir / model_name)

    confirm = input(f"Do you want to download '{repository}' to Google Drive Vault now? (y/N): ").strip().lower()
    if confirm not in ("y", "yes"):
        print("Download cancelled by user. No model downloaded.")
        return False

    print(f"\n[Downloading {repository} via huggingface_hub to {vault.models_dir / model_name}...]")
    try:
        from huggingface_hub import snapshot_download
        target_dir = vault.models_dir / model_name
        target_dir.mkdir(parents=True, exist_ok=True)
        snapshot_download(repo_id=repository, local_dir=str(target_dir))

        manifest_entry = ModelManifestEntry(
            name=model_name,
            repository=repository,
            revision="main",
            quantization=quantization,
            size="Verified",
            local_path=str(target_dir),
            engine="vLLM",
            status="available"
        )
        vault.register_model(manifest_entry)
        print(f"✅ Download complete! Model registered in {vault.manifest_file}.")
        return True
    except ImportError:
        print("❌ Error: 'huggingface_hub' package is not installed. Install via `pip install huggingface_hub`.")
        return False
    except Exception as e:
        print(f"❌ Failed to download model: {e}")
        return False

if __name__ == "__main__":
    if len(sys.argv) > 2:
        download_model_interactive(sys.argv[1], sys.argv[2])
    else:
        print("Usage: python download_model.py <model_name> <repository>")
