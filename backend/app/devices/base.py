from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, Awaitable, Callable

from fastapi import APIRouter

if TYPE_CHECKING:
    from app.registry import DeviceRegistry

logger = logging.getLogger(__name__)

# Type alias for the WebSocket broadcast callable injected by main.py.
# Signature: async (message: dict) -> None
BroadcastFn = Callable[[dict], Awaitable[None]]


class BaseDevice(ABC):
    """
    Abstract base class for every reef controller device.

    Lifecycle
    ---------
    1. Instantiated in main.py.
    2. Registered with DeviceRegistry via registry.register(device).
    3. set_broadcast() called to inject the WebSocket broadcast function.
    4. set_registry() called to inject the registry (for inter-device calls).
    5. on_connected() called each time the MQTT client establishes a session.
    6. handle_message() called by the generic MQTT loop for every incoming
       message whose topic prefix matches this device's device_id.
    7. get_router() called once in main.py to mount the device's HTTP routes.

    Subclasses
    ----------
    Must implement: device_id, get_subscriptions(), handle_message(),
                    get_router().
    May override:   on_connected() — default is a no-op.
    Must NOT:       import from other device packages at module level
                    (use registry.get_device() at call time to avoid
                    circular imports and hard coupling).
    """

    # ── Identity ─────────────────────────────────────────────────────────────

    @property
    @abstractmethod
    def device_id(self) -> str:
        """
        Stable identifier for this device, e.g. ``"doser"``.

        Used as the second path segment in MQTT topics:
        ``reef/{device_id}/...``
        and as the key in DeviceRegistry.
        """

    # ── MQTT ─────────────────────────────────────────────────────────────────

    @abstractmethod
    def get_subscriptions(self) -> list[str]:
        """
        Return the list of MQTT topic patterns this device subscribes to.

        Wildcards are allowed (``+`` single-level, ``#`` multi-level).
        Example: ``["reef/doser/#"]``
        """

    @abstractmethod
    async def handle_message(self, topic: str, payload: dict) -> None:
        """
        Process a single inbound MQTT message.

        Called by the generic MQTT loop for every message whose topic
        matches one of the patterns returned by get_subscriptions().

        Parameters
        ----------
        topic:
            Full topic string, e.g. ``"reef/doser/status/pump/0"``.
        payload:
            Already-decoded JSON dict.  The generic loop discards
            messages that are not valid JSON before this is called.
        """

    # ── HTTP ─────────────────────────────────────────────────────────────────

    @abstractmethod
    def get_router(self) -> APIRouter:
        """Return the FastAPI router that exposes this device's HTTP API."""

    # ── Lifecycle hooks ───────────────────────────────────────────────────────

    async def on_connected(self) -> None:
        """
        Called each time the MQTT client successfully connects to the broker.

        Override to publish initial requests (e.g. request_status) or
        perform any setup that requires an active MQTT session.
        Default implementation is a no-op.
        """

    def health_snapshot(self) -> dict:
        """
        Return a serialisable dict summarising this device's health for
        the ``GET /system/health`` endpoint.

        Override to expose device-specific connection state, fault flags,
        or any other runtime metrics useful for monitoring.
        Default returns an empty dict (device is omitted from health output
        if not overridden, via the hasattr() check in system.py).
        """
        return {}

    # ── Dependency injection ──────────────────────────────────────────────────

    def set_broadcast(self, fn: BroadcastFn) -> None:
        """Inject the WebSocket broadcast callable. Called once by main.py."""
        self._broadcast = fn

    def set_registry(self, registry: DeviceRegistry) -> None:
        """
        Inject the DeviceRegistry. Called once by main.py after all
        devices are registered.

        Use registry.get_device(device_id) inside handler methods — never
        at import time — to avoid circular imports.
        """
        self._registry = registry

    # ── Helpers available to subclasses ──────────────────────────────────────

    async def broadcast(self, event_type: str, payload: dict) -> None:
        """
        Emit a typed WebSocket event.

        Enforces the standard envelope shape:
        ``{"device": device_id, "type": event_type, "payload": {...}}``

        Parameters
        ----------
        event_type:
            Short string identifying the event kind, e.g. ``"status"``,
            ``"alert"``, ``"heartbeat"``.  Devices should use a string
            enum so the frontend has a stable contract.
        payload:
            Arbitrary dict; device-specific content of the event.
        """
        if not hasattr(self, "_broadcast") or self._broadcast is None:
            logger.warning(
                "[%s] broadcast called before set_broadcast(); dropping event",
                self.device_id,
            )
            return
        await self._broadcast(
            {
                "device":  self.device_id,
                "type":    event_type,
                "payload": payload,
            }
        )

    def get_device(self, device_id: str) -> "BaseDevice | None":
        """
        Retrieve another registered device by its device_id.

        Returns None if the registry has not been injected yet or if no
        device with the given id is registered.  Callers should guard
        against None rather than assuming the device exists.
        """
        if not hasattr(self, "_registry") or self._registry is None:
            logger.warning(
                "[%s] get_device() called before set_registry()", self.device_id
            )
            return None
        return self._registry.get_device(device_id)
