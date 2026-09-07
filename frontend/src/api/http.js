import axios from "axios";

// ── Base URL resolution ───────────────────────────────────────────────────
// In dev: Vite proxy rewrites /api → Pi, so baseURL is just /api
// In production: window.REEF_CONFIG.apiUrl is set by public/config.js

const baseURL =
  import.meta.env.DEV
    ? "/api"
    : (window.REEF_CONFIG?.apiUrl ?? "http://192.168.1.137:8000");

const http = axios.create({
  baseURL,
  timeout: 10000,
  headers: { "Content-Type": "application/json" },
});

// ── Response interceptor — unwrap data, normalise errors ──────────────────

http.interceptors.response.use(
  (res) => res.data,
  (err) => {
    const message =
      err.response?.data?.detail ??
      err.response?.data?.message ??
      err.message ??
      "Unknown error";
    return Promise.reject(new Error(message));
  }
);

// ── Doser endpoints ───────────────────────────────────────────────────────

export const doserApi = {
  // ── Read ─────────────────────────────────────────────────────────────

  getStatus: () =>
    http.get("/doser/status"),

  getSchedule: () =>
    http.get("/doser/schedule"),

  getPumpSchedule: (pumpIndex) =>
    http.get(`/doser/schedule/${pumpIndex}`),

  getLogs: (params = {}) =>
    http.get("/doser/logs", { params }),

  getPumpLogs: (pumpIndex, hours = 24) =>
    http.get(`/doser/logs/${pumpIndex}`, { params: { hours } }),

  getAlerts: (limit = 50) =>
    http.get("/doser/alerts", { params: { limit } }),

  getHistory: (pumpIndex, hours = 24) =>
    http.get(`/doser/history/${pumpIndex}`, { params: { hours } }),

  getRuntime: (pumpIndex, hours = 24) =>
    http.get(`/doser/runtime/${pumpIndex}`, { params: { hours } }),

  // ── Commands ──────────────────────────────────────────────────────────

  clearLogs: (pumpIndex = null, type = "all") => {
    const params = {};
    if (pumpIndex !== null) params.pump_index = pumpIndex;
    if (type === "manual") params.manual = true;
    if (type === "auto") params.manual = false;

    return http.delete("/doser/logs", { params });
  },

  manualDose: (pumpIndex, volumeMl) =>
    http.post("/doser/dose", { pump_index: pumpIndex, volume_ml: volumeMl }),

  clearFault: (pumpIndex) =>
    http.post("/doser/fault/clear", { pump_index: pumpIndex }),

  enableDisable: (pumpIndex, enabled) =>
    http.post("/doser/enable", { pump_index: pumpIndex, enabled }),

  calibrate: (pumpIndex, data) =>
    http.post("/doser/calibrate", { pump_index: pumpIndex, ...data }),

  syncLogs: () =>
    http.post("/doser/logs/sync"),

  // ── Schedule mutations ────────────────────────────────────────────────

  updateInterval: (pumpIndex, intervalMinutes, volumeMl) =>
    http.post("/doser/schedule/interval", {
      pump_index: pumpIndex,
      interval_minutes: intervalMinutes,
      volume_ml: volumeMl,
    }),

  updateWindow: (pumpIndex, startMinutes, endMinutes, restrict) =>
    http.post("/doser/schedule/window", {
      pump_index: pumpIndex,
      start_minutes: startMinutes,
      end_minutes: endMinutes,
      restrict,
    }),

  updateMode: (pumpIndex, mode) =>
    http.post("/doser/schedule/mode", { pump_index: pumpIndex, mode }),

  updateRole: (pumpIndex, role) =>
    http.post("/doser/schedule/role", { pump_index: pumpIndex, role }),

  updateDoses: (pumpIndex, doses) =>
    http.post("/doser/schedule/doses", { pump_index: pumpIndex, doses }),

  updatePumpBulk: (data) =>
    http.post("/doser/schedule/bulk", data),

  getDebugBinary: () =>
    http.get("/doser/schedule/debug/binary"),
};

// ── System endpoints ──────────────────────────────────────────────────────

export const systemApi = {
  getHealth: () => http.get("/system/health"),
};

export default http;
