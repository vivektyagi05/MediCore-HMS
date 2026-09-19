import { useEffect, useMemo, useState } from "react";
import { ChevronsLeft, ChevronsRight, X } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useI18n } from "../../i18n/I18nContext";
import { buildNavigation, GROUP_ORDER } from "../../config/navigation";
import { adminApi } from "../../api/adminApi";
import Tooltip from "../ui/Tooltip";

// BUGFIX (kept): buildNavigation used to live here as a module-level
// const navigation = [...] that called t("...") at import time, before any
// component rendered and without this file even importing useI18n. That
// threw ReferenceError: t is not defined immediately on import and crashed
// every /admin, /doctor, and /patient route via DashboardLayout. It now
// lives in src/config/navigation.js as a function that takes t() as a
// parameter, so the new Command Palette can reuse the same list instead of
// maintaining a second copy that would drift out of sync.

// BUGFIX (Phase A5.1): this panel used to show a hardcoded
// "98% uptime across hospital services" bar for every role, on every page,
// forever — a fabricated number that never reflected anything real. It now
// only renders for admin/super_admin (the only roles with access to the
// underlying data) and shows the real, computed database/socket status
// from the new Mission Control endpoint. It is hidden for doctor/patient
// roles rather than shown with fake numbers.
function SystemHealthPanel({ collapsed }) {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .getMissionControl()
      .then((response) => {
        if (!cancelled) setStatus(response.data?.system || null);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const healthy = Boolean(status?.database?.healthy && status?.socket?.healthy);

  if (collapsed) {
    return (
      <div className="mx-auto mb-4 flex justify-center">
        <Tooltip
          label={
            status
              ? `Database ${status.database?.state || "unknown"} · ${status.socket?.connectedClients ?? 0} realtime clients`
              : "Checking system status…"
          }
        >
          <span
            className={`h-2.5 w-2.5 rounded-full ${healthy ? "bg-emerald-400" : "bg-rose-400"}`}
            aria-label="System health"
          />
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="m-4 rounded-card border border-white/10 bg-white/5 p-4">
      <p className="text-sm font-bold">System Health</p>
      <div className="mt-4 h-2 rounded-full bg-white/10">
        <div className={`h-2 rounded-full ${healthy ? "w-4/5 bg-royal-500" : "w-1/5 bg-rose-500"}`} />
      </div>
      <p className="mt-3 text-xs font-medium text-slate-400">
        {status
          ? `Database ${status.database?.state || "unknown"} · ${status.socket?.connectedClients ?? 0} realtime clients`
          : "Checking system status…"}
      </p>
    </div>
  );
}

function Sidebar({ isOpen, onClose, collapsed = false, onToggleCollapsed }) {
  const { t } = useI18n();
  const navigation = buildNavigation(t);
  const role = JSON.parse(localStorage.getItem("hms_user") || "null")?.role;
  const visibleNavigation = navigation.filter((item) => item.roles.includes(role));
  const isAdmin = role === "super_admin";

  // Group role-visible items by their configured group, preserving
  // GROUP_ORDER and skipping any group with no visible items for this role
  // (e.g. patients never see an "Operations" section).
  const groupedNavigation = useMemo(() => {
    return GROUP_ORDER.map((groupName) => ({
      name: groupName,
      items: visibleNavigation.filter((item) => item.group === groupName),
    })).filter((section) => section.items.length > 0);
  }, [visibleNavigation]);

  const widthClass = collapsed ? "lg:w-20" : "lg:w-72";

  return (
    <>
      <div
        className={`fixed inset-0 z-30 bg-navy-950/60 transition lg:hidden ${isOpen ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={onClose}
      />

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col bg-navy-950 text-white shadow-2xl transition-[transform,width] duration-200 ease-standard lg:translate-x-0 ${widthClass} ${isOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex h-16 items-center justify-between gap-2 border-b border-white/10 px-4">
          <NavLink to="/" className="flex min-w-0 items-center gap-3" onClick={onClose}>
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-royal-600 text-sm font-black shadow-sm">
              HP
            </span>
            {!collapsed && (
              <span className="min-w-0">
                <p className="truncate text-base font-bold tracking-tight">HMS Pro</p>
                <p className="truncate text-xs font-medium text-slate-400">Clinical Command</p>
              </span>
            )}
          </NavLink>

          <button
            className="rounded-control p-2 text-slate-400 transition hover:bg-white/10 hover:text-white lg:hidden"
            onClick={onClose}
            aria-label="Close sidebar"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-5" aria-label="Primary">
          {groupedNavigation.map((section) => (
            <div key={section.name}>
              {!collapsed && (
                <p className="mb-1.5 px-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  {section.name}
                </p>
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const link = (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      onClick={onClose}
                      title={collapsed ? item.name : undefined}
                      className={({ isActive }) =>
                        `flex items-center gap-3 rounded-control px-3 py-2.5 text-sm font-semibold transition duration-150 ease-standard ${
                          collapsed ? "justify-center" : ""
                        } ${
                          isActive
                            ? item.primary
                              ? "bg-royal-600 text-white shadow-sm"
                              : "bg-white/10 text-white"
                            : "text-slate-300 hover:bg-white/5 hover:text-white"
                        } ${item.primary && !collapsed ? "font-bold" : ""}`
                      }
                    >
                      <item.icon size={18} className="shrink-0" />
                      {!collapsed && <span className="truncate">{item.name}</span>}
                    </NavLink>
                  );

                  return collapsed ? (
                    <Tooltip key={item.path} label={item.name}>
                      {link}
                    </Tooltip>
                  ) : (
                    link
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {isAdmin && <SystemHealthPanel collapsed={collapsed} />}

        <button
          onClick={onToggleCollapsed}
          className="hidden items-center justify-center gap-2 border-t border-white/10 px-4 py-3 text-xs font-semibold text-slate-400 transition hover:bg-white/5 hover:text-white lg:flex"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
          {!collapsed && "Collapse"}
        </button>
      </aside>
    </>
  );
}

export default Sidebar;
