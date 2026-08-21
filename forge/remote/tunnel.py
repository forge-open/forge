from __future__ import annotations

import os
import socket
import subprocess
import time
from typing import Any

from forge.utils.logging import logger


class SSHTunnelManager:
    """Manages SSH port-forwarding tunnel process and automatic reconnection."""

    def __init__(
        self,
        ssh_host: str = "ssh.lightning.ai",
        ssh_user: str | None = None,
        remote_port: int = 8000,
        local_port: int = 8000,
        ssh_port: int = 22,
        ssh_key_path: str | None = None,
    ):
        self.ssh_host = ssh_host
        self.ssh_user = ssh_user or ""
        self.remote_port = remote_port
        self.local_port = local_port
        self.ssh_port = ssh_port
        self.ssh_key_path = ssh_key_path
        self._process: subprocess.Popen[Any] | None = None
        self._is_mock: bool = False
        self._mock_connected: bool = False

    def get_ssh_target(self) -> str:
        """Returns target SSH user@host string."""
        if self.ssh_user:
            return f"{self.ssh_user}@{self.ssh_host}"
        return self.ssh_host

    def is_port_open(self, host: str = "127.0.0.1", timeout: float = 1.0) -> bool:
        """Checks if local port is open and accepting TCP connections."""
        try:
            with socket.create_connection((host, self.local_port), timeout=timeout):
                return True
        except (OSError, ConnectionRefusedError):
            return False

    def start(self, timeout: float = 10.0) -> bool:
        """Starts SSH tunnel process in background."""
        if self._is_mock:
            self._mock_connected = True
            return True

        if self.is_alive():
            logger.info(f"SSH Tunnel already active on port {self.local_port}.")
            return True

        target = self.get_ssh_target()
        cmd = [
            "ssh",
            "-N",
            "-L",
            f"{self.local_port}:localhost:{self.remote_port}",
            "-p",
            str(self.ssh_port),
            "-o",
            "ExitOnForwardFailure=yes",
            "-o",
            "StrictHostKeyChecking=accept-new",
            "-o",
            "ServerAliveInterval=15",
            "-o",
            "ServerAliveCountMax=3",
        ]

        if self.ssh_key_path and os.path.exists(self.ssh_key_path):
            cmd.extend(["-i", self.ssh_key_path])

        cmd.append(target)

        logger.info(f"Starting SSH tunnel on port {self.local_port} to {target}...")

        try:
            self._process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                stdin=subprocess.PIPE,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except (FileNotFoundError, OSError) as e:
            logger.warning(f"Failed to launch ssh binary: {e}. Operating in mock/direct mode.")
            self._is_mock = True
            self._mock_connected = True
            return True

        # Wait up to timeout seconds for tunnel port to open
        start_time = time.time()
        while time.time() - start_time < timeout:
            if self._process.poll() is not None:
                # Process exited unexpectedly
                _, stderr = self._process.communicate()
                err_msg = stderr.decode("utf-8", errors="replace").strip() if stderr else "Process terminated"
                logger.error(f"SSH tunnel process exited with code {self._process.returncode}: {err_msg}")
                self._process = None
                return False

            if self.is_port_open():
                logger.info("SSH tunnel successfully established.")
                return True
            time.sleep(0.3)

        # If port isn't open after timeout but process is running
        if self._process and self._process.poll() is None:
            return True

        return False

    def is_alive(self) -> bool:
        """Checks if SSH tunnel process is running and port is listening."""
        if self._is_mock:
            return self._mock_connected

        if self._process is not None:
            if self._process.poll() is not None:
                self._process = None
                return False
            return True

        return self.is_port_open()

    def ensure_alive(self, max_retries: int = 3) -> bool:
        """Verifies tunnel is alive; attempts automatic reconnection if disconnected."""
        if self.is_alive():
            return True

        logger.warning("SSH Tunnel disconnected. Attempting automatic reconnect...")
        for attempt in range(1, max_retries + 1):
            if self.start(timeout=5.0):
                logger.info(f"SSH Tunnel reconnected on attempt {attempt}.")
                return True
            time.sleep(1.0)

        return False

    def stop(self) -> None:
        """Gracefully closes SSH tunnel process."""
        if self._is_mock:
            self._mock_connected = False
            return

        if self._process is not None:
            logger.info("Closing SSH tunnel process...")
            try:
                self._process.terminate()
                try:
                    self._process.wait(timeout=2.0)
                except subprocess.TimeoutExpired:
                    self._process.kill()
            except Exception as e:
                logger.warning(f"Error terminating SSH process: {e}")
            finally:
                self._process = None
