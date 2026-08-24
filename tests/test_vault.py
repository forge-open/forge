import hashlib
import json
import tempfile
from pathlib import Path

import pytest

from forge.utils.vault import ModelManifestEntry, ModelVault, VaultError


def test_model_vault_manifest_operations():
    with tempfile.TemporaryDirectory() as tmpdir:
        vault = ModelVault(tmpdir)
        vault.initialize_structure()
        assert vault.models_dir.exists()
        assert not vault.is_model_downloaded("missing")
        model_dir = vault.models_dir / "Qwen"
        model_dir.mkdir(parents=True)
        (model_dir / "config.json").write_text("{}", encoding="utf-8")
        vault.register_model(ModelManifestEntry(
            name="Qwen", repository="Qwen/test", revision="main", quantization="FP8",
            size="27GB", local_path=str(model_dir), engine="vLLM", status="available"
        ))
        assert vault.is_model_downloaded("Qwen")


def test_plan_download_is_idempotent_and_records_persistent_path():
    with tempfile.TemporaryDirectory() as tmpdir:
        vault = ModelVault(tmpdir)
        vault.initialize_structure()
        first = vault.plan_download("gemma", "google/gemma", required_files=["config.json"])
        second = vault.plan_download("gemma", "google/gemma", required_files=["config.json"])
        assert first.local_path == second.local_path == str(vault.models_dir / "gemma")
        assert second.status == "planned"
        assert vault.load_manifest()["gemma"].repository == "google/gemma"


def test_download_is_offline_resumable_and_checksum_validated():
    with tempfile.TemporaryDirectory() as tmpdir:
        vault = ModelVault(tmpdir)
        vault.initialize_structure()
        vault.plan_download("gemma", "google/gemma", required_files=["config.json"])
        calls = []

        def fake_download(repository, *, revision, local_dir):
            calls.append((repository, revision))
            Path(local_dir).mkdir(parents=True, exist_ok=True)
            (Path(local_dir) / "config.json").write_text("{}", encoding="utf-8")

        entry = vault.download_model("gemma", downloader=fake_download)
        assert entry.status == "available"
        assert entry.checksums["config.json"] == hashlib.sha256(b"{}").hexdigest()
        vault.download_model("gemma", downloader=fake_download)
        assert len(calls) == 1
        (Path(entry.local_path) / "config.json").write_text("changed", encoding="utf-8")
        assert not vault.is_model_downloaded("gemma")


def test_download_failure_is_truthful_and_persisted():
    with tempfile.TemporaryDirectory() as tmpdir:
        vault = ModelVault(tmpdir)
        vault.initialize_structure()
        vault.plan_download("bad", "missing/model")
        def fail(*_args, **_kwargs):
            raise RuntimeError("offline")
        with pytest.raises(VaultError, match="Failed to download 'bad'"):
            vault.download_model("bad", downloader=fail)
        entry = vault.load_manifest()["bad"]
        assert entry.status == "failed"
        assert entry.error == "offline"


def test_stage_records_metadata_and_rejects_corrupt_source():
    with tempfile.TemporaryDirectory() as tmpdir:
        vault = ModelVault(tmpdir)
        vault.initialize_structure()
        vault.plan_download("gemma", "google/gemma")
        def download(_repo, **kwargs):
            Path(kwargs["local_dir"]).joinpath("model.gguf").write_bytes(b"model")
        vault.download_model("gemma", downloader=download)
        staged = vault.stage_model("gemma", str(Path(tmpdir) / "staging"))
        assert staged.status == "staged"
        assert Path(staged.staged_path, "model.gguf").read_bytes() == b"model"
        assert staged.staged_at
        Path(staged.local_path, "model.gguf").write_bytes(b"corrupt")
        with pytest.raises(VaultError, match="failed validation"):
            vault.stage_model("gemma", str(Path(tmpdir) / "other"))
        assert vault.load_manifest()["gemma"].status == "corrupt"


def test_invalid_manifest_status_is_not_silently_ignored():
    with tempfile.TemporaryDirectory() as tmpdir:
        vault = ModelVault(tmpdir)
        vault.initialize_structure()
        payload = {"x": {"name": "x", "repository": "x", "revision": "main",
                          "quantization": "q", "size": "1", "local_path": "x",
                          "engine": "x", "status": "done"}}
        vault.manifest_file.write_text(json.dumps(payload), encoding="utf-8")
        with pytest.raises(VaultError, match="invalid status"):
            vault.load_manifest()
