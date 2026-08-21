from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass


@dataclass
class RemoteConfig:
    """Configuration settings for remote GPU backend providers and SSH tunneling."""
    provider: str = "lightning"
    studio: str = "forge-qwen"
    gpu: str = "NVIDIA L40S 48 GB"
    teamspace: str | None = None
    user: str | None = None
    api_key: str | None = None
    remote_port: int = 8000
    remote_host: str = "localhost"
    ssh_host: str = "ssh.lightning.ai"
    ssh_user: str | None = None
    ssh_port: int = 22
    ssh_key_path: str | None = None
    auto_start: bool = True
    auto_stop: bool = True
    startup_timeout: float = 300.0
    retry_interval: float = 3.0

    def get_masked_api_key(self) -> str:
        """Returns a masked version of the API key for safe logging/display."""
        if not self.api_key:
            return "None"
        if len(self.api_key) <= 8:
            return "****"
        return f"{self.api_key[:4]}...{self.api_key[-4:]}"


def load_remote_config(data: dict[str, Any] | None = None) -> RemoteConfig:
    """Loads remote backend configuration from environment variables and yaml settings."""
    cfg = RemoteConfig()

    # Environment variable overrides
    provider_env = os.getenv("FORGE_REMOTE_PROVIDER")
    if provider_env:
        cfg.provider = provider_env.lower()

    studio_env = os.getenv("FORGE_LIGHTNING_STUDIO")
    if studio_env:
        cfg.studio = studio_env

    gpu_env = os.getenv("FORGE_LIGHTNING_GPU")
    if gpu_env:
        cfg.gpu = gpu_env

    teamspace_env = os.getenv("FORGE_LIGHTNING_TEAMSPACE")
    if teamspace_env:
        cfg.teamspace = teamspace_env

    user_env = os.getenv("FORGE_LIGHTNING_USER")
    if user_env:
        cfg.user = user_env

    api_key_env = os.getenv("FORGE_LIGHTNING_API_KEY") or os.getenv("LIGHTNING_API_KEY")
    if api_key_env:
        cfg.api_key = api_key_env

    port_env = os.getenv("FORGE_REMOTE_PORT")
    if port_env:
        try:
            cfg.remote_port = int(port_env)
        except ValueError:
            pass

    ssh_host_env = os.getenv("FORGE_SSH_HOST")
    if ssh_host_env:
        cfg.ssh_host = ssh_host_env

    ssh_user_env = os.getenv("FORGE_SSH_USER")
    if ssh_user_env:
        cfg.ssh_user = ssh_user_env

    ssh_port_env = os.getenv("FORGE_SSH_PORT")
    if ssh_port_env:
        try:
            cfg.ssh_port = int(ssh_port_env)
        except ValueError:
            pass

    ssh_key_env = os.getenv("FORGE_SSH_KEY_PATH")
    if ssh_key_env:
        cfg.ssh_key_path = ssh_key_env

    auto_start_env = os.getenv("FORGE_REMOTE_AUTO_START")
    if auto_start_env:
        cfg.auto_start = auto_start_env.lower() in ("true", "1", "yes")

    auto_stop_env = os.getenv("FORGE_REMOTE_AUTO_STOP")
    if auto_stop_env:
        cfg.auto_stop = auto_stop_env.lower() in ("true", "1", "yes")

    timeout_env = os.getenv("FORGE_REMOTE_STARTUP_TIMEOUT")
    if timeout_env:
        try:
            cfg.startup_timeout = float(timeout_env)
        except ValueError:
            pass

    retry_env = os.getenv("FORGE_REMOTE_RETRY_INTERVAL")
    if retry_env:
        try:
            cfg.retry_interval = float(retry_env)
        except ValueError:
            pass

    # Merge with dict data if provided
    if data and isinstance(data, dict):
        remote_data = data.get("remote", data)
        if isinstance(remote_data, dict):
            if "provider" in remote_data:
                cfg.provider = str(remote_data["provider"]).lower()
            if "studio" in remote_data:
                cfg.studio = str(remote_data["studio"])
            if "gpu" in remote_data:
                cfg.gpu = str(remote_data["gpu"])
            if "teamspace" in remote_data:
                cfg.teamspace = str(remote_data["teamspace"])
            if "user" in remote_data:
                cfg.user = str(remote_data["user"])
            if "api_key" in remote_data:
                cfg.api_key = str(remote_data["api_key"])
            if "remote_port" in remote_data:
                cfg.remote_port = int(remote_data["remote_port"])
            if "ssh_host" in remote_data:
                cfg.ssh_host = str(remote_data["ssh_host"])
            if "ssh_user" in remote_data:
                cfg.ssh_user = str(remote_data["ssh_user"])
            if "ssh_port" in remote_data:
                cfg.ssh_port = int(remote_data["ssh_port"])
            if "ssh_key_path" in remote_data:
                cfg.ssh_key_path = str(remote_data["ssh_key_path"])
            if "auto_start" in remote_data:
                cfg.auto_start = bool(remote_data["auto_start"])
            if "auto_stop" in remote_data:
                cfg.auto_stop = bool(remote_data["auto_stop"])
            if "startup_timeout" in remote_data:
                cfg.startup_timeout = float(remote_data["startup_timeout"])
            if "retry_interval" in remote_data:
                cfg.retry_interval = float(remote_data["retry_interval"])

    return cfg
