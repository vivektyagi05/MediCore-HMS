import { Link, useLocation } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";
import { useI18n } from "../../i18n/I18nContext";
import { buildNavigation } from "../../config/navigation";

const ROLE_HOME = {
  admin: "/admin/dashboard",
  super_admin: "/admin/dashboard",
  doctor: "/doctor/dashboard",
  patient: "/patient/dashboard",
};

function labelFor(segment) {
  // Mongo ObjectIds / UUID-like segments aren't real page names — show a
  // generic "Detail" crumb instead of a 24-char hex string.
  if (/^[a-f0-9]{20,}$/i.test(segment) || /^[0-9a-f-]{16,}$/i.test(segment)) return "Detail";
  return segment
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Lightweight breadcrumb trail. Looks up each partial path against the
// shared navigation config first (so real page names/i18n labels are used
// wherever possible), and only falls back to a humanized URL segment for
// dynamic parts of the route (ids) that aren't in the nav config.
function Breadcrumbs() {
  const location = useLocation();
  const { t } = useI18n();
  const navItems = buildNavigation(t);

  const segments = location.pathname.split("/").filter(Boolean);
  if (segments.length <= 1) return null;

  const role = (() => {
    try {
      return JSON.parse(localStorage.getItem("hms_user") || "null")?.role;
    } catch {
      return null;
    }
  })();

  const crumbs = segments.map((seg, idx) => {
    const path = "/" + segments.slice(0, idx + 1).join("/");
    const match = navItems.find((item) => item.path === path);
    return { path, label: match ? match.name : labelFor(seg) };
  });

  return (
    <nav aria-label="Breadcrumb" className="mb-4 flex items-center gap-1.5 text-sm font-semibold text-slate-500">
      <Link to={ROLE_HOME[role] || "/"} className="flex items-center text-slate-400 transition hover:text-slate-950">
        <Home size={15} />
      </Link>
      {crumbs.map((crumb, idx) => (
        <span key={crumb.path} className="flex items-center gap-1.5">
          <ChevronRight size={14} className="text-slate-300" />
          {idx === crumbs.length - 1 ? (
            <span className="text-slate-950">{crumb.label}</span>
          ) : (
            <Link to={crumb.path} className="transition hover:text-slate-950">
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}

export default Breadcrumbs;
