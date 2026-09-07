import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useWebSocket } from "@/hooks/useWebSocket";
import Sidebar from "@/components/layout/Sidebar";
import TopBar from "@/components/layout/TopBar";
import Dashboard from "@/pages/Dashboard";
import DoserPage from "@/pages/doser/DoserPage";

function AppShell() {
  const wsConnected = useWebSocket();

  return (
    <div className="flex h-dvh overflow-hidden bg-surface-900">
      {/* Sidebar — hidden on mobile, shown on md+ */}
      <Sidebar wsConnected={wsConnected} />

      {/* Main content area */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* TopBar — shown on mobile only */}
        <TopBar wsConnected={wsConnected} />

        {/* Page content */}
        <main className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="max-w-7xl mx-auto px-4 py-6 md:px-6 lg:px-8">
            <Routes>
              <Route path="/"            element={<Dashboard />} />
              <Route path="/doser/*"     element={<DoserPage />} />
              <Route path="*"            element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </main>

        {/* Mobile bottom nav spacer */}
        <div className="h-16 md:hidden flex-shrink-0" />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}
