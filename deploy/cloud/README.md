# Cloud GPU Deployment Guide for Forge 🛠️ (RunPod, Lambda, Vast.ai)

For larger models like full GLM 5.2 or Kimi K2.5 quantizations, deploy inference nodes on cloud GPU providers.

## Recommended Cloud Instances
- **RunPod / Lambda Labs**:
  - 8x NVIDIA A100 (80GB) or 8x NVIDIA H100 (80GB) for full GLM 5.2 AWQ 4-bit quant.
  - 1x NVIDIA A100 (80GB) for 70B distilled models.

## Launch Steps
1. Launch PyTorch container with vLLM installed.
2. Run vLLM endpoint:
   ```bash
   python3 -m vllm.entrypoints.openai.api_server \
       --model THUDM/glm-5.2-awq \
       --port 8000 \
       --tensor-parallel-size 8
   ```
3. Set your Cloud IP in local `.env`:
   ```env
   GLM_ENDPOINT=http://<cloud-instance-ip>:8000/v1
   GLM_API_KEY=your-secure-key
   ```
