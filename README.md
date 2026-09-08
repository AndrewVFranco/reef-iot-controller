# Reef IoT Controller 🌊

A full-stack, event-driven IoT integration server for real-time hardware control and telemetry. This platform bridges web protocols with embedded hardware, providing automated scheduling, precise dosing control, and real-time data monitoring for reef aquarium environments.

## 🏗 Architecture & Tech Stack

This project is built using a modern microservices architecture, decoupling HTTP client requests from the physical hardware communication layer. 

- **Backend:** Python, FastAPI, WebSockets, aiomqtt, asyncio
- **Frontend:** React, Vite, Tailwind CSS, Zustand
- **Message Broker:** Mosquitto (MQTT) for instantaneous, low-latency device communication
- **Database:** InfluxDB for time-series telemetry storage
- **Deployment:** Docker & Docker Compose (Multi-stage builds)

## ⚙️ Backend

The backend is explicitly designed to handle non-blocking I/O, maintain persistent hardware connections, and respect microcontroller memory constraints.

* **Asynchronous Event Loop:** An `aiomqtt` task runs persistently in the background to handle bidirectional MQTT traffic, automatically managing reconnects, backoffs, and hardware state synchronization without blocking the main API thread.
* **Hardware-Constrained Serialization:** Translates JSON HTTP payloads into precise 1360-byte binary structs for the MQTT broker, completely bypassing JSON overhead for memory-constrained microcontroller clients.
* **Concurrency Management:** Explicitly offloads blocking I/O operations (like database querying and binary serialization) to separate threads using `asyncio.to_thread` to maintain a high-performance event loop.
* **Dynamic Device Registry:** Implements the Registry pattern for hardware abstraction. New hardware types can be instantiated and injected on application startup, dynamically mounting their specific HTTP routers and health checks without modifying core system routes.
* **Unified Telemetry Pipeline:** Aggregates all registered hardware states into a single WebSocket endpoint. Upon connection, the server replays the current state of all devices, subsequently streaming live telemetry as events arrive from the broker.

## 💻 Frontend & UI

The visual layer provides a responsive, state-driven dashboard that consumes the backend's real-time events.

* **Reactive State:** Uses Zustand to manage complex device schedules and real-time telemetry across the application without prop drilling.
* **Live Dashboards:** WebSocket hooks automatically update UI components (like pump status and flow rates) the millisecond a message is published by the hardware.
* **Optimized Build:** Configured with Vite for rapid development and packaged into a lightweight, high-performance Nginx container for production.

## 🚀 Getting Started (Docker)

The easiest way to run the entire system (Frontend, Backend, Database, and MQTT Broker) is via Docker Compose.

### Prerequisites
- [Docker](https://docs.docker.com/get-docker/)
- [Docker Compose](https://docs.docker.com/compose/install/)

### Installation

1. Clone the repository:
   ```bash
   git clone [https://github.com/AndrewVFranco/reef-iot-controller.git](https://github.com/AndrewVFranco/reef-iot-controller.git)
   cd reef-iot-controller
   ```

2. Start the services:
   ```bash
   docker-compose up -d --build
   ```

3. Access the application:
   - **Frontend Dashboard:** http://localhost
   - **Backend API Docs (Swagger):** http://localhost:8000/docs
   - **InfluxDB UI:** http://localhost:8086

## 📂 Project Structure

```text
reef-iot-controller/
├── backend/                
│   ├── app/                
│   │   ├── database/       # Time-series client (InfluxDB)
│   │   ├── devices/        # Hardware logic & binary serialization
│   │   ├── routers/        # System API & WebSocket endpoints
│   │   ├── mqtt.py         # Async event loop
│   │   └── main.py         # FastAPI lifecycle & registry init
│   └── Dockerfile
├── frontend/               
│   ├── src/
│   │   ├── api/            # HTTP and WebSocket hooks
│   │   ├── components/     # UI components & layouts
│   │   ├── pages/          # Dashboard views
│   │   └── store/          # Zustand global state
│   └── Dockerfile
└── docker-compose.yml      # Service orchestration
```