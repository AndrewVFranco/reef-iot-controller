import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Droplets,
  Wifi,
  WifiOff,
} from "lucide-react";

const NAV_ITEMS = [
  { to: "/",       label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/doser",  label: "Doser",     icon: Droplets },
];

function NavItem({ to, label, icon: Icon, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        [
          "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150",
          isActive
            ? "bg-accent-muted text-accent-light shadow-glow"
            : "text-gray-400 hover:text-white hover:bg-surface-700",
        ].join(" ")
      }
    >
      <Icon size={18} strokeWidth={1.75} />
      <span>{label}</span>
    </NavLink>
  );
}

export default function Sidebar({ wsConnected }) {
  return (
    <aside className="hidden md:flex flex-col w-56 flex-shrink-0 bg-surface-800 border-r border-surface-600">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 h-16 border-b border-surface-600 flex-shrink-0">
        <div className="w-7 h-7 rounded-lg bg-accent-muted flex items-center justify-center">
          <Droplets size={15} className="text-accent" />
        </div>
        <span className="font-semibold text-sm tracking-wide">
          Reef Controller
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto scrollbar-thin">
        <p className="section-label px-3 mb-3">Navigation</p>
        {NAV_ITEMS.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
      </nav>

      {/* Connection status */}
      <div className="px-4 py-4 border-t border-surface-600 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div
            className={[
              "w-2 h-2 rounded-full flex-shrink-0",
              wsConnected
                ? "bg-status-ok animate-pulse-slow"
                : "bg-status-offline",
            ].join(" ")}
          />
          {wsConnected ? (
            <Wifi size={13} className="text-status-ok flex-shrink-0" />
          ) : (
            <WifiOff size={13} className="text-status-offline flex-shrink-0" />
          )}
          <span
            className={[
              "text-xs font-medium",
              wsConnected ? "text-status-ok" : "text-status-offline",
            ].join(" ")}
          >
            {wsConnected ? "Connected" : "Reconnecting…"}
          </span>
        </div>
      </div>
    </aside>
  );
}
