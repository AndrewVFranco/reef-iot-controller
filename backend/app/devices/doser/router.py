from __future__ import annotations

import asyncio
import logging
import time

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator
from typing import Optional, List

from app.devices.doser import db
from app.devices.doser.state import DoserState
from app import mqtt

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

_PUMP_MIN = 0
_PUMP_MAX = 3

_VALID_MODES = frozenset({"INTERVAL", "SCHEDULED", "BOTH"})
_VALID_ROLES = frozenset({"AWC_OUT", "AWC_IN", "ATO", "DOSER", "DISABLED"})

_SCHEDULE_TOPIC = "reef/doser/command/schedule"

# ── Request models ────────────────────────────────────────────────────────────

class ManualDoseRequest(BaseModel):
    pump_index: int
    volume_ml: float

class ClearFaultRequest(BaseModel):
    pump_index: int

class EnableDisableRequest(BaseModel):
    pump_index: int
    enabled: bool

class CalibrateRequest(BaseModel):
    pump_index: int
    ml_delivered: float
    seconds_ran: float
    expected_current_mA: float
    tolerance_percent: float

    @field_validator("seconds_ran")
    @classmethod
    def seconds_must_be_positive(cls, v: float) -> float:
        if v <= 0:
            raise ValueError("seconds_ran must be greater than zero")
        return v

class ScheduleIntervalRequest(BaseModel):
    pump_index: int
    interval_minutes: int
    volume_ml: float

class ScheduleWindowRequest(BaseModel):
    pump_index: int
    start_minutes: int
    end_minutes: int
    restrict: bool

class ScheduleModeRequest(BaseModel):
    pump_index: int
    mode: str

class ScheduleRoleRequest(BaseModel):
    pump_index: int
    role: str

class ScheduledDoseItem(BaseModel):
    time_minutesSinceMidnight: int
    volume_ml: float
    enabled: bool

class ScheduleDosesRequest(BaseModel):
    pump_index: int
    doses: List[ScheduledDoseItem]

class BulkPumpUpdateRequest(BaseModel):
    pump_index: int
    role: str
    mode: str
    interval_minutes: int
    volume_ml: float
    start_minutes: int
    end_minutes: int
    restrict: bool
    enabled: bool
    doses: List[ScheduledDoseItem]


# ── Router factory ────────────────────────────────────────────────────────────

