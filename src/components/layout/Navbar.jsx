import { LogOut, Menu, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import LiveNotificationCenter from "../realtime/LiveNotificationCenter";
import RealtimeStatusBadge from "../realtime/RealtimeStatusBadge";

function Navbar({ onMenuClick }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login", { replace: true });
  };

  return (
    <header className="sticky top-0 z-20 border-b border-white/60 bg-slate-100/80 px-4 py-4 backdrop-blur-xl lg:px-6">
      <div className="flex items-center gap-4">
        <button
          className="rounded-xl bg-white/70 p-3 text-slate-900 shadow-lg transition hover:bg-white lg:hidden"
          onClick={onMenuClick}
          aria-label="Open sidebar"
        >
          <Menu size={20} />
        </button>

        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            className="w-full rounded-2xl border border-white/70 bg-white/60 py-3 pl-11 pr-4 text-sm font-medium text-slate-900 shadow-lg outline-none backdrop-blur-lg transition placeholder:text-slate-400 focus:border-blue-600 focus:bg-white focus:ring-4 focus:ring-blue-600/10"
            placeholder="Search patients, doctors, invoices..."
            type="search"
          />
        </div>

        <RealtimeStatusBadge />
        <LiveNotificationCenter />

        <div className="hidden items-center gap-3 rounded-2xl bg-white/70 px-3 py-2 shadow-lg sm:flex">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-sm font-bold text-white">
            {user?.name?.slice(0, 2).toUpperCase() || "HP"}
          </span>
          <span className="text-left">
            <span className="block text-sm font-bold text-slate-950">{user?.name || "HMS User"}</span>
            <span className="block text-xs font-semibold capitalize text-slate-500">{user?.role || "member"}</span>
          </span>
          <button
            onClick={handleLogout}
            className="rounded-xl p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-950"
            aria-label="Logout"
          >
            <LogOut size={17} />
          </button>
        </div>
      </div>
    </header>
  );
}

export default Navbar;
