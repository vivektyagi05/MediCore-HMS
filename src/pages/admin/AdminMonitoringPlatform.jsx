import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Sparkles,
  Search,
  RefreshCcw,
  AlertTriangle,
  Gauge,
  ListTree,
  Repeat,
} from "lucide-react";
import { monitoringApi } from "../../api/monitoringApi";
import { getApiErrorMessage } from "../../api/axios";
import { useRealtime } from "../../context/RealtimeContext";
import { useToast } from "../../context/ToastContext";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import Loader from "../../components/ui/Loader";
import EmptyState from "../../components/shared/EmptyState";
import { MiniBarChart } from "../../components/finance/FinanceCharts";
import MonitoringExecutionDrawer from "../../components/admin/MonitoringExecutionDrawer";

// ─────────────────────────────────────────────────────────────────────────
// Phase A6.2.4 — Enterprise Monitoring Platform.
//
// One connected hub (brief: "Everything connected. Not separate pages.")
// with internal tabs rather than separate routes, same choice
// AdminAutomationStudio.jsx made for its Home/Flows/Builder/Simulator
// surfaces. Reuses dashboardSyncTick for realtime refresh (brief Step 11 —
// "Reuse existing Socket system. No new sockets.") and links out to
// AdminWorkflowEngine/AdminAutomationStudio rather than duplicating either.
//
// Scope note (see CHANGELOG-A6.2.4 for the full audit): "Retry Center" and
// "Dead Letter Queue" here are the real Payment retry queue
// (Payment.retryCount/nextRetryAt), not a generic AutomationFlow retry
// concept — flow runs are synchronous/one-shot with no queue or retry
// semantic anywhere in actionExecutor.js. "Execution Graph" is a
// sequential timeline, not a branching DAG — this codebase's actions run
// strictly in order. "Dependency Graph" is a trigger fan-out view (which
// published flows subscribe to which real trigger) — flows have no
// inter-flow dependency edges to form a cycle-detectable graph.
// ─────────────────────────────────────────────────────────────────────────

const TABS = [
  { key: "dashboard", label: "Dashboard", icon: Gauge },
  { key: "executions", label: "Execution Explorer", icon: Search },
  { key: "flow-health", label: "Flow & Cron Health", icon: Activity },
  { key: "performance", label: "Performance", icon: Sparkles },
  { key: "failures", label: "Failure Intelligence", icon: AlertTriangle },
  { key: "retry", label: "Payment Retry Queue", icon: Repeat },
  { key: "dependency", label: "Dependency Fan-out", icon: ListTree },
];

