import { AlertTriangle, Bell, ChevronLeft, ChevronRight, Inbox as InboxIcon, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { realtimeApi } from "../../api/realtimeApi";
import { getApiErrorMessage } from "../../api/axios";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import EmptyState from "../../components/shared/EmptyState";
import ErrorState from "../../components/shared/ErrorState";
import Loader from "../../components/ui/Loader";
import { useRealtime } from "../../context/RealtimeContext";
import { useToast } from "../../context/ToastContext";

const PRIORITY_META = {
  urgent: { label: "Urgent", tone: "danger" },
  action_required: { label: "Action Required", tone: "warning" },
  information: { label: "Information", tone: "neutral" },
};

const PRIORITY_TABS = [
  { value: "", label: "All" },
  { value: "urgent", label: "Urgent" },
  { value: "action_required", label: "Action Required" },
  { value: "information", label: "Information" },
];

function formatWhen(value) {
  return new Date(value).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function InboxItem({ item, onOpen, isMarking }) {
  const meta = PRIORITY_META[item.priority] || PRIORITY_META.information;
  return (
    <div
      className={`flex flex-col gap-3 rounded-2xl border p-4 transition sm:flex-row sm:items-start sm:justify-between ${
        item.readAt ? "border-slate-200 bg-slate-50/60" : "border-blue-200 bg-blue-50/50"
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {!item.readAt && <span className="h-2 w-2 rounded-full bg-blue-600" aria-label="Unread" />}
          <p className="font-black text-slate-950">{item.title}</p>
          <Badge tone={meta.tone}>{meta.label}</Badge>
          <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400">{item.categoryLabel}</span>
        </div>
        <p className="mt-1 text-sm text-slate-600">{item.message}</p>
        <p className="mt-1 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">{formatWhen(item.createdAt)}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {item.action && (
          <Button variant={item.priority === "urgent" ? "danger" : "secondary"} size="sm" to={item.action.to} onClick={() => onOpen(item)}>
            {item.action.label}
          </Button>
        )}
        {!item.readAt && (
          <Button variant="tertiary" size="sm" isLoading={isMarking} onClick={() => onOpen(item, { markOnly: true })}>
            Mark read
          </Button>
        )}
      </div>
    </div>
  );
}

function DoctorSmartInbox() {
  const toast = useToast();
  const { dashboardSyncTick, notifications, markNotificationRead } = useRealtime();
  const [inbox, setInbox] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [markingId, setMarkingId] = useState("");

  const load = async (targetPage = page) => {
    setIsLoading(true);
    setError("");
    try {
      const params = { page: targetPage, pageSize: 20 };
      if (search.trim()) params.search = search.trim();
      if (categoryFilter) params.category = categoryFilter;
      if (priorityFilter) params.priority = priorityFilter;
      if (unreadOnly) params.unread = "true";
      const res = await realtimeApi.getSmartInbox(params);
      setInbox(res.data);
      setPage(res.data?.pagination?.page || 1);
    } catch (loadError) {
      setError(getApiErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load(1);
  }, [search, categoryFilter, priorityFilter, unreadOnly]);

  // Realtime (STEP 8): dashboardSyncTick covers appointment/payment socket
  // events, but several producers (review, document, verification,
  // subscription) only ever emit "notification:new" — a signal
  // RealtimeContext already captures into `notifications`, just not one
  // this page previously listened to. Reacting to the newest notification's
  // id + list length (not the whole array reference) means a read-state-only
  // update from markNotificationRead below does NOT trigger a redundant
  // refetch — only a genuinely new incoming notification does.
  const latestNotificationSignal = `${notifications[0]?._id || ""}:${notifications.length}`;
  useEffect(() => {
    load(page);
  }, [dashboardSyncTick, latestNotificationSignal]);

  const handleOpen = async (item, { markOnly = false } = {}) => {
    if (item.readAt) return;
    setMarkingId(item._id);
    try {
      await markNotificationRead(item._id);
      setInbox((current) =>
        current
          ? { ...current, items: current.items.map((i) => (i._id === item._id ? { ...i, readAt: new Date().toISOString() } : i)) }
          : current,
      );
    } catch (readError) {
      toast.error(getApiErrorMessage(readError));
    } finally {
      setMarkingId("");
    }
    if (markOnly) return;
  };

  const runSearch = () => setSearch(searchInput);

  const items = inbox?.items || [];
  const summary = inbox?.attentionSummary || { urgent: 0, actionRequired: 0, unread: 0, total: 0 };
  const categories = inbox?.categories || [];
  const pagination = inbox?.pagination;

  // Frontend renders tier headers by walking the already-priority-sorted
  // page in order (STEP 10 layout) rather than fetching separate grouped
  // arrays — the backend guarantees urgent/action-required/information
  // ordering when no explicit priority filter is set.
  const groupedRuns = useMemo(() => {
    const runs = [];
    for (const item of items) {
      const last = runs[runs.length - 1];
      if (last && last.priority === item.priority) last.items.push(item);
      else runs.push({ priority: item.priority, items: [item] });
    }
    return runs;
  }, [items]);

  const emptyStateFor = () => {
    if (search.trim()) return <EmptyState title="No matches" description="No inbox items match your search." />;
    if (priorityFilter === "urgent") return <EmptyState title="You're clear" description="No urgent items right now." />;
    if (unreadOnly) return <EmptyState title="You're all caught up" description="No unread items right now." />;
    return <EmptyState title="Inbox is clear" description="Nothing matches these filters right now." />;
  };

  if (isLoading && !inbox) return <Loader label="Loading inbox…" />;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Smart Inbox</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Everything that needs your attention</h1>
        <p className="mt-2 text-sm text-slate-600">
          What happened, what needs you, and what's safe to skip — one work queue instead of six pages.
        </p>
      </div>

      {error ? (
        <ErrorState description={error} onRetry={() => load(page)} />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Card className="!p-4">
              <p className="text-3xl font-black text-red-600">{summary.urgent}</p>
              <p className="text-sm font-bold text-slate-500">Urgent</p>
            </Card>
            <Card className="!p-4">
              <p className="text-3xl font-black text-amber-600">{summary.actionRequired}</p>
              <p className="text-sm font-bold text-slate-500">Action Required</p>
            </Card>
            <Card className="!p-4">
              <p className="text-3xl font-black text-blue-600">{summary.unread}</p>
              <p className="text-sm font-bold text-slate-500">Unread</p>
            </Card>
          </div>

          <Card className="!p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <div className="flex flex-1 items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-2">
                <Search size={16} className="text-slate-400" />
                <input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && runSearch()}
                  placeholder="Search title, message, or category…"
                  className="w-full bg-transparent text-sm font-semibold text-slate-800 outline-none placeholder:text-slate-400"
                />
              </div>
              <select
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
              >
                <option value="">All categories</option>
                {categories.map((category) => (
                  <option key={category.key} value={category.key}>
                    {category.label} ({category.count})
                  </option>
                ))}
              </select>
              <Button variant={unreadOnly ? "primary" : "secondary"} onClick={() => setUnreadOnly((v) => !v)}>
                <Bell size={14} /> Unread only
              </Button>
              <Button onClick={runSearch}>Search</Button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {PRIORITY_TABS.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => setPriorityFilter(tab.value)}
                  className={`rounded-xl px-4 py-2 text-xs font-bold transition ${
                    priorityFilter === tab.value ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </Card>

          {isLoading ? (
            <Loader label="Loading inbox…" />
          ) : items.length ? (
            <div className="space-y-6">
              {groupedRuns.map((run, index) => {
                const meta = PRIORITY_META[run.priority] || PRIORITY_META.information;
                const showHeader = !priorityFilter; // filtered-to-one-tier views don't need a repeated header
                return (
                  <div key={`${run.priority}-${index}`} className="space-y-2">
                    {showHeader && (
                      <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                        {run.priority === "urgent" && <AlertTriangle size={13} className="text-red-600" />}
                        {meta.label}
                      </p>
                    )}
                    <div className="space-y-2">
                      {run.items.map((item) => (
                        <InboxItem key={item._id} item={item} onOpen={handleOpen} isMarking={markingId === item._id} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            emptyStateFor()
          )}

          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-slate-500">
                Page {pagination.page} of {pagination.totalPages} · {pagination.total} item{pagination.total === 1 ? "" : "s"}
              </p>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={!pagination.hasPrevious} onClick={() => load(page - 1)}>
                  <ChevronLeft size={14} /> Prev
                </Button>
                <Button variant="secondary" size="sm" disabled={!pagination.hasNext} onClick={() => load(page + 1)}>
                  Next <ChevronRight size={14} />
                </Button>
              </div>
            </div>
          )}

          {!items.length && !isLoading && !pagination && (
            <div className="flex justify-center text-slate-300">
              <InboxIcon size={28} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default DoctorSmartInbox;
