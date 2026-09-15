import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Download, RefreshCcw, X } from "lucide-react";
import Card from "../ui/Card";
import Button from "../ui/Button";
import { adminApi } from "../../api/adminApi";
import { getApiErrorMessage } from "../../api/axios";
import { useRealtime } from "../../context/RealtimeContext";

const RANGE_OPTIONS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

function toCSV(rows) {
  if (!rows || !rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => JSON.stringify(row[h] ?? "")).join(","));
  }
  return lines.join("\n");
}

function downloadCSV(filename, rows) {
  const csv = toCSV(rows);
  if (!csv) return;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * One reusable shell every Smart Widget renders through — the per-widget
 * data shape/visualisation is supplied via `renderBody`/`renderDrillDown`,
 * but expand/collapse, refresh, loading/skeleton/error/empty states, the
 * date-range control, CSV export, and realtime re-fetch on
 * dashboardSyncTick are implemented exactly once here.
 */
function WidgetShell({
  meta, // { key, title, supportsDateRange, supportsDrillDown, supportsExport, allowed }
  icon: Icon,
  renderBody,
  renderDrillDown,
  onRemove,
  exportRows,
}) {
  const { dashboardSyncTick } = useRealtime();
  const [collapsed, setCollapsed] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [days, setDays] = useState(30);
  const [drillDownOpen, setDrillDownOpen] = useState(false);

  const load = useCallback(async () => {
    if (meta.allowed === false) return;
    setLoading(true);
    setError("");
    try {
      const params = meta.supportsDateRange ? { days } : {};
      const response = await adminApi.getWidgetData(meta.key, params);
      setData(response.data);
    } catch (loadError) {
      setError(getApiErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [meta.key, meta.allowed, meta.supportsDateRange, days]);

  useEffect(() => {
    load();
  }, [load, dashboardSyncTick]);

  const isEmpty = useMemo(() => {
    if (!data) return false;
    if (Array.isArray(data.items)) return data.items.length === 0 && Object.keys(data).length <= 2;
    return false;
  }, [data]);

  if (meta.allowed === false) return null;

  return (
    <Card className="flex flex-col">
      <div className="mb-4 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {Icon && (
            <span className="rounded-lg bg-blue-600/10 p-2 text-blue-700">
              <Icon size={17} />
            </span>
          )}
          <h3 className="text-sm font-black text-slate-950">{meta.title}</h3>
        </div>
        <div className="flex items-center gap-1">
          {meta.supportsExport && data && (
            <button
              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              onClick={() => downloadCSV(`${meta.key}.csv`, exportRows ? exportRows(data) : data.items)}
              aria-label="Export CSV"
              title="Export CSV"
            >
              <Download size={15} />
            </button>
          )}
          <button
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            onClick={load}
            aria-label="Refresh"
            title="Refresh"
          >
            <RefreshCcw size={15} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand" : "Collapse"}
            title={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
          </button>
          {onRemove && (
            <button
              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
              onClick={() => onRemove(meta.key)}
              aria-label="Remove widget"
              title="Remove from dashboard"
            >
              <X size={15} />
            </button>
          )}
        </div>
      </div>

      {!collapsed && (
        <>
          {meta.supportsDateRange && (
            <div className="mb-3 flex gap-1.5">
              {RANGE_OPTIONS.map((opt) => (
                <button
                  key={opt.days}
                  onClick={() => setDays(opt.days)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-bold transition ${
                    days === opt.days ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}

          {loading && !data && (
            <div className="animate-pulse space-y-2">
              <div className="h-6 w-2/3 rounded bg-slate-200" />
              <div className="h-4 w-1/2 rounded bg-slate-100" />
              <div className="h-16 w-full rounded bg-slate-100" />
            </div>
          )}

          {!loading && error && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-bold text-red-700">{error}</div>
          )}

          {!loading && !error && data && isEmpty && (
            <p className="py-6 text-center text-xs font-semibold text-slate-400">Nothing to show right now.</p>
          )}

          {!loading && !error && data && !isEmpty && (
            <div>
              {renderBody(data)}
              {meta.supportsDrillDown && renderDrillDown && (
                <button
                  className="mt-3 text-xs font-bold text-blue-600 hover:underline"
                  onClick={() => setDrillDownOpen(true)}
                >
                  View details →
                </button>
              )}
            </div>
          )}
        </>
      )}

      {drillDownOpen && renderDrillDown && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" onClick={() => setDrillDownOpen(false)}>
          <div
            className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-black text-slate-950">{meta.title} — details</h3>
              <button className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" onClick={() => setDrillDownOpen(false)}>
                <X size={18} />
              </button>
            </div>
            {renderDrillDown(data)}
          </div>
        </div>
      )}
    </Card>
  );
}

export default WidgetShell;
