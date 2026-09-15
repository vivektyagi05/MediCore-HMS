import { HeartPulse, History, Sparkles } from "lucide-react";
import { NavLink } from "react-router-dom";

// Reused at the top of Health Profile, AI Assistant, and Personal Health
// Journey so the three pages read as one connected Personal Health
// Intelligence Platform instead of three isolated screens. `healthScore`
// comes from getHealthProfile (a real, computed figure) — never fabricated.
function PersonalHealthNav({ healthScore, active }) {
  const tabs = [
    {
      key: "profile",
      label: "Health Profile",
      to: "/patient/profile",
      icon: HeartPulse,
      stat: typeof healthScore === "number" ? `${healthScore}% complete` : "—",
    },
    {
      key: "ai",
      label: "AI Assistant",
      to: "/patient/ai",
      icon: Sparkles,
      stat: "Your healthcare copilot",
    },
    {
      key: "journey",
      label: "Health Journey",
      to: "/patient/journey",
      icon: History,
      stat: "Your longitudinal timeline",
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

export default PersonalHealthNav;
