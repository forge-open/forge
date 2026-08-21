import tempfile

from forge.utils.vault import ModelManifestEntry, ModelVault


def test_model_vault_manifest_operations():
    with tempfile.TemporaryDirectory() as tmpdir:
        vault = ModelVault(tmpdir)
        vault.initialize_structure()

        assert vault.models_dir.exists()
        assert vault.configs_dir.exists()
        assert vault.manifest_file.exists()

        assert not vault.is_model_downloaded("Qwen3.8-27B-FP8")

        entry = ModelManifestEntry(
            name="Qwen3.8-27B-FP8",
            repository="Qwen/Qwen3.8-27B-FP8",
            revision="main",
            quantization="FP8",
            size="27GB",
            local_path=str(vault.models_dir / "Qwen3.8-27B-FP8"),
            engine="vLLM",
            status="available"
        )
        # Create dummy folder with file
        model_dir = vault.models_dir / "Qwen3.8-27B-FP8"
        model_dir.mkdir(parents=True, exist_ok=True)
        (model_dir / "config.json").write_text("{}", encoding="utf-8")

        vault.register_model(entry)
        assert vault.is_model_downloaded("Qwen3.8-27B-FP8")
