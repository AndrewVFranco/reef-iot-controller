import { useState, useEffect, useMemo } from "react";
import { useDoserStore, ROLE_NAMES } from "@/store/doserStore";
import { doserApi } from "@/api/http";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Spinner } from "@/components/ui/Spinner";
import { Clock, Save, ChevronDown, ChevronUp, Plus, Trash2, CheckCircle, AlertTriangle } from "lucide-react";

// ── Constants ─────────────────────────────────────────────────────────────

const ROLES = ["AWC_OUT", "AWC_IN", "ATO", "DOSER", "DISABLED"];
const MODES = ["INTERVAL", "SCHEDULED", "BOTH"];

// ── Helpers ───────────────────────────────────────────────────────────────

function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60).toString().padStart(2, "0");
  const m = (minutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

function timeToMinutes(timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

// ── Shared input styles ───────────────────────────────────────────────────

const inputCls = [
  "w-full bg-surface-700 border border-surface-600 rounded-xl",
  "px-3 py-2 text-sm text-white",
  "focus:outline-none focus:border-accent transition-colors",
].join(" ");

const selectCls = [
  "w-full bg-surface-700 border border-surface-600 rounded-xl",
  "px-3 py-2 text-sm text-white appearance-none",
  "focus:outline-none focus:border-accent transition-colors",
].join(" ");

// ── ACK status indicator ──────────────────────────────────────────────────

function AckStatus({ status }) {
  if (!status) return null;

  if (status === "pending") {
    return (
      <div className="flex items-center gap-2 justify-center py-2 text-xs text-gray-400">
        <Spinner size="sm" />
        Waiting for Pico confirmation…
      </div>
    );
  }

  if (status === "ok") {
    return (
      <div className="flex items-center gap-2 justify-center py-2 text-xs text-status-ok animate-fade-in">
        <CheckCircle size={13} />
        Schedule confirmed by Pico
      </div>
    );
  }

  if (status === "timeout") {
    return (
      <div className="flex items-center gap-2 justify-center py-2 text-xs text-status-fault animate-fade-in">
        <AlertTriangle size={13} />
        No confirmation received — Pico may be offline
      </div>
    );
  }

  return null;
}

// ── 24-Hour Timeline Visualizer ───────────────────────────────────────────

function TimelineVisualizer({ mode, doses, intervalMinutes, volumeMl, restrict, startMin, endMin }) {
  const points = useMemo(() => {
    const pts = [];

    if (mode === "SCHEDULED" || mode === "BOTH") {
      doses.forEach((d) => {
        pts.push({
          timeStr: d.time,
          minutes: timeToMinutes(d.time),
          volume: Number(d.volume),
          type: "scheduled",
        });
      });
    }

    if ((mode === "INTERVAL" || mode === "BOTH") && Number(intervalMinutes) > 0) {
      const start = restrict ? Number(startMin) : 0;
      const end   = restrict ? Number(endMin)   : 1440;
      const step  = Math.max(Number(intervalMinutes), 1);

      for (let m = start; m <= end; m += step) {
        if (mode === "BOTH" && pts.some(p => p.type === "scheduled" && p.minutes === m)) continue;
        pts.push({
          timeStr: minutesToTime(m),
          minutes: m,
          volume: Number(volumeMl),
          type: "interval",
        });
      }
    }

    return pts.sort((a, b) => a.minutes - b.minutes);
  }, [mode, doses, intervalMinutes, volumeMl, restrict, startMin, endMin]);

  const axisHours = [0, 4, 8, 12, 16, 20, 24];

  return (
    <div className="mt-4 bg-surface-900/50 rounded-xl p-4 border border-surface-600">
      <div className="flex justify-between items-center mb-6">
        <p className="text-xs text-gray-400 font-medium">Daily Projection</p>
        <p className="text-[10px] text-gray-500">
          <span className="inline-block w-2 h-2 bg-accent rounded-sm mr-1" /> Scheduled
          <span className="inline-block w-2 h-2 bg-blue-400/60 rounded-sm ml-3 mr-1" /> Interval
        </p>
      </div>

      <div className="relative w-full h-16">
        <div className="absolute top-1/2 left-0 w-full h-[1px] bg-surface-500 -translate-y-1/2" />

        {axisHours.map((h) => (
          <div
            key={h}
            className="absolute top-1/2 -translate-y-1/2 flex flex-col items-center"
            style={{ left: `${(h / 24) * 100}%` }}
          >
            <div className="h-2 w-[1px] bg-surface-400" />
            <span className="absolute top-4 text-[9px] text-gray-500 font-mono">
              {h === 0 || h === 24 ? "12A" : h < 12 ? `${h}A` : h === 12 ? "12P" : `${h - 12}P`}
            </span>
          </div>
        ))}

        {points.map((pt, i) => {
          const isScheduled = pt.type === "scheduled";
          return (
            <div
              key={i}
              className="absolute bottom-1/2 group cursor-crosshair z-10"
              style={{ left: `${(pt.minutes / 1440) * 100}%` }}
            >
              <div
                className={`w-0.5 rounded-t-sm origin-bottom transition-all transform -translate-x-1/2 ${
                  isScheduled ? "bg-accent h-6" : "bg-blue-400/60 h-4"
                } hover:h-8 hover:bg-white`}
              />
              <div className="opacity-0 group-hover:opacity-100 absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-surface-700 text-[10px] font-mono text-white px-2 py-1 rounded shadow-lg whitespace-nowrap border border-surface-500 pointer-events-none transition-opacity">
                {pt.timeStr} • {pt.volume}ml
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 text-center">
        <p className="text-[11px] text-gray-400">
          Total Daily Volume:{" "}
          <span className="text-accent font-mono ml-1">
            {points.reduce((acc, curr) => acc + curr.volume, 0).toFixed(1)} ml
          </span>
        </p>
      </div>
    </div>
  );
}

// ── Pump schedule editor ──────────────────────────────────────────────────

function PumpScheduleEditor({ pumpIndex }) {
  const schedData          = useDoserStore((s) => s.schedule?.pumps?.[String(pumpIndex)]);
  const fetchSchedule      = useDoserStore((s) => s.fetchSchedule);
  const scheduleAckStatus  = useDoserStore((s) => s.scheduleAckStatus);
  const setAckPending      = useDoserStore((s) => s.setScheduleAckPending);

  const [expanded, setExpanded] = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [error,    setError]    = useState(null);

  const [role,            setRole]            = useState(schedData?.role               ?? "DISABLED");
  const [mode,            setMode]            = useState(schedData?.schedule_mode      ?? "INTERVAL");
  const [intervalMinutes, setIntervalMinutes] = useState(schedData?.interval_minutes   ?? 60);
  const [volumeMl,        setVolumeMl]        = useState(schedData?.volume_ml          ?? 1.0);
  const [restrict,        setRestrict]        = useState(schedData?.restrict_to_window ?? false);
  const [startTime,       setStartTime]       = useState(minutesToTime(schedData?.start_minutes ?? 480));
  const [endTime,         setEndTime]         = useState(minutesToTime(schedData?.end_minutes   ?? 1320));
  const [enabled,         setEnabled]         = useState(schedData?.enabled            ?? false);

  const [doses, setDoses] = useState(() =>
    (schedData?.scheduled_doses || []).map(d => ({
      time:   minutesToTime(d.time_minutesSinceMidnight),
      volume: d.volume_ml,
    }))
  );

  const [newDoseTime, setNewDoseTime] = useState("08:00");
  const [newDoseVol,  setNewDoseVol]  = useState(1.0);

  useEffect(() => {
    if (!schedData) return;
    setRole(schedData.role);
    setMode(schedData.schedule_mode);
    setIntervalMinutes(schedData.interval_minutes);
    setVolumeMl(schedData.volume_ml);
    setRestrict(schedData.restrict_to_window);
    setStartTime(minutesToTime(schedData.start_minutes));
    setEndTime(minutesToTime(schedData.end_minutes));
    setEnabled(schedData.enabled);
    setDoses((schedData.scheduled_doses || []).map(d => ({
      time:   minutesToTime(d.time_minutesSinceMidnight),
      volume: d.volume_ml,
    })));
  }, [schedData]);

  const handleAddDose = () => {
    if (doses.length >= 24) {
      setError("Maximum of 24 scheduled doses allowed per pump.");
      return;
    }
    if (Number(newDoseVol) <= 0) {
      setError("Dose volume must be greater than 0.");
      return;
    }
    const newDoses = [...doses, { time: newDoseTime, volume: Number(newDoseVol) }]
      .sort((a, b) => timeToMinutes(a.time) - timeToMinutes(b.time));
    setDoses(newDoses);
    setError(null);
  };

  const handleRemoveDose = (indexToRemove) => {
    setDoses(doses.filter((_, idx) => idx !== indexToRemove));
  };

  async function handleSave() {
    setError(null);
    setSaving(true);

    const startMin = timeToMinutes(startTime);
    const endMin   = timeToMinutes(endTime);

    if (restrict && startMin >= endMin) {
      setError("Start time must be before end time");
      setSaving(false);
      return;
    }
    if (mode !== "SCHEDULED" && Number(volumeMl) <= 0) {
      setError("Interval volume must be greater than 0");
      setSaving(false);
      return;
    }

    try {
      const formattedDoses = doses.map(d => ({
        time_minutesSinceMidnight: timeToMinutes(d.time),
        volume_ml: Number(d.volume),
        enabled: true,
      }));

      // Mark ACK as pending before publishing
      setAckPending();

      await doserApi.updatePumpBulk({
        pump_index:       pumpIndex,
        role,
        mode,
        interval_minutes: Number(intervalMinutes),
        volume_ml:        Number(volumeMl),
        start_minutes:    startMin,
        end_minutes:      endMin,
        restrict,
        enabled,
        doses:            formattedDoses,
      });

      await fetchSchedule();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);

    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const isDisabled  = role === "DISABLED";
  const showInterval  = mode === "INTERVAL" || mode === "BOTH";
  const showScheduled = mode === "SCHEDULED" || mode === "BOTH";

  return (
    <div className="card overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3.5 hover:bg-surface-700/50 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={[
              "w-1.5 h-1.5 rounded-full flex-shrink-0",
              enabled && !isDisabled ? "bg-status-ok" : "bg-status-offline",
            ].join(" ")}
          />
          <div className="text-left min-w-0">
            <p className="text-sm font-semibold text-white truncate">
              {ROLE_NAMES[role] ?? `Pump ${pumpIndex}`}
            </p>
            <p className="text-xs text-gray-500 mt-0.5 truncate">
              Pump {pumpIndex}
              {!isDisabled && mode !== "SCHEDULED" && intervalMinutes > 0 && ` · Every ${intervalMinutes}m`}
              {!isDisabled && mode !== "INTERVAL"  && doses.length > 0    && ` · ${doses.length} doses/day`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Badge variant={enabled && !isDisabled ? "ok" : "offline"}>
            {enabled && !isDisabled ? "Enabled" : "Disabled"}
          </Badge>
          {expanded
            ? <ChevronUp size={15} className="text-gray-500" />
            : <ChevronDown size={15} className="text-gray-500" />
          }
        </div>
      </button>

      {/* Expanded editor */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-surface-600 animate-fade-in">
          <div className="pt-4 space-y-6">

            {/* Enable toggle */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-white">Enabled</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Pump will run on schedule when enabled
                </p>
              </div>
              <button
                onClick={() => setEnabled((v) => !v)}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  enabled ? "bg-accent" : "bg-surface-600"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    enabled ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            {/* Role & Mode — stacked on mobile, side by side on sm+ */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="section-label block mb-2 text-xs text-gray-400">Role</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className={selectCls}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{ROLE_NAMES[r] ?? r}</option>
                  ))}
                </select>
              </div>
              {!isDisabled && (
                <div>
                  <label className="section-label block mb-2 text-xs text-gray-400">Mode</label>
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value)}
                    className={selectCls}
                  >
                    {MODES.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {!isDisabled && (
              <>
                {/* Interval config */}
                {showInterval && (
                  <div className="p-3 bg-surface-800/50 rounded-xl border border-surface-600">
                    <p className="text-sm font-medium text-white mb-3">Interval Settings</p>
                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div>
                        <label className="section-label block mb-1.5 text-xs">Interval (min)</label>
                        <input
                          type="number"
                          value={intervalMinutes}
                          onChange={(e) => setIntervalMinutes(e.target.value)}
                          min="1"
                          className={inputCls}
                        />
                      </div>
                      <div>
                        <label className="section-label block mb-1.5 text-xs">Volume (ml)</label>
                        <input
                          type="number"
                          value={volumeMl}
                          onChange={(e) => setVolumeMl(e.target.value)}
                          min="0.1"
                          step="0.1"
                          className={inputCls}
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between mb-2 mt-4">
                      <label className="section-label flex items-center gap-1.5 text-xs">
                        <Clock size={11} /> Restrict to Time Window
                      </label>
                      <button
                        onClick={() => setRestrict((v) => !v)}
                        className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                          restrict ? "bg-accent" : "bg-surface-600"
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                            restrict ? "translate-x-4" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </div>

                    {restrict && (
                      <div className="grid grid-cols-2 gap-3 animate-fade-in">
                        <div>
                          <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={inputCls} />
                        </div>
                        <div>
                          <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className={inputCls} />
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Scheduled doses config */}
                {showScheduled && (
                  <div className="p-3 bg-surface-800/50 rounded-xl border border-surface-600">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-sm font-medium text-white">Scheduled Timeline</p>
                      <Badge variant="neutral">{doses.length} / 24 Doses</Badge>
                    </div>

                    <div className="space-y-2 mb-4 max-h-48 overflow-y-auto pr-1 scrollbar-thin">
                      {doses.length === 0 ? (
                        <p className="text-xs text-gray-500 text-center py-2">No doses scheduled yet.</p>
                      ) : (
                        doses.map((dose, idx) => (
                          <div key={idx} className="flex items-center justify-between bg-surface-700 p-2 rounded-lg border border-surface-600">
                            <div className="flex gap-4 px-2">
                              <span className="text-sm text-white font-mono">{dose.time}</span>
                              <span className="text-sm text-accent">{dose.volume} ml</span>
                            </div>
                            <button onClick={() => handleRemoveDose(idx)} className="text-gray-500 hover:text-red-400 p-1 transition-colors tap-target">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))
                      )}
                    </div>

                    {doses.length < 24 && (
                      <div className="flex gap-2 items-end pt-2 border-t border-surface-600">
                        <div className="flex-1 min-w-0">
                          <label className="text-xs text-gray-400 mb-1 block">Time</label>
                          <input type="time" value={newDoseTime} onChange={(e) => setNewDoseTime(e.target.value)} className={inputCls} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <label className="text-xs text-gray-400 mb-1 block">Volume (ml)</label>
                          <input type="number" step="0.1" min="0.1" value={newDoseVol} onChange={(e) => setNewDoseVol(e.target.value)} className={inputCls} />
                        </div>
                        <Button variant="secondary" onClick={handleAddDose} className="mb-[1px] flex-shrink-0">
                          <Plus size={16} />
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                <TimelineVisualizer
                  mode={mode}
                  doses={doses}
                  intervalMinutes={intervalMinutes}
                  volumeMl={volumeMl}
                  restrict={restrict}
                  startMin={timeToMinutes(startTime)}
                  endMin={timeToMinutes(endTime)}
                />
              </>
            )}

            {error && (
              <p className="text-xs text-red-400 bg-red-900/20 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <Button
              variant={saved ? "secondary" : "primary"}
              onClick={handleSave}
              loading={saving}
              className="w-full"
            >
              <Save size={14} />
              {saved ? "Saved ✓" : "Save Settings"}
            </Button>

            {/* ACK status — only shown for this pump's expanded editor */}
            <AckStatus status={expanded ? scheduleAckStatus : null} />

          </div>
        </div>
      )}
    </div>
  );
}

// ── Schedule page ─────────────────────────────────────────────────────────

export default function DoserSchedule() {
  const schedule      = useDoserStore((s) => s.schedule);
  const fetchSchedule = useDoserStore((s) => s.fetchSchedule);

  useEffect(() => {
    if (!schedule) fetchSchedule();
  }, []);

  if (!schedule) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-3">
      <p className="text-sm text-gray-400 mb-4">
        Tap a pump to expand its schedule settings.
      </p>
      {[0, 1, 2, 3].map((i) => (
        <PumpScheduleEditor key={i} pumpIndex={i} />
      ))}
    </div>
  );
}