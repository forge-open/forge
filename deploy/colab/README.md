# Google Colab Deployment Workflow for Forge 🛠️

This directory contains deployment scripts and notebooks to run open weight models (**GLM 5.2** & **Kimi K2.5**) on Google Colab or cloud GPU runtimes.

## Step-by-Step Workflow

1. **Mount Google Drive**:
   - Mount Google Drive to persist the Model Vault (`AI Model Vault/models/...`).
2. **Run Hardware Check**:
   ```bash
   python hardware_check.py
   ```
   - Verifies GPU model, VRAM capacity, CUDA version, PyTorch version, System RAM, and available disk space.
3. **Run Model Check & Compatibility Audit**:
   ```bash
   python model_check.py
   ```
   - Evaluates GLM 5.2 / Kimi K2.5 quantization sizes against available VRAM.
   - Evaluates uncensored variant credibility and license requirements.
4. **Interactive Download to Model Vault**:
   ```bash
   python download_model.py GLM-5.2-AWQ THUDM/glm-5.2-awq
   ```
   - Checks if the model already exists in Drive Vault before initiating download.
   - Requires explicit user confirmation.
5. **Launch Inference Server (vLLM / SGLang)**:
   ```bash
   python start_server.py --model-path "/content/drive/MyDrive/AI Model Vault/models/GLM-5.2-AWQ" --port 8000
   ```
6. **Verify Endpoint Health**:
   ```bash
   python health_check.py http://localhost:8000/v1
   ```
7. **Run Performance Benchmarks**:
   ```bash
   python benchmark.py glm
   ```
8. **Connect Local Forge CLI**:
   - Update `GLM_ENDPOINT=http://<colab-public-url-or-tunnel>:8000/v1` in your local `.env`.
