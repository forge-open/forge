import modal

app = modal.App("forge-gpu-test")

image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "torch",
    "psutil"
)

@app.function(gpu="any", image=image)
def check_gpu():
    import torch
    import psutil
    import platform

    print("\n" + "=" * 50)
    print("      Modal Remote GPU Test - Forge Harness")
    print("=" * 50)
    
    cuda_available = torch.cuda.is_available()
    print(f"CUDA Available   : {cuda_available}")
    if cuda_available:
        print(f"GPU Device       : {torch.cuda.get_device_name(0)}")
        print(f"Device Count     : {torch.cuda.device_count()}")
        vram_gb = round(torch.cuda.get_device_properties(0).total_memory / (1024**3), 2)
        print(f"Total VRAM       : {vram_gb} GB")
        print(f"CUDA Version     : {torch.version.cuda}")
    
    print(f"PyTorch Version  : {torch.__version__}")
    print(f"CPU Architecture : {platform.processor() or platform.machine()}")
    print("=" * 50 + "\n")
    
    return {
        "cuda_available": cuda_available,
        "gpu_name": torch.cuda.get_device_name(0) if cuda_available else "None",
        "vram_gb": round(torch.cuda.get_device_properties(0).total_memory / (1024**3), 2) if cuda_available else 0.0
    }

@app.local_entrypoint()
def main():
    print("Launching remote Modal GPU test...")
    res = check_gpu.remote()
    print(f"Remote Test Result: {res}")