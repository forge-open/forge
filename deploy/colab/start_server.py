import sys
import subprocess
import argparse
from pathlib import Path

def start_inference_server(
    model_path: str,
    port: int = 8000,
    engine: str = "vllm",
    quantization: str = "awq",
    tensor_parallel_size: int = 1,
    max_model_len: int = 8192
) -> None:
    """Launches vLLM or SGLang OpenAI-compatible API server."""
    print("\n" + "=" * 55)
    print(f"      Launching Forge Inference Server ({engine.upper()})")
    print("=" * 55)
    print(f"Model Path            : {model_path}")
    print(f"Port                  : {port}")
    print(f"Engine                : {engine}")
    print(f"Quantization          : {quantization}")
    print(f"Tensor Parallel Size  : {tensor_parallel_size}")
    print(f"Max Model Length      : {max_model_len}")
    print("=" * 55 + "\n")

    if engine.lower() == "vllm":
        cmd = [
            "python", "-m", "vllm.entrypoints.openai.api_server",
            "--model", model_path,
            "--port", str(port),
            "--quantization", quantization,
            "--tensor-parallel-size", str(tensor_parallel_size),
            "--max-model-len", str(max_model_len),
            "--trust-remote-code"
        ]
    elif engine.lower() == "sglang":
        cmd = [
            "python", "-m", "sglang.launch_server",
            "--model-path", model_path,
            "--port", str(port),
            "--tp", str(tensor_parallel_size),
            "--trust-remote-code"
        ]
    else:
        print(f"❌ Unsupported engine '{engine}'. Choose 'vllm' or 'sglang'.")
        sys.exit(1)

    print(f"Executing: {' '.join(cmd)}\n")
    try:
        subprocess.run(cmd, check=True)
    except KeyboardInterrupt:
        print("\nInference server stopped by user.")
    except Exception as e:
        print(f"\n❌ Error starting server: {e}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Start vLLM / SGLang inference server for Forge.")
    parser.add_argument("--model-path", type=str, required=True, help="Path to local quantized checkpoint")
    parser.add_argument("--port", type=int, default=8000, help="Server port")
    parser.add_argument("--engine", type=str, choices=["vllm", "sglang"], default="vllm", help="Inference engine")
    parser.add_argument("--quantization", type=str, default="awq", help="Quantization type (awq, gptq, squeezellm)")
    parser.add_argument("--tp", type=int, default=1, help="Tensor parallel degree")
    args = parser.parse_args()

    start_inference_server(
        model_path=args.model_path,
        port=args.port,
        engine=args.engine,
        quantization=args.quantization,
        tensor_parallel_size=args.tp
    )
