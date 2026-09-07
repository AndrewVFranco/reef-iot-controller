import { NavLink, useLocation } from "react-router-dom";
import { LayoutDashboard, Droplets, Wifi, WifiOff } from "lucide-react";

const NAV_ITEMS = [
  { to: "/",      label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/doser", label: "Doser",     icon: Droplets },
];

const PAGE_TITLES = {
  "/":       "Dashboard",
  "/doser":  "Doser",
};

function getTitle(pathname) {
  // Match longest prefix
  const match = Object.keys(PAGE_TITLES)
    .filter((k) => pathname.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return PAGE_TITLES[match] ?? "Reef Controller";
}

export default function TopBar({ wsConnected }) {
  const { pathname } = useLocation();

  return (
    <>
      {/* Top header — mobile only */}
      <header className="md:hidden flex items-center justify-between px-4 h-14 bg-surface-800 border-b border-surface-600 flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-md bg-accent-muted flex items-center justify-center">
            <Droplets size={13} className="text-accent" />
          </div>
          <span className="font-semibold text-sm">{getTitle(pathname)}</span>
        </div>

        {/* Connection indicator */}
        <div className="flex items-center gap-1.5">
          {wsConnected ? (
            <Wifi size={15} className="text-status-ok" />
          ) : (
            <WifiOff size={15} className="text-status-offline" />
          )}
          <span
            className={[
              "text-xs font-medium",
              wsConnected ? "text-status-ok" : "text-status-offline",
            ].join(" ")}
          >
            {wsConnected ? "Live" : "Offline"}
          </span>
        </div>
      </header>

      {/* Bottom tab bar — mobile only, fixed at bottom */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex bg-surface-800 border-t border-surface-600">
        {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              [
                "flex-1 flex flex-col items-center justify-center gap-1 py-2.5 text-xs font-medium transition-colors tap-target",
                isActive
                  ? "text-accent-light"
                  : "text-gray-500 hover:text-gray-300",
              ].join(" ")
            }
          >
            {({ isActive }) => (
              <>
                <Icon
                  size={20}
                  strokeWidth={isActive ? 2 : 1.75}
                  className={isActive ? "text-accent-light" : ""}
                />
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </>
  );
}
