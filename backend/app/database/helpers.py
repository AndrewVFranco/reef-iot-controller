from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from app.database.client import write_points, query as _raw_query

logger = logging.getLogger(__name__)

# ── Types ─────────────────────────────────────────────────────────────────────

# A single InfluxDB point ready for write_points().
Point = dict[str, Any]


# ── Write ─────────────────────────────────────────────────────────────────────

def write_point(
    measurement: str,
    tags: dict[str, str],
    fields: dict[str, Any],
    timestamp_ms: int | None = None,
) -> bool:
    """
    Write a single measurement point to InfluxDB.

    Parameters
    ----------
    measurement:
        Measurement name.  Convention: ``"{device_id}/{series}"``,
        e.g. ``"doser/pump_status"``, ``"plug/temperature"``.
    tags:
        Low-cardinality indexed metadata (pump index, alert type, etc.).
        All values must be strings.
    fields:
        The actual data values (floats, ints, bools, strings).
        At least one field is required.
    timestamp_ms:
        Optional Unix timestamp in milliseconds.  When omitted InfluxDB
        uses the server's current time, which is correct for live data.
        Pass a value when replaying historical data from the device
        (e.g. log entries that carry the Pico's own timestamp).

    Returns
    -------
    True on success, False if the write failed (error already logged).
    """
    point: Point = {
        "measurement": measurement,
        "tags":        tags,
        "fields":      fields,
    }
    if timestamp_ms is not None:
        point["time"] = _ms_to_iso(timestamp_ms)

    success = write_points([point])
    if not success:
        logger.error(
            "[db] write_point failed — measurement=%s tags=%s", measurement, tags
        )
    return success


def write_points_batch(points: list[Point]) -> bool:
    """
    Write multiple pre-built points in a single network call.

    Use this when a single MQTT message produces several related points
    (e.g. a status update that writes both current and voltage series).
    Each point must be a dict with at minimum ``measurement`` and
    ``fields`` keys; ``tags`` and ``time`` are optional.

    Returns True if all points were written, False on any error.
    """
    if not points:
        return True
    success = write_points(points)
    if not success:
        logger.error("[db] write_points_batch failed — %d points dropped", len(points))
    return success


# ── Query ─────────────────────────────────────────────────────────────────────

def query(influxql: str) -> list[dict[str, Any]]:
    """
    Execute a raw InfluxQL query and return results as a flat list of dicts.

    Each dict is one row; keys are field/tag names plus ``"time"``.
    Returns an empty list on error (already logged by client.py).

    Devices write their own query functions using this helper so that
    query strings stay co-located with the measurement names they
    reference — never scattered across unrelated modules.

    Example::

        from app.database.helpers import query

        def query_pump_logs(pump_index: int, hours: int = 24) -> list[dict]:
            return query(f'''
                SELECT "volume_ml", "duration_ms", "avg_current_mA", "status"
                FROM "doser/pump_log"
                WHERE "pump_index" = '{pump_index}'
                AND time >= now() - {hours}h
                ORDER BY time DESC
            ''')
    """
    return _raw_query(influxql)


def query_last(
    measurement: str,
    fields: list[str],
    group_by_tag: str | None = None,
) -> list[dict[str, Any]]:
    """
    Convenience wrapper: fetch the most recent value of one or more fields.

    Parameters
    ----------
    measurement:
        Measurement name, e.g. ``"doser/pump_status"``.
    fields:
        List of field names to fetch, e.g. ``["current_mA", "voltage_V"]``.
    group_by_tag:
        Optional tag name to group by, e.g. ``"pump_index"``.
        When provided each tag value returns its own latest row.

    Returns
    -------
    List of result dicts, one per group (or a single-element list when
    group_by_tag is None).
    """
    selector = ", ".join(f'last("{f}") AS "{f}"' for f in fields)
    influxql = f'SELECT {selector} FROM "{measurement}"'
    if group_by_tag:
        influxql += f' GROUP BY "{group_by_tag}"'
    return _raw_query(influxql)


# ── Internal helpers ──────────────────────────────────────────────────────────

def _ms_to_iso(timestamp_ms: int) -> str:
    """Convert a Unix millisecond timestamp to an ISO-8601 string for InfluxDB."""
    return datetime.fromtimestamp(
        timestamp_ms / 1000.0, tz=timezone.utc
    ).isoformat()
