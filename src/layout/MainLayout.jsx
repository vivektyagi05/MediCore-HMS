import { Activity, Menu, X, ArrowUpRight } from "lucide-react";
import { NavLink, Outlet, Link } from "react-router-dom";
import { useEffect, useState } from "react";
import Button from "../components/ui/Button";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../i18n/I18nContext";
import LanguageSwitcher from "../components/shared/LanguageSwitcher";

const DASHBOARD_PATHS = {
  admin: "/admin/dashboard",
  super_admin: "/admin/dashboard",
  doctor: "/doctor/dashboard",
  patient: "/patient/dashboard",
};

function MainLayout() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const dashPath = user ? DASHBOARD_PATHS[user.role] || "/" : null;

  useEffect(() => {
    if (!mobileOpen) return undefined;
    const onKeyDown = (event) => { if (event.key === "Escape") setMobileOpen(false); };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen]);

  const NAV_LINKS = [
    { label: t("nav.home"), to: "/" },
    { label: t("nav.findDoctors"), to: "/doctors" },
    { label: t("nav.services"), to: "/services" },
    { label: t("nav.articles"), to: "/articles" },
    { label: t("nav.about"), to: "/about" },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur-xl">
        <div className="public-shell flex items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
          <NavLink to="/" className="flex items-center gap-3">
            <span className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-red-500 text-slate-950 shadow-lg shadow-orange-500/20">
              <Activity size={20} />
            </span>
            <span className="leading-none">
              <span className="block text-[15px] font-black tracking-tight text-slate-950">{t("meta.appName")}</span>
              <span className="mt-1 block text-xs font-bold uppercase tracking-[0.2em] text-slate-500">{t("p11.main_layout.auto1")}</span>
            </span>
          </NavLink>

          <nav className="hidden items-center gap-1 lg:flex">
            {NAV_LINKS.map((link) => (
              <NavLink key={link.to} to={link.to} end={link.to === "/"} className={({ isActive }) =>
                `rounded-xl px-3.5 py-2 text-xs font-bold transition ${isActive ? "bg-slate-100 text-slate-950" : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"}`
              }>
                {link.label}
              </NavLink>
            ))}
            <NavLink to="/contact" className="ml-1 rounded-xl px-3.5 py-2 text-xs font-bold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950">
              {t("nav.contact")}
            </NavLink>
          </nav>

          <div className="hidden items-center gap-2 sm:flex">
            <LanguageSwitcher />
            {user ? (
              <Button to={dashPath} className="!rounded-xl !bg-white !text-slate-950 !shadow-none hover:!bg-slate-100">{t("nav.goToDashboard")}</Button>
            ) : (
              <>
                <Link to="/login" className="rounded-xl px-3.5 py-2.5 text-xs font-bold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950">{t("nav.login")}</Link>
                <Link to="/register" className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-orange-500 to-red-500 px-4 py-2.5 text-xs font-black text-slate-950 shadow-lg shadow-orange-500/20 transition hover:-translate-y-0.5">{t("nav.getStarted")} <ArrowUpRight size={13}/></Link>
              </>
            )}
          </div>

          <button type="button" aria-expanded={mobileOpen} aria-controls="public-mobile-menu" onClick={() => setMobileOpen((v) => !v)} className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-slate-100 text-slate-600 sm:hidden" aria-label={t("p11.main_layout.auto15")}>
            {mobileOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>

        {mobileOpen && (
          <div id="public-mobile-menu" className="border-t border-slate-200 bg-white px-4 pb-4 sm:hidden">
            <nav className="public-shell flex flex-col gap-1 pt-3">
              {[...NAV_LINKS, { label: t("nav.contact"), to: "/contact" }].map((link) => (
                <NavLink key={link.to} to={link.to} end={link.to === "/"} onClick={() => setMobileOpen(false)} className={({ isActive }) =>
                  `rounded-xl px-4 py-3 text-sm font-bold ${isActive ? "bg-slate-100 text-slate-950" : "text-slate-600"}`
                }>{link.label}</NavLink>
              ))}
              <div className="mt-2 grid gap-2 border-t border-slate-200 pt-3">
                <LanguageSwitcher />
                {user ? <Button to={dashPath} onClick={() => setMobileOpen(false)}>{t("nav.goToDashboard")}</Button> : <><Link to="/login" onClick={() => setMobileOpen(false)} className="rounded-xl border border-slate-200 px-4 py-3 text-center text-sm font-bold text-slate-950">{t("nav.login")}</Link><Link to="/register" onClick={() => setMobileOpen(false)} className="rounded-xl bg-orange-500 px-4 py-3 text-center text-sm font-black text-slate-950">{t("nav.getStarted")}</Link></>}
              </div>
            </nav>
          </div>
        )}
      </header>

      <main><Outlet /></main>

      <footer className="border-t border-slate-200 bg-white text-slate-500">
        <div className="public-shell grid gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.4fr_0.8fr_0.8fr_0.9fr] lg:px-8">
          <div>
            <div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-950"><Activity size={17}/></span><span className="font-black text-slate-950">{t("meta.appName")}</span></div>
            <p className="mt-4 max-w-sm text-sm leading-7">{t("p11.main_layout.auto2")}</p>
          </div>
          <div><p className="mb-4 text-xs font-black uppercase tracking-[0.2em] text-slate-600">{t("p11.main_layout.auto3")}</p><div className="space-y-2 text-sm"><Link className="block hover:text-slate-950" to="/doctors">{t("p11.main_layout.auto4")}</Link><Link className="block hover:text-slate-950" to="/services">{t("p11.main_layout.auto5")}</Link><Link className="block hover:text-slate-950" to="/articles">{t("p11.main_layout.auto6")}</Link></div></div>
          <div><p className="mb-4 text-xs font-black uppercase tracking-[0.2em] text-slate-600">{t("p11.main_layout.auto7")}</p><div className="space-y-2 text-sm"><Link className="block hover:text-slate-950" to="/about">{t("p11.main_layout.auto8")}</Link><Link className="block hover:text-slate-950" to="/contact">{t("p11.main_layout.auto9")}</Link><Link className="block hover:text-slate-950" to="/register">{t("p11.main_layout.auto10")}</Link></div></div>
          <div><p className="mb-4 text-xs font-black uppercase tracking-[0.2em] text-slate-600">{t("p11.main_layout.auto11")}</p><div className="space-y-2 text-sm">
            <Link className="block hover:text-slate-950" to="/contact">{t("p11.main_layout.auto12")}</Link>
            <Link className="block hover:text-slate-950" to="/privacy-policy">{t("p16.nav.privacy")}</Link>
            <Link className="block hover:text-slate-950" to="/terms">{t("p16.nav.terms")}</Link>
            <Link className="block hover:text-slate-950" to="/medical-disclaimer">{t("p16.nav.medical")}</Link>
            <Link className="block hover:text-slate-950" to="/cookie-policy">{t("p16.nav.cookies")}</Link>
            <Link className="block hover:text-slate-950" to="/privacy-preferences">{t("p16.nav.preferences")}</Link>
            <Link className="block hover:text-slate-950" to="/data-rights">{t("p16.nav.rights")}</Link>
          </div></div>
        </div>
        <div className="border-t border-slate-200"><div className="public-shell flex flex-col gap-2 px-4 py-5 text-xs sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8"><span>{t("footer.copyright", { year: new Date().getFullYear() })}</span><span className="text-slate-600">{t("p11.main_layout.auto14")}</span></div></div>
      </footer>
    </div>
  );
}

export default MainLayout;
