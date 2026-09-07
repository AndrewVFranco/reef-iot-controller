from __future__ import annotations

import json
import logging
import struct
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# ── Paths ─────────────────────────────────────────────────────────────────────

_DATA_DIR      = Path(__file__).parent.parent.parent.parent / "data"
_SCHEDULE_FILE = _DATA_DIR / "schedule.json"

# ── Default schedule ──────────────────────────────────────────────────────────
#
# Calibration fields (flow_rate_ml_per_sec, expected_current_mA,
# tolerance_percent) removed — calibration is stored separately in
# CalibrationBlock on the Pico and managed via the calibrate endpoint.
#
# version removed — version checking was brittle and caused overflow issues.
# linked_pump removed from sensors — sensor 0 is hardcoded to ATO in firmware.

_DEFAULT_SCHEDULE: dict[str, Any] = {
    "pumps": {
        "0": {
            "role":               "AWC_OUT",
            "enabled":            True,
            "schedule_mode":      "INTERVAL",
            "interval_minutes":   240,
            "volume_ml":          90.0,
            "restrict_to_window": True,
            "start_minutes":      480,
            "end_minutes":        1320,
        },
        "1": {
            "role":               "AWC_IN",
            "enabled":            True,
            "schedule_mode":      "INTERVAL",
            "interval_minutes":   240,
            "volume_ml":          90.0,
            "restrict_to_window": True,
            "start_minutes":      480,
            "end_minutes":        1320,
        },
        "2": {
            "role":               "ATO",
            "enabled":            True,
            "schedule_mode":      "INTERVAL",
            "interval_minutes":   0,
            "volume_ml":          0.0,
            "restrict_to_window": False,
            "start_minutes":      480,
            "end_minutes":        1320,
        },
        "3": {
            "role":               "DOSER",
            "enabled":            False,
            "schedule_mode":      "INTERVAL",
            "interval_minutes":   60,
            "volume_ml":          1.0,
            "restrict_to_window": True,
            "start_minutes":      480,
            "end_minutes":        1320,
        },
    },
    "sensors": {
        "0": {"role": "TANK_LEVEL",      "enabled": True,  "active_low": True},
        "1": {"role": "CONTAINER_LEVEL", "enabled": False, "active_low": True},
        "2": {"role": "CONTAINER_LEVEL", "enabled": False, "active_low": True},
        "3": {"role": "CONTAINER_LEVEL", "enabled": False, "active_low": True},
        "4": {"role": "CONTAINER_LEVEL", "enabled": False, "active_low": True},
    },
    "last_updated": None,
}

_PUMP_INDICES = ("0", "1", "2", "3")

# ── Binary serialization constants ────────────────────────────────────────────
#
# The Pico expects a packed binary SystemSchedule struct over UART.
# Sizes confirmed via static_assert on the ARM Cortex-M0+ compiler
# after refactor:
#   SystemSchedule = 1360 bytes    PumpConfig     = 324 bytes
#   SensorConfig   = 12 bytes      IntervalConfig = 16 bytes
#   ScheduledDose  = 12 bytes
#
# Removed from struct vs previous version:
#   - version (uint16_t) — no versioning
#   - wallClockOffset_seconds (uint32_t) — RAM only, managed by NTP
#   - linkedSensorIndex (int8_t) from PumpConfig — hardcoded in firmware
#   - linkedPumpIndex (int8_t) from SensorConfig — hardcoded in firmware
#   - flowRate_mlPerSec, expectedCurrent_mA, tolerancePercent from PumpConfig
#     — moved to separate CalibrationBlock
#
# All formats use little-endian (<) to match the RP2040.

_PUMP_ROLE     = {"AWC_OUT": 0, "AWC_IN": 1, "ATO": 2, "DOSER": 3, "DISABLED": 4}
_SCHEDULE_MODE = {"INTERVAL": 0, "SCHEDULED": 1, "BOTH": 2}
_SENSOR_ROLE   = {"TANK_LEVEL": 0, "CONTAINER_LEVEL": 1}

