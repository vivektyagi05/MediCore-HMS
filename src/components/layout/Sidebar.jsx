import {
  CalendarDays,
  CreditCard,
  FileText,
  HeartPulse,
  Sparkles,
  LayoutDashboard,
  LineChart,
  NotebookPen,
  ShieldCheck,
  Settings,
  Stethoscope,
  Users,
  X,
  Star,
  WalletCards
} from "lucide-react";
import { NavLink } from "react-router-dom";

const navigation = [
  { name: "Dashboard", path: "/admin/dashboard", icon: LayoutDashboard, roles: ["admin", "super_admin"] },
  { name: "Dashboard", path: "/doctor/dashboard", icon: LayoutDashboard, roles: ["doctor"] },
  { name: "Dashboard", path: "/patient/dashboard", icon: LayoutDashboard, roles: ["patient"] },
  { name: "Services", path: "/admin/services", icon: Settings, roles: ["admin", "super_admin"] },
  { name: "Doctors", path: "/admin/doctors", icon: Stethoscope, roles: ["admin", "super_admin"] },
  { name: "Doctors", path: "/patient/doctors", icon: Stethoscope, roles: ["patient"] },
  { name: "Saved Doctors", path: "/patient/saved-doctors", icon: Stethoscope, roles: ["patient"] },
  { name: "Patients", path: "/admin/patients", icon: Users, roles: ["admin", "super_admin"] },
{
  name: "Patients",
  path: "/doctor/patients",
  icon: Users,
  roles: ["doctor"]
},
  { name: "Appointments", path: "/admin/appointments", icon: CalendarDays, roles: ["admin", "super_admin"] },
{
  name: "Appointments",
  path: "/doctor/appointments",
  icon: CalendarDays,
  roles: ["doctor"]
},
{
 name: "Reviews",
 path: "/doctor/reviews",
 icon: Star,
 roles: ["doctor"]
},
{
 name:"Reviews",
 path:"/admin/reviews",
 icon: Star,
 roles:[
   "admin",
   "super_admin"
 ]
},
{
 name:"Earnings",
 path:"/doctor/earnings",
 icon:WalletCards,
 roles:["doctor"]
},
  { name: "Appointments", path: "/patient/appointments", icon: CalendarDays, roles: ["patient"] },
  { name: "Clinical", path: "/doctor/clinical", icon: NotebookPen, roles: ["doctor"] },
  { name: "Schedule", path: "/doctor/schedule", icon: CalendarDays, roles: ["doctor"] },
  { name: "Documents", path: "/doctor/documents", icon: FileText, roles: ["doctor"] },
  { name: "Analytics", path: "/doctor/analytics", icon: LineChart, roles: ["doctor"] },
  { name: "Billing", path: "/doctor/billing", icon: CreditCard, roles: ["doctor"] },
  { name: "Payments", path: "/admin/payments", icon: CreditCard, roles: ["admin", "super_admin"] },
  {name: "Refunds",path: "/admin/refunds",icon: CreditCard,roles: ["admin", "super_admin"]},
  { name: "Payments", path: "/patient/payments", icon: CreditCard, roles: ["patient"] },
  { name: "Finance", path: "/admin/finance", icon: CreditCard, roles: ["admin", "super_admin"] },
  { name: "Finance Ops", path: "/admin/finance/ops", icon: LineChart, roles: ["admin", "super_admin"] },
  { name: "AI Command", path: "/admin/ai", icon: Sparkles, roles: ["admin", "super_admin"] },
  { name: "Invoices", path: "/admin/invoices", icon: FileText, roles: ["admin", "super_admin"] },
  { name: "Wallet", path: "/patient/wallet", icon: CreditCard, roles: ["patient"] },
  { name: "AI Assistant", path: "/patient/ai", icon: Sparkles, roles: ["patient"] },
  { name: "Invoices", path: "/patient/invoices", icon: FileText, roles: ["patient"] },
  { name: "Records", path: "/patient/records", icon: FileText, roles: ["patient"] },
  { name: "Family", path: "/patient/family", icon: Users, roles: ["patient"] },
  { name: "Insurance", path: "/patient/insurance", icon: ShieldCheck, roles: ["patient"] },
  { name: "Health Profile", path: "/patient/profile", icon: HeartPulse, roles: ["patient"] },
  { name: "Settings", path: "/admin/settings", icon: Settings, roles: ["admin", "super_admin"] },
];

function Sidebar({ isOpen, onClose }) {
  const role = JSON.parse(localStorage.getItem("hms_user") || "null")?.role;
  const visibleNavigation = navigation.filter((item) => item.roles.includes(role));

  return (
    <>
      <div
        className={`fixed inset-0 z-30 bg-slate-950/60 backdrop-blur-sm transition lg:hidden ${isOpen ? "opacity-100" : "pointer-events-none opacity-0"}`}
        onClick={onClose}
      />

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col bg-slate-950 text-white shadow-2xl transition-transform duration-300 lg:translate-x-0 ${isOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex h-20 items-center justify-between border-b border-white/10 px-6">
          <NavLink to="/" className="flex items-center gap-3" onClick={onClose}>
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-base font-black shadow-lg shadow-blue-600/30">
              HP
            </span>
            <div>
              <p className="text-lg font-black tracking-tight">HMS Pro</p>
              <p className="text-xs font-semibold text-slate-400">Clinical Command</p>
            </div>
          </NavLink>

          <button
            className="rounded-xl p-2 text-slate-400 transition hover:bg-white/10 hover:text-white lg:hidden"
            onClick={onClose}
            aria-label="Close sidebar"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 space-y-2 px-4 py-6">
          {visibleNavigation.map((item) => (
            <NavLink
              key={item.name}
              to={item.path}
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition duration-200 ${
                  isActive
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-600/25"
                    : "text-slate-300 hover:bg-white/10 hover:text-white"
                }`
              }
            >
              <item.icon size={19} />
              {item.name}
            </NavLink>
          ))}
        </nav>

        <div className="m-4 rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-sm font-bold">System Health</p>
          <div className="mt-4 h-2 rounded-full bg-white/10">
            <div className="h-2 w-4/5 rounded-full bg-blue-600" />
          </div>
          <p className="mt-3 text-xs font-medium text-slate-400">
            98% uptime across hospital services
          </p>
        </div>
      </aside>
    </>
  );
}

export default Sidebar;
