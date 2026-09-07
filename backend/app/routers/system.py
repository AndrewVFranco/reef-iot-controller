from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.websocket import ws_manager
from app import mqtt
from app.database.client import get_client
from app.registry import registry

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/system", tags=["system"])


# ── Helpers ───────────────────────────────────────────────────────────────────

def _check_influxdb() -> bool:
    try:
        get_client().ping()
        return True
    except Exception:
        return False


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    """
    Single WebSocket endpoint for all connected devices.

    On connect, the current state of every registered device is replayed
    to the client via the initial_state_fn registered in main.py.
    Thereafter, live events are pushed as they arrive from MQTT.

    Inbound client messages: only {"type": "ping"} is handled;
    everything else is silently ignored.  Clients should send a ping
    every ~30s to prevent proxy timeouts.
    """
    await ws_manager.connect(websocket)
    try:
        await ws_manager.handle(websocket)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.error("[system/ws] Unexpected error: %s", e)
    finally:
        ws_manager.disconnect(websocket)


@router.get("/health")
async def health() -> dict:
    """
    System health summary.

    Reports uptime, connected WebSocket clients, MQTT broker connection,
    InfluxDB reachability, and a per-device connection snapshot.

    Device snapshots are provided by each device's health_snapshot()
    method if it exists, otherwise omitted.  This keeps the health
    endpoint extensible without hardcoding any device names here.
    """
    import asyncio

    influx_ok = await asyncio.to_thread(_check_influxdb)

    device_health: dict[str, dict] = {}
    for device in registry.all():
        if hasattr(device, "health_snapshot"):
            device_health[device.device_id] = device.health_snapshot()

    return {
        "status":             "ok",
        "uptime_seconds":     round(ws_manager.uptime_seconds, 1),
        "server_time_utc":    datetime.now(timezone.utc).isoformat(),
        "websocket_clients":  ws_manager.connection_count,
        "mqtt_connected":     mqtt._client is not None,
        "influxdb_connected": influx_ok,
        "devices":            device_health,
    }