def create_router(state: DoserState) -> APIRouter:
    """
    Build and return the doser APIRouter with ``state`` and
    ``start_ack_timeout`` closed over.

    Schedule mutation pattern
    ─────────────────────────
    Every schedule-changing endpoint:
      1. Validates the request
      2. Updates the JSON state (persisted to disk)
      3. Serializes the full schedule to binary (1360 bytes)
      4. Publishes the binary blob to reef/doser/command/schedule
      5. Starts a 10-second ACK timeout — if the Pico does not confirm
         receipt, the frontend is notified via WebSocket

    The Pico only understands one schedule message: the complete
    SystemSchedule binary struct. Partial updates do not exist at the
    hardware level — the server always sends the full blob.

    Calibration fields (flow_rate_ml_per_sec, expected_current_mA,
    tolerance_percent) are stored in CalibrationBlock on the Pico and
    sent via MSG_CALIBRATE — they are not part of the schedule binary.
    """
    router = APIRouter(prefix="/doser", tags=["doser"])

    # ── Rate limiting ─────────────────────────────────────────────────────────

    _last_write: list[float] = [0.0]

    async def write_rate_limit() -> None:
        now = time.monotonic()
        if now - _last_write[0] < 1.0:
            raise HTTPException(status_code=429, detail="Too many requests, wait 1 second")
        _last_write[0] = now

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _validate_pump(pump_index: int) -> None:
        if not (_PUMP_MIN <= pump_index <= _PUMP_MAX):
            raise HTTPException(
                status_code=400,
                detail=f"pump_index must be between {_PUMP_MIN} and {_PUMP_MAX}",
            )

    async def _publish_schedule() -> None:
        """
        Serialize the current JSON schedule and publish the binary blob.
        Starts the ACK timeout after publishing.
        Errors are logged but not re-raised — the JSON state is already
        updated on disk; the Pico will receive it on next reconnect.
        """
        try:
            blob = await asyncio.to_thread(state.serialize_schedule)
            await mqtt.publish_binary(_SCHEDULE_TOPIC, blob)
            logger.info("[doser/router] Schedule published (%d bytes)", len(blob))
        except Exception as e:
            logger.error("[doser/router] Failed to publish schedule: %s", e)

    # ── Read endpoints ────────────────────────────────────────────────────────

    @router.get("/status")
    async def get_status():
        return {
            "pumps":             state.get_pump_status(),
            "pico_connected":    state.is_pico_connected(),
            "last_heartbeat_ms": state.get_last_heartbeat_ms(),
        }

    @router.get("/schedule")
    async def get_schedule():
        return state.get_schedule()

    @router.get("/schedule/debug/binary")
    async def debug_binary():
        """Returns the hex representation of the 1360-byte struct for verification."""
        try:
            blob = await asyncio.to_thread(state.serialize_schedule)
            return {
                "size_bytes": len(blob),
                "hex_dump":   blob.hex(),
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    @router.get("/schedule/{pump_index}")
    async def get_pump_schedule(pump_index: int):
        config = state.get_pump_config(pump_index)
        if config is None:
            raise HTTPException(status_code=404, detail=f"Pump {pump_index} not found")
        return config

    @router.get("/logs")
    async def get_logs(
        hours: int = 24,
        pump_index: Optional[int] = None,
        manual: Optional[bool] = None,
    ):
        logs = (
            await asyncio.to_thread(db.query_pump_logs, pump_index, hours)
            if pump_index is not None
            else await asyncio.to_thread(db.query_all_pump_logs, hours)
        )
        if manual is not None:
            logs = [l for l in logs if bool(l.get("was_manual")) == manual]
        return {"logs": logs, "count": len(logs)}

    @router.get("/logs/{pump_index}")
    async def get_pump_logs(pump_index: int, hours: int = 24):
        logs = await asyncio.to_thread(db.query_pump_logs, pump_index, hours)
        return {"pump_index": pump_index, "logs": logs, "count": len(logs)}

    @router.delete("/logs")
    async def clear_logs(
        pump_index: Optional[int] = Query(None),
        manual: Optional[bool] = Query(None)
    ):
        """Clear logs with optional filters for pump and dose type."""
        if pump_index is not None:
            _validate_pump(pump_index)
        try:
            await asyncio.to_thread(db.delete_pump_logs, pump_index, manual)
            return {"status": "ok", "detail": "Logs cleared successfully"}
        except Exception as e:
            logger.error("[doser/router] Failed to clear logs: %s", e)
            raise HTTPException(status_code=500, detail="Failed to clear database logs")

    @router.get("/alerts")
    async def get_alerts(limit: int = 50):
        alerts = await asyncio.to_thread(db.query_alerts, limit)
        return {"alerts": alerts, "count": len(alerts)}

    @router.get("/history/{pump_index}")
    async def get_history(pump_index: int, hours: int = 24):
        history = await asyncio.to_thread(db.query_pump_current_history, pump_index, hours)
        return {"pump_index": pump_index, "history": history}

    @router.get("/runtime/{pump_index}")
    async def get_runtime(pump_index: int, hours: int = 24):
        logs = await asyncio.to_thread(db.query_pump_runtime, pump_index, hours)
        total_volume_ml   = sum(l.get("volume_ml", 0) for l in logs)
        total_duration_ms = sum(l.get("duration_ms", 0) for l in logs)
        return {
            "pump_index":             pump_index,
            "hours":                  hours,
            "total_volume_ml":        round(total_volume_ml, 2),
            "total_duration_ms":      total_duration_ms,
            "total_duration_minutes": round(total_duration_ms / 60_000, 2),
            "run_count":              len(logs),
        }

    @router.post("/logs/sync")
    async def sync_logs():
        """Request a full log buffer replay from the Pico."""
        await mqtt.publish("reef/doser/command/request_logs", {})
        return {"status": "ok", "detail": "Log sync requested from Pico"}

    @router.get("/schedule/debug/binary")
    async def debug_binary():
        """Returns the hex representation of the 1360-byte schedule struct."""
        try:
            blob = await asyncio.to_thread(state.serialize_schedule)
            return {
                "size_bytes": len(blob),
                "hex_dump":   blob.hex(),
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    # ── Command endpoints (non-schedule) ──────────────────────────────────────

    @router.post("/dose")
    async def manual_dose(req: ManualDoseRequest):
        _validate_pump(req.pump_index)
        if req.volume_ml < 0:
            raise HTTPException(status_code=400, detail="volume_ml cannot be negative")
        await mqtt.publish("reef/doser/command/dose", {
            "pump":   req.pump_index,
            "volume": req.volume_ml,
        })
        return {"status": "ok", "pump": req.pump_index, "volume_ml": req.volume_ml}

    @router.post("/fault/clear")
    async def clear_fault(req: ClearFaultRequest):
        _validate_pump(req.pump_index)
        await mqtt.publish("reef/doser/command/fault/clear", {"pump": req.pump_index})
        return {"status": "ok", "pump": req.pump_index}

    @router.post("/calibrate")
    async def calibrate(req: CalibrateRequest, _=Depends(write_rate_limit)):
        _validate_pump(req.pump_index)
        # Calibration goes to the Pico via MSG_CALIBRATE — stored in
        # CalibrationBlock, not the schedule. No schedule fields updated.
        await mqtt.publish("reef/doser/command/calibrate", {
            "pump": req.pump_index,
            "ml":   req.ml_delivered,
            "sec":  req.seconds_ran,
            "mA":   req.expected_current_mA,
            "tol":  req.tolerance_percent,
        })
        return {"status": "ok", "pump": req.pump_index}

    # ── Schedule mutation endpoints ────────────────────────────────────────────

    @router.post("/enable")
    async def enable_disable(req: EnableDisableRequest, _=Depends(write_rate_limit)):
        _validate_pump(req.pump_index)
        await asyncio.to_thread(
            state.update_pump_config,
            req.pump_index,
            {"enabled": req.enabled},
        )
        await _publish_schedule()
        return {"status": "ok", "pump": req.pump_index, "enabled": req.enabled}

    @router.post("/schedule/interval")
    async def update_interval(req: ScheduleIntervalRequest, _=Depends(write_rate_limit)):
        _validate_pump(req.pump_index)
        await asyncio.to_thread(
            state.update_pump_config,
            req.pump_index,
            {"interval_minutes": req.interval_minutes, "volume_ml": req.volume_ml},
        )
        await _publish_schedule()
        return {"status": "ok", "pump": req.pump_index}

    @router.post("/schedule/window")
    async def update_window(req: ScheduleWindowRequest, _=Depends(write_rate_limit)):
        _validate_pump(req.pump_index)
        if not (0 <= req.start_minutes <= 1439):
            raise HTTPException(status_code=400, detail="start_minutes must be 0–1439")
        if not (0 <= req.end_minutes <= 1439):
            raise HTTPException(status_code=400, detail="end_minutes must be 0–1439")
        if req.start_minutes >= req.end_minutes:
            raise HTTPException(status_code=400, detail="start_minutes must be before end_minutes")
        await asyncio.to_thread(
            state.update_pump_config,
            req.pump_index,
            {
                "start_minutes":      req.start_minutes,
                "end_minutes":        req.end_minutes,
                "restrict_to_window": req.restrict,
            },
        )
        await _publish_schedule()
        return {"status": "ok", "pump": req.pump_index}

    @router.post("/schedule/mode")
    async def update_mode(req: ScheduleModeRequest, _=Depends(write_rate_limit)):
        _validate_pump(req.pump_index)
        if req.mode not in _VALID_MODES:
            raise HTTPException(
                status_code=400,
                detail=f"mode must be one of {sorted(_VALID_MODES)}",
            )
        await asyncio.to_thread(
            state.update_pump_config,
            req.pump_index,
            {"schedule_mode": req.mode},
        )
        await _publish_schedule()
        return {"status": "ok", "pump": req.pump_index, "mode": req.mode}

    @router.post("/schedule/role")
    async def update_role(req: ScheduleRoleRequest, _=Depends(write_rate_limit)):
        _validate_pump(req.pump_index)
        if req.role not in _VALID_ROLES:
            raise HTTPException(
                status_code=400,
                detail=f"role must be one of {sorted(_VALID_ROLES)}",
            )
        await asyncio.to_thread(
            state.update_pump_config,
            req.pump_index,
            {"role": req.role},
        )
        await _publish_schedule()
        return {"status": "ok", "pump": req.pump_index, "role": req.role}

    @router.post("/schedule/doses")
    async def update_scheduled_doses(req: ScheduleDosesRequest, _=Depends(write_rate_limit)):
        _validate_pump(req.pump_index)
        if len(req.doses) > 24:
            raise HTTPException(
                status_code=400,
                detail="A maximum of 24 scheduled doses are allowed per pump.",
            )
        doses_data = [dose.model_dump() for dose in req.doses]
        await asyncio.to_thread(
            state.update_pump_config,
            req.pump_index,
            {"scheduled_doses": doses_data},
        )
        await _publish_schedule()
        return {"status": "ok", "pump": req.pump_index, "dose_count": len(doses_data)}

    @router.post("/schedule/bulk")
    async def update_pump_bulk(req: BulkPumpUpdateRequest, _=Depends(write_rate_limit)):
        _validate_pump(req.pump_index)
        doses_data = [dose.model_dump() for dose in req.doses][:24]
        changes = {
            "role":               req.role,
            "schedule_mode":      req.mode,
            "interval_minutes":   req.interval_minutes,
            "volume_ml":          req.volume_ml,
            "start_minutes":      req.start_minutes,
            "end_minutes":        req.end_minutes,
            "restrict_to_window": req.restrict,
            "enabled":            req.enabled,
            "scheduled_doses":    doses_data,
        }
        await asyncio.to_thread(state.update_pump_config, req.pump_index, changes)
        await _publish_schedule()
        return {"status": "ok", "pump": req.pump_index}

    return router
