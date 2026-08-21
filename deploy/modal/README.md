# Modal Cloud Deployment Guide for Forge 🛠️

[Modal](https://modal.com/) provides serverless GPU infrastructure ideal for hosting open weight models like **GLM 5.2** and **Kimi K2.5**.

## Features
- Serverless GPU auto-scaling (A100 / H100 / L4).
- Persistent Modal Volumes for model checkpoint caching.
- Native vLLM / SGLang integration exposing OpenAI-compatible endpoints (`/v1/chat/completions`).

## Usage
1. Install Modal CLI:
   ```bash
   pip install modal
   modal setup
   ```
2. Deploy vLLM server on Modal:
   ```bash
   modal run deploy/modal/modal_server.py
   ```
