from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Iterator, TypeVar

if TYPE_CHECKING:
    from app.devices.base import BaseDevice

logger = logging.getLogger(__name__)

D = TypeVar("D", bound="BaseDevice")


class DeviceRegistry:
    """
    Central store for all registered reef controller devices.

    Devices are keyed by their device_id (e.g. ``"doser"``).
    The registry is populated once during application startup in main.py
    and is read-only thereafter.

    Inter-device access
    -------------------
    Devices that need to communicate with another device should call
    ``get_device(device_id, DeviceClass)`` rather than importing the
    target device's module directly.  This avoids circular imports and
    makes the dependency explicit and optional (returns None if the
    target device is not registered).

    Example::

        doser = self.get_device("doser", DoserDevice)
        if doser is not None:
            doser.state.update_pump_config(pump_index, changes)
    """

    def __init__(self) -> None:
        self._devices: dict[str, "BaseDevice"] = {}

    # ── Registration ─────────────────────────────────────────────────────────

    def register(self, device: "BaseDevice") -> None:
        """
        Register a device.

        Raises ValueError if a device with the same device_id is already
        registered — duplicate registration is always a programming error.
        """
        if device.device_id in self._devices:
            raise ValueError(
                f"Device '{device.device_id}' is already registered. "
                "Each device_id must be unique."
            )
        self._devices[device.device_id] = device
        logger.info("[registry] Registered device: %s", device.device_id)

    # ── Lookup ────────────────────────────────────────────────────────────────

    def get_device(self, device_id: str, device_type: type[D] | None = None) -> D | None:
        """
        Retrieve a registered device by its device_id.

        Parameters
        ----------
        device_id:
            The device's stable identifier, e.g. ``"doser"``.
        device_type:
            Optional subclass of BaseDevice.  When provided, the return
            value is type-checked and None is returned (with a warning)
            if the registered device is not an instance of that type.
            This lets callers get a properly-typed reference without an
            explicit cast::

                doser = registry.get_device("doser", DoserDevice)
                # doser is DoserDevice | None

        Returns
        -------
        The device instance, or None if not found / wrong type.
        """
        device = self._devices.get(device_id)
        if device is None:
            return None
        if device_type is not None and not isinstance(device, device_type):
            logger.warning(
                "[registry] get_device('%s') expected %s but found %s",
                device_id,
                device_type.__name__,
                type(device).__name__,
            )
            return None
        return device  # type: ignore[return-value]

    # ── Bulk access ───────────────────────────────────────────────────────────

    def all(self) -> list["BaseDevice"]:
        """Return all registered devices in registration order."""
        return list(self._devices.values())

    def get_subscriptions(self) -> list[str]:
        """
        Return the union of every registered device's MQTT subscriptions.

        Called once by the generic MQTT loop to subscribe to all topics
        in a single pass.
        """
        topics: list[str] = []
        for device in self._devices.values():
            topics.extend(device.get_subscriptions())
        return topics

    def __iter__(self) -> Iterator["BaseDevice"]:
        return iter(self._devices.values())

    def __len__(self) -> int:
        return len(self._devices)

    def __contains__(self, device_id: str) -> bool:
        return device_id in self._devices


# Singleton instance imported across the app.
# Populated in main.py during startup; read-only everywhere else.
registry = DeviceRegistry()
