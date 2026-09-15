import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, CornerDownLeft, X } from "lucide-react";
import { useI18n } from "../../i18n/I18nContext";
import { buildNavigation } from "../../config/navigation";

const RECENT_PAGES_KEY = "hms_recent_pages";
const MAX_RECENT = 5;

function readRecentPages() {
  try {
    const raw = localStorage.getItem(RECENT_PAGES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function recordRecentPage(item) {
  try {
    const existing = readRecentPages().filter((p) => p.path !== item.path);
    const updated = [{ path: item.path, name: item.name }, ...existing].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_PAGES_KEY, JSON.stringify(updated));
  } catch {
    // localStorage unavailable — recent pages just won't persist, non-fatal
  }
}

// Global Command Palette: opens on Ctrl/Cmd+K or clicking the navbar search
// field. Reuses the exact same role-filtered navigation list as the
// sidebar (src/config/navigation.js), so there is one source of truth for
// "what pages exist" instead of the search box being a dead input like it
// was before (it previously had no onChange, no results, no keyboard
// handling at all).
function CommandPalette({ open, onClose }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);

  const role = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("hms_user") || "null")?.role;
    } catch {
      return null;
    }
  }, [open]);

  const allItems = useMemo(() => buildNavigation(t).filter((item) => item.roles.includes(role)), [t, role]);

  const recentItems = useMemo(() => {
    if (query) return [];
    const recents = readRecentPages();
    return recents
      .map((r) => allItems.find((item) => item.path === r.path))
      .filter(Boolean);
  }, [query, allItems, open]);

  const filteredItems = useMemo(() => {
    if (!query.trim()) return allItems;
    const q = query.trim().toLowerCase();
    return allItems.filter((item) => item.name.toLowerCase().includes(q));
  }, [query, allItems]);

  const resultsToShow = query.trim() ? filteredItems : (recentItems.length ? recentItems : allItems.slice(0, 8));

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      const id = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(id);
    }
  }, [open]);

  // Global Ctrl/Cmd+K shortcut, works regardless of whether the palette is
  // currently open, and Escape closes it.
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onClose(!open);
      } else if (e.key === "Escape" && open) {
        onClose(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const goTo = (item) => {
    if (!item) return;
    recordRecentPage(item);
    navigate(item.path);
    onClose(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, resultsToShow.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      goTo(resultsToShow[activeIndex]);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-24">
      <div className="fixed inset-0 bg-navy-950/60" onClick={() => onClose(false)} />

      <div className="relative w-full max-w-xl overflow-hidden rounded-card border border-slate-200 bg-white shadow-elevated">
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
          <Search size={18} className="text-slate-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search pages..."
            className="flex-1 border-none bg-transparent text-sm font-medium text-slate-900 outline-none placeholder:text-slate-400"
          />
          <button
            onClick={() => onClose(false)}
            className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-950"
            aria-label="Close search"
          >
            <X size={16} />
          </button>
        </div>

        <div className="max-h-80 overflow-y-auto p-2">
          {!query.trim() && recentItems.length > 0 && (
            <p className="px-3 pb-1 pt-2 text-xs font-bold uppercase tracking-wide text-slate-400">Recent</p>
          )}
          {resultsToShow.length === 0 && (
            <p className="px-3 py-6 text-center text-sm font-medium text-slate-400">No matching pages</p>
          )}
          {resultsToShow.map((item, idx) => (
            <button
              key={item.path}
              onClick={() => goTo(item)}
              onMouseEnter={() => setActiveIndex(idx)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition ${
                idx === activeIndex ? "bg-royal-600 text-white" : "text-slate-700 hover:bg-slate-50"
              }`}
            >
              <item.icon size={17} />
              <span className="flex-1">{item.name}</span>
              {idx === activeIndex && <CornerDownLeft size={14} />}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-xs font-semibold text-slate-400">
          <span>↑↓ to navigate</span>
          <span>Enter to select · Esc to close</span>
        </div>
      </div>
    </div>
  );
}

export default CommandPalette;
