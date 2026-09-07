import { useState, useEffect, useRef } from "react";
import { useDoserStore, ROLE_NAMES, ROLE_LABELS, readBuffer } from "@/store/doserStore";
import * as ChartJS from "chart.js";
import { doserApi } from "@/api/http";
import { Spinner } from "@/components/ui/Spinner";
import { Button } from "@/components/ui/Button";
import { RefreshCw, Trash2, X } from "lucide-react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";

// ── Constants ─────────────────────────────────────────────────────────────

const PUMP_COLORS = ["#06b6d4", "#10b981", "#f59e0b", "#8b5cf6"];

// ── Helpers ───────────────────────────────────────────────────────────────

function formatTime(ms) {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatTimestamp(isoStr) {
  if (!isoStr) return "—";
  return new Date(isoStr).toLocaleString([], {
    month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function formatDuration(ms) {
  if (!ms) return "—";
  const s = Math.round(ms / 1000);
  return s > 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

function findNearest(hist, t, tolerance) {
  if (!hist.length) return null;
  let lo = 0, hi = hist.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (hist[mid].time < t) lo = mid + 1;
    else hi = mid;
  }
  const candidates = [hist[lo], lo > 0 ? hist[lo - 1] : null].filter(Boolean);
  let nearest = null, nearestDist = Infinity;
  for (const pt of candidates) {
    const dist = Math.abs(pt.time - t);
    if (dist < nearestDist && dist <= tolerance) {
      nearest = pt;
      nearestDist = dist;
    }
  }
  return nearest;
}

function getLogicalTicks(domainStart, domainEnd, timeWindow) {
  const windowMinutes = (timeWindow === "live") ? 60 : Number(timeWindow);

  let intervalMs;
  if (windowMinutes <= 60) {
    intervalMs = 15 * 60 * 1000; // Snap to 15-minute marks
  } else if (windowMinutes <= 1440) {
    intervalMs = 4 * 60 * 60 * 1000; // Snap to 4-hour marks
  } else if (windowMinutes <= 10080) {
    intervalMs = 24 * 60 * 60 * 1000; // Snap to Midnight every day
  } else {
    intervalMs = 5 * 24 * 60 * 60 * 1000; // Snap to 5-day marks
  }

  // Offset by timezone to snap to local wall-clock times
  const offsetMs = new Date().getTimezoneOffset() * 60 * 1000;
  const localStart = domainStart - offsetMs;

  const firstTickLocal = Math.ceil(localStart / intervalMs) * intervalMs;

  const ticks = [];
  for (let t = firstTickLocal; t <= (domainEnd - offsetMs); t += intervalMs) {
    ticks.push(t + offsetMs);
  }

  return ticks.length > 0 ? ticks : [domainStart, domainEnd];
}

// ── Live current draw chart ──────────────────────────────────────────────

function LiveCurrentChart({ displayPumps }) {
  const currentHistory = useDoserStore((s) => s.currentHistory);
  const historyTick    = useDoserStore((s) => s._historyTick);
  const schedule       = useDoserStore((s) => s.schedule);

  const [timeWindow, setTimeWindow] = useState("live");
  const [historicalData, setHistoricalData] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const isLive = timeWindow === "live";
  const canvasRef = useRef(null);
  const chartRef  = useRef(null);

  const timeOptions = [
    { label: "Live", val: "live" },
    { label: "1h",   val: 60 },
    { label: "12h",  val: 720 },
    { label: "24h",  val: 1440 },
    { label: "7d",   val: 10080 },
  ];

  // ── Fetch historical data ───────────────────────────────────────────────
  useEffect(() => {
    if (!isLive) {
      async function fetchHistory() {
        setLoadingHistory(true);
        try {
          const res = await doserApi.getLogs({ hours: timeWindow / 60 });
          setHistoricalData(res.logs ?? []);
        } catch (err) {
          console.error("Failed to fetch historical trends:", err);
        } finally {
          setLoadingHistory(false);
        }
      }
      fetchHistory();
    }
  }, [timeWindow, isLive]);

  // ── Init / reinit Chart.js when switching to live ──────────────────────
  useEffect(() => {
    if (!isLive || !canvasRef.current) return;

    // Destroy existing instance before creating new one
    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    ChartJS.Chart.register(
      ChartJS.LineController,
      ChartJS.LineElement,
      ChartJS.PointElement,
      ChartJS.LinearScale,
      ChartJS.Tooltip,
      ChartJS.Legend,
    );

    const now = Date.now();
    const ctx = canvasRef.current.getContext("2d");

    chartRef.current = new ChartJS.Chart(ctx, {
      type: "line",
      data: {
        datasets: displayPumps.map((p, i) => ({
          label:           ROLE_NAMES[schedule?.pumps?.[String(p.index)]?.role] ?? `Pump ${p.index}`,
          data:            [],
          borderColor:     PUMP_COLORS[i % PUMP_COLORS.length],
          backgroundColor: "transparent",
          borderWidth:     1.5,
          pointRadius:     0,
          tension:         0,
        })),
      },
      options: {
        animation:           false,
        parsing:             false,
        normalized:          true,
        responsive:          true,
        maintainAspectRatio: false,
        interaction:         { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "#1a2235",
            borderColor:     "#2e3a52",
            borderWidth:     1,
            titleColor:      "#9ca3af",
            bodyColor:       "#e5e7eb",
            padding:         8,
            callbacks: {
              title:  (items) => new Date(items[0].parsed.x).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
              label:  (item)  => ` ${item.dataset.label}: ${item.parsed.y?.toFixed(1) ?? 0} mA`,
            },
          },
        },
        scales: {
          x: {
            type: "linear",
            min:  now - 2 * 60 * 1000,
            max:  now,
            ticks: {
              color:         "#6b7280",
              font:          { size: 10 },
              maxTicksLimit: 6,
              callback:      (val) => new Date(val).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            },
            grid:   { color: "#232d42" },
            border: { display: false },
          },
          y: {
            min:         0,
            suggestedMax: 300,
            ticks: {
              color:    "#6b7280",
              font:     { size: 10 },
              callback: (val) => `${val} mA`,
            },
            grid:   { color: "#232d42" },
            border: { display: false },
          },
        },
      },
    });

    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [isLive, displayPumps.map(p => p.index).join(",")]);

  // ── Update live data ────────────────────────────────────────────────────
  useEffect(() => {
    if (!isLive || !chartRef.current) return;

    const now      = Date.now();
    const windowMs = 2 * 60 * 1000;

    // Include one extra point before the window so lines don't clip at left edge
    const bufferMs = 5000;
    displayPumps.forEach((p, i) => {
      const buf     = readBuffer(currentHistory[p.index]);
      const dataset = chartRef.current.data.datasets[i];
      if (dataset) {
        dataset.data = buf
          .filter(pt => pt.time >= now - windowMs - bufferMs)
          .map(pt => ({ x: pt.time, y: pt.current_mA }));
      }
    });

    chartRef.current.options.scales.x.min = now - windowMs;
    chartRef.current.options.scales.x.max = now;
    chartRef.current.update("none");
  }, [historyTick, isLive]);

  // ── Historical data (recharts) ──────────────────────────────────────────
  const { historicalChartData, domainStart, domainEnd } = (() => {
    if (isLive) return { historicalChartData: [], domainStart: 0, domainEnd: 0 };
    const now = Date.now();
    const times = new Set();
    historicalData.forEach(log => {
      const t = new Date(log.time).getTime();
      if (!isNaN(t)) times.add(t);
    });
    const sorted = [...times].sort((a, b) => a - b);
    const pts = sorted.map(t => {
      const pt = { time: t, label: formatTimestamp(t) };
      displayPumps.forEach(p => {
        const match = historicalData.find(l =>
          new Date(l.time).getTime() === t &&
          Number(l.pump_index ?? l.pump) === p.index
        );
        pt[`mA_${p.index}`] = match ? (match.avg_current_mA ?? match.avg_mA ?? null) : null;
      });
      return pt;
    });
    return {
      historicalChartData: pts,
      domainEnd:   now,
      domainStart: now - (timeWindow * 60 * 1000),
    };
  })();

  const calculatedTicks = !isLive ? getLogicalTicks(domainStart, domainEnd, timeWindow) : [];
  const chartData = historicalChartData.length > 0 ? historicalChartData : [
    { time: domainStart, _yAnchor: 240 },
    { time: domainEnd,   _yAnchor: 0 },
  ];

  // ── Shared header ───────────────────────────────────────────────────────
  const header = (
    <div className="flex justify-between items-center mb-2">
      <div className="text-xs text-gray-500">
        {!isLive ? "Long-Term Wear Trends (Avg mA per Dose)" : "Live Telemetry"}
      </div>
      <div className="flex gap-1">
        {timeOptions.map((btn) => (
          <button
            key={btn.label}
            onClick={() => setTimeWindow(btn.val)}
            className={[
              "px-2 py-0.5 rounded text-[10px] font-medium transition-colors border",
              timeWindow === btn.val
                ? "bg-surface-600 text-white border-surface-500"
                : "bg-transparent text-gray-500 border-surface-700 hover:text-gray-400",
            ].join(" ")}
          >
            {btn.label}
          </button>
        ))}
      </div>
    </div>
  );

  if (loadingHistory) {
    return (
      <div className="flex flex-col h-[260px]">
        {header}
        <div className="flex-1 flex items-center justify-center text-sm text-gray-500">
          <Spinner size="sm" className="mr-2" /> Loading historical trends...
        </div>
      </div>
    );
  }

  // Live — Chart.js canvas
  if (isLive) {
    return (
      <div className="flex flex-col">
        {header}
        <div style={{ height: 260, position: "relative" }}>
          <canvas ref={canvasRef} />
        </div>
        <div style={{ display: "flex", justifyContent: "center", gap: "16px", paddingTop: "8px" }}>
          {displayPumps.map((p, i) => {
            const cfg = schedule?.pumps?.[String(p.index)];
            return (
              <div key={p.index} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", backgroundColor: PUMP_COLORS[i % PUMP_COLORS.length] }} />
                <span style={{ color: "#9ca3af", fontSize: "11px" }}>{ROLE_NAMES[cfg?.role] ?? `Pump ${p.index}`}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Historical — recharts
  return (
    <div className="flex flex-col">
      {header}
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#232d42" />
          <XAxis
            dataKey="time"
            type="number"
            domain={[domainStart, domainEnd]}
            ticks={calculatedTicks}
            interval={0}
            tickFormatter={(tick) => {
              const d = new Date(tick);
              if (timeWindow <= 1440) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
              return d.toLocaleDateString([], { month: "short", day: "numeric" });
            }}
            tick={{ fill: "#6b7280", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fill: "#6b7280", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            unit=" mA"
            domain={[0, (dataMax) => Math.ceil(dataMax * 1.1 / 60) * 60]}
          />
          <Tooltip
            contentStyle={{ backgroundColor: "#1a2235", border: "1px solid #2e3a52", borderRadius: "8px", fontSize: "12px" }}
            labelStyle={{ color: "#9ca3af" }}
            formatter={(value, name) => {
              const idx = parseInt(String(name).replace("mA_", ""));
              const cfg = schedule?.pumps?.[String(idx)];
              return [value !== null ? `${Number(value).toFixed(2)} mA` : "0 mA", ROLE_NAMES[cfg?.role] ?? `Pump ${idx}`];
            }}
            labelFormatter={(label) => formatTimestamp(label)}
          />
          <Legend
            wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
            content={({ payload }) => (
              <div style={{ display: "flex", justifyContent: "center", gap: "16px", paddingTop: "8px" }}>
                {payload?.map((entry, i) => {
                  const idx = parseInt(String(entry.dataKey).replace("mA_", ""));
                  const cfg = schedule?.pumps?.[String(idx)];
                  const name = ROLE_NAMES[cfg?.role] ?? `Pump ${idx}`;
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", backgroundColor: entry.color }} />
                      <span style={{ color: "#9ca3af", fontSize: "11px" }}>{name}</span>
                    </div>
                  );
                })}
              </div>
            )}
          />
          {historicalChartData.length === 0 && (
            <Line type="monotone" dataKey="_yAnchor" stroke="transparent" dot={false} activeDot={false} isAnimationActive={false} legendType="none" tooltipType="none" />
          )}
          {displayPumps.map((p, i) => (
            <Line
              key={p.index}
              type="monotone"
              dataKey={`mA_${p.index}`}
              stroke={PUMP_COLORS[i % PUMP_COLORS.length]}
              dot={{ r: 2 }}
              strokeWidth={1.5}
              connectNulls={true}
              isAnimationActive={false}
              name={`mA_${p.index}`}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Dose history table ────────────────────────────────────────────────────

function DoseHistoryTable() {
  const schedule = useDoserStore((s) => s.schedule);
  const [logs,    setLogs]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [hours,   setHours]   = useState(24);

  // --- Deletion State (Inline Tray) ---
  const [clearing, setClearing] = useState(false);
  const [isTrayOpen, setIsTrayOpen] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [pumpsToClear, setPumpsToClear] = useState(new Set());
  const [typeToClear, setTypeToClear] = useState("all");

  // --- Filter States ---
  const [doseType, setDoseType] = useState("all");

  const allPumps = Object.entries(schedule?.pumps ?? {})
    .map(([idx, cfg]) => ({ index: Number(idx), ...cfg }))
    .sort((a, b) => a.index - b.index);

  const [visiblePumps, setVisiblePumps] = useState(() => {
    const initial = new Set();
    Object.keys(schedule?.pumps ?? {}).forEach((k) => initial.add(Number(k)));
    return initial;
  });

  async function fetchLogs() {
    setLoading(true);
    try {
      const data = await doserApi.getLogs({ hours });
      setLogs(data.logs ?? []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchLogs(); }, [hours]);

  // --- Clear Menu Handlers ---
  function handleToggleTray() {
    if (isTrayOpen) {
      setIsTrayOpen(false);
      setConfirmWipe(false);
    } else {
      setPumpsToClear(new Set(visiblePumps));
      setTypeToClear(doseType);
      setIsTrayOpen(true);
    }
  }

  function togglePumpToClear(index) {
    setPumpsToClear((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      setConfirmWipe(false);
      return next;
    });
  }

  function handleWipeClick() {
    if (!confirmWipe) {
      setConfirmWipe(true);
      setTimeout(() => setConfirmWipe(false), 3000);
    } else {
      executeClear();
    }
  }

  async function executeClear() {
    setClearing(true);
    try {
      if (pumpsToClear.size === allPumps.length) {
        await doserApi.clearLogs(null, typeToClear);
      } else {
        for (const pumpIndex of pumpsToClear) {
          await doserApi.clearLogs(pumpIndex, typeToClear);
        }
      }
      await fetchLogs();
    } catch (err) {
      console.error("Failed to clear logs:", err);
    } finally {
      setClearing(false);
      setIsTrayOpen(false);
      setConfirmWipe(false);
    }
  }

  function pumpName(idx) {
    if (idx === undefined || idx === null) return "Unknown Pump";
    const cfg = schedule?.pumps?.[String(idx)];
    return ROLE_NAMES[cfg?.role] ?? `Pump ${idx}`;
  }

  function togglePump(index) {
    setVisiblePumps((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function isManualDose(log) {
    return log.was_manual === "True" || log.was_manual === true || log.manual === true;
  }

  return (
    <div>
      <div className="flex flex-col gap-3 mb-4">
        {/* Top Row: Time filters, Refresh, and Trash */}
        <div className="flex items-center justify-between">
          <div className="flex gap-1.5">
            {[6, 24, 48, 168].map((h) => (
              <button
                key={h}
                onClick={() => setHours(h)}
                className={[
                  "px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border",
                  hours === h
                    ? "bg-accent-muted text-accent-light border-accent-dark/40"
                    : "bg-surface-700 text-gray-400 border-surface-600 hover:text-white",
                ].join(" ")}
              >
                {h === 168 ? "7d" : `${h}h`}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleToggleTray}
              disabled={loading || clearing}
              className={`transition-colors ${isTrayOpen ? "text-status-error bg-status-error/10" : "text-gray-400 hover:text-status-error"}`}
            >
              <Trash2 size={14} />
            </Button>
            <Button variant="ghost" size="sm" onClick={fetchLogs} loading={loading || clearing}>
              <RefreshCw size={13} />
            </Button>
          </div>
        </div>

        {/* Bottom Row: Pump Visibility and Type Toggles */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-gray-500 mr-1">Show:</span>
            {allPumps.map((p) => (
              <button
                key={p.index}
                onClick={() => togglePump(p.index)}
                className={[
                  "px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border",
                  visiblePumps.has(p.index)
                    ? "bg-surface-600 text-white border-surface-500"
                    : "bg-transparent text-gray-500 border-surface-700 hover:text-gray-400",
                ].join(" ")}
              >
                {pumpName(p.index)}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 border-l border-surface-600 pl-4">
            <span className="text-xs text-gray-500 mr-1">Type:</span>
            {["all", "auto", "manual"].map((type) => (
              <button
                key={type}
                onClick={() => setDoseType(type)}
                className={[
                  "px-2.5 py-1 rounded-lg text-xs font-medium transition-colors border capitalize",
                  doseType === type
                    ? "bg-surface-600 text-white border-surface-500"
                    : "bg-transparent text-gray-500 border-surface-700 hover:text-gray-400",
                ].join(" ")}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        {/* --- Inline Clear Logs Tray --- */}
        {isTrayOpen && (
          <div className="bg-[#1a2235] border border-status-error/30 rounded-lg p-3 mt-1 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 animate-fade-in shadow-lg">

            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2 text-status-error pr-2 border-r border-surface-600">
                <Trash2 size={16} />
                <span className="text-sm font-semibold">Wipe Data</span>
              </div>

              {/* Tray Pump Selectors */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-500 mr-1">Pumps:</span>
                {allPumps.map((p) => (
                  <button
                    key={p.index}
                    onClick={() => togglePumpToClear(p.index)}
                    className={[
                      "px-2 py-1 rounded text-[11px] font-medium transition-colors border",
                      pumpsToClear.has(p.index)
                        ? "bg-status-error/20 text-status-error border-status-error/50"
                        : "bg-surface-800 text-gray-500 border-surface-700 hover:border-gray-500 hover:text-gray-300",
                    ].join(" ")}
                  >
                    {pumpName(p.index)}
                  </button>
                ))}
              </div>

              {/* Tray Type Selectors */}
              <div className="flex items-center gap-1.5 border-l border-surface-600 pl-4">
                <span className="text-xs text-gray-500 mr-1">Type:</span>
                {["all", "auto", "manual"].map((type) => (
                  <button
                    key={type}
                    onClick={() => {
                      setTypeToClear(type);
                      setConfirmWipe(false);
                    }}
                    className={[
                      "px-2 py-1 rounded text-[11px] font-medium transition-colors border capitalize",
                      typeToClear === type
                        ? "bg-surface-600 text-white border-surface-500"
                        : "bg-surface-800 text-gray-500 border-surface-700 hover:text-gray-400",
                    ].join(" ")}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleToggleTray}
                className="px-3 py-1.5 rounded text-xs font-medium text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleWipeClick}
                disabled={pumpsToClear.size === 0 || clearing}
                className={[
                  "px-3 py-1.5 rounded text-xs font-medium transition-all shadow-md disabled:opacity-50 min-w-[140px] flex justify-center",
                  confirmWipe
                    ? "bg-status-error text-white shadow-status-error/20"
                    : "bg-surface-700 text-status-error border border-status-error/30 hover:bg-status-error/10"
                ].join(" ")}
              >
                {clearing ? <Spinner size="sm" className="w-3.5 h-3.5" /> : confirmWipe ? "Click to Confirm" : "Wipe Selected Logs"}
              </button>
            </div>
          </div>
        )}
      </div>

      {loading || clearing ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : logs.length === 0 ? (
        <p className="text-sm text-gray-500 text-center py-8">No dose logs in this period</p>
      ) : (
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-surface-600">
                {["Time", "Pump", "Volume", "Duration", "Avg mA", "Type"].map((h) => (
                  <th key={h} className="text-left text-gray-500 font-medium pb-2 pr-4 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-700">
              {logs
                  .filter((log) => (log.volume_ml ?? 0) > 0)
                  .filter((log) => visiblePumps.has(Number(log.pump_index ?? log.pump)))
                  .filter((log) => {
                    if (doseType === "all") return true;
                    const manual = isManualDose(log);
                    return doseType === "manual" ? manual : !manual;
                  })
                  .map((log, i) => (
                <tr key={i} className="hover:bg-surface-700/30 transition-colors">
                  <td className="py-2 pr-4 text-gray-400 whitespace-nowrap">
                    {formatTimestamp(log.time)}
                  </td>
                  <td className="py-2 pr-4 text-white whitespace-nowrap">
                    {pumpName(log.pump_index ?? log.pump)}
                  </td>
                  <td className="py-2 pr-4 font-mono text-accent-light whitespace-nowrap">
                    {(log.volume_ml ?? 0).toFixed(2)} ml
                  </td>
                  <td className="py-2 pr-4 text-gray-400 whitespace-nowrap">
                    {formatDuration(log.duration_ms)}
                  </td>
                  <td className="py-2 pr-4 font-mono text-gray-300 whitespace-nowrap">
                    {(log.avg_current_mA ?? log.avg_mA ?? 0).toFixed(0)} mA
                  </td>
                  <td className="py-2 pr-4">
                    <span className={[
                      "px-1.5 py-0.5 rounded text-xs",
                      isManualDose(log)
                        ? "bg-accent-muted text-accent-light"
                        : "bg-surface-700 text-gray-500",
                    ].join(" ")}>
                      {isManualDose(log) ? "Manual" : "Auto"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── 24h volume summary ────────────────────────────────────────────────────

function VolumeSummary({ displayPumps }) {
  const runtimeSummary  = useDoserStore((s) => s.runtimeSummary);
  const fetchRuntime    = useDoserStore((s) => s.fetchRuntimeSummary);

  useEffect(() => { fetchRuntime(); }, []);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {displayPumps.map((p) => {
        const summary   = runtimeSummary[p.index];
        const roleLabel = ROLE_LABELS[p.role] ?? "dosed";
        return (
          <div key={p.index} className="bg-surface-700 rounded-xl p-3">
            <p className="section-label capitalize mb-1">{roleLabel}</p>
            <p className="data-value text-xl">
              {summary ? summary.total_volume_ml.toFixed(0) : "—"}
              <span className="text-xs text-gray-500 ml-1">ml</span>
            </p>
            <p className="text-xs text-gray-600 mt-0.5">
              {ROLE_NAMES[p.role] ?? `Pump ${p.index}`} · 24h
            </p>
            {summary && (
              <p className="text-xs text-gray-500 mt-0.5">
                {summary.run_count} run{summary.run_count !== 1 ? "s" : ""}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Graphs page ───────────────────────────────────────────────────────────

export default function DoserGraphs() {
  const schedule      = useDoserStore((s) => s.schedule);
  const fetchSchedule = useDoserStore((s) => s.fetchSchedule);

  useEffect(() => {
    if (!schedule) fetchSchedule();
  }, []);

  if (!schedule) {
    return <div className="flex justify-center py-20"><Spinner size="lg" /></div>;
  }

  // --- Show all pumps across components regardless of disabled status ---
  const displayPumps = Object.entries(schedule.pumps ?? {})
    .map(([idx, cfg]) => ({ index: Number(idx), ...cfg }))
    .sort((a, b) => a.index - b.index);

  return (
    <div className="animate-fade-in space-y-6">

      {/* 24h volume summary */}
      <section>
        <h2 className="text-sm font-semibold text-white mb-3">24h Summary</h2>
        <VolumeSummary displayPumps={displayPumps} />
      </section>

      {/* Live current draw */}
      <section className="card p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-white">Live Current Draw</h2>
          <span className="flex items-center gap-1.5 text-xs text-status-ok">
            <span className="w-1.5 h-1.5 rounded-full bg-status-ok animate-pulse-slow" />
            Live
          </span>
        </div>
        <LiveCurrentChart displayPumps={displayPumps} />
      </section>

      {/* Dose history */}
      <section className="card p-4">
        <h2 className="text-sm font-semibold text-white mb-4">Dose History</h2>
        <DoseHistoryTable />
      </section>

    </div>
  );
}