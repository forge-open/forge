import json
from pathlib import Path

import pytest

from forge.runtime import HardwareInfo, ModelRuntimeManager
from forge.utils.vault import ModelManifestEntry, ModelVault


def _entry(root: Path, name: str = "demo") -> ModelManifestEntry:
    model = root / "models" / name
    model.mkdir(parents=True)
    (model / "config.json").write_text('{"model": "demo"}', encoding="utf-8")
    (model / "weights.bin").write_bytes(b"weights")
    return ModelManifestEntry(name, "org/demo", "rev-1", "GGUF", "1GB", str(model), "ollama", "available")


def test_stage_model_copies_and_reuses_by_checksum(tmp_path):
    vault = ModelVault(tmp_path / "vault")
    vault.initialize_structure()
    entry = _entry(vault.models_dir)
    manager = ModelRuntimeManager(vault, tmp_path / "cache", hardware=HardwareInfo(ram_gb=16))

    first = manager.stage_model(entry)
    second = manager.stage_model(entry)

    assert first.status == "staged"
    assert second.status == "reused"
    assert second.reused is True
    assert second.checksum == first.checksum
    assert (second.path / "config.json").exists()
    assert json.loads((second.path / ".forge-stage.json").read_text())['files'] == 2


def test_stage_model_replaces_changed_cache(tmp_path):
    vault = ModelVault(tmp_path / "vault")
    entry = _entry(vault.models_dir)
    manager = ModelRuntimeManager(vault, tmp_path / "cache", hardware=HardwareInfo(ram_gb=16))

    first = manager.stage_model(entry)
    (Path(entry.local_path) / "weights.bin").write_bytes(b"changed")
    second = manager.stage_model(entry)

    assert second.status == "staged"
    assert second.checksum != first.checksum


def test_checksum_metadata_is_validated(tmp_path):
    vault = ModelVault(tmp_path / "vault")
    entry = _entry(vault.models_dir)
    manager = ModelRuntimeManager(vault, tmp_path / "cache", hardware=HardwareInfo(ram_gb=16))
    entry.checksum = "sha256:not-the-real-checksum"

    with pytest.raises(ValueError, match="checksum mismatch"):
        manager.stage_model(entry)


def test_runtime_compatibility_metadata_and_launch_plans(tmp_path):
    vault = ModelVault(tmp_path / "vault")
    entry = _entry(vault.models_dir)
    manager = ModelRuntimeManager(
        vault,
        tmp_path / "cache",
        hardware=HardwareInfo(ram_gb=24, vram_gb=12, gpu_available=True, gpu_vendor="nvidia"),
    )

    compatibility = manager.compatibility(entry)
    assert compatibility["ollama"] == (True, "compatible")
    assert compatibility["vllm"][0] is False

    ollama = manager.launch_plan(entry, "ollama", port=11435)
    assert ollama.argv == ("ollama", "serve", "--host", "127.0.0.1:11435")
    assert ollama.endpoint == "http://127.0.0.1:11435"


def test_vllm_and_sglang_plans_are_argv_only(tmp_path):
    vault = ModelVault(tmp_path / "vault")
    entry = _entry(vault.models_dir)
    entry.engine = "transformers"
    manager = ModelRuntimeManager(
        vault,
        tmp_path / "cache",
        hardware=HardwareInfo(ram_gb=24, vram_gb=16, gpu_available=True),
    )

    vllm = manager.launch_plan(entry, "vllm", extra_args=("--dtype", "auto"))
    sglang = manager.launch_plan(entry, "sglang")
    assert "--model" in vllm.argv and str(vllm.model_path) in vllm.argv
    assert "--model-path" in sglang.argv and str(sglang.model_path) in sglang.argv
    assert all(isinstance(argument, str) for argument in vllm.argv + sglang.argv)


def test_unknown_runtime_is_rejected_without_starting_process(tmp_path):
    vault = ModelVault(tmp_path / "vault")
    entry = _entry(vault.models_dir)
    manager = ModelRuntimeManager(vault, tmp_path / "cache", hardware=HardwareInfo(ram_gb=16))

    with pytest.raises(ValueError, match="unsupported runtime"):
        manager.launch_plan(entry, "unknown")
