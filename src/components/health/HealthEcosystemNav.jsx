import { FileText, ShieldCheck, Users } from "lucide-react";
import { NavLink } from "react-router-dom";

// Reused at the top of Records, Family, and Insurance so the three pages
// read as one connected Digital Health Ecosystem instead of three isolated
// screens. Counts come from getEcosystemOverview (real aggregates only).
function HealthEcosystemNav({ overview, active }) {
  const tabs = [
    {
      key: "records",
      label: "Digital Health Records",
      to: "/patient/records",
      icon: FileText,
      stat: overview ? `${overview.records?.total || 0} record${overview.records?.total === 1 ? "" : "s"}` : "—",
    },
    {
      key: "family",
      label: "Family Health Center",
      to: "/patient/family",
      icon: Users,
      stat: overview ? `${overview.family?.total || 0} member${overview.family?.total === 1 ? "" : "s"}` : "—",
    },
    {
      key: "insurance",
      label: "Insurance Center",
      to: "/patient/insurance",
      icon: ShieldCheck,
      stat: overview
        ? `${overview.insurance?.total || 0} polic${overview.insurance?.total === 1 ? "y" : "ies"}${overview.insurance?.expiringSoon ? ` • ${overview.insurance.expiringSoon} expiring soon` : ""}`
        : "—",
    },
  ];

  return (
    <div className="grid gap-3 rounded-2xl bg-white/50 p-3 shadow-lg sm:grid-cols-3">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = tab.key === active;
        return (
          <NavLink
            key={tab.key}
            to={tab.to}
            className={`flex items-center gap-3 rounded-xl px-4 py-3 transition ${
              isActive ? "bg-blue-600 text-white shadow-lg shadow-blue-600/25" : "bg-white/60 text-slate-700 hover:bg-white"
            }`}
          >
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${isActive ? "bg-white/20" : "bg-blue-600 text-white"}`}>
              <Icon size={18} />
            </div>
            <div className="min-w-0">
              <p className={`truncate text-sm font-black ${isActive ? "text-white" : "text-slate-950"}`}>{tab.label}</p>
              <p className={`truncate text-xs font-semibold ${isActive ? "text-blue-100" : "text-slate-500"}`}>{tab.stat}</p>
            </div>
          </NavLink>
        );
      })}
    </div>
  );
}

export default HealthEcosystemNav;
