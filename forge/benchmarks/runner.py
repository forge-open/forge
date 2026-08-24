from __future__ import annotations

import json
import re
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

DEFAULT_PROMPTS = (
    "Explain what a Python list is in one sentence.",
    "Write a Python function that adds two integers.",
    "What is one practical way to make an API response faster?",
)


def _token_count(value: str) -> int:
    return len(re.findall(r"\w+|[^\w\s]", value or ""))


@dataclass
class BenchmarkResult:
    model_id: str
    status: str
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    samples: int = 0
    total_time: float = 0.0
    ttft: float = 0.0
    tokens_per_second: float = 0.0
    output_tokens: int = 0
    error: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)


class BenchmarkStore:
    """Persists benchmark results in a human-readable JSON file."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)

    def load(self) -> list[BenchmarkResult]:
        if not self.path.exists():
            return []
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            return [BenchmarkResult(**item) for item in data if isinstance(item, dict)]
        except (OSError, TypeError, ValueError, json.JSONDecodeError):
            return []

    def append(self, result: BenchmarkResult) -> BenchmarkResult:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        results = self.load()
        results.append(result)
        self.path.write_text(json.dumps([asdict(item) for item in results], indent=2), encoding="utf-8")
        return result

    def latest(self, model_id: str | None = None) -> BenchmarkResult | None:
        results = self.load()
        if model_id is not None:
            results = [item for item in results if item.model_id == model_id]
        return results[-1] if results else None


class BenchmarkRunner:
    """Runs fixed samples through an injected local provider and persists metrics."""

    def __init__(self, store: BenchmarkStore) -> None:
        self.store = store

    def run(
        self,
        model_id: str,
        generate: Callable[[str], Any] | None = None,
        prompts: tuple[str, ...] = DEFAULT_PROMPTS,
        metadata: dict[str, Any] | None = None,
    ) -> BenchmarkResult:
        if generate is None:
            return self.store.append(BenchmarkResult(
                model_id=model_id,
                status="not_run",
                error="No local generator was supplied; no model request was made.",
                metadata=metadata or {},
            ))

        started = time.perf_counter()
        first_response_time = 0.0
        output_tokens = 0
        completed = 0
        error = ""
        try:
            for prompt in prompts:
                sample_started = time.perf_counter()
                output = generate(prompt)
                first_response_time = first_response_time or (time.perf_counter() - sample_started)
                output_tokens += _token_count(output if isinstance(output, str) else str(output))
                completed += 1
        except Exception as exc:
            error = str(exc)
        total_time = time.perf_counter() - started
        return self.store.append(BenchmarkResult(
            model_id=model_id,
            status="completed" if completed == len(prompts) else "failed",
            samples=completed,
            total_time=total_time,
            ttft=first_response_time,
            tokens_per_second=output_tokens / total_time if total_time else 0.0,
            output_tokens=output_tokens,
            error=error,
            metadata=metadata or {},
        ))
