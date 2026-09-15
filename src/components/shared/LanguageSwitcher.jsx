/**
 * LanguageSwitcher — accessible, dropdown language selector
 * Reuses the existing project design system (glass-card, tailwind utilities).
 * Placed in Navbar for global access.
 */
import { useState, useRef, useEffect } from "react";
import { Globe, Check, ChevronDown } from "lucide-react";
import { useI18n } from "../../i18n/I18nContext";

export default function LanguageSwitcher({ compact = false, dark = false }) {
  const { locale, setLocale, locales } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const current = locales.find((l) => l.code === locale) ?? locales[0];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Select language"
        className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold shadow-sm transition focus:outline-none ${dark ? "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 focus:ring-4 focus:ring-orange-500/10" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 focus:ring-4 focus:ring-blue-600/10"}`}
      >
        <Globe size={14} className={dark ? "text-slate-600" : "text-slate-400"} />
        {compact ? (
          <span className={`font-black text-xs ${dark ? "text-white" : "text-slate-950"}`}>{locale.toUpperCase()}</span>
        ) : (
          <span>{current.nativeLabel}</span>
        )}
        <ChevronDown
          size={13}
          className={`text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Language options"
          className={`absolute right-0 top-full z-50 mt-1.5 min-w-[160px] overflow-hidden rounded-2xl shadow-2xl ${dark ? "border border-white/10 bg-[#0c0f14]" : "border border-slate-200 bg-white"}`}
        >
          {locales.map((l) => (
            <button
              key={l.code}
              role="option"
              aria-selected={l.code === locale}
              onClick={() => { setLocale(l.code); setOpen(false); }}
              className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm transition ${dark ? "hover:bg-white/5" : "hover:bg-slate-50"} ${l.code === locale ? (dark ? "bg-orange-500/10 font-bold text-orange-300" : "bg-blue-50 font-bold text-blue-700") : (dark ? "text-slate-300" : "text-slate-700")}`}
            >
              <span className="flex flex-col">
                <span className="font-semibold">{l.nativeLabel}</span>
                {l.nativeLabel !== l.label && (
                  <span className={dark ? "text-xs text-slate-600" : "text-xs text-slate-400"}>{l.label}</span>
                )}
              </span>
              {l.code === locale && (
                <Check size={14} className={`flex-shrink-0 ${dark ? "text-orange-400" : "text-blue-600"}`} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
