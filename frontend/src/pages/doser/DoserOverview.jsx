import { useState, useEffect } from "react";
import { useDoserStore, ROLE_NAMES, ROLE_LABELS, PUMP_STATUS, STATUS_LABELS } from "@/store/doserStore";
import { doserApi } from "@/api/http";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import {
  Zap, Droplets, Power, AlertTriangle,
  RefreshCw, Clock, Activity,
} from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────────────────

function statusVariant(status) {
  switch (status) {
    case PUMP_STATUS.RUNNING:  return "running";
    case PUMP_STATUS.FAULT:    return "fault";
    case PUMP_STATUS.DISABLED: return "offline";
    default:                   return "ok";
  }
}

function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60).toString().padStart(2, "0");
  const m = (minutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

// ── Manual dose modal ─────────────────────────────────────────────────────

function ManualDoseModal({ pump, open, onClose }) {
  const [volume, setVolume] = useState("10");
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState(null);

  async function handleDose() {
    const vol = parseFloat(volume);
    if (isNaN(vol) || vol <= 0) {
      setError("Enter a valid volume greater than 0");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await doserApi.manualDose(pump.index, vol);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Manual Dose — ${ROLE_NAMES[pump?.role] ?? `Pump ${pump?.index}`}`}>
      <div className="space-y-4">
        <p className="text-sm text-gray-400">
          Pump {pump?.index} will run until the specified volume is delivered.
        </p>

        <div>
          <label className="section-label block mb-2">Volume (ml)</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={volume}
              onChange={(e) => setVolume(e.target.value)}
              min="0.1"
              step="0.5"
              className={[
                "flex-1 bg-surface-700 border border-surface-600 rounded-xl",
                "px-3 py-2 text-sm text-white placeholder-gray-600",
                "focus:outline-none focus:border-accent transition-colors",
              ].join(" ")}
              placeholder="10.0"
            />
            <span className="text-sm text-gray-500">ml</span>
          </div>
        </div>

        {/* Quick presets */}
        <div className="flex gap-2">
          {[1, 5, 10, 25, 50].map((v) => (
            <button
              key={v}
              onClick={() => setVolume(String(v))}
              className={[
                "flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors",
                String(v) === volume
                  ? "bg-accent-muted text-accent-light border border-accent-dark/40"
                  : "bg-surface-700 text-gray-400 hover:text-white border border-surface-600",
              ].join(" ")}
            >
              {v}ml
            </button>
          ))}
        </div>

        {error && (
          <p className="text-xs text-red-400 bg-red-900/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleDose}
            loading={loading}
            className="flex-1"
          >
            <Droplets size={14} />
            Dose {volume}ml
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Pump card ─────────────────────────────────────────────────────────────

function PumpCard({ pumpIndex }) {
  const liveData      = useDoserStore((s) => s.pumps[String(pumpIndex)]);
  const schedData     = useDoserStore((s) => s.schedule?.pumps?.[String(pumpIndex)]);
  const runtimeSummary = useDoserStore((s) => s.runtimeSummary);
  const fetchRuntime  = useDoserStore((s) => s.fetchRuntimeSummary);

  const pump = { ...liveData, ...schedData, index: pumpIndex };

  const [doseOpen, setDoseOpen] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [syncing,  setSyncing]  = useState(false);

  const isFault   = pump.status === PUMP_STATUS.FAULT;
  const isRunning = pump.status === PUMP_STATUS.RUNNING;
  const runtime   = runtimeSummary[pumpIndex];
  const roleLabel = ROLE_LABELS[pump.role];

  async function toggleEnable() {
    setEnabling(true);
    try {
      await doserApi.enableDisable(pumpIndex, !pump.enabled);
    } catch (e) {
      console.error(e);
    } finally {
      setEnabling(false);
    }
  }

  async function clearFault() {
    setClearing(true);
    try {
      await doserApi.clearFault(pumpIndex);
    } catch (e) {
      console.error(e);
    } finally {
      setClearing(false);
    }
  }

  async function syncLogs() {
    setSyncing(true);
    try {
      await doserApi.syncLogs();
      await fetchRuntime();
    } catch (e) {
      console.error(e);
    } finally {
      setSyncing(false);
    }
  }

  return (
    <>
      <div
        className={[
          "card p-4 transition-all duration-200",
          isFault ? "border-red-800/60 shadow-fault" : "",
        ].join(" ")}
      >
        {/* Card header */}
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="flex items-center gap-2">
              <div
                className={[
                  "w-1.5 h-1.5 rounded-full flex-shrink-0",
                  isRunning ? "bg-accent animate-pulse"            :
                  isFault   ? "bg-status-fault animate-pulse-slow" :
                  pump.enabled ? "bg-status-ok"                    : "bg-status-offline",
                ].join(" ")}
              />
              <h3 className="text-sm font-semibold text-white">
                {ROLE_NAMES[pump.role] ?? `Pump ${pumpIndex}`}
              </h3>
            </div>
            <p className="text-xs text-gray-500 mt-0.5 ml-3.5">
              Pump {pumpIndex}
            </p>
          </div>
          <Badge variant={statusVariant(pump.status)}>
            {isFault && <AlertTriangle size={10} />}
            {STATUS_LABELS[pump.status] ?? "—"}
          </Badge>
        </div>

        {/* Electrical readings */}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="bg-surface-700 rounded-xl p-2.5">
            <div className="flex items-center gap-1 mb-1">
              <Zap size={11} className="text-accent opacity-60" />
              <span className="section-label">Current</span>
            </div>
            <p className="data-value text-base">
              {pump.current_mA > 0 ? `${pump.current_mA.toFixed(0)}` : "—"}
              <span className="text-xs text-gray-500 ml-1">mA</span>
            </p>
          </div>
          <div className="bg-surface-700 rounded-xl p-2.5">
            <div className="flex items-center gap-1 mb-1">
              <Activity size={11} className="text-accent opacity-60" />
              <span className="section-label">24h {roleLabel ?? "volume"}</span>
            </div>
            <p className="data-value text-base">
              {runtime ? `${runtime.total_volume_ml.toFixed(0)}` : "—"}
              <span className="text-xs text-gray-500 ml-1">ml</span>
            </p>
          </div>
        </div>

        {/* Schedule summary */}
        {schedData && (
          <div className="bg-surface-700 rounded-xl p-2.5 mb-3 space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500">Mode</span>
              <span className="text-gray-300">{schedData.schedule_mode}</span>
            </div>
            {schedData.interval_minutes > 0 && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500">Interval</span>
                <span className="text-gray-300">
                  Every {schedData.interval_minutes}m
                </span>
              </div>
            )}
            {schedData.volume_ml > 0 && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500">Volume</span>
                <span className="data-value text-xs">{schedData.volume_ml} ml</span>
              </div>
            )}
            {schedData.restrict_to_window && (
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500 flex items-center gap-1">
                  <Clock size={10} /> Window
                </span>
                <span className="text-gray-300">
                  {minutesToTime(schedData.start_minutes)} – {minutesToTime(schedData.end_minutes)}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          {isFault ? (
            <Button
              variant="danger"
              size="sm"
              onClick={clearFault}
              loading={clearing}
              className="flex-1"
            >
              <AlertTriangle size={13} />
              Clear Fault
            </Button>
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setDoseOpen(true)}
              className="flex-1"
            >
              <Droplets size={13} />
              Manual Dose
            </Button>
          )}

          <Button
            variant="secondary"
            size="sm"
            onClick={toggleEnable}
            loading={enabling}
            className="flex-shrink-0"
          >
            <Power size={13} />
            {pump.enabled ? "Disable" : "Enable"}
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={syncLogs}
            loading={syncing}
            className="flex-shrink-0"
            title="Sync logs from Pico"
          >
            <RefreshCw size={13} />
          </Button>
        </div>
      </div>

      <ManualDoseModal
        pump={pump}
        open={doseOpen}
        onClose={() => setDoseOpen(false)}
      />
    </>
  );
}

// ── Overview page ─────────────────────────────────────────────────────────

export default function DoserOverview() {
  const schedule      = useDoserStore((s) => s.schedule);
  const fetchSchedule = useDoserStore((s) => s.fetchSchedule);
  const fetchRuntime  = useDoserStore((s) => s.fetchRuntimeSummary);

  useEffect(() => {
    if (!schedule) fetchSchedule();
    fetchRuntime();
  }, []);

  const enabledPumps = schedule
    ? Object.entries(schedule.pumps ?? {})
        .map(([idx, cfg]) => ({ index: Number(idx), ...cfg }))
    : [];

  if (!schedule) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      {enabledPumps.length === 0 ? (
        <div className="card p-8 text-center">
          <Droplets size={32} className="text-gray-600 mx-auto mb-3" />
          <p className="text-sm text-gray-400">No pumps enabled</p>
          <p className="text-xs text-gray-600 mt-1">
            Enable pumps in the Schedule tab to see them here
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {enabledPumps.map((p) => (
            <PumpCard key={p.index} pumpIndex={p.index} />
          ))}
        </div>
      )}
    </div>
  );
}
