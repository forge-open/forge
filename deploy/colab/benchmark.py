import sys

from benchmarks.benchmark_runner import BenchmarkRunner


def main() -> None:
    model_key = sys.argv[1] if len(sys.argv) > 1 else "glm"
    print(f"\n[Running Colab Benchmark Suite for model '{model_key}'...]\n")
    runner = BenchmarkRunner(output_dir="benchmarks/results")
    res = runner.run_benchmark(model_key)
    print("Benchmark Completed Successfully.")
    print(f"Total Elapsed Time: {res['total_benchmark_time_seconds']}s")
    for r in res["runs"]:
        print(f"Run {r['prompt_id']}: TTFT={r['ttft_seconds']}s | TPS={r['tokens_per_second']}")

if __name__ == "__main__":
    main()