_MAX_SCHEDULED_DOSES  = 24
_SYSTEM_SCHEDULE_SIZE = 1360

# ScheduledDose: uint16_t time, 2x pad, float volume_ml, bool enabled, 3x pad
_FMT_SCHEDULED_DOSE  = "<H2xf?3x"    # 12 bytes

# IntervalConfig: uint32_t interval_minutes, uint16_t start, uint16_t end,
#                 float volume_ml, bool restrictToWindow, 3x pad
_FMT_INTERVAL_CONFIG = "<IHHf?3x"    # 16 bytes

# PumpConfig head: uint8_t pin, uint8_t pumpNumber, 2x pad,
#                  int32_t role, int32_t scheduleMode,
#                  bool enabled, bool manualDoseFlag, 2x pad
# linkedSensorIndex removed
_FMT_PUMP_CONFIG_HEAD = "<BB2xii??2x"  # 16 bytes

# PumpConfig tail: uint8_t scheduledDoseCount, 3x pad
# calibration floats removed — managed by CalibrationBlock
_FMT_PUMP_CONFIG_TAIL = "<B3x"          # 4 bytes

# SensorConfig: uint8_t pin, 3x pad, int32_t role,
#               bool activeLow, bool enabled, 2x pad
# linkedPumpIndex removed
_FMT_SENSOR_CONFIG = "<B3xi??2x"       # 12 bytes

# SystemSchedule footer: uint8_t pumpCount, uint8_t sensorCount, 2x pad
# No header — PumpConfig[4] starts at offset 0
_FMT_SCHEDULE_FOOTER = "<BB2x"          # 4 bytes


# ── DoserState ────────────────────────────────────────────────────────────────

