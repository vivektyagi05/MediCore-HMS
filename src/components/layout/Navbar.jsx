import { useEffect, useRef, useState } from "react";
import { ChevronDown, LogOut, Menu, Search, Settings } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import LiveNotificationCenter from "../realtime/LiveNotificationCenter";
import RealtimeStatusBadge from "../realtime/RealtimeStatusBadge";

// Real routes only — each of these already exists in the nav catalog
// (config/navigation.js) for its role, so the profile menu's "Settings"
// entry never points somewhere fabricated.
const ROLE_SETTINGS_PATH = {
  admin: "/admin/settings",
  super_admin: "/admin/settings",
  doctor: "/doctor/practice-settings",
  patient: "/patient/profile",
};

function ProfileMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const handleKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  const settingsPath = ROLE_SETTINGS_PATH[user?.role];

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2.5 rounded-control px-2 py-1.5 transition hover:bg-slate-100"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-control bg-navy-950 text-sm font-bold text-white">
          {user?.name?.slice(0, 2).toUpperCase() || "HP"}
        </span>
        <span className="hidden text-left sm:block">
          <span className="block text-sm font-bold leading-tight text-slate-950">{user?.name || "HMS User"}</span>
          <span className="block text-xs font-semibold capitalize leading-tight text-slate-500">{user?.role || "member"}</span>
        </span>
        <ChevronDown size={15} className="hidden text-slate-400 sm:block" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-52 overflow-hidden rounded-card border border-slate-200 bg-white shadow-elevated"
        >
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="truncate text-sm font-bold text-slate-950">{user?.name || "HMS User"}</p>
            <p className="truncate text-xs font-semibold capitalize text-slate-500">{user?.role || "member"}</p>
          </div>
          {settingsPath && (
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false);
                navigate(settingsPath);
              }}
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <Settings size={16} />
              Settings
            </button>
          )}
          <button
            role="menuitem"
            onClick={handleLogout}
            className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm font-semibold text-rose-600 transition hover:bg-rose-50"
          >
            <LogOut size={16} />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

function Navbar({ onMenuClick, onSearchClick }) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:px-6">
      <div className="flex items-center gap-3">
        <button
          className="rounded-control p-2.5 text-slate-600 transition hover:bg-slate-100 lg:hidden"
          onClick={onMenuClick}
          aria-label="Open sidebar"
        >
          <Menu size={20} />
        </button>

        <button
          type="button"
          onClick={onSearchClick}
          className="relative flex-1 text-left"
          aria-label="Open search (Ctrl+K)"
        >
          <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
          <span className="block w-full max-w-md truncate rounded-control border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-16 text-sm font-medium text-slate-400 transition hover:border-slate-300 hover:bg-white">
            Search pages...
          </span>
          <span className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-400 sm:flex">
            Ctrl K
          </span>
        </button>

        <div className="flex items-center gap-2">
          <RealtimeStatusBadge />
          <LiveNotificationCenter />
          <div className="h-8 w-px bg-slate-200" aria-hidden="true" />
          <ProfileMenu />
        </div>
      </div>
    </header>
  );
}

export default Navbar;
