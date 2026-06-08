import { Activity, Menu } from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";
import Button from "../components/ui/Button";

const links = [
  { label: "Home", to: "/" },
  { label: "About", to: "/about" },
  { label: "Contact", to: "/contact" },
];

function MainLayout() {
  return (
    <div className="min-h-screen bg-slate-100">
      <header className="sticky top-0 z-30 border-b border-white/60 bg-slate-100/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <NavLink to="/" className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-950 text-white shadow-lg">
              <Activity size={22} />
            </span>
            <span className="text-lg font-black tracking-tight text-slate-950">HMS Pro</span>
          </NavLink>

          <nav className="hidden items-center gap-1 md:flex">
            {links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  `rounded-xl px-4 py-2 text-sm font-bold transition ${
                    isActive ? "bg-white text-blue-600 shadow-lg" : "text-slate-600 hover:bg-white/70 hover:text-slate-950"
                  }`
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>

          <div className="hidden items-center gap-3 sm:flex">
            <Button to="/login" variant="secondary">Login</Button>
            <Button to="/register">Get Started</Button>
          </div>

          <Button to="/login" variant="secondary" className="h-11 w-11 px-0 sm:hidden" aria-label="Open menu">
            <Menu size={19} />
          </Button>
        </div>
      </header>

      <main>
        <Outlet />
      </main>
    </div>
  );
}

export default MainLayout;
