from __future__ import annotations

import asyncio
import json
import logging

import aiomqtt

from app.config import get_settings
from app.registry import DeviceRegistry

logger = logging.getLogger(__name__)
settings = get_settings()

# The active client is held here so devices can call publish() at any time.
# None when disconnected; set inside the connection context manager.
_client: aiomqtt.Client | None = None


# ── Public API ────────────────────────────────────────────────────────────────

async def publish(topic: str, payload: dict) -> None:
    """
    Publish a JSON message to the broker.

    Called by device routers (HTTP → MQTT command path).
    Logs and returns silently if the client is not currently connected
    rather than raising — the command will be lost, which is acceptable
    for interactive UI operations where the user will see no response
    and can retry.
    """
    if _client is None:
        logger.error("[mqtt] publish() called while disconnected — topic=%s", topic)
        return
    try:
        await _client.publish(topic, json.dumps(payload), qos=1)
    except Exception as e:
        logger.error("[mqtt] publish error on %s: %s", topic, e)


async def publish_binary(topic: str, payload: bytes) -> None:
    """
    Publish a raw binary message to the broker.

    Used for the SystemSchedule binary blob sent to the Pico.
    The payload is sent as-is with no JSON encoding.
    """
    if _client is None:
        logger.error("[mqtt] publish_binary() called while disconnected — topic=%s", topic)
        return
    try:
        await _client.publish(topic, payload, qos=1)
    except Exception as e:
        logger.error("[mqtt] publish_binary error on %s: %s", topic, e)


# ── Main loop ─────────────────────────────────────────────────────────────────

async def mqtt_loop(registry: DeviceRegistry) -> None:
    """
    Generic MQTT event loop.

    Connects to the broker, subscribes to all topics declared by
    registered devices, and routes each inbound message to the
    appropriate device's handle_message() coroutine.

    Routing
    -------
    Topics follow the convention ``reef/{device_id}/...``.
    The device_id segment is extracted from position [1] of the
    topic path and used to look up the device in the registry.
    Messages for unknown device IDs are logged and dropped.

    Reconnection
    ------------
    On any disconnect or error the loop waits 5 seconds and retries.
    device.on_connected() is called after each successful (re)connect
    so devices can re-request state from their hardware counterparts.

    Parameters
    ----------
    registry:
        The populated DeviceRegistry.  Passed explicitly (rather than
        imported as a singleton) so this function is independently
        testable.
    """
    global _client

    subscriptions = registry.get_subscriptions()
    if not subscriptions:
        logger.warning("[mqtt] No devices registered, nothing to subscribe to")
        return

    while True:
        try:
            async with aiomqtt.Client(
                hostname=settings.mqtt_host,
                port=settings.mqtt_port,
                username=settings.mqtt_username or None,
                password=settings.mqtt_password or None,
            ) as client:
                _client = client

                for topic in subscriptions:
                    await client.subscribe(topic)
                    logger.info("[mqtt] Subscribed: %s", topic)

                logger.info("[mqtt] Connected to %s:%d", settings.mqtt_host, settings.mqtt_port)

                # Notify devices so they can request initial state from hardware
                for device in registry.all():
                    try:
                        await device.on_connected()
                    except Exception as e:
                        logger.error(
                            "[mqtt] on_connected() error for device '%s': %s",
                            device.device_id, e
                        )

                async for message in client.messages:
                    topic_str = str(message.topic)

                    # Decode JSON — drop non-JSON messages with a warning
                    try:
                        payload = json.loads(message.payload.decode())
                    except (json.JSONDecodeError, UnicodeDecodeError):
                        logger.warning("[mqtt] Non-JSON message on %s — dropped", topic_str)
                        continue

                    # Route to device by device_id prefix
                    device = _route(topic_str, registry)
                    if device is None:
                        logger.debug("[mqtt] No device for topic: %s", topic_str)
                        continue

                    try:
                        await device.handle_message(topic_str, payload)
                    except Exception as e:
                        logger.error(
                            "[mqtt] handle_message() error for device '%s' on topic '%s': %s",
                            device.device_id, topic_str, e,
                        )

        except aiomqtt.MqttError as e:
            logger.warning("[mqtt] Disconnected: %s — retrying in 5s", e)
        except Exception as e:
            logger.error("[mqtt] Unexpected error: %s — retrying in 5s", e)
        finally:
            _client = None

        await asyncio.sleep(5)


# ── Routing ───────────────────────────────────────────────────────────────────

def _route(topic: str, registry: DeviceRegistry):
    """
    Extract the device_id from a topic and return the matching device.

    Expected topic structure: ``reef/{device_id}/...``
    Returns None if the topic is malformed or the device is not registered.
    """
    parts = topic.split("/")
    # Minimum valid topic: "reef/{device_id}/{anything}" → 3 parts
    if len(parts) < 3 or parts[0] != "reef":
        logger.debug("[mqtt] Unroutable topic (unexpected structure): %s", topic)
        return None

    device_id = parts[1]
    return registry.get_device(device_id)
