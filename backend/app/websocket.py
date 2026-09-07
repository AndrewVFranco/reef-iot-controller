from __future__ import annotations

import json
import logging
import time

from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)


class WebSocketManager:
    """
    Device-agnostic WebSocket broadcast hub.

    Maintains the set of active client connections and provides a single
    ``broadcast()`` coroutine that devices call to push events to the UI.

    All outbound messages use the standard envelope defined in BaseDevice:
    ``{"device": str, "type": str, "payload": dict}``

    The manager does not know about specific devices — it only serialises
    and fans out whatever dict it receives.  Topic routing and payload
    shaping are entirely the responsibility of the originating device.

    Connection lifecycle
    --------------------
    ``connect()``      — called from the WebSocket endpoint on accept.
    ``disconnect()``   — called from the endpoint on close or error.
    ``broadcast()``    — called by devices to push an event to all clients.
    ``handle()``       — called from the endpoint to handle inbound client
                         messages (currently only ping/pong keepalive).
    """

    def __init__(self) -> None:
        self._connections: set[WebSocket] = set()
        self._start_time: float = time.time()

        # Injected by main.py after devices are registered.
        # Called once per new connection to replay current state.
        self._initial_state_fn: _InitialStateFn | None = None

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections.add(websocket)
        logger.info(
            "[ws] Client connected — total: %d", len(self._connections)
        )
        if self._initial_state_fn is not None:
            await self._initial_state_fn(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        self._connections.discard(websocket)
        logger.info(
            "[ws] Client disconnected — total: %d", len(self._connections)
        )

    # ── Inbound ───────────────────────────────────────────────────────────────

    async def handle(self, websocket: WebSocket) -> None:
        """
        Drive the receive loop for a single connection.

        Raises WebSocketDisconnect (or another exception) when the
        connection closes; callers should catch and call disconnect().
        """
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
                if msg.get("type") == "ping":
                    await websocket.send_text(
                        json.dumps({"device": "system", "type": "pong"})
                    )
            except json.JSONDecodeError:
                pass  # ignore malformed client messages

    # ── Outbound ──────────────────────────────────────────────────────────────

    async def broadcast(self, message: dict) -> None:
        """
        Send a message to all connected clients.

        Dead connections are silently pruned.  The message is serialised
        once and the same string is sent to every client.
        """
        if not self._connections:
            return

        payload = json.dumps(message)
        dead: set[WebSocket] = set()

        for ws in self._connections:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.add(ws)

        for ws in dead:
            self._connections.discard(ws)
            logger.warning("[ws] Pruned dead connection")

    # ── Initial state injection ───────────────────────────────────────────────

    def set_initial_state_fn(self, fn: _InitialStateFn) -> None:
        """
        Register a coroutine that sends the current system state to a
        newly connected client.

        Called once in main.py after all devices are registered.  The
        function receives the raw WebSocket so it can send multiple
        targeted messages before the client starts receiving live events.

        Example implementation in main.py::

            async def send_initial_state(ws: WebSocket) -> None:
                for device in registry.all():
                    await device.send_initial_state(ws)

            ws_manager.set_initial_state_fn(send_initial_state)
        """
        self._initial_state_fn = fn

    # ── Metrics ───────────────────────────────────────────────────────────────

    @property
    def connection_count(self) -> int:
        return len(self._connections)

    @property
    def uptime_seconds(self) -> float:
        return time.time() - self._start_time


# Type alias for the initial-state callback to keep signatures readable.
from typing import Awaitable, Callable
_InitialStateFn = Callable[[WebSocket], Awaitable[None]]


# Singleton — imported by main.py, system.py router, and main lifespan.
ws_manager = WebSocketManager()
