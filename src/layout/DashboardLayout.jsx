import { useState } from "react";
import { Outlet } from "react-router-dom";
import Navbar from "../components/layout/Navbar";
import Sidebar from "../components/layout/Sidebar";
import CommandPalette from "../components/layout/CommandPalette";
import Breadcrumbs from "../components/layout/Breadcrumbs";

const COLLAPSE_KEY = "hms_sidebar_collapsed";

function readCollapsedPreference() {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

function DashboardLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsedPreference);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        // localStorage unavailable — collapse state just won't persist, non-fatal
      }
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-slate-100">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
      />
      <div className={`transition-[padding] duration-200 ease-standard ${collapsed ? "lg:pl-20" : "lg:pl-72"}`}>
        <Navbar onMenuClick={() => setSidebarOpen(true)} onSearchClick={() => setPaletteOpen(true)} />
        <main className="p-4 sm:p-6">
          <Breadcrumbs />
          <Outlet />
        </main>
      </div>
      <CommandPalette open={paletteOpen} onClose={setPaletteOpen} />
    </div>
  );
}

export default DashboardLayout;
