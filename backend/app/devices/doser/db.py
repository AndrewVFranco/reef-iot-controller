from __future__ import annotations

import logging
from typing import Any

from app.database.helpers import query, write_point

logger = logging.getLogger(__name__)

_M_STATUS = "doser/pump_status"
_M_LOG    = "doser/pump_log"
_M_ALERT  = "doser/alert"

def write_pump_status(
    pump_index: int,
    current_mA: float,
    voltage_V: float,
    status: int,
) -> None:
    write_point(
        measurement=_M_STATUS,
        tags={"pump_index": str(pump_index)},
        fields={
            "current_mA": current_mA,
            "voltage_V":  voltage_V,
            "status":     status,
        },
    )

def write_pump_log(
    pump_index: int,
    volume_ml: float,
    duration_ms: float,
    avg_current_mA: float,
    status: int,
    timestamp_ms: int,
    was_manual: bool,
) -> None:
    write_point(
        measurement=_M_LOG,
        tags={
            "pump_index": str(pump_index),
            "was_manual": str(was_manual),
        },
        fields={
            "volume_ml":      volume_ml,
            "duration_ms":    duration_ms,
            "avg_current_mA": avg_current_mA,
            "status":         status,
        },
        timestamp_ms=timestamp_ms,
    )

def write_alert(
    alert_type: int,
    pump_index: int,
    current_mA: float,
    expected_mA: float,
    voltage_V: float,
    timestamp_ms: int,
) -> None:
    write_point(
        measurement=_M_ALERT,
        tags={
            "alert_type": str(alert_type),
            "pump_index": str(pump_index),
        },
        fields={
            "current_mA":  current_mA,
            "expected_mA": expected_mA,
            "voltage_V":   voltage_V,
        },
        timestamp_ms=timestamp_ms,
    )

def query_pump_logs(pump_index: int, hours: int = 24) -> list[dict[str, Any]]:
    return query(f'''
        SELECT *
        FROM "{_M_LOG}"
        WHERE "pump_index" = '{pump_index}'
        AND time >= now() - {hours}h
        ORDER BY time DESC
    ''')

def query_all_pump_logs(hours: int = 24) -> list[dict[str, Any]]:
    return query(f'''
        SELECT *
        FROM "{_M_LOG}"
        WHERE time >= now() - {hours}h
        ORDER BY time DESC
    ''')

def query_alerts(limit: int = 50) -> list[dict[str, Any]]:
    return query(f'''
        SELECT *
        FROM "{_M_ALERT}"
        ORDER BY time DESC
        LIMIT {limit}
    ''')

def query_pump_current_history(pump_index: int, hours: int = 24) -> list[dict[str, Any]]:
    return query(f'''
        SELECT *
        FROM "{_M_STATUS}"
        WHERE "pump_index" = '{pump_index}'
        AND time >= now() - {hours}h
    ''')

def query_pump_runtime(pump_index: int, hours: int = 24) -> list[dict[str, Any]]:
    return query(f'''
        SELECT *
        FROM "{_M_LOG}"
        WHERE "pump_index" = '{pump_index}'
        AND time >= now() - {hours}h
    ''')

def delete_pump_logs(pump_index: int | None, manual: bool | None) -> None:
    """
    Delete pump log entries from InfluxDB matching the given filters.

    Parameters
    ----------
    pump_index:
        If provided, only delete logs for this pump index.
    manual:
        If provided, only delete logs where was_manual matches.
        True = manual doses only, False = auto doses only, None = all.
    """
    where_clauses = []
    if pump_index is not None:
        where_clauses.append(f'"pump_index" = \'{pump_index}\'')
    if manual is not None:
        where_clauses.append(f'"was_manual" = \'{str(manual)}\'')

    where = f" WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
    query(f'DELETE FROM "{_M_LOG}"{where}')
