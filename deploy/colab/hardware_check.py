import platform
import shutil
import subprocess
from typing import Any, Dict


def get_hardware_info() -> Dict[str, Any]:
    info: Dict[str, Any] = {
        "gpu": "None detected",
        "gpu_count": 0,
        "vram_gb": 0.0,
        "cuda_version": "N/A",
        "pytorch_version": "N/A",
        "system_ram_gb": 0.0,
        "available_disk_gb": 0.0,
        "cpu_info": platform.processor() or platform.machine(),
    }

    # PyTorch & GPU info
    try:
        import torch
        info["pytorch_version"] = torch.__version__
        info["cuda_version"] = torch.version.cuda if torch.cuda.is_available() else "N/A"
        if torch.cuda.is_available():
            info["gpu_count"] = torch.cuda.device_count()
            gpu_name = torch.cuda.get_device_name(0)
            total_vram = torch.cuda.get_device_properties(0).total_memory / (1024 ** 3)
            info["gpu"] = gpu_name
            info["vram_gb"] = round(total_vram, 2)
    except ImportError:
        # Fallback to nvidia-smi if torch not installed
        try:
            res = subprocess.run(
                "nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits",
                shell=True, capture_output=True, text=True
            )
            if res.returncode == 0 and res.stdout.strip():
                lines = res.stdout.strip().split("\n")
                info["gpu_count"] = len(lines)
                name, mem = lines[0].split(",")
                info["gpu"] = name.strip()
                info["vram_gb"] = round(float(mem.strip()) / 1024.0, 2)
        except Exception:
            pass

    # System RAM
    try:
        import psutil
        info["system_ram_gb"] = round(psutil.virtual_memory().total / (1024 ** 3), 2)
    except ImportError:
        info["system_ram_gb"] = 0.0

    # Disk Space
    try:
        total, used, free = shutil.disk_usage("/")
        info["available_disk_gb"] = round(free / (1024 ** 3), 2)
    except Exception:
        pass

    return info

def print_hardware_report() -> Dict[str, Any]:
    hw = get_hardware_info()

    print("\n" + "=" * 50)
    print("        Forge Hardware Compatibility Report")
    print("=" * 50)
    print(f"GPU              : {hw['gpu']}")
    print(f"GPU Count        : {hw['gpu_count']}")
    print(f"VRAM             : {hw['vram_gb']} GB")
    print(f"CUDA Version     : {hw['cuda_version']}")
    print(f"PyTorch Version  : {hw['pytorch_version']}")
    print(f"System RAM       : {hw['system_ram_gb']} GB")
    print(f"Available Disk   : {hw['available_disk_gb']} GB")
    print(f"CPU Architecture : {hw['cpu_info']}")
    print("-" * 50)

    print("Compatibility Assessment:")
    vram = hw["vram_gb"]
    if vram == 0:
        print("❌ NO GPU DETECTED. Local GPU inference is unavailable. CPU offloading is extremely slow.")
    elif vram < 16:
        print(f"⚠️ LOW VRAM ({vram} GB). Cannot fit heavy 27B+ models natively without offloading.")
    elif vram < 40:
        print(f"⚡ MEDIUM VRAM ({vram} GB - e.g. T4/V100/L4). Can fit 4-bit quantized ~30B models or offloaded quants.")
    else:
        print(f"🚀 HIGH VRAM ({vram} GB - e.g. A100/H100/L40S). Suitable for Qwen3 27B FP8 models and larger checkpoints.")

    print("=" * 50 + "\n")
    return hw

if __name__ == "__main__":
    print_hardware_report()