class DoserState:
    """
    All in-memory state for the doser device.

    Owns the schedule (loaded from / persisted to disk) and the live
    pump status cache populated from MQTT messages. There is exactly
    one instance, created and owned by DoserDevice.

    No module-level globals. No mutation outside this class.
    """

    def __init__(self) -> None:
        self._schedule: dict[str, Any] = {}
        self._pump_status: dict[str, dict[str, Any]] = {
            idx: {"current_mA": 0.0, "voltage_V": 0.0, "status": 0}
            for idx in _PUMP_INDICES
        }
        self._pico_connected: bool = False
        self._last_heartbeat_ms: int = 0
        self._last_wall_clock_seconds: int = 0

    # ── Schedule persistence ──────────────────────────────────────────────────

    def load_schedule(self) -> None:
        """
        Load the schedule from disk. Falls back to defaults if the file
        is missing or corrupt, and immediately persists the defaults so
        the file exists on the next startup.
        """
        _DATA_DIR.mkdir(parents=True, exist_ok=True)

        if _SCHEDULE_FILE.exists():
            try:
                with open(_SCHEDULE_FILE) as f:
                    self._schedule = json.load(f)
                logger.info("[doser/state] Schedule loaded from %s", _SCHEDULE_FILE)
                return
            except Exception as e:
                logger.error(
                    "[doser/state] Failed to load schedule (%s) — using defaults", e
                )

        logger.info("[doser/state] No schedule file found — using defaults")
        self._schedule = _deep_copy_schedule(_DEFAULT_SCHEDULE)
        self._save_schedule()

    def _save_schedule(self) -> None:
        """
        Atomically write the schedule to disk using a temp-file swap.
        Errors are logged but never raised — a failed save is not fatal.
        """
        try:
            _DATA_DIR.mkdir(parents=True, exist_ok=True)
            tmp = _SCHEDULE_FILE.with_suffix(".tmp")
            with open(tmp, "w") as f:
                json.dump(self._schedule, f, indent=2, default=str)
            tmp.replace(_SCHEDULE_FILE)
            logger.debug("[doser/state] Schedule saved")
        except Exception as e:
            logger.error("[doser/state] Failed to save schedule: %s", e)

    def save_schedule(self) -> None:
        """Public entry point for callers that need to persist after a mutation."""
        self._save_schedule()

    # ── Schedule access ───────────────────────────────────────────────────────

    def get_schedule(self) -> dict[str, Any]:
        return self._schedule

    def get_pump_config(self, pump_index: int) -> dict[str, Any] | None:
        return self._schedule.get("pumps", {}).get(str(pump_index))

    def update_pump_config(self, pump_index: int, changes: dict[str, Any]) -> dict[str, Any]:
        """
        Apply a partial update to a pump's config, persist to disk, and
        return the updated config dict.

        Raises KeyError if pump_index is not in the schedule.
        """
        key   = str(pump_index)
        pumps = self._schedule.get("pumps", {})
        if key not in pumps:
            raise KeyError(f"Pump {pump_index} not found in schedule")

        pumps[key].update(changes)
        self._schedule["last_updated"] = datetime.now(timezone.utc).isoformat()
        self._save_schedule()
        return pumps[key]

    def get_sensor_config(self, sensor_index: int) -> dict[str, Any] | None:
        return self._schedule.get("sensors", {}).get(str(sensor_index))

    # ── Pump status cache ─────────────────────────────────────────────────────

    def update_pump_status(
        self,
        pump_index: int,
        current_mA: float,
        voltage_V: float,
        status: int,
    ) -> None:
        self._pump_status[str(pump_index)] = {
            "current_mA": current_mA,
            "voltage_V":  voltage_V,
            "status":     status,
        }

    def get_pump_status(self) -> dict[str, dict[str, Any]]:
        return self._pump_status

    def get_pump_status_single(self, pump_index: int) -> dict[str, Any] | None:
        return self._pump_status.get(str(pump_index))

    # ── Connection state ──────────────────────────────────────────────────────

    def set_pico_connected(self, connected: bool) -> None:
        self._pico_connected = connected

    def is_pico_connected(self) -> bool:
        return self._pico_connected

    def update_heartbeat(self, uptime_ms: int, wall_clock_seconds: int = 0) -> None:
        self._last_heartbeat_ms = uptime_ms
        self._last_wall_clock_seconds = wall_clock_seconds
        self._pico_connected = True

    def get_last_heartbeat_ms(self) -> int:
        return self._last_heartbeat_ms

    def get_last_wall_clock_seconds(self) -> int:
        return self._last_wall_clock_seconds

    def connection_snapshot(self) -> dict[str, Any]:
        """Serialisable snapshot of connection state for WebSocket replay."""
        return {
            "pico_connected":        self._pico_connected,
            "last_heartbeat_ms":     self._last_heartbeat_ms,
            "last_wall_clock_seconds": self._last_wall_clock_seconds,
        }

    # ── Binary serialization ──────────────────────────────────────────────────

    def serialize_schedule(self) -> bytes:
        """
        Serialize the current JSON schedule to a 1360-byte binary blob
        matching the Pico's SystemSchedule struct layout exactly.

        ESP32Comms.cpp validates payloadLength == sizeof(SystemSchedule)
        so this must produce exactly _SYSTEM_SCHEDULE_SIZE bytes.

        SystemSchedule layout (no header fields):
          PumpConfig[4]    = 1296 bytes
          SensorConfig[5]  = 60 bytes
          footer           = 4 bytes
          total            = 1360 bytes

        Raises ValueError if the result is the wrong size.
        """
        pumps_cfg   = self._schedule.get("pumps", {})
        sensors_cfg = self._schedule.get("sensors", {})

        buf = bytearray()

        # PumpConfig[4] — starts at offset 0, no header
        for i in range(4):
            buf += _serialize_pump(pumps_cfg.get(str(i), {}))

        # SensorConfig[5]
        for i in range(5):
            buf += _serialize_sensor(sensors_cfg.get(str(i), {}))

        # Footer: pumpCount, sensorCount
        buf += struct.pack(_FMT_SCHEDULE_FOOTER, 4, 5)

        if len(buf) != _SYSTEM_SCHEDULE_SIZE:
            raise ValueError(
                f"serialize_schedule produced {len(buf)} bytes, "
                f"expected {_SYSTEM_SCHEDULE_SIZE}"
            )

        return bytes(buf)


