from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, WebSocket

from app.devices.base import BaseDevice
from app.devices.doser import handlers
from app.devices.doser.router import create_router
from app.devices.doser.state import DoserState
from app import mqtt

logger = logging.getLogger(__name__)

# MQTT topic prefix for this device
_TOPIC_PREFIX = "reef/doser"

# Inbound topics the doser subscribes to
_SUBSCRIPTIONS = [
    f"{_TOPIC_PREFIX}/status/pump/+",
    f"{_TOPIC_PREFIX}/status/schedule_ack",
    f"{_TOPIC_PREFIX}/alert",
    f"{_TOPIC_PREFIX}/log",
    f"{_TOPIC_PREFIX}/heartbeat",
    f"{_TOPIC_PREFIX}/error",
]

# How long to wait for a schedule ACK before broadcasting failure
_ACK_TIMEOUT_S = 10


class DoserDevice(BaseDevice):
    """
    Reef doser device: RP2040 Pico + ESP32-C3 4-head peristaltic pump controller.

    Owns
    ----
    - ``state``  — DoserState instance (schedule + pump status cache)
    - Routing of inbound MQTT messages to the correct handler function
    - The FastAPI router for all ``/doser/*`` HTTP endpoints
    - Initial WebSocket state replay for newly connected clients
    - MQTT on_connected hook to request current hardware state

    The state attribute is intentionally public so that other devices
    (e.g. an alkalinity checker) can read pump config and call
    update_pump_config() via registry.get_device("doser", DoserDevice).
    """

    def __init__(self) -> None:
        self.state = DoserState()
        self._router: APIRouter | None = None
        self._sync_task: asyncio.Task | None = None
        self._ack_timeout_task: asyncio.Task | None = None

    # ── Identity ──────────────────────────────────────────────────────────────

    @property
    def device_id(self) -> str:
        return "doser"

    # ── Initialisation ────────────────────────────────────────────────────────

    def initialise(self) -> None:
        """
        Load persisted schedule from disk.

        Called explicitly by main.py before the event loop starts so
        that the schedule is available immediately on first request.
        Separated from __init__ to keep construction side-effect-free
        and to make the startup sequence in main.py explicit.
        """
        self.state.load_schedule()
        logger.info("[doser] Initialised — schedule loaded")

    # ── MQTT ──────────────────────────────────────────────────────────────────

    def get_subscriptions(self) -> list[str]:
        return list(_SUBSCRIPTIONS)

    async def handle_message(self, topic: str, payload: dict) -> None:
        """Route an inbound MQTT message to the appropriate handler."""
        broadcast = self._broadcast

        if topic.startswith(f"{_TOPIC_PREFIX}/status/pump/"):
            await handlers.handle_pump_status(topic, payload, self.state, broadcast)

        elif topic == f"{_TOPIC_PREFIX}/status/schedule_ack":
            # Cancel the timeout task — ACK arrived in time
            if self._ack_timeout_task and not self._ack_timeout_task.done():
                self._ack_timeout_task.cancel()
                self._ack_timeout_task = None
            await handlers.handle_schedule_ack(broadcast)

        elif topic == f"{_TOPIC_PREFIX}/alert":
            await handlers.handle_alert(payload, self.state, broadcast)

        elif topic == f"{_TOPIC_PREFIX}/log":
            await handlers.handle_log(payload, self.state, broadcast)

        elif topic == f"{_TOPIC_PREFIX}/heartbeat":
            await handlers.handle_heartbeat(payload, self.state, broadcast)

        elif topic == f"{_TOPIC_PREFIX}/error":
            await handlers.handle_error(payload, broadcast)

        else:
            logger.debug("[doser] Unhandled topic: %s", topic)

    async def on_connected(self) -> None:
        """
        Request current status and logs from the Pico on every MQTT
        (re)connect so the server cache stays consistent even after
        broker restarts or network blips.

        Also publishes the full binary schedule so the Pico always has
        the latest config after a reconnect, and starts (or restarts)
        the daily log sync background task.
        """
        await mqtt.publish(f"{_TOPIC_PREFIX}/command/request_status", {})
        await mqtt.publish(f"{_TOPIC_PREFIX}/command/request_logs", {})
        logger.info("[doser] Requested initial status and logs from Pico")

        # Push current schedule to Pico
        try:
            blob = self.state.serialize_schedule()
            await mqtt.publish_binary(f"{_TOPIC_PREFIX}/command/schedule", blob)
            logger.info("[doser] Schedule published on connect (%d bytes)", len(blob))
            self._start_ack_timeout()
        except Exception as e:
            logger.error("[doser] Failed to publish schedule on connect: %s", e)

        if self._sync_task and not self._sync_task.done():
            self._sync_task.cancel()
        self._sync_task = asyncio.create_task(self._daily_log_sync())

    async def _daily_log_sync(self) -> None:
        """Request a full log buffer replay from the Pico once every 24 hours."""
        while True:
            await asyncio.sleep(24 * 60 * 60)
            await mqtt.publish(f"{_TOPIC_PREFIX}/command/request_logs", {})
            logger.info("[doser] Daily log sync requested")

    # ── Schedule ACK timeout ──────────────────────────────────────────────────

    def _start_ack_timeout(self) -> None:
        """
        Start a 10-second timeout waiting for a schedule ACK from the Pico.
        If no ACK arrives, broadcast a failure event to WebSocket clients.
        Cancels any existing timeout before starting a new one.
        """
        if self._ack_timeout_task and not self._ack_timeout_task.done():
            self._ack_timeout_task.cancel()
        self._ack_timeout_task = asyncio.create_task(self._ack_timeout())

    async def _ack_timeout(self) -> None:
        """Broadcast schedule ACK failure if no ACK received within timeout."""
        await asyncio.sleep(_ACK_TIMEOUT_S)
        logger.warning("[doser] Schedule ACK timeout — Pico did not confirm")
        await self.broadcast(handlers.EVT_SCHEDULE_ACK, {"status": "timeout"})

    # ── HTTP ──────────────────────────────────────────────────────────────────

    def get_router(self) -> APIRouter:
        if self._router is None:
            self._router = create_router(self.state)
        return self._router

    # ── Health ────────────────────────────────────────────────────────────────

    def health_snapshot(self) -> dict:
        """Expose doser connection state in GET /system/health."""
        return self.state.connection_snapshot()

    # ── WebSocket initial state ───────────────────────────────────────────────

    async def send_initial_state(self, websocket: WebSocket) -> None:
        """
        Replay current device state to a newly connected WebSocket client.

        Sends three messages in order:
        1. Per-pump status (one message per pump)
        2. Connection state (pico_connected, last_heartbeat_ms)
        3. Full schedule

        Called by the initial_state_fn registered in main.py.
        """
        import json

        # Per-pump status
        for pump_index, status in self.state.get_pump_status().items():
            await websocket.send_text(json.dumps({
                "device":     self.device_id,
                "type":       handlers.EVT_STATUS,
                "pump_index": int(pump_index),
                "payload":    status,
            }))

        # Connection state
        await websocket.send_text(json.dumps({
            "device":  self.device_id,
            "type":    handlers.EVT_CONNECTION,
            "payload": self.state.connection_snapshot(),
        }))

        # Schedule
        await websocket.send_text(json.dumps({
            "device":  self.device_id,
            "type":    handlers.EVT_SCHEDULE,
            "payload": self.state.get_schedule(),
        }))
