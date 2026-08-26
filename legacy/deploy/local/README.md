# Local GPU Deployment Guide for Forge 🛠️

To host GLM 5.2 or Kimi K2.5 on a local workstation:

## Prerequisites
- NVIDIA GPU with CUDA support.
- Recommended VRAM:
  - 4-bit Quantized GLM 5.2 (Distilled/Mini): 24 GB+ VRAM (RTX 3090 / 4090 / RTX 6000 Ada).
  - Full 753B Quantized GLM 5.2: Multi-GPU setup (4x to 8x 80GB VRAM GPUs).
- Installed `vLLM` or `SGLang`.

## Quick Start
1. Start vLLM local API server:
   ```bash
   vllm serve THUDM/glm-5.2-awq --port 8000 --quantization awq
   ```
2. Configure `.env`:
   ```env
   GLM_ENDPOINT=http://localhost:8000/v1
   ```
3. Run Forge CLI:
   ```bash
   forge
   ```