# ── Internal helpers ──────────────────────────────────────────────────────────

def _deep_copy_schedule(schedule: dict[str, Any]) -> dict[str, Any]:
    """Return a deep copy via JSON round-trip to avoid shared mutable state."""
    return json.loads(json.dumps(schedule))


def _serialize_pump(cfg: dict[str, Any]) -> bytes:
    """
    Serialize one PumpConfig to 324 bytes.

    PumpConfig layout (ARM Cortex-M0+ verified, 324 bytes total):
      [0]    uint8_t  pin               (1)
      [1]    uint8_t  pumpNumber        (1)
      [2-3]  pad                        (2)
      [4]    int32_t  role              (4)
      [8]    int32_t  scheduleMode      (4)
      [12]   bool     enabled           (1)
      [13]   bool     manualDoseFlag    (1)
      [14-15] pad                       (2)
      [16]   IntervalConfig             (16)
      [32]   ScheduledDose[24]          (288)
      [320]  uint8_t  scheduledDoseCount(1)
      [321-323] pad                     (3)
      total = 324
    """
    buf = bytearray()

    role = _PUMP_ROLE.get(cfg.get("role", "DISABLED"), 4)
    mode = _SCHEDULE_MODE.get(cfg.get("schedule_mode", "INTERVAL"), 0)

    # Head — no linkedSensorIndex
    buf += struct.pack(
        _FMT_PUMP_CONFIG_HEAD,
        0,      # pin — managed by Pico DefaultSchedule
        0,      # pumpNumber — managed by Pico DefaultSchedule
        role,
        mode,
        bool(cfg.get("enabled", False)),
        False,  # manualDoseFlag — always False from server
    )

    # IntervalConfig
    buf += struct.pack(
        _FMT_INTERVAL_CONFIG,
        int(cfg.get("interval_minutes", 0)),
        int(cfg.get("start_minutes", 480)),
        int(cfg.get("end_minutes", 1320)),
        float(cfg.get("volume_ml", 0.0)),
        bool(cfg.get("restrict_to_window", False)),
    )

    # ScheduledDose[24]
    scheduled_doses = cfg.get("scheduled_doses", [])
    dose_count = min(len(scheduled_doses), _MAX_SCHEDULED_DOSES)

    for j in range(_MAX_SCHEDULED_DOSES):
        if j < dose_count:
            dose = scheduled_doses[j]
            buf += struct.pack(
                _FMT_SCHEDULED_DOSE,
                int(dose.get("time_minutesSinceMidnight", 0)),
                float(dose.get("volume_ml", 0.0)),
                bool(dose.get("enabled", False)),
            )
        else:
            buf += b"\x00" * 12

    # Tail — no calibration floats
    buf += struct.pack(_FMT_PUMP_CONFIG_TAIL, dose_count)

    return bytes(buf)


def _serialize_sensor(cfg: dict[str, Any]) -> bytes:
    """
    Serialize one SensorConfig to 12 bytes.

    SensorConfig layout (ARM Cortex-M0+ verified, 12 bytes total):
      [0]    uint8_t  pin       (1)
      [1-3]  pad                (3)
      [4]    int32_t  role      (4)
      [8]    bool     activeLow (1)
      [9]    bool     enabled   (1)
      [10-11] pad               (2)
      total = 12
    """
    role = _SENSOR_ROLE.get(cfg.get("role", "CONTAINER_LEVEL"), 1)

    return struct.pack(
        _FMT_SENSOR_CONFIG,
        0,    # pin — managed by Pico
        role,
        bool(cfg.get("active_low", True)),
        bool(cfg.get("enabled", False)),
    )
