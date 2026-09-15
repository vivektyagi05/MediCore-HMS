import { LayoutGrid, MessageSquare, Award, BarChart3, Wallet } from "lucide-react";
import { NavLink } from "react-router-dom";

// Reused at the top of Business Overview, Reviews, Reputation, Analytics,
// and Earnings so all five read as one connected Doctor Business
// Intelligence Platform instead of five isolated pages. Stats come from
// getBusinessOverview (real aggregates only, computed by shared backend
// builders — never fabricated here).
function BusinessIntelligenceNav({ overview, active }) {
  const tabs = [
    {
      key: "overview",
      label: "Business Overview",
      to: "/doctor/business",
      icon: LayoutGrid,
      stat: overview ? `Score: ${overview.businessScore ?? "—"}/100` : "—",
    },
    {
      key: "reviews",
      label: "Reviews",
      to: "/doctor/reviews",
      icon: MessageSquare,
      stat: overview?.reviewsNeedingAttention
        ? `${overview.reviewsNeedingAttention.unrepliedCount} unreplied`
        : "—",
    },
    {
      key: "reputation",
      label: "Reputation",
      to: "/doctor/reputation",
      icon: Award,
      stat: overview ? `${overview.rating?.average ?? "—"}/5 rating` : "—",
    },
    {
      key: "analytics",
      label: "Analytics",
      to: "/doctor/analytics",
      icon: BarChart3,
      stat: overview ? `${overview.growth?.monthlyGrowth >= 0 ? "+" : ""}${overview.growth?.monthlyGrowth ?? 0}% growth` : "—",
    },
    {
      key: "earnings",
      label: "Earnings",
      to: "/doctor/earnings",
      icon: Wallet,
      stat: overview ? `₹${overview.revenue?.monthly ?? 0} this month` : "—",
    },
  ];

  return (
    <div className="grid gap-3 rounded-2xl bg-white/50 p-3 shadow-lg sm:grid-cols-3 lg:grid-cols-5">
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

export default BusinessIntelligenceNav;
