import tempfile
from pathlib import Path
from forge.utils.vault import ModelVault, ModelManifestEntry

def test_model_vault_manifest_operations():
    with tempfile.TemporaryDirectory() as tmpdir:
        vault = ModelVault(tmpdir)
        vault.initialize_structure()

        assert vault.models_dir.exists()
        assert vault.configs_dir.exists()
        assert vault.manifest_file.exists()

        assert not vault.is_model_downloaded("GLM-5.2")

        entry = ModelManifestEntry(
            name="GLM-5.2",
            repository="THUDM/glm-5.2",
            revision="main",
            quantization="AWQ",
            size="45GB",
            local_path=str(vault.models_dir / "GLM-5.2"),
            engine="vLLM",
            status="available"
        )
        # Create dummy folder with file
        model_dir = vault.models_dir / "GLM-5.2"
        model_dir.mkdir(parents=True, exist_ok=True)
        (model_dir / "config.json").write_text("{}", encoding="utf-8")

        vault.register_model(entry)
        assert vault.is_model_downloaded("GLM-5.2")
