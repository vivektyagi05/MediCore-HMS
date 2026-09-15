import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { adminApi } from "../../api/adminApi";
import { getApiErrorMessage } from "../../api/axios";
import Loader from "../ui/Loader";
import Button from "../ui/Button";
import { useAuth } from "../../context/AuthContext";
import WidgetShell from "./WidgetShell";
import { WIDGET_RENDER_CONFIG } from "./widgetRegistry";

const layoutKey = (userId) => `hms_widget_layout_${userId || "default"}`;

function loadLayout(userId) {
  try {
    const raw = localStorage.getItem(layoutKey(userId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveLayout(userId, keys) {
  localStorage.setItem(layoutKey(userId), JSON.stringify(keys));
}

function WidgetGrid() {
  const { user } = useAuth();
  const [registry, setRegistry] = useState(null);
  const [visibleKeys, setVisibleKeys] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    adminApi
      .getWidgetRegistry()
      .then((response) => {
        if (cancelled) return;
        const widgets = response.data?.widgets || [];
        setRegistry(widgets);
        const allowedKeys = widgets.filter((w) => w.allowed).map((w) => w.key);
        const savedLayout = loadLayout(user?._id);
        // Widget personalization: an admin's saved layout is honoured, but
        // filtered against what they're actually allowed to see right now
        // (a permission change since the layout was saved never leaks a
        // widget back in) and any newly-added widget the admin hasn't seen
        // yet is appended automatically.
        const initial = savedLayout
          ? savedLayout.filter((key) => allowedKeys.includes(key)).concat(allowedKeys.filter((key) => !savedLayout.includes(key)))
          : allowedKeys;
        setVisibleKeys(initial);
      })
      .catch((loadError) => setError(getApiErrorMessage(loadError)))
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [user?._id]);

  const registryByKey = useMemo(() => new Map((registry || []).map((w) => [w.key, w])), [registry]);
  const hiddenAllowedWidgets = useMemo(
    () => (registry || []).filter((w) => w.allowed && !visibleKeys?.includes(w.key)),
    [registry, visibleKeys],
  );

  const removeWidget = (key) => {
    const next = visibleKeys.filter((k) => k !== key);
    setVisibleKeys(next);
    saveLayout(user?._id, next);
  };

  const addWidget = (key) => {
    const next = [...visibleKeys, key];
    setVisibleKeys(next);
    saveLayout(user?._id, next);
    setPickerOpen(false);
  };

  if (isLoading) return <Loader label="Loading your widgets" />;
  if (error) return <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          {visibleKeys.length} widget{visibleKeys.length === 1 ? "" : "s"} on your dashboard — add or remove any time.
        </p>
        <div className="relative">
          <Button variant="secondary" onClick={() => setPickerOpen((o) => !o)} disabled={!hiddenAllowedWidgets.length}>
            <Plus size={16} /> Add widget
          </Button>
          {pickerOpen && hiddenAllowedWidgets.length > 0 && (
            <div className="absolute right-0 z-20 mt-2 w-56 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl">
              {hiddenAllowedWidgets.map((w) => (
                <button
                  key={w.key}
                  onClick={() => addWidget(w.key)}
                  className="block w-full rounded-xl px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  {w.title}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
        {visibleKeys.map((key) => {
          const meta = registryByKey.get(key);
          const config = WIDGET_RENDER_CONFIG[key];
          if (!meta || !config) return null;
          return (
            <WidgetShell
              key={key}
              meta={meta}
              icon={config.icon}
              renderBody={config.renderBody}
              renderDrillDown={config.renderDrillDown}
              exportRows={config.exportRows}
              onRemove={removeWidget}
            />
          );
        })}
      </div>
    </div>
  );
}

export default WidgetGrid;
