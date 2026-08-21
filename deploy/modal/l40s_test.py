import modal

app = modal.App("forge-l40s-test")

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install("torch")
)


@app.function(
    image=image,
    gpu="L40S",
    timeout=120,
)
def test_gpu():
    import torch

    print("=" * 60)
    print("FORGE — L40S GPU TEST")
    print("=" * 60)

    print(f"PyTorch       : {torch.__version__}")
    print(f"CUDA available: {torch.cuda.is_available()}")

    if not torch.cuda.is_available():
        raise RuntimeError("CUDA unavailable")

    gpu = torch.cuda.get_device_properties(0)

    print(f"GPU           : {gpu.name}")
    print(f"VRAM          : {gpu.total_memory / 1024**3:.2f} GB")
    print(f"Compute Cap.  : {gpu.major}.{gpu.minor}")
    print(f"CUDA          : {torch.version.cuda}")

    x = torch.randn(
        4096,
        4096,
        device="cuda",
        dtype=torch.float16,
    )

    y = x @ x

    torch.cuda.synchronize()

    print("Matrix test   : SUCCESS")
    print(f"Result shape  : {tuple(y.shape)}")

    print("=" * 60)

    return {
        "gpu": gpu.name,
        "vram_gb": round(gpu.total_memory / 1024**3, 2),
    }


@app.local_entrypoint()
def main():
    result = test_gpu.remote()
    print("\nResult:", result)