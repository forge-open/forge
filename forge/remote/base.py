from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Callable


@dataclass
class RemoteStatus:
    """Status metadata for remote GPU provider."""
    provider: str
    studio_name: str
    gpu_type: str
    status: str  # "connected", "running", "stopped", "starting", "error", "unknown"
    model_name: str = ""
    session_duration: float = 0.0  # seconds
    started_by_forge: bool = False
    details: str = ""
    extra: dict[str, Any] = field(default_factory=dict)

    def is_active(self) -> bool:
        """Returns True if the backend is connected or running."""
        return self.status in ("connected", "running")


class RemoteProvider(ABC):
    """Abstract Base Class for remote GPU cloud providers (Lightning AI, RunPod, Modal, etc.)."""

    @abstractmethod
    def start(self) -> bool:
        """Starts the remote GPU instance/studio programmatically."""
        pass

    @abstractmethod
    def stop(self) -> bool:
        """Stops the remote GPU instance/studio programmatically."""
        pass

    @abstractmethod
    def is_running(self) -> bool:
        """Checks if the remote GPU studio/instance is currently in a running state."""
        pass

    @abstractmethod
    def wait_until_ready(
        self,
        timeout: float = 300.0,
        retry_interval: float = 3.0,
        progress_callback: Callable[[str, str], None] | None = None,
    ) -> bool:
        """Polls infrastructure and inference server until fully ready."""
        pass

    @abstractmethod
    def connect(self) -> bool:
        """Establishes connection / SSH tunnel to the remote GPU instance."""
        pass

    @abstractmethod
    def disconnect(self) -> None:
        """Closes SSH tunnel and cleans up network connections."""
        pass

    @abstractmethod
    def get_status(self) -> RemoteStatus:
        """Returns current provider status object."""
        pass
