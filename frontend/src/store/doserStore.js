import { create } from "zustand";
import { doserApi } from "@/api/http";

// ── Constants ─────────────────────────────────────────────────────────────

const MAX_CURRENT_HISTORY = 1500;

export const ROLE_LABELS = {
  AWC_OUT:  "removed",
  AWC_IN:   "added",
  ATO:      "topped off",
  DOSER:    "dosed",
  DISABLED: null,
};

export const ROLE_NAMES = {
  AWC_OUT:  "AWC Out",
  AWC_IN:   "AWC In",
  ATO:      "ATO",
  DOSER:    "Doser",
  DISABLED: "Disabled",
};

export const PUMP_STATUS = {
  IDLE:     0,
  RUNNING:  1,
  FAULT:    2,
  DISABLED: 3,
};

export const STATUS_LABELS = {
  0: "Idle",
  1: "Running",
  2: "Fault",
  3: "Disabled",
};

// ── Circular buffer ───────────────────────────────────────────────────────
//
// Fixed-size ring buffer — no array allocations after initial fill.
// head points to the next write slot.
// size tracks how many valid entries exist (capped at MAX_CURRENT_HISTORY).

const makeBuffer = () => ({
  data: new Array(MAX_CURRENT_HISTORY).fill(null),
  head: 0,
  size: 0,
});

// Write a point into the buffer in place — no spread, no slice.
function appendToBuffer(buf, point) {
  buf.data[buf.head] = point;
  buf.head = (buf.head + 1) % MAX_CURRENT_HISTORY;
  if (buf.size < MAX_CURRENT_HISTORY) buf.size++;
}

// Read the buffer in chronological order as a plain array for recharts.
// Called only by the chart component, not on every store update.
export function readBuffer(buf) {
  if (buf.size === 0) return [];
  const result = new Array(buf.size);
  const start = buf.size < MAX_CURRENT_HISTORY ? 0 : buf.head;
  for (let i = 0; i < buf.size; i++) {
    result[i] = buf.data[(start + i) % MAX_CURRENT_HISTORY];
  }
  return result;
}

// ── Initial state ─────────────────────────────────────────────────────────

const initialPumpLive = () => ({
  current_mA: 0,
  voltage_V:  0,
  status:     0,
});

// ── Store ─────────────────────────────────────────────────────────────────

export const useDoserStore = create((set, get) => ({
  // ── State ───────────────────────────────────────────────────────────────

  pumps: {
    0: initialPumpLive(),
    1: initialPumpLive(),
    2: initialPumpLive(),
    3: initialPumpLive(),
  },

  schedule: null,

  connection: {
    pico_connected:          false,
    last_heartbeat_ms:       0,
    last_wall_clock_seconds: 0,
  },

  alerts: [],
  logs:   [],

  // Circular buffers — one per pump
  currentHistory: {
    0: makeBuffer(),
    1: makeBuffer(),
    2: makeBuffer(),
    3: makeBuffer(),
  },

  scheduleAckStatus: null,
  _historyTick: 0,

  loading: {
    schedule: false,
    logs:     false,
    alerts:   false,
    runtime:  false,
  },
  errors: {},

  runtimeSummary: {},

  // ── WebSocket message handler ────────────────────────────────────────────

  handleWsMessage(msg) {
    const { device, type, payload } = msg;

    if (device !== "doser") return;

    switch (type) {
      case "status": {
        const idx    = String(msg.pump_index);
        const mA     = payload.current_mA ?? 0;
        const V      = payload.voltage_V  ?? 0;
        const status = payload.status     ?? 0;

        set((s) => {
          const buf = s.currentHistory[idx];
          appendToBuffer(buf, { time: Date.now(), current_mA: mA });
          return {
            pumps: {
              ...s.pumps,
              [idx]: { current_mA: mA, voltage_V: V, status },
            },
            _historyTick: s._historyTick + 1,
          };
        });
        break;
      }

      case "alert":
        set((s) => ({
          alerts: [{ ...payload, _id: Date.now() }, ...s.alerts].slice(0, 100),
        }));
        break;

      case "log":
        set((s) => ({
          logs: [{ ...payload, _id: Date.now() }, ...s.logs].slice(0, 200),
        }));
        break;

      case "heartbeat":
        set((s) => ({
          connection: {
            ...s.connection,
            pico_connected:          true,
            last_heartbeat_ms:       payload.uptime_ms          ?? s.connection.last_heartbeat_ms,
            last_wall_clock_seconds: payload.wall_clock_seconds ?? s.connection.last_wall_clock_seconds,
          },
        }));
        break;

      case "connection":
        set({ connection: payload });
        break;

      case "schedule":
        set({ schedule: payload });
        break;

      case "schedule_ack":
        set({ scheduleAckStatus: payload.status === "ok" ? "ok" : "timeout" });
        break;

      default:
        break;
    }
  },

  // ── Actions ───────────────────────────────────────────────────────────────

  setScheduleAckPending() {
    set({ scheduleAckStatus: "pending" });
  },

  // ── REST fetches ─────────────────────────────────────────────────────────

  async fetchSchedule() {
    set((s) => ({ loading: { ...s.loading, schedule: true } }));
    try {
      const data = await doserApi.getSchedule();
      set({ schedule: data });
    } catch (e) {
      set((s) => ({ errors: { ...s.errors, schedule: e.message } }));
    } finally {
      set((s) => ({ loading: { ...s.loading, schedule: false } }));
    }
  },

  async fetchLogs(hours = 24) {
    set((s) => ({ loading: { ...s.loading, logs: true } }));
    try {
      const data = await doserApi.getLogs({ hours });
      set({ logs: data.logs ?? [] });
    } catch (e) {
      set((s) => ({ errors: { ...s.errors, logs: e.message } }));
    } finally {
      set((s) => ({ loading: { ...s.loading, logs: false } }));
    }
  },

  async fetchAlerts() {
    set((s) => ({ loading: { ...s.loading, alerts: true } }));
    try {
      const data = await doserApi.getAlerts();
      set({ alerts: data.alerts ?? [] });
    } catch (e) {
      set((s) => ({ errors: { ...s.errors, alerts: e.message } }));
    } finally {
      set((s) => ({ loading: { ...s.loading, alerts: false } }));
    }
  },

  async fetchRuntimeSummary() {
    set((s) => ({ loading: { ...s.loading, runtime: true } }));
    try {
      const results = await Promise.all(
        [0, 1, 2, 3].map((i) => doserApi.getRuntime(i, 24))
      );
      const summary = {};
      results.forEach((r) => {
        summary[r.pump_index] = {
          total_volume_ml: r.total_volume_ml,
          run_count:       r.run_count,
        };
      });
      set({ runtimeSummary: summary });
    } catch (e) {
      set((s) => ({ errors: { ...s.errors, runtime: e.message } }));
    } finally {
      set((s) => ({ loading: { ...s.loading, runtime: false } }));
    }
  },

  // ── Derived helpers ───────────────────────────────────────────────────────

  getEnabledPumps() {
    const { schedule } = get();
    if (!schedule?.pumps) return [];
    return Object.entries(schedule.pumps)
      .filter(([, cfg]) => cfg.enabled && cfg.role !== "DISABLED")
      .map(([idx, cfg]) => ({ index: Number(idx), ...cfg }));
  },

  getPump(pumpIndex) {
    const { pumps, schedule } = get();
    const idx = String(pumpIndex);
    return {
      ...pumps[idx],
      ...(schedule?.pumps?.[idx] ?? {}),
      index: pumpIndex,
    };
  },
}));