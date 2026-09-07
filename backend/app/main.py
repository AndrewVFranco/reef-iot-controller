from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.database.client import init_db
from app.devices.doser.device import DoserDevice
from app.registry import registry
from app.routers import system
from app.websocket import ws_manager
from app import mqtt

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)
settings = get_settings()


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── 1. Register devices ───────────────────────────────────────────────────
    # To add a new device: instantiate it and call registry.register().
    # Everything else (MQTT subscriptions, HTTP routes, WebSocket state
    # replay, health reporting) is wired automatically below.

    doser = DoserDevice()
    registry.register(doser)

    # ── 2. Initialise devices (load persisted state, etc.) ────────────────────
    for device in registry.all():
        if hasattr(device, "initialise"):
            device.initialise()

    # ── 3. Inject dependencies into every device ──────────────────────────────
    for device in registry.all():
        device.set_broadcast(ws_manager.broadcast)
        device.set_registry(registry)

    # ── 4. Wire WebSocket initial-state replay ────────────────────────────────
    async def send_initial_state(websocket) -> None:
        for device in registry.all():
            if hasattr(device, "send_initial_state"):
                await device.send_initial_state(websocket)

    ws_manager.set_initial_state_fn(send_initial_state)

    # ── 5. Mount device HTTP routers ──────────────────────────────────────────
    for device in registry.all():
        app.include_router(device.get_router())

    # ── 6. Initialise InfluxDB ────────────────────────────────────────────────
    init_db()
    logger.info("InfluxDB initialised")

    # ── 7. Start MQTT loop ────────────────────────────────────────────────────
    mqtt_task = asyncio.create_task(mqtt.mqtt_loop(registry))
    logger.info("MQTT loop started")

    logger.info(
        "Reef controller ready — %d device(s) registered: %s",
        len(registry),
        [d.device_id for d in registry.all()],
    )

    yield

    # ── Shutdown ──────────────────────────────────────────────────────────────
    logger.info("Shutting down reef controller")
    mqtt_task.cancel()
    try:
        await mqtt_task
    except asyncio.CancelledError:
        pass


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Reef Controller",
    description="Multi-device reef aquarium controller API",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# System router is always mounted (health + WebSocket endpoint)
app.include_router(system.router)


# ── Static files ──────────────────────────────────────────────────────────────

static_path = Path(settings.static_files_path)
assets_path = static_path / "assets"

if static_path.exists() and assets_path.exists():
    app.mount("/assets", StaticFiles(directory=assets_path), name="assets")

    @app.get("/{full_path:path}")
    async def serve_react(full_path: str):
        index = static_path / "index.html"
        if index.exists():
            return FileResponse(index)
        return {"error": "Frontend not built yet"}

else:
    @app.get("/")
    async def root():
        return {
            "message": "Reef Controller API",
            "docs":    "/docs",
            "devices": [d.device_id for d in registry.all()],
        }
