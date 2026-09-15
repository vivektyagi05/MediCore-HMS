import { useEffect, useMemo, useState } from "react";
import { RefreshCcw, Search, Pin, LayoutGrid, Table2 } from "lucide-react";
import { adminApi } from "../../api/adminApi";
import { getApiErrorMessage } from "../../api/axios";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import Loader from "../../components/ui/Loader";
import EmptyState from "../../components/shared/EmptyState";
import { useRealtime } from "../../context/RealtimeContext";
import OperationsWorkspaceDrawer from "../../components/admin/OperationsWorkspaceDrawer";
import AdminTable from "../../components/admin/AdminTable";

// ─────────────────────────────────────────────────────────────────────────
// Phase A6.1 — Unified Operations Queue / Operations Inbox.
//
// This page previously rendered platformHealthAdminController.buildOperationsQueue()
// — an aggregate, non-clickable re-packaging of buildSmartAlerts(). It is now
// rewired (in place, same route, same nav entry) to the real Unified
// Operations Queue (operationsAdminController.getOperationsQueueUnified),
// where every row is a real, individually assignable/resolvable document.
// Clicking a row opens the Operations Workspace as a right-side drawer —
// it never navigates away from this page (Step 5 of the brief).
// ─────────────────────────────────────────────────────────────────────────

const PRIORITY_STYLES = {
  critical: "bg-rose-50 text-rose-800 border-rose-200",
  high: "bg-amber-50 text-amber-800 border-amber-200",
  medium: "bg-blue-50 text-blue-800 border-blue-200",
  low: "bg-slate-50 text-slate-700 border-slate-200",
};

const SLA_DOT = {
  overdue: "bg-rose-600",
  at_risk: "bg-amber-500",
  on_track: "bg-emerald-500",
  completed: "bg-slate-400",
};

const STATUS_LABELS = {
  open: "Open",
  claimed: "Claimed",
  assigned: "Assigned",
  escalated: "Escalated",
  resolved: "Resolved",
  cancelled: "Cancelled",
};

const PAGE_SIZE = 50;

