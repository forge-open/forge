# Model Routing Architecture & Vision

Forge is built on a provider-decoupled architecture designed to intelligently route tasks across local and remote open-weight models based on task requirements, model strength, and resource availability.

---

## Current Architecture

Currently, Forge connects to any standard OpenAI-compatible `/v1/chat/completions` endpoint and provides dynamic model discovery via `/v1/models`.

```
                  ┌────────────────────────┐
                  │    Forge CLI Shell     │
                  └───────────┬────────────┘
                              │
                              ▼
                  ┌────────────────────────┐
                  │    ModelRouter         │
                  └───────────┬────────────┘
                              │
                              ▼
                  ┌────────────────────────┐
                  │ OpenAICompatible       │
                  │ Provider Interface     │
                  └───────────┬────────────┘
                              │
                              ▼
                  ┌────────────────────────┐
                  │ vLLM / SGLang Endpoint │
                  │ (Qwen3.8 27B FP8)      │
                  └────────────────────────┘
```

---

## Model Routing Vision

In upcoming releases, Forge will expand its `ModelRouter` to automatically dispatch work across specialized models:

1. **Primary Coding Model** (e.g. Qwen3.8 27B FP8 / GLM 5.2): Handles code generation, file editing, and main task execution.
2. **Reviewer Model** (e.g. Kimi K2.5): Performs automated code reviews, diff inspections, and edge-case validation.
3. **Local Fast Model**: Handles fast completions, status updates, and context summary generation.

### Bring Your Own Compute (BYOC)

Developers can host their own inference servers via:
- Local GPU workstations (`vLLM`, `Ollama`, `SGLang`)
- Cloud GPU instances (RunPod, Lambda Labs, Vast.ai)
- SSH-tunnelled studio environments (Lightning AI Studios)