function StatTile({ label, value, tone = "slate" }) {
  const toneClass = {
    slate: "text-slate-950",
    emerald: "text-emerald-700",
    rose: "text-rose-700",
    amber: "text-amber-700",
    blue: "text-blue-700",
  }[tone];
  return (
    <div className="rounded-xl border border-slate-200 bg-white/60 p-4">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-black ${toneClass}`}>{value}</p>
    </div>
  );
}

function fmtDuration(ms) {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function fmtCurrency(amount) {
  if (amount == null) return "—";
  return `₹${Number(amount).toLocaleString("en-IN")}`;
}

// ── Dashboard tab ──────────────────────────────────────────────────────
function DashboardTab({ tick }) {
  const [overview, setOverview] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [isRateLimited, setIsRateLimited] = useState(false);
  const [aiSummary, setAiSummary] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setError("");
    setIsRateLimited(false);
    monitoringApi
      .getOverview()
      .then((res) => active && setOverview(res.data))
      .catch((err) => {
        if (!active) return;
        setIsRateLimited(err?.response?.status === 429);
        setError(getApiErrorMessage(err));
      })
      .finally(() => active && setIsLoading(false));
    return () => {
      active = false;
    };
  }, [tick, retryToken]);

  const loadAiSummary = async () => {
    setAiLoading(true);
    try {
      const res = await monitoringApi.getOverviewAiSummary();
      setAiSummary(res.data);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setAiLoading(false);
    }
  };

  if (isLoading) return <Loader label="Loading monitoring dashboard…" />;
  if (isRateLimited) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center">
        <AlertTriangle className="text-amber-600" size={24} />
        <p className="text-sm font-bold text-amber-800">
          You're refreshing this dashboard faster than the server allows right now. Wait a moment, then try again.
        </p>
        <Button variant="secondary" onClick={() => setRetryToken((current) => current + 1)}>
          Try again
        </Button>
      </div>
    );
  }
  if (error) return <p className="text-sm font-semibold text-rose-700">{error}</p>;
  if (!overview) return null;

  const { liveCounters, executionKPIs } = overview;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Today's Executions" value={liveCounters.todayTotal} />
        <StatTile label="Completed" value={liveCounters.completed} tone="emerald" />
        <StatTile label="Failed" value={liveCounters.failed} tone="rose" />
        <StatTile label="Skipped" value={liveCounters.skipped} tone="amber" />
        <StatTile label="Running Cron Jobs" value={liveCounters.running} tone="blue" />
        <StatTile label="Success Rate" value={`${executionKPIs.successRate}%`} tone="emerald" />
        <StatTile label="Failure Rate" value={`${executionKPIs.failureRate}%`} tone="rose" />
        <StatTile label="Avg Runtime" value={fmtDuration(executionKPIs.avgDurationMs)} />
      </div>

      <Card title={`Hourly Executions — last ${executionKPIs.rangeDays} day(s)`}>
        <MiniBarChart
          data={executionKPIs.hourlyExecutions}
          valueKey="count"
          labelKey="hour"
          formatValue={(v) => v}
        />
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Top Failing Flows">
          {overview.topFailingFlows?.length ? (
            <ul className="space-y-2 text-sm">
              {overview.topFailingFlows.map((f) => (
                <li key={f.id} className="flex justify-between">
                  <span className="font-semibold text-slate-800">{f.name}</span>
                  <span className="font-black text-rose-700">{f.successRate}% success</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No flow has a concerning failure rate.</p>
          )}
        </Card>
        <Card title="Top Slow Flows">
          {overview.topSlowFlows?.length ? (
            <ul className="space-y-2 text-sm">
              {overview.topSlowFlows.map((f) => (
                <li key={f.id} className="flex justify-between">
                  <span className="font-semibold text-slate-800">{f.name}</span>
                  <span className="font-black text-slate-700">{fmtDuration(f.avgDurationMs)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No flow stands out as unusually slow.</p>
          )}
        </Card>
      </div>

      <Card
        title="AI Health Summary"
        action={
          !aiSummary && (
            <Button variant="secondary" onClick={loadAiSummary} disabled={aiLoading}>
              <Sparkles size={16} /> {aiLoading ? "Analyzing…" : "Generate Summary"}
            </Button>
          )
        }
      >
        {aiSummary ? (
          <div className="space-y-2 text-sm text-slate-700">
            <p>{aiSummary.summary}</p>
            <p>{aiSummary.worstNote}</p>
            <p>{aiSummary.cronNote}</p>
            <p className="font-semibold text-blue-700">{aiSummary.advice}</p>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Generate a grounded health summary from real flow and cron data.</p>
        )}
      </Card>
    </div>
  );
}

// ── Execution Explorer tab ─────────────────────────────────────────────
function ExecutionExplorerTab() {
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 25, total: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState({ source: "flow", status: "", search: "" });
  const [selected, setSelected] = useState(null);

  const load = async (page = 1) => {
    setIsLoading(true);
    setError("");
    try {
      const params = { page, limit: 25 };
      if (filters.source) params.source = filters.source;
      if (filters.status) params.status = filters.status;
      if (filters.search) params.search = filters.search;
      const res = await monitoringApi.listExecutions(params);
      setRows(res.data);
      setPagination(res.pagination);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load(1);
  }, [filters.source, filters.status]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold"
          value={filters.source}
          onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value }))}
        >
          <option value="flow">Automation Flow Runs</option>
          <option value="cron">Background Job Runs</option>
        </select>
        <select
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold"
          value={filters.status}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
        >
          <option value="">All Statuses</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
          {filters.source === "flow" && <option value="skipped">Skipped</option>}
          {filters.source === "cron" && <option value="running">Running</option>}
        </select>
        {filters.source === "flow" && (
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              load(1);
            }}
          >
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Search by flow name…"
              value={filters.search}
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
            />
            <Button type="submit" variant="secondary">
              <Search size={16} />
            </Button>
          </form>
        )}
        <Button variant="secondary" onClick={() => load(pagination.page)}>
          <RefreshCcw size={16} />
        </Button>
      </div>

      {isLoading && <Loader label="Loading executions…" />}
      {error && <p className="text-sm font-semibold text-rose-700">{error}</p>}
      {!isLoading && !error && rows.length === 0 && (
        <EmptyState title="No executions found" description="No runs match these filters yet." />
      )}

      {!isLoading && rows.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-black uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Trigger</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Started</th>
                <th className="px-4 py-2">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="cursor-pointer hover:bg-blue-50/60"
                  onClick={() => setSelected(row)}
                >
                  <td className="px-4 py-2 font-semibold text-slate-800">{row.name}</td>
                  <td className="px-4 py-2 text-slate-600">{row.triggerLabel || "—"}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                        row.status === "success"
                          ? "bg-emerald-50 text-emerald-700"
                          : row.status === "failed"
                            ? "bg-rose-50 text-rose-700"
                            : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-600">{row.startedAt ? new Date(row.startedAt).toLocaleString() : "—"}</td>
                  <td className="px-4 py-2 text-slate-600">{fmtDuration(row.durationMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-500">
            <span>
              Page {pagination.page} — {pagination.total} total
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={pagination.page <= 1} onClick={() => load(pagination.page - 1)}>
                Previous
              </Button>
              <Button
                variant="secondary"
                disabled={pagination.page * pagination.limit >= pagination.total}
                onClick={() => load(pagination.page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <MonitoringExecutionDrawer executionId={selected.id} source={selected.source} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

// ── Flow & Cron Health tab ─────────────────────────────────────────────
function FlowCronHealthTab() {
  const [flowHealth, setFlowHealth] = useState(null);
  const [cronHealth, setCronHealth] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([monitoringApi.getFlowHealth(), monitoringApi.getCronHealth()])
      .then(([fh, ch]) => {
        setFlowHealth(fh.data);
        setCronHealth(ch.data);
      })
      .catch((err) => setError(getApiErrorMessage(err)))
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading) return <Loader label="Loading health rankings…" />;
  if (error) return <p className="text-sm font-semibold text-rose-700">{error}</p>;

  return (
    <div className="space-y-6">
      <Card title={`Automation Flows (${flowHealth.publishedFlows} published / ${flowHealth.totalFlows} total)`}>
        {flowHealth.flows.length === 0 ? (
          <p className="text-sm text-slate-500">No flows created yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs font-black uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2">Flow</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Runs</th>
                  <th className="py-2">Success Rate</th>
                  <th className="py-2">Avg Duration</th>
                  <th className="py-2">Last Run</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {flowHealth.flows.map((f) => (
                  <tr key={f.id}>
                    <td className="py-2 font-semibold text-slate-800">{f.name}</td>
                    <td className="py-2 text-slate-600">{f.status}</td>
                    <td className="py-2 text-slate-600">{f.totalRuns}</td>
                    <td className="py-2 text-slate-600">{f.successRate == null ? "—" : `${f.successRate}%`}</td>
                    <td className="py-2 text-slate-600">{fmtDuration(f.avgDurationMs)}</td>
                    <td className="py-2 text-slate-600">{f.lastRunStatus || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={`Background Jobs (${cronHealth.healthyCount} of ${cronHealth.totalCount} healthy)`}>
        {cronHealth.jobs.length === 0 ? (
          <p className="text-sm text-slate-500">No background job runs recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs font-black uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2">Job</th>
                  <th className="py-2">Latest Status</th>
                  <th className="py-2">Runs</th>
                  <th className="py-2">Failures</th>
                  <th className="py-2">Avg Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cronHealth.jobs.map((j) => (
                  <tr key={j.jobName}>
                    <td className="py-2 font-semibold text-slate-800">{j.jobName}</td>
                    <td className="py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                          j.latestStatus === "success" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                        }`}
                      >
                        {j.latestStatus || "—"}
                      </span>
                    </td>
                    <td className="py-2 text-slate-600">{j.totalRuns}</td>
                    <td className="py-2 text-slate-600">{j.failureCount}</td>
                    <td className="py-2 text-slate-600">{fmtDuration(j.avgDurationMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ── Performance Intelligence tab ───────────────────────────────────────
function PerformanceTab() {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [advisor, setAdvisor] = useState(null);
  const [advisorLoading, setAdvisorLoading] = useState(false);

  useEffect(() => {
    monitoringApi
      .getPerformance()
      .then((res) => setData(res.data))
      .catch((err) => setError(getApiErrorMessage(err)))
      .finally(() => setIsLoading(false));
  }, []);

  const loadAdvisor = async () => {
    setAdvisorLoading(true);
    try {
      const res = await monitoringApi.getPerformanceAiAdvisor();
      setAdvisor(res.data);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setAdvisorLoading(false);
    }
  };

  if (isLoading) return <Loader label="Loading performance intelligence…" />;
  if (error) return <p className="text-sm font-semibold text-rose-700">{error}</p>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Total Executions" value={data.totalExecutions} />
        <StatTile label="Avg Duration" value={fmtDuration(data.avgDurationMs)} />
        <StatTile label="P95 Duration" value={fmtDuration(data.p95DurationMs)} tone="amber" />
        <StatTile label="Peak Hour" value={data.peakHour != null ? `${data.peakHour}:00` : "—"} />
      </div>

      <Card title="Trigger Distribution">
        <MiniBarChart data={data.triggerDistribution} valueKey="count" labelKey="triggerLabel" formatValue={(v) => v} />
      </Card>

      <Card title="Action Distribution">
        <MiniBarChart data={data.actionDistribution} valueKey="count" labelKey="actionType" formatValue={(v) => v} />
      </Card>

      {data.slowestFlow && (
        <Card title="Slowest Flow">
          <p className="text-sm text-slate-700">
            <span className="font-semibold text-slate-900">{data.slowestFlow.name}</span> averages{" "}
            {fmtDuration(data.slowestFlow.avgDurationMs)} per run.
          </p>
        </Card>
      )}

      <Card
        title="AI Performance Advisor"
        action={
          !advisor && (
            <Button variant="secondary" onClick={loadAdvisor} disabled={advisorLoading}>
              <Sparkles size={16} /> {advisorLoading ? "Analyzing…" : "Get Advice"}
            </Button>
          )
        }
      >
        {advisor ? (
          <div className="space-y-2 text-sm text-slate-700">
            <p>{advisor.summary}</p>
            <p>{advisor.peakNote}</p>
            <p>{advisor.slowestNote}</p>
            <p className="font-semibold text-blue-700">{advisor.advice}</p>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Get a grounded read on runtime health.</p>
        )}
      </Card>
    </div>
  );
}

// ── Failure Intelligence tab ───────────────────────────────────────────
function FailuresTab() {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [explain, setExplain] = useState(null);
  const [explainLoading, setExplainLoading] = useState(false);

  useEffect(() => {
    monitoringApi
      .getFailures()
      .then((res) => setData(res.data))
      .catch((err) => setError(getApiErrorMessage(err)))
      .finally(() => setIsLoading(false));
  }, []);

  const loadExplain = async () => {
    setExplainLoading(true);
    try {
      const res = await monitoringApi.getFailuresAiExplain();
      setExplain(res.data);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setExplainLoading(false);
    }
  };

  if (isLoading) return <Loader label="Loading failure intelligence…" />;
  if (error) return <p className="text-sm font-semibold text-rose-700">{error}</p>;

  return (
    <div className="space-y-6">
      <StatTile label={`Failures — last ${data.rangeDays} day(s)`} value={data.totalFailures} tone="rose" />

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Failures by Trigger">
          {data.byTriggerType.length ? (
            <ul className="space-y-2 text-sm">
              {data.byTriggerType.map((t) => (
                <li key={t.triggerType} className="flex justify-between">
                  <span className="text-slate-700">{t.triggerLabel}</span>
                  <span className="font-black text-rose-700">{t.count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No failures recorded.</p>
          )}
        </Card>
        <Card title="Failures by Action Type">
          {data.byActionType.length ? (
            <ul className="space-y-2 text-sm">
              {data.byActionType.map((a) => (
                <li key={a.actionType} className="flex justify-between">
                  <span className="text-slate-700">{a.actionType}</span>
                  <span className="font-black text-rose-700">{a.count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No action-level failures recorded.</p>
          )}
        </Card>
      </div>

      <Card
        title="AI Failure Explain"
        action={
          !explain && (
            <Button variant="secondary" onClick={loadExplain} disabled={explainLoading}>
              <Sparkles size={16} /> {explainLoading ? "Analyzing…" : "Explain Pattern"}
            </Button>
          )
        }
      >
        {explain ? (
          <div className="space-y-2 text-sm text-slate-700">
            <p>{explain.summary}</p>
            <p>{explain.triggerNote}</p>
            <p>{explain.actionNote}</p>
            <p className="italic text-slate-500">{explain.sampleNote}</p>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Summarize the real failure pattern above.</p>
        )}
      </Card>
    </div>
  );
}

// ── Payment Retry Queue tab (real Dead Letter Queue) ───────────────────
function RetryQueueTab() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [advisor, setAdvisor] = useState(null);
  const [advisorLoading, setAdvisorLoading] = useState(false);
  const [resolvingId, setResolvingId] = useState("");

  const load = () => {
    setIsLoading(true);
    monitoringApi
      .getRetryQueue()
      .then((res) => setData(res.data))
      .catch((err) => setError(getApiErrorMessage(err)))
      .finally(() => setIsLoading(false));
  };

  useEffect(load, []);

  const loadAdvisor = async () => {
    setAdvisorLoading(true);
    try {
      const res = await monitoringApi.getRetryQueueAiAdvisor();
      setAdvisor(res.data);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setAdvisorLoading(false);
    }
  };

  const resolve = async (paymentId) => {
    setResolvingId(paymentId);
    try {
      await monitoringApi.resolveDeadLetterPayment(paymentId);
      toast?.success?.("Payment marked reviewed.");
      load();
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setResolvingId("");
    }
  };

  if (isLoading) return <Loader label="Loading payment retry queue…" />;
  if (error) return <p className="text-sm font-semibold text-rose-700">{error}</p>;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
        This tracks real <span className="font-semibold">Payment.retryCount</span> / <span className="font-semibold">nextRetryAt</span> data
        written by the existing <code>retryFailedPayments</code> cron job — not a generic automation-flow retry concept (flow runs are
        one-shot and have no retry semantic).
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatTile label="In Retry Window" value={data.inRetryWindowCount} tone="amber" />
        <StatTile label="Dead Letter (Exhausted)" value={data.deadLetterCount} tone="rose" />
      </div>

      <Card title={`Dead Letter Queue — retries exhausted (max ${data.maxRetries})`}>
        {data.deadLetter.length === 0 ? (
          <p className="text-sm text-slate-500">No payment has exhausted its retry attempts right now.</p>
        ) : (
          <div className="space-y-2">
            {data.deadLetter.map((p) => (
              <div key={p._id} className="flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm">
                <div>
                  <p className="font-semibold text-slate-800">{fmtCurrency(p.amount)}</p>
                  <p className="text-xs text-slate-500">
                    Failed {p.failedAt ? new Date(p.failedAt).toLocaleDateString() : "—"} — {p.retryCount} attempt(s)
                  </p>
                </div>
                <Button variant="secondary" disabled={resolvingId === p._id} onClick={() => resolve(p._id)}>
                  {resolvingId === p._id ? "Marking…" : "Mark Reviewed"}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="In Retry Window">
        {data.inRetryWindow.length === 0 ? (
          <p className="text-sm text-slate-500">No payment is currently scheduled for retry.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {data.inRetryWindow.map((p) => (
              <li key={p._id} className="flex justify-between rounded-lg border border-amber-200 bg-amber-50 p-3">
                <span className="font-semibold text-slate-800">{fmtCurrency(p.amount)}</span>
                <span className="text-slate-600">
                  Attempt {p.retryCount}/{data.maxRetries} — next {p.nextRetryAt ? new Date(p.nextRetryAt).toLocaleString() : "—"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="AI Retry Advisor"
        action={
          !advisor && (
            <Button variant="secondary" onClick={loadAdvisor} disabled={advisorLoading}>
              <Sparkles size={16} /> {advisorLoading ? "Analyzing…" : "Get Advice"}
            </Button>
          )
        }
      >
        {advisor ? (
          <div className="space-y-2 text-sm text-slate-700">
            <p>{advisor.summary}</p>
            <p className="font-semibold text-blue-700">{advisor.advice}</p>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Get grounded advice on the current retry queue.</p>
        )}
      </Card>
    </div>
  );
}

// ── Dependency Fan-out tab ──────────────────────────────────────────────
function DependencyFanoutTab() {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    monitoringApi
      .getDependencyFanout()
      .then((res) => setData(res.data))
      .catch((err) => setError(getApiErrorMessage(err)))
      .finally(() => setIsLoading(false));
  }, []);

  if (isLoading) return <Loader label="Loading dependency fan-out…" />;
  if (error) return <p className="text-sm font-semibold text-rose-700">{error}</p>;

  return (
    <div className="space-y-3">
      <p className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
        Which published flows subscribe to each real trigger. Flows have no dependency edges on each other in this codebase, so this is a
        fan-out view rather than a cycle-detectable dependency graph.
      </p>
      {data.map((t) => (
        <Card key={t.triggerType} title={t.triggerLabel}>
          {t.subscribedFlows.length === 0 ? (
            <p className="text-sm text-slate-500">No published flow currently subscribes to this trigger.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {t.subscribedFlows.map((f) => (
                <li key={f.id} className="font-semibold text-slate-800">
                  {f.name}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}
    </div>
  );
}

// ── Page shell ───────────────────────────────────────────────────────────
function AdminMonitoringPlatform() {
  const { dashboardSyncTick } = useRealtime();
  const [activeTab, setActiveTab] = useState("dashboard");

  const TabComponent = useMemo(() => {
    switch (activeTab) {
      case "executions":
        return <ExecutionExplorerTab />;
      case "flow-health":
        return <FlowCronHealthTab />;
      case "performance":
        return <PerformanceTab />;
      case "failures":
        return <FailuresTab />;
      case "retry":
        return <RetryQueueTab />;
      case "dependency":
        return <DependencyFanoutTab />;
      default:
        return <DashboardTab tick={dashboardSyncTick} />;
    }
  }, [activeTab, dashboardSyncTick]);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">Automation Studio · Enterprise</p>
        <h1 className="text-2xl font-black text-slate-950">Monitoring Platform</h1>
        <p className="mt-1 text-sm text-slate-600">
          Every real automation-flow and background-job execution — observable, searchable, and explainable.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                activeTab === tab.key ? "bg-blue-600 text-white shadow" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Icon size={16} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {TabComponent}
    </div>
  );
}

export default AdminMonitoringPlatform;
