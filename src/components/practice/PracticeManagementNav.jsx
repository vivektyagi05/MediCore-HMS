import { NavLink } from "react-router-dom";
import { LayoutGrid, UserCog, ShieldCheck, CreditCard, Settings } from "lucide-react";

const TABS = [
  { key: "overview", label: "Overview", path: "/doctor/practice", icon: LayoutGrid },
  { key: "identity", label: "Identity", path: "/doctor/profile-strength", icon: UserCog },
  { key: "profile", label: "Professional Profile", path: "/doctor/profile/edit", icon: UserCog },
  { key: "verification", label: "Verification", path: "/doctor/verification", icon: ShieldCheck },
  { key: "subscription", label: "Subscription", path: "/doctor/billing", icon: CreditCard },
  { key: "settings", label: "Practice Settings", path: "/doctor/practice-settings", icon: Settings },
];

// Practice Management Platform nav strip (Phase D4), mirroring the exact
// pattern established by BusinessIntelligenceNav.jsx in Phase D3 -- a
// shared component reused across every page in the connected platform.
export default function PracticeManagementNav({ active }) {
  return (
    <div className="glass-card flex flex-wrap gap-2 rounded-2xl p-2">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = tab.key === active;
        return (
          <NavLink
            key={tab.key}
            to={tab.path}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition ${
              isActive ? "bg-blue-600 text-white shadow-lg" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <Icon size={15} />
            {tab.label}
          </NavLink>
        );
      })}
    </div>
  );
}
