import { NavLink, Routes, Route, Navigate, useMatch } from "react-router-dom";
import { useDoserStore } from "@/store/doserStore";
import { Badge } from "@/components/ui/Badge";
import { LayoutGrid, Calendar, Gauge, BarChart2 } from "lucide-react";
import DoserOverview  from "./DoserOverview";
import DoserSchedule  from "./DoserSchedule";
import DoserCalibrate from "./DoserCalibrate";
import DoserGraphs    from "./DoserGraphs";

const TABS = [
  { to: "",          label: "Overview",  icon: LayoutGrid, end: true },
  { to: "schedule",  label: "Schedule",  icon: Calendar },
  { to: "calibrate", label: "Calibrate", icon: Gauge },
  { to: "graphs",    label: "Graphs",    icon: BarChart2 },
];

export default function DoserPage() {
  const connection  = useDoserStore((s) => s.connection);
  const getEnabled  = useDoserStore((s) => s.getEnabledPumps);
  const getPump     = useDoserStore((s) => s.getPump);
  const match       = useMatch("/doser/*");
  const basePath    = match?.pathnameBase ?? "/doser";

  const activeFaults = getEnabled().filter(
    (p) => getPump(p.index).status === 2
  ).length;

  return (
    <div className="animate-fade-in">
      {/* Page header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-white">Doser</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            4-head peristaltic pump controller
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeFaults > 0 && (
            <Badge variant="fault">
              {activeFaults} fault{activeFaults > 1 ? "s" : ""}
            </Badge>
          )}
          <Badge variant={connection.pico_connected ? "ok" : "offline"}>
            {connection.pico_connected ? "Online" : "Offline"}
          </Badge>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-surface-800 p-1 rounded-xl border border-surface-600 mb-6 overflow-x-auto scrollbar-thin">
        {TABS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={`${basePath}${to ? `/${to}` : ""}`}
            end={end}
            className={({ isActive }) =>
              [
                "flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium",
                "transition-all duration-150 whitespace-nowrap flex-shrink-0",
                isActive
                  ? "bg-surface-700 text-white shadow-sm"
                  : "text-gray-500 hover:text-gray-300",
              ].join(" ")
            }
          >
            <Icon size={15} strokeWidth={1.75} />
            {label}
          </NavLink>
        ))}
      </div>

      {/* Tab content */}
      <Routes>
        <Route index                  element={<DoserOverview />} />
        <Route path="schedule"        element={<DoserSchedule />} />
        <Route path="calibrate"       element={<DoserCalibrate />} />
        <Route path="graphs"          element={<DoserGraphs />} />
        <Route path="*"               element={<Navigate to="" replace />} />
      </Routes>
    </div>
  );
}
