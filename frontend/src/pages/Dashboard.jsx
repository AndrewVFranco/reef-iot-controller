import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useDoserStore, ROLE_LABELS } from "@/store/doserStore";
import { Badge } from "@/components/ui/Badge";
import { PumpRow } from "@/components/doser/PumpRow";
import { Spinner } from "@/components/ui/Spinner";
import { Droplets, ChevronRight, Clock, AlertTriangle } from "lucide-react";

function formatUptime(ms) {
  if (!ms) return "—";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatTime(isoStr) {
  if (!isoStr) return "—";
  return new Date(isoStr).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Doser device card ─────────────────────────────────────────────────────

function DoserCard() {
  const navigate    = useNavigate();
  const connection  = useDoserStore((s) => s.connection);
  const schedule    = useDoserStore((s) => s.schedule);
  const runtimeSummary = useDoserStore((s) => s.runtimeSummary);
  const alerts      = useDoserStore((s) => s.alerts);
  const getPump     = useDoserStore((s) => s.getPump);
  const getEnabled  = useDoserStore((s) => s.getEnabledPumps);
  const fetchRuntime = useDoserStore((s) => s.fetchRuntimeSummary);

  useEffect(() => {
    fetchRuntime();
  }, [fetchRuntime]);

  const enabledPumps = useMemo(() => getEnabled(), [schedule]);
  const pumpData = useMemo(
    () => enabledPumps.map((p) => ({ ...p, ...getPump(p.index) })),
    [enabledPumps, getPump]
  );
  const activeFaults = useMemo(
    () => pumpData.filter((p) => p.status === 2),
    [pumpData]
  );
  const recentAlert = alerts[0];

  return (
    <div
      onClick={() => navigate("/doser")}
      className={[
        "card p-5 cursor-pointer transition-all duration-200",
        "hover:border-accent/40 hover:shadow-glow",
        activeFaults.length > 0 ? "border-red-800/60 shadow-fault" : "",
      ].join(" ")}
    >
      {/* Card header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-accent-muted flex items-center justify-center flex-shrink-0">
            <Droplets size={18} className="text-accent" />
          </div>
          <div>
            <h2 className="font-semibold text-white text-sm">Doser</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              4-head peristaltic
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {activeFaults.length > 0 && (
            <Badge variant="fault">
              <AlertTriangle size={10} />
              {activeFaults.length} fault{activeFaults.length > 1 ? "s" : ""}
            </Badge>
          )}
          <Badge variant={connection.pico_connected ? "ok" : "offline"}>
            {connection.pico_connected ? "Online" : "Offline"}
          </Badge>
          <ChevronRight size={15} className="text-gray-600" />
        </div>
      </div>

      {/* Pump rows */}
      {!schedule ? (
        <div className="flex items-center justify-center py-6">
          <Spinner size="sm" />
        </div>
      ) : enabledPumps.length === 0 ? (
        <p className="text-xs text-gray-500 text-center py-4">
          No pumps enabled
        </p>
      ) : (
        <div className="divide-y divide-surface-600">
          {pumpData.map((p) => (
            <PumpRow
              key={p.index}
              pump={p}
              compact
            />
          ))}
        </div>
      )}

      {/* 24h volume summary */}
      {Object.keys(runtimeSummary).length > 0 && enabledPumps.length > 0 && (
        <div className="mt-4 pt-4 border-t border-surface-600 grid grid-cols-2 gap-2">
          {enabledPumps
            .filter((p) => ROLE_LABELS[p.role])
            .map((p) => {
              const summary = runtimeSummary[p.index];
              const label   = ROLE_LABELS[p.role];
              return (
                <div key={p.index} className="bg-surface-700 rounded-xl p-2.5">
                  <p className="text-xs text-gray-500 capitalize">{label} (24h)</p>
                  <p className="data-value text-sm mt-0.5">
                    {summary
                      ? `${summary.total_volume_ml.toFixed(0)} ml`
                      : "—"}
                  </p>
                </div>
              );
            })}
        </div>
      )}

      {/* Footer — uptime + last alert */}
      <div className="mt-4 pt-4 border-t border-surface-600 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-gray-500">
          <Clock size={11} />
          <span>Uptime {formatUptime(connection.last_heartbeat_ms)}</span>
        </div>
        {recentAlert && (
          <p className="text-xs text-amber-500 truncate max-w-[180px]">
            ⚠ {recentAlert.type ?? "Alert"} — pump {recentAlert.pump}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────

export default function Dashboard() {
  return (
    <div className="animate-fade-in">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">
          Live system overview
        </p>
      </div>

      {/* Device card grid — 1 col mobile, 2 col md+, 3 col xl+ */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <DoserCard />
        {/* Future devices mount here as additional cards */}
      </div>
    </div>
  );
}