// Phase UI-11, Part A — Workflow Table. Same duration format as
// OperationsWorkspaceDrawer's fmtDuration (Elapsed/Remaining) — kept local
// rather than shared to avoid an import coupling between an admin page and
// a drawer component for one small formatter.
function fmtAge(ms) {
  if (ms == null) return "—";
  const abs = Math.abs(ms);
  const hours = Math.floor(abs / (60 * 60 * 1000));
  if (hours < 1) return "<1h";
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function lastActivityAt(item) {
  // Real data only: the item's own timeline (already returned by the
  // Unified Operations Queue) is the actual activity log. If nothing has
  // happened since creation there is no separate "activity" — the honest
  // answer is the creation time itself, not a fabricated event.
  const last = item.timeline?.length ? item.timeline[item.timeline.length - 1] : null;
  return last?.at || item.createdAt;
}

function AdminOperationsCenter() {
  const { dashboardSyncTick } = useRealtime();
  const [data, setData] = useState(null);
  const [slaOverview, setSlaOverview] = useState(null);
  const [admins, setAdmins] = useState([]);
  const [workflowTypes, setWorkflowTypes] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeKey, setActiveKey] = useState(null);

  // Operations Inbox filters (Step 3)
  const [search, setSearch] = useState("");
  const [priority, setPriority] = useState("");
  const [type, setType] = useState("");
  const [status, setStatus] = useState("");
  const [groupBy, setGroupBy] = useState("priority");

  // Phase UI-11, Part A — Workflow Table view. Grouped-card view (existing,
  // A6.1) stays the default; "table" is an additive display mode over the
  // exact same paginated `items`/`pagination` state — no second data
  // fetch, no duplicate queue.
  const [view, setView] = useState("grouped");

  // Debounced search — typing doesn't fire a request per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Phase UI-10 — server-side pagination. The queue can hold thousands of
  // items across 10 source models, so only one page is ever requested or
  // rendered (Rule #17: never load/render an unbounded list).
  const [page, setPage] = useState(1);

  const load = async (targetPage, targetSearch) => {
    setIsLoading(true);
    setError("");
    try {
      const response = await adminApi.getUnifiedOperationsQueue({
        search: targetSearch || undefined,
        priority: priority || undefined,
        type: type || undefined,
        status: status || undefined,
        page: targetPage,
        pageSize: PAGE_SIZE,
      });
      setData(response.data);
    } catch (loadError) {
      setError(getApiErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  };

  const loadAdmins = async () => {
    try {
      // BUGFIX (PHASE UI-14 audit): this used to fetch the unbounded
      // generic Users list and filter client-side for admin/super_admin —
      // now that getUsers is server-paginated (PHASE UI-14), that would
      // silently truncate this picklist. The real, purpose-built endpoint
      // for "every admin/super_admin account" already existed
      // (permissionAdminController.listAdmins) and is inherently a small,
      // safe, unbounded set — reused here instead of duplicating it.
      const response = await adminApi.getAdmins();
      setAdmins(response.data?.admins || []);
    } catch {
      setAdmins([]);
    }
  };

  // Phase UI-11, Part K — SLA Command Center. Own fetch, own failure
  // isolation (Part O): if this call fails, the queue above still renders —
  // only this strip shows "unavailable".
  const loadSlaOverview = async () => {
    try {
      const response = await adminApi.getSlaOverview();
      setSlaOverview(response.data);
    } catch {
      setSlaOverview(null);
    }
  };

  // Type filter options must reflect every possible operation type, not just
  // the types present on the current page — sourced from the real Workflow
  // Registry (the same source of truth the backend uses to label items),
  // never recomputed or duplicated here.
  const loadWorkflowTypes = async () => {
    try {
      const response = await adminApi.getWorkflowRegistry();
      setWorkflowTypes(response.data?.workflows || []);
    } catch {
      setWorkflowTypes([]);
    }
  };

  useEffect(() => {
    loadAdmins();
    loadWorkflowTypes();
  }, []);

  useEffect(() => {
    loadSlaOverview();
  }, [dashboardSyncTick]);

  // Debounce free-text search into debouncedSearch.
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search), 350);
    return () => window.clearTimeout(timeout);
  }, [search]);

  // Any filter change invalidates the current page — go back to page 1.
  useEffect(() => {
    setPage(1);
  }, [priority, type, status, debouncedSearch]);

  // The single source of truth for fetching: fires on realtime sync ticks,
  // any committed filter change, and any page change.
  useEffect(() => {
    load(page, debouncedSearch);
  }, [dashboardSyncTick, priority, type, status, debouncedSearch, page]);

  useEffect(() => {
    const interval = window.setInterval(() => load(page, debouncedSearch), 20000);
    return () => window.clearInterval(interval);
  }, [priority, type, status, debouncedSearch, page]);

  const items = data?.items || [];
  const pagination = data?.pagination;

  const typeOptions = useMemo(() => workflowTypes.map((w) => [w.key, w.label]), [workflowTypes]);

  const grouped = useMemo(() => {
    const key = groupBy === "department" ? "department" : groupBy === "status" ? "status" : "priority";
    const map = new Map();
    for (const item of items) {
      const groupKey = item[key];
      if (!map.has(groupKey)) map.set(groupKey, []);
      map.get(groupKey).push(item);
    }
    if (key === "priority") {
      const order = ["critical", "high", "medium", "low"];
      return order.filter((p) => map.has(p)).map((p) => ({ label: p, items: map.get(p) }));
    }
    return Array.from(map.entries()).map(([label, groupItems]) => ({ label, items: groupItems }));
  }, [items, groupBy]);

  // Phase UI-11, Part A — exact column set from the brief: Workflow/
  // Operation, Type, Status, Priority, SLA, Owner, Started, Last Activity,
  // Age, Action. Every value comes straight off the real queue item — no
  // column is rendered for data the backend doesn't actually return.
  const tableColumns = useMemo(
    () => [
      {
        key: "operation",
        header: "Workflow / Operation",
        render: (item) => (
          <div className="flex min-w-0 items-center gap-2">
            {item.pinned && <Pin size={13} className="shrink-0 text-slate-400" />}
            <span className="truncate" title={item.reason}>
              {item.reason || item.typeLabel}
            </span>
          </div>
        ),
      },
      { key: "type", header: "Type", render: (item) => item.typeLabel },
      {
        key: "status",
        header: "Status",
        render: (item) => (
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-bold uppercase text-slate-600">
            {STATUS_LABELS[item.status] || item.status}
          </span>
        ),
      },
      {
        key: "priority",
        header: "Priority",
        render: (item) => (
          <span className={`rounded-full border px-2 py-0.5 text-xs font-black uppercase ${PRIORITY_STYLES[item.priority] || PRIORITY_STYLES.low}`}>
            {item.priority}
          </span>
        ),
      },
      {
        key: "sla",
        header: "SLA",
        render: (item) => (
          <span className="inline-flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${SLA_DOT[item.sla?.state] || SLA_DOT.on_track}`} />
            {item.sla?.state ? item.sla.state.replace("_", " ") : "Not available"}
          </span>
        ),
      },
      { key: "owner", header: "Owner", render: (item) => item.assignedTo?.name || item.owner || "Unassigned" },
      { key: "started", header: "Started", render: (item) => (item.createdAt ? new Date(item.createdAt).toLocaleString() : "Not available") },
      {
        key: "lastActivity",
        header: "Last Activity",
        render: (item) => {
          const at = lastActivityAt(item);
          return at ? new Date(at).toLocaleString() : "Not available";
        },
      },
      { key: "age", header: "Age", render: (item) => fmtAge(item.sla?.elapsedMs) },
      {
        key: "action",
        header: "Action",
        render: (item) => (
          <Button variant="secondary" onClick={() => setActiveKey(item.id)}>
            Open
          </Button>
        ),
      },
    ],
    [],
  );

  if (isLoading && !data) return <Loader label="Loading operations inbox" />;
  if (error && !data) return <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Hospital Operations Center</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Unified Operations Queue</h1>
          <p className="mt-2 text-sm text-slate-600">
            Every pending workflow, approval, and manual review across the platform — one queue, one workspace.
          </p>
        </div>
        <Button onClick={() => load(page, debouncedSearch)}>
          <RefreshCcw size={16} /> Refresh now
        </Button>
      </div>

      {/* Phase UI-11, Part A — view toggle. Table view is additive; grouped
          stays the default so no existing behavior changes. */}
      <div className="flex items-center gap-2">
        <Button variant={view === "grouped" ? "dark" : "secondary"} onClick={() => setView("grouped")}>
          <LayoutGrid size={16} /> Grouped
        </Button>
        <Button variant={view === "table" ? "dark" : "secondary"} onClick={() => setView("table")}>
          <Table2 size={16} /> Table
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-4 lg:grid-cols-8">
        {["critical", "high", "medium", "low"].map((p) => (
          <Card key={p} className="text-center">
            <p className="text-xs font-black uppercase text-slate-500">{p}</p>
            <p className="mt-2 text-2xl font-black text-slate-950">{data?.counts?.[p] ?? 0}</p>
          </Card>
        ))}
        <Card className="text-center">
          <p className="text-xs font-black uppercase text-slate-500">Overdue</p>
          <p className="mt-2 text-2xl font-black text-rose-600">{data?.counts?.overdue ?? 0}</p>
        </Card>
        <Card className="text-center">
          <p className="text-xs font-black uppercase text-slate-500">At Risk</p>
          <p className="mt-2 text-2xl font-black text-amber-600">{data?.counts?.atRisk ?? 0}</p>
        </Card>
        <Card className="text-center">
          <p className="text-xs font-black uppercase text-slate-500">Unassigned</p>
          <p className="mt-2 text-2xl font-black text-slate-950">{data?.counts?.unassigned ?? 0}</p>
        </Card>
        <Card className="text-center">
          <p className="text-xs font-black uppercase text-slate-500">Total Open</p>
          <p className="mt-2 text-2xl font-black text-slate-950">{data?.counts?.total ?? 0}</p>
        </Card>
      </div>

      {/* Phase UI-11, Part K — SLA Command Center. On Track/At Risk/Overdue
          mirror the counts above (same computeSla engine, same items);
          Resolved Within SLA / Resolved Late come from the separate
          sla-overview fetch since they need resolved items the default
          open-only queue doesn't load. */}
      <Card title="SLA Command Center">
        {slaOverview ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-center">
              <p className="text-xs font-black uppercase text-emerald-700">On Track</p>
              <p className="mt-1 text-xl font-black text-emerald-900">{slaOverview.onTrack}</p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-center">
              <p className="text-xs font-black uppercase text-amber-700">At Risk</p>
              <p className="mt-1 text-xl font-black text-amber-900">{slaOverview.atRisk}</p>
            </div>
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-center">
              <p className="text-xs font-black uppercase text-rose-700">Overdue</p>
              <p className="mt-1 text-xl font-black text-rose-900">{slaOverview.overdue}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
              <p className="text-xs font-black uppercase text-slate-600">Resolved Within SLA</p>
              <p className="mt-1 text-xl font-black text-slate-900">{slaOverview.resolvedWithinSla}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
              <p className="text-xs font-black uppercase text-slate-600">Resolved Late</p>
              <p className="mt-1 text-xl font-black text-slate-900">{slaOverview.resolvedLate}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm font-semibold text-slate-500">SLA overview unavailable.</p>
        )}
      </Card>

      {/* Operations Inbox filters */}
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <label className="text-xs font-bold uppercase text-slate-400" htmlFor="ops-search">
              Search
            </label>
            <div className="mt-1 flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2">
              <Search size={16} className="text-slate-400" />
              <input
                id="ops-search"
                className="w-full text-sm outline-none"
                placeholder="Search reason, patient, doctor…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-bold uppercase text-slate-400" htmlFor="ops-priority">
              Priority
            </label>
            <select id="ops-priority" className="mt-1 block rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="">All</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-bold uppercase text-slate-400" htmlFor="ops-type">
              Type
            </label>
            <select id="ops-type" className="mt-1 block rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">All</option>
              {typeOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-bold uppercase text-slate-400" htmlFor="ops-status">
              Status
            </label>
            <select id="ops-status" className="mt-1 block rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Open (default)</option>
              <option value="claimed">Claimed</option>
              <option value="assigned">Assigned</option>
              <option value="escalated">Escalated</option>
              <option value="resolved">Resolved</option>
              <option value="cancelled">Cancelled</option>
              <option value="all">All statuses</option>
            </select>
          </div>

          <div>
            <label className="text-xs font-bold uppercase text-slate-400" htmlFor="ops-group">
              Group by
            </label>
            <select id="ops-group" className="mt-1 block rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
              <option value="priority">Priority</option>
              <option value="department">Department</option>
              <option value="status">Status</option>
            </select>
          </div>
        </div>
      </Card>

      {grouped.length === 0 ? (
        <EmptyState title="Queue is empty" description="No pending doctors, refunds, insurance, reports, payments, webhooks, automation, or scheduling items match these filters." />
      ) : view === "table" ? (
        <AdminTable columns={tableColumns} data={items} rowKey="id" isLoading={isLoading} />
      ) : (
        grouped.map((group) => (
          <Card key={group.label} title={`${group.label[0].toUpperCase()}${group.label.slice(1).replace("_", " ")} (${group.items.length})`}>
            <div className="space-y-2">
              {group.items.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => setActiveKey(item.id)}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-md ${PRIORITY_STYLES[item.priority]}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {item.pinned && <Pin size={13} className="shrink-0" />}
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${SLA_DOT[item.sla?.state] || SLA_DOT.on_track}`} title={`SLA: ${item.sla?.state}`} />
                      <p className="truncate text-sm font-bold">{item.typeLabel}</p>
                      <span className="rounded-full border border-current/20 bg-white/50 px-2 py-0.5 text-[11px] font-bold uppercase">
                        {STATUS_LABELS[item.status] || item.status}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs opacity-80">{item.reason}</p>
                    <p className="mt-0.5 text-xs opacity-60">
                      {item.patient?.name ? `Patient: ${item.patient.name}` : ""}
                      {item.doctor?.name ? `${item.patient?.name ? " · " : ""}Doctor: ${item.doctor.name}` : ""}
                      {item.assignedTo?.name ? ` · Assigned: ${item.assignedTo.name}` : ""}
                      {item.relatedCount ? ` · ${item.relatedCount} related` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs font-black uppercase opacity-70">Open →</span>
                </button>
              ))}
            </div>
          </Card>
        ))
      )}

      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-600">
          <p>
            Page {pagination.page} of {pagination.totalPages} · {pagination.total} matching operation{pagination.total === 1 ? "" : "s"}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" disabled={pagination.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Previous
            </Button>
            <Button variant="secondary" disabled={pagination.page >= pagination.totalPages} onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}>
              Next
            </Button>
          </div>
        </div>
      )}

      {activeKey && (
        <OperationsWorkspaceDrawer
          operationKey={activeKey}
          admins={admins}
          onClose={() => setActiveKey(null)}
          onChanged={() => load(page, debouncedSearch)}
        />
      )}
    </div>
  );
}

export default AdminOperationsCenter;
