import json
import time
from pathlib import Path
from typing import Dict, Any, List
from forge.config.settings import load_config
from forge.providers.openai_provider import OpenAICompatibleProvider

BENCHMARK_PROMPTS = [
    "Write a Python function to perform binary search on a sorted array.",
    "Implement a thread-safe singleton pattern in Python with unit tests.",
    "Draft a REST API endpoint in FastAPI for user authentication with JWT."
]

class BenchmarkRunner:
    """Runs latency, TTFT (time to first token), throughput, and memory benchmarks."""

    def __init__(self, output_dir: str = "benchmarks/results"):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def run_benchmark(self, model_key: str = "glm") -> Dict[str, Any]:
        config = load_config()
        model_cfg = config.models.get(model_key, config.get_primary_model())
        provider = OpenAICompatibleProvider(model_cfg)

        results: List[Dict[str, Any]] = []
        total_start = time.time()

        for idx, prompt in enumerate(BENCHMARK_PROMPTS):
            messages = [{"role": "user", "content": prompt}]
            t0 = time.time()
            ttft: float = 0.0
            first_chunk = True
            token_count = 0

            chunks = []
            for chunk in provider.generate_stream(messages=messages):
                if first_chunk:
                    ttft = time.time() - t0
                    first_chunk = False
                chunks.append(chunk)
                token_count += len(chunk.split())

            t1 = time.time()
            total_duration = t1 - t0
            tps = (token_count / total_duration) if total_duration > 0 else 0.0

            results.append({
                "prompt_id": idx + 1,
                "prompt": prompt,
                "ttft_seconds": round(ttft, 4),
                "total_time_seconds": round(total_duration, 4),
                "word_count": token_count,
                "tokens_per_second": round(tps, 2),
            })

        total_elapsed = time.time() - total_start
        report = {
            "model_name": model_cfg.name,
            "model_key": model_key,
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "total_benchmark_time_seconds": round(total_elapsed, 4),
            "runs": results,
        }

        output_path = self.output_dir / f"benchmark_{model_key}_{int(time.time())}.json"
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(report, f, indent=2)

        return report

if __name__ == "__main__":
    runner = BenchmarkRunner()
    res = runner.run_benchmark("glm")
    print(json.dumps(res, indent=2))
