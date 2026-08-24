import json
from pathlib import Path

from forge.benchmarks import BenchmarkResult, BenchmarkRunner, BenchmarkStore


def test_benchmark_runner_persists_offline_result(tmp_path: Path):
    store = BenchmarkStore(tmp_path / "benchmarks.json")
    result = BenchmarkRunner(store).run("test-model")
    assert result.status == "not_run"
    assert store.latest("test-model") == result
    assert json.loads((tmp_path / "benchmarks.json").read_text())


def test_benchmark_runner_records_injected_generator(tmp_path: Path):
    store = BenchmarkStore(tmp_path / "benchmarks.json")
    result = BenchmarkRunner(store).run("test-model", generate=lambda prompt: "ok")
    assert result.status == "completed"
    assert result.samples == 3
    assert result.output_tokens == 3


def test_benchmark_store_ignores_corrupt_file(tmp_path: Path):
    path = tmp_path / "benchmarks.json"
    path.write_text("not json", encoding="utf-8")
    assert BenchmarkStore(path).load() == []


def test_benchmark_store_round_trips_result(tmp_path: Path):
    store = BenchmarkStore(tmp_path / "benchmarks.json")
    store.append(BenchmarkResult(model_id="m", status="completed", samples=1))
    loaded = store.latest()
    assert loaded is not None
    assert loaded.model_id == "m"
    assert loaded.samples == 1
