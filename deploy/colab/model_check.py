from typing import Any, Dict, List

KNOWN_CHECKPOINTS = {
    "GLM-5.2-Official": {
        "name": "GLM 5.2 Official Checkpoint",
        "repo": "THUDM/glm-5.2",
        "params": "753B",
        "quantization": "BF16 (Unquantized)",
        "file_size": "~1.5 TB",
        "vram_required": "~1600 GB",
        "engine": "vLLM / SGLang",
        "colab_compatible": False,
        "notes": "Full 753B parameter raw checkpoint. Exceeds standard Colab VRAM limit."
    },
    "GLM-5.2-AWQ-INT4": {
        "name": "GLM 5.2 AWQ 4-bit Quant",
        "repo": "THUDM/glm-5.2-awq",
        "params": "753B (Quantized)",
        "quantization": "AWQ 4-bit",
        "file_size": "~380 GB",
        "vram_required": "~400 GB",
        "engine": "vLLM / SGLang",
        "colab_compatible": False,
        "notes": "Requires multi-GPU cluster (e.g. 8x A100 80GB) or high VRAM cloud deployment."
    },
    "GLM-5.2-Community-Mini": {
        "name": "GLM 5.2 Distilled Community Checkpoint",
        "repo": "THUDM/glm-5.2-distill-32b-awq",
        "params": "32B",
        "quantization": "AWQ 4-bit",
        "file_size": "~20 GB",
        "vram_required": "24 GB",
        "engine": "vLLM / SGLang",
        "colab_compatible": True,
        "notes": "Suitable for Colab A100 / L4 GPU runtimes."
    },
    "Kimi-K2.5-Official": {
        "name": "Kimi K2.5 Official",
        "repo": "MoonshotAI/kimi-k2.5",
        "params": "MoE",
        "quantization": "BF16",
        "file_size": "~400 GB",
        "vram_required": "~450 GB",
        "engine": "vLLM",
        "colab_compatible": False,
        "notes": "Full MoE checkpoint requiring distributed inference."
    },
    "Kimi-K2.5-Quant": {
        "name": "Kimi K2.5 AWQ 4-bit Community",
        "repo": "MoonshotAI/kimi-k2.5-awq",
        "params": "MoE (Quantized)",
        "quantization": "AWQ 4-bit",
        "file_size": "~110 GB",
        "vram_required": "~120 GB",
        "engine": "vLLM",
        "colab_compatible": False,
        "notes": "Requires multi-GPU (e.g. 2x A100 80GB)."
    }
}

UNCENSORED_VERIFICATION_CHECKLIST = [
    "1. Provenance: Official organization or verified community maintainer.",
    "2. Model Architecture: Matches original GLM 5.2 transformer structure without breaking weight layers.",
    "3. Quantization Method: AWQ / GPTQ / GGUF validated for inference engine.",
    "4. File Size & VRAM: Exact download size matches VRAM budget.",
    "5. Inference Compatibility: Fully supported by vLLM or SGLang v1/chat/completions API.",
    "6. License & Credibility: Open source license verified; no suspicious binary code executables in repo."
]

def check_model_compatibility(available_vram_gb: float) -> List[Dict[str, Any]]:
    print("\n" + "=" * 55)
    print("      Forge Model Discovery & Compatibility Check")
    print("=" * 55)
    print(f"Detected VRAM: {available_vram_gb} GB\n")

    compatible: List[Dict[str, Any]] = []
    for cid, info in KNOWN_CHECKPOINTS.items():
        vram_req = float(info["vram_required"].replace("~", "").replace("GB", "").strip())
        is_fit = available_vram_gb >= vram_req
        fit_status = "✅ FITS" if is_fit else "❌ INSUFFICIENT VRAM"
        print(f"• [{cid}] {info['name']}")
        print(f"  Repo: {info['repo']} | Params: {info['params']} | Quant: {info['quantization']}")
        print(f"  Size: {info['file_size']} | VRAM Required: {info['vram_required']} | Status: {fit_status}")
        print(f"  Notes: {info['notes']}\n")
        if is_fit:
            compatible.append(info)

    print("\n--- Uncensored Model Variant Verification Checklist ---")
    for item in UNCENSORED_VERIFICATION_CHECKLIST:
        print(item)
    print("=" * 55 + "\n")
    return compatible

if __name__ == "__main__":
    check_model_compatibility(available_vram_gb=40.0)
