from __future__ import annotations

import time
import asyncio
import logging
from typing import Awaitable, Callable

from app.devices.doser import db
from app.devices.doser.state import DoserState
from app.telegram import send_alert

logger = logging.getLogger(__name__)

# Type alias matching BaseDevice.BroadcastFn
BroadcastFn = Callable[[dict], Awaitable[None]]

# ── Alert metadata ────────────────────────────────────────────────────────────

_ALERT_NAMES: dict[int, str] = {
    1: "Occlusion",
    2: "Empty",
    3: "Pump Fault",
    4: "Sensor Fault",
    5: "Container Low",
    6: "Handshake Fail",
    7: "Version Mismatch",
    8: "Connection Lost",
}

# Alert types that warrant a Telegram push notification
_FAULT_ALERT_TYPES: frozenset[int] = frozenset({1, 2, 3, 4, 5})

# ── Event type strings ────────────────────────────────────────────────────────
# Defined here so handlers and device.py share one source of truth.
# The frontend depends on these strings for routing — change with care.

EVT_STATUS       = "status"
EVT_ALERT        = "alert"
EVT_LOG          = "log"
EVT_HEARTBEAT    = "heartbeat"
EVT_ERROR        = "error"
EVT_CONNECTION   = "connection"
EVT_SCHEDULE     = "schedule"
EVT_SCHEDULE_ACK = "schedule_ack"

# ── Handlers ──────────────────────────────────────────────────────────────────

async def handle_pump_status(
    topic: str,
    payload: dict,
    state: DoserState,
    broadcast: BroadcastFn,
) -> None:
    """Process ``reef/doser/status/pump/{index}`` messages."""
    try:
        pump_index = int(topic.split("/")[-1])
    except (ValueError, IndexError):
        logger.warning("[doser/handlers] Malformed pump status topic: %s", topic)
        return

    current_mA = float(payload.get("current_mA", 0.0))
    voltage_V  = float(payload.get("voltage_V",  0.0))
    status     = int(payload.get("status", 0))

    state.update_pump_status(pump_index, current_mA, voltage_V, status)

    await asyncio.to_thread(
        db.write_pump_status,
        pump_index=pump_index,
        current_mA=current_mA,
        voltage_V=voltage_V,
        status=status,
    )

    await broadcast({
        "device":     "doser",
        "type":       EVT_STATUS,
        "pump_index": pump_index,
        "payload":    payload,
    })


async def handle_alert(
    payload: dict,
    state: DoserState,
    broadcast: BroadcastFn,
) -> None:
    """Process ``reef/doser/alert`` messages."""

    raw_timestamp = int(payload.get("timestamp", 0))
    valid_timestamp = (raw_timestamp * 1000) if raw_timestamp > 1577836800 else None

    alert_type  = int(payload.get("type", 0))
    pump_index  = int(payload.get("pump", 0))
    current_mA  = float(payload.get("current_mA", 0.0))
    expected_mA = float(payload.get("expected_mA", 0.0))
    voltage_V   = float(payload.get("voltage_V", 0.0))

    await asyncio.to_thread(
        db.write_alert,
        alert_type=alert_type,
        pump_index=pump_index,
        current_mA=current_mA,
        expected_mA=expected_mA,
        voltage_V=voltage_V,
        timestamp_ms=valid_timestamp,
    )

    await broadcast({
        "device":  "doser",
        "type":    EVT_ALERT,
        "payload": payload,
    })

    if alert_type in _FAULT_ALERT_TYPES:
        alert_name = _ALERT_NAMES.get(alert_type, "Unknown")
        message = (
            f"🚨 <b>Reef Doser Alert</b>\n"
            f"Type: {alert_name}\n"
            f"Pump: {pump_index}\n"
            f"Current: {current_mA:.1f} mA (expected {expected_mA:.1f} mA)\n"
            f"Voltage: {voltage_V:.2f} V"
        )
        await send_alert(message)


async def handle_log(
    payload: dict,
    state: DoserState,
    broadcast: BroadcastFn,
) -> None:
    """Process ``reef/doser/log`` messages."""

    raw_timestamp = int(payload.get("timestamp", 0))

    # If the timestamp is a valid Unix epoch in seconds (> year 2020)
    if raw_timestamp > 1577836800:
        server_tz_offset = time.altzone if time.localtime().tm_isdst else time.timezone
        valid_timestamp = (raw_timestamp + server_tz_offset) * 1000
    else:
        valid_timestamp = None

    await asyncio.to_thread(
        db.write_pump_log,
        pump_index=int(payload.get("pump", 0)),
        volume_ml=float(payload.get("volume_ml", 0.0)),
        duration_ms=float(payload.get("duration_ms", 0.0)),
        avg_current_mA=float(payload.get("avg_mA", 0.0)),
        status=int(payload.get("status", 0)),
        timestamp_ms=valid_timestamp,
        was_manual=bool(payload.get("manual", 0)),
    )

    await broadcast({
        "device":  "doser",
        "type":    EVT_LOG,
        "payload": payload,
    })


async def handle_heartbeat(
    payload: dict,
    state: DoserState,
    broadcast: BroadcastFn,
) -> None:
    """
    Process ``reef/doser/heartbeat`` messages.

    Now includes wall_clock_seconds alongside uptime_ms so the server
    can verify NTP sync is working correctly.
    """
    uptime_ms          = int(payload.get("uptime_ms", 0))
    wall_clock_seconds = int(payload.get("wall_clock_seconds", 0))

    state.update_heartbeat(uptime_ms, wall_clock_seconds)

    await broadcast({
        "device":  "doser",
        "type":    EVT_HEARTBEAT,
        "payload": payload,
    })


async def handle_schedule_ack(
    broadcast: BroadcastFn,
) -> None:
    """
    Process ``reef/doser/status/schedule_ack`` messages.

    The Pico sends this after successfully applying and saving a schedule
    or calibration update. Broadcasts to WebSocket clients so the frontend
    can show confirmed status.
    """
    logger.info("[doser/handlers] Schedule ACK received from Pico")

    await broadcast({
        "device":  "doser",
        "type":    EVT_SCHEDULE_ACK,
        "payload": {"status": "ok"},
    })


async def handle_error(
    payload: dict,
    broadcast: BroadcastFn,
) -> None:
    """Process ``reef/doser/error`` messages (ESP32 command errors)."""
    logger.error("[doser/handlers] Command error from ESP32: %s", payload)

    await broadcast({
        "device":  "doser",
        "type":    EVT_ERROR,
        "payload": payload,
    })
