# Automatic Remote GPU Lifecycle Management ⚡

Forge features native, automated remote GPU lifecycle management for cloud infrastructure such as Lightning AI Studios.

Instead of manually starting cloud GPUs, SSH tunneling, and starting Forge, you simply run:

```bash
forge
```

Forge detects if the remote backend is reachable. If it is stopped, Forge presents a polished interactive prompt to launch the GPU studio, open the SSH tunnel, verify vLLM health, auto-discover models, and cleanly stop the GPU upon exit.

---

## Architecture Overview

```
Windows Workstation
        ↓
    Forge CLI
        ↓
  RemoteManager
        ↓
SSHTunnelManager (Port 8000 Forwarding)
        ↓
Lightning AI Studio: forge-qwen (NVIDIA L40S 48 GB)
        ↓
 vLLM Server (http://localhost:8000/v1)
        ↓
   Qwen3.8 27B FP8
```

---

## 1. What Automatic Remote GPU Management Does

When you run `forge`:

1. **Backend Check**: Forge checks `http://localhost:8000/v1/models` to see if the GPU server is already active.
2. **Already Running**:
   - Status: `✓ Connected`
   - Forge proceeds normally without starting a redundant GPU.
   - On exit (`/exit`, `/quit`, `Ctrl+C`), Forge leaves the pre-existing GPU running.
3. **Not Running**:
   - Forge displays an interactive CLI prompt:

```text
┌──────────────────────────────────────────────┐
│  ⚡ Remote GPU required                      │
│                                              │
│  Forge needs the remote GPU to continue.     │
│                                              │
│  Provider: Lightning AI                      │
│  Studio: forge-qwen                          │
│  GPU: NVIDIA L40S 48 GB                      │
│  Model: Qwen3.8 27B FP8                      │
│                                              │
│  [ Enter ] Start remote GPU                  │
│  [ L ] Use local backend                     │
│  [ C ] Cancel                                │
└──────────────────────────────────────────────┘
```

4. **On User Confirmation**:
   - `⚡ Starting Lightning AI Studio...` → `✓ Studio started`
   - `⚡ Waiting for GPU...` → `✓ NVIDIA L40S ready`
   - `⚡ Waiting for vLLM...` → `✓ vLLM ready`
   - `⚡ Establishing SSH tunnel...` → `✓ Tunnel established`
   - `✓ Forge is ready`

5. **Dynamic Model Discovery**: Forge queries `/v1/models` over the tunnel and automatically connects to the served model (`Qwen3.8 27B FP8`).
6. **Graceful Session Shutdown**: Upon exit, Forge closes the SSH tunnel, stops the Lightning Studio (if started by Forge), and prints session metrics:

```text
✓ Forge session ended
⚡ Remote GPU session: 1h 42m
✓ Lightning AI Studio stopped
✓ GPU resources released
```

---

## 2. Lightning AI Authentication

Forge supports authentication via environment variables or the official Lightning CLI/SDK login session.

### Environment Variable Authentication (Recommended)

Set your Lightning API key in your environment or `.env` file:

```bash
export LIGHTNING_API_KEY="your-lightning-api-key"
# or
export FORGE_LIGHTNING_API_KEY="your-lightning-api-key"
```

### CLI / SDK Authentication

If you have used the Lightning CLI on your machine:

```bash
lightning login
```

Forge will automatically detect your existing credentials.

> **Security Note**: Credentials and private API keys are NEVER logged or printed in output tracebacks.

---

## 3. Configuring Remote GPU Settings

You can configure remote GPU behavior via environment variables or inside `.forge/config.yaml`.

### Environment Variables

```bash
# Provider configuration
FORGE_REMOTE_PROVIDER=lightning
FORGE_LIGHTNING_STUDIO=forge-qwen
FORGE_LIGHTNING_GPU="NVIDIA L40S 48 GB"
FORGE_REMOTE_PORT=8000

# Teamspace & User (Optional)
FORGE_LIGHTNING_TEAMSPACE=my-teamspace
FORGE_LIGHTNING_USER=my-user

# Automation & Safety Controls
FORGE_REMOTE_AUTO_START=true
FORGE_REMOTE_AUTO_STOP=true
FORGE_REMOTE_STARTUP_TIMEOUT=300
FORGE_REMOTE_RETRY_INTERVAL=3
```

### YAML Configuration (`.forge/config.yaml`)

```yaml
remote:
  provider: lightning
  studio: forge-qwen
  gpu: NVIDIA L40S 48 GB
  remote_port: 8000
  auto_start: true
  auto_stop: true
  startup_timeout: 300.0
  retry_interval: 3.0
```

---

## 4. SSH Tunneling Mechanism

Forge manages SSH port forwarding programmatically via `SSHTunnelManager`:

- Tunnel target: `ssh -N -L 8000:localhost:8000 <studio-user>@ssh.lightning.ai`
- Options configured: `-o ExitOnForwardFailure=yes -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=15`
- **Health Monitoring & Auto-Reconnect**: Monitors connection status. If the tunnel disconnects unexpectedly, Forge automatically attempts reconnection without crashing your session.

---

## 5. Disabling Automatic Remote GPU Startup

If you prefer to start GPUs manually or run strictly against a local model server:

1. **Option 1**: Select `[ L ] Use local backend` when prompted in the interactive CLI.
2. **Option 2**: Set environment variable:
   ```bash
   export FORGE_REMOTE_AUTO_START=false
   ```

---

## 6. Interactive Slash Command `/remote`

Within the Forge CLI shell, use `/remote` to monitor or control infrastructure:

- `/remote` or `/remote status`: View detailed status panel (Provider, Studio, GPU, Status, Model, Session duration, Ownership).
- `/remote start`: Programmatically launch the remote GPU studio & tunnel.
- `/remote stop`: Stop the SSH tunnel & remote GPU studio.
- `/remote restart`: Stop and restart the remote GPU studio & tunnel.

---

## 7. Implementing Additional Remote Providers (Contributor Guide)

Forge's remote backend is provider-independent. To add a new cloud GPU provider (e.g. RunPod, Modal, Lambda Labs):

1. **Inherit `RemoteProvider`** in `forge/remote/base.py`:
   ```python
   from forge.remote.base import RemoteProvider, RemoteStatus

   class CustomCloudProvider(RemoteProvider):
       def start(self) -> bool: ...
       def stop(self) -> bool: ...
       def is_running(self) -> bool: ...
       def wait_until_ready(self, timeout, retry_interval, progress_callback) -> bool: ...
       def connect(self) -> bool: ...
       def disconnect(self) -> None: ...
       def get_status(self) -> RemoteStatus: ...
   ```
2. **Register the Provider** in `forge/remote/manager.py`:
   ```python
   if prov_name == "customcloud":
       return CustomCloudProvider(self.config)
   ```
3. Add unit tests under `tests/test_remote_gpu.py`.
