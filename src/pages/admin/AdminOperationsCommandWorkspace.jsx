import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Database,
  Gauge,
  History,
  RefreshCcw,
  ShieldCheck,
  Wifi,
  Workflow,
} from "lucide-react";
import { adminApi } from "../../api/adminApi";
import { monitoringApi } from "../../api/monitoringApi";
import { getApiErrorMessage } from "../../api/axios";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import Loader from "../../components/ui/Loader";
import EmptyState from "../../components/shared/EmptyState";
import { useRealtime } from "../../context/RealtimeContext";
import OperationalAttentionPanel from "../../components/admin/OperationalAttentionPanel";
import OperationsWorkspaceDrawer from "../../components/admin/OperationsWorkspaceDrawer";

// ─────────────────────────────────────────────────────────────────────────
// Phase UI-10 — Mission Control, Platform Health & Operations Command
// Workspace.
//
// AUDIT FINDING this page exists to fix: Mission Control, Platform Health,
// the Unified Operations Queue, Smart Assignment, Monitoring, and Workflow
// Intelligence already existed as 6 fully-built, fully-real, disconnected
// pages with no shared operational view and no cross-cutting attention
// surface. UI-9 (AdminDashboard) is the executive KPI/decision surface;
// this page is the operational investigation surface the brief calls for
// — every number and list here is fetched from the exact same builders
// those pages already use (buildMissionControlData, buildPlatformHealthCenter,
// buildUnifiedQueue, buildWorkloadIntelligence snapshots, buildFlowHealthRanking,
// buildCronHealthRanking, buildFailureIntelligence, buildExecutiveTimeline).
// Nothing here recalculates anything; nothing here is a second dashboard —
// there are no executive KPIs, no revenue, no growth charts. Every section
// below deep-links to the existing dedicated page for full depth/actions.
// ─────────────────────────────────────────────────────────────────────────

const STATUS_STYLES = {
  healthy: "text-emerald-700 bg-emerald-50 border-emerald-200",
  warning: "text-amber-700 bg-amber-50 border-amber-200",
  degraded: "text-amber-700 bg-amber-50 border-amber-200",
  critical: "text-rose-700 bg-rose-50 border-rose-200",
};

function fmtDate(value) {
  if (!value) return "Not available";
  return new Date(value).toLocaleString();
}

// ── A resilient section wrapper: one failed data source never breaks the
// rest of the workspace (Phase UI-10, Rule/Section 15). ────────────────
function SectionState({ isLoading, error, onRetry, isEmpty, emptyProps, children }) {
  if (isLoading) return <Loader label="Loading" />;
  if (error) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-bold text-rose-700">
        <span>{error}</span>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <RefreshCcw size={14} /> Retry
        </Button>
      </div>
    );
  }
  if (isEmpty) return <EmptyState {...emptyProps} />;
  return children;
}

function StatusStrip() {
  const { dashboardSyncTick } = useRealtime();
  const [missionControl, setMissionControl] = useState(null);
  const [platformHealth, setPlatformHealth] = useState(null);
  const [mcError, setMcError] = useState("");
  const [phError, setPhError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const load = async () => {
    setIsLoading(true);
    const [mc, ph] = await Promise.allSettled([adminApi.getMissionControl(), adminApi.getPlatformHealth()]);
    if (mc.status === "fulfilled") {
      setMissionControl(mc.value.data);
      setMcError("");
    } else {
      setMcError(getApiErrorMessage(mc.reason));
    }
    if (ph.status === "fulfilled") {
      setPlatformHealth(ph.value.data);
      setPhError("");
    } else {
      setPhError(getApiErrorMessage(ph.reason));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    load();
  }, [dashboardSyncTick]);

  if (isLoading && !missionControl && !platformHealth) return <Loader label="Loading platform status" />;

  const overall = platformHealth?.overallHealth;

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card
        title="Platform Health"
        action={<Button variant="secondary" size="sm" to="/admin/platform-health">Open</Button>}
      >
        {phError ? (
          <p className="text-sm font-bold text-rose-600">{phError}</p>
        ) : (
          <div className="flex items-center gap-3">
            <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-black uppercase ${STATUS_STYLES[overall?.status] || STATUS_STYLES.healthy}`}>
              <ShieldCheck size={14} /> {overall?.status || "Unknown"}
            </span>
            <span className="text-2xl font-black text-slate-950">{overall?.score ?? "—"}<span className="text-sm font-bold text-slate-400">/100</span></span>
          </div>
        )}
      </Card>

      <Card title="Live Presence" action={<Button variant="secondary" size="sm" to="/admin/mission-control">Open</Button>}>
        {mcError ? (
          <p className="text-sm font-bold text-rose-600">{mcError}</p>
        ) : (
          <div className="flex items-center gap-4 text-sm font-bold text-slate-700">
            <span className="flex items-center gap-1.5"><Wifi size={14} className="text-emerald-600" /> {missionControl?.presence?.activeSessions ?? 0} online</span>
            <span>{missionControl?.liveConsultations ?? 0} live consults</span>
          </div>
        )}
      </Card>

      <Card title="Database" action={<Database size={18} className="text-slate-400" />}>
        {mcError ? (
          <p className="text-sm font-bold text-rose-600">{mcError}</p>
        ) : (
          <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-black uppercase ${missionControl?.system?.database?.healthy ? STATUS_STYLES.healthy : STATUS_STYLES.critical}`}>
            {missionControl?.system?.database?.state || "Unknown"}
          </span>
        )}
      </Card>
    </div>
  );
}

function OperationsQueuePreview({ onInvestigate }) {
  const [state, setState] = useState({ isLoading: true, error: "", data: null });

  const load = async () => {
    setState((s) => ({ ...s, isLoading: true, error: "" }));
    try {
      const response = await adminApi.getUnifiedOperationsQueue({ priority: "critical", page: 1, pageSize: 10 });
      setState({ isLoading: false, error: "", data: response.data });
    } catch (err) {
      setState({ isLoading: false, error: getApiErrorMessage(err), data: null });
    }
  };

  useEffect(() => {
    load();
  }, []);

  const items = state.data?.items || [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">Highest-priority items across the real Unified Operations Queue — every field traces to the same builder the full Operations Center uses.</p>
        <Button to="/admin/operations-center">Open full Operations Queue</Button>
      </div>
      <SectionState
        isLoading={state.isLoading}
        error={state.error}
        onRetry={load}
        isEmpty={!state.isLoading && !state.error && items.length === 0}
        emptyProps={{ title: "No critical operations", description: "There are no open critical-priority operations in the queue right now." }}
      >
        <div className="space-y-2">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onInvestigate(item.id)}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-left text-rose-800 transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{item.typeLabel}</p>
                <p className="mt-0.5 truncate text-xs opacity-80">{item.reason}</p>
              </div>
              <span className="shrink-0 text-xs font-black uppercase">Open →</span>
            </button>
          ))}
        </div>
      </SectionState>
    </div>
  );
}

function SlaWorkloadTab() {
  const [state, setState] = useState({ isLoading: true, error: "", queueCounts: null, snapshots: null, capacity: null });

  const load = async () => {
    setState((s) => ({ ...s, isLoading: true, error: "" }));
    const [queueRes, workloadRes] = await Promise.allSettled([
      adminApi.getUnifiedOperationsQueue({ page: 1, pageSize: 1 }),
      adminApi.getWorkloadIntelligence(),
    ]);
    const queueCounts = queueRes.status === "fulfilled" ? queueRes.value.data.counts : null;
    const workload = workloadRes.status === "fulfilled" ? workloadRes.value.data : null;
    const error = queueRes.status === "rejected" && workloadRes.status === "rejected" ? getApiErrorMessage(queueRes.reason) : "";
    setState({ isLoading: false, error, queueCounts, snapshots: workload?.snapshots || null, capacity: workload?.capacity || null });
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <SectionState isLoading={state.isLoading} error={state.error} onRetry={load} isEmpty={false}>
      <div className="space-y-6">
        <div>
          <h3 className="mb-3 text-sm font-black uppercase tracking-wide text-slate-500">SLA Intelligence</h3>
          {state.queueCounts ? (
            <div className="grid gap-4 sm:grid-cols-3">
              <Card className="text-center">
                <p className="text-xs font-black uppercase text-slate-500">Overdue</p>
                <p className="mt-2 text-2xl font-black text-rose-600">{state.queueCounts.overdue}</p>
              </Card>
              <Card className="text-center">
                <p className="text-xs font-black uppercase text-slate-500">At Risk</p>
                <p className="mt-2 text-2xl font-black text-amber-600">{state.queueCounts.atRisk}</p>
              </Card>
              <Card className="text-center">
                <p className="text-xs font-black uppercase text-slate-500">Unassigned</p>
                <p className="mt-2 text-2xl font-black text-slate-950">{state.queueCounts.unassigned}</p>
              </Card>
            </div>
          ) : (
            <p className="text-sm text-slate-500">SLA data unavailable right now.</p>
          )}
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-black uppercase tracking-wide text-slate-500">Admin Workload</h3>
            <Button variant="secondary" size="sm" to="/admin/smart-assignment">Open Smart Assignment</Button>
          </div>
          {state.snapshots && state.snapshots.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs font-black uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Admin</th>
                    <th className="px-3 py-2">Open</th>
                    <th className="px-3 py-2">Overdue</th>
                    <th className="px-3 py-2">Utilization</th>
                    <th className="px-3 py-2">Burnout Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {state.snapshots.map((s) => (
                    <tr key={s.admin.id} className="border-t border-slate-100">
                      <td className="max-w-[200px] truncate px-3 py-2 font-bold">{s.admin.name}</td>
                      <td className="px-3 py-2">{s.openCount}</td>
                      <td className="px-3 py-2">{s.overdue}</td>
                      <td className="px-3 py-2">{s.utilization?.pct != null ? `${s.utilization.pct}%` : "Not available"}</td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-black uppercase ${s.burnoutRisk === "high" ? STATUS_STYLES.critical : s.burnoutRisk === "medium" ? STATUS_STYLES.warning : STATUS_STYLES.healthy}`}>
                          {s.burnoutRisk}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No workload data" description="No eligible admins were found to compute workload snapshots for." />
          )}
        </div>
      </div>
    </SectionState>
  );
}

function AutomationHealthTab() {
  const [state, setState] = useState({ isLoading: true, error: "", flows: null, failures: null, cron: null });

  const load = async () => {
    setState((s) => ({ ...s, isLoading: true, error: "" }));
    const [flowsRes, failuresRes, cronRes] = await Promise.allSettled([
      monitoringApi.getFlowHealth(),
      monitoringApi.getFailures(),
      monitoringApi.getCronHealth(),
    ]);
    setState({
      isLoading: false,
      error: [flowsRes, failuresRes, cronRes].every((r) => r.status === "rejected") ? "Automation health data is currently unavailable." : "",
      flows: flowsRes.status === "fulfilled" ? flowsRes.value.data : null,
      failures: failuresRes.status === "fulfilled" ? failuresRes.value.data : null,
      cron: cronRes.status === "fulfilled" ? cronRes.value.data : null,
    });
  };

  useEffect(() => {
    load();
  }, []);

  // buildFlowHealthRanking()/buildCronHealthRanking() (backend/monitoring/monitoringAggregates.js)
  // both return an object ({ flows, topFailing, ... } / { jobs, healthyCount, ... }), not a bare
  // array — confirmed against AdminMonitoringPlatform.jsx's FlowCronHealthTab, which consumes the
  // same two endpoints correctly. `topFailing` is already the worst-success-rate-first ranking
  // computed server-side, so reuse it here instead of re-deriving it client-side.
  const worstFlows = state.flows?.topFailing || [];
  const failedCron = (state.cron?.jobs || []).filter((j) => j.latestStatus === "failed");

  return (
    <SectionState isLoading={state.isLoading} error={state.error} onRetry={load} isEmpty={false}>
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <p className="text-xs font-black uppercase text-slate-500">Automation Failures (7d)</p>
            <p className="mt-2 text-2xl font-black text-slate-950">{state.failures?.totalFailures ?? "Not available"}</p>
          </Card>
          <Card>
            <p className="text-xs font-black uppercase text-slate-500">Cron Jobs Currently Failing</p>
            <p className="mt-2 text-2xl font-black text-rose-600">{failedCron.length}</p>
          </Card>
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-black uppercase tracking-wide text-slate-500">Lowest Success-Rate Flows</h3>
            <Button variant="secondary" size="sm" to="/admin/monitoring">Open Monitoring</Button>
          </div>
          {worstFlows.length > 0 ? (
            <div className="space-y-2">
              {worstFlows.map((f) => (
                <div key={f.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm">
                  <span className="truncate font-bold">{f.name}</span>
                  <span className={`font-black ${f.successRate != null && f.successRate < 70 ? "text-rose-600" : "text-slate-700"}`}>
                    {f.successRate != null ? `${f.successRate}%` : "Not available"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No flow run history" description="No published automation flows have run yet." />
          )}
        </div>

        <div className="flex justify-end">
          <Button variant="secondary" size="sm" to="/admin/workflow-intelligence">Open Workflow Intelligence (predictions, self-healing)</Button>
        </div>
      </div>
    </SectionState>
  );
}

function SystemEventsTab() {
  const [state, setState] = useState({ isLoading: true, error: "", events: null });

  const load = async () => {
    setState({ isLoading: true, error: "", events: null });
    try {
      const response = await adminApi.getExecutiveTimeline({ limit: 20 });
      setState({ isLoading: false, error: "", events: response.data });
    } catch (err) {
      setState({ isLoading: false, error: getApiErrorMessage(err), events: null });
    }
  };

  useEffect(() => {
    load();
  }, []);

  const events = state.events || [];

  return (
    <SectionState
      isLoading={state.isLoading}
      error={state.error}
      onRetry={load}
      isEmpty={!state.isLoading && !state.error && events.length === 0}
      emptyProps={{ title: "No recent events", description: "No admin actions, decisions, or system events in the last 30 days." }}
    >
      <div className="space-y-2">
        {events.map((e, i) => (
          <div key={i} className="flex items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 text-sm">
            <div className="min-w-0 flex-1">
              <p className="font-bold text-slate-900">{e.type}</p>
              <p className="mt-0.5 truncate text-xs text-slate-600">{e.label}</p>
            </div>
            <span className="shrink-0 text-xs text-slate-400">{fmtDate(e.at)}</span>
          </div>
        ))}
      </div>
    </SectionState>
  );
}

function AdminOperationsCommandWorkspace() {
  const [tab, setTab] = useState("attention");
  const [investigateKey, setInvestigateKey] = useState(null);
  const [admins, setAdmins] = useState([]);

  useEffect(() => {
    // BUGFIX (PHASE UI-14 audit) — same fix as AdminOperationsCenter.jsx:
    // getUsers() is now server-paginated, so filtering its first page
    // client-side for admin/super_admin would silently miss admins beyond
    // page 1. The real endpoint for this already existed (listAdmins) —
    // reused instead of duplicating pagination-aware filtering here.
    adminApi
      .getAdmins()
      .then((response) => {
        setAdmins(response.data?.admins || []);
      })
      .catch(() => setAdmins([]));
  }, []);

  const tabs = [
    { key: "attention", label: "Attention", icon: AlertTriangle },
    { key: "queue", label: "Operations Queue", icon: Activity },
    { key: "sla", label: "SLA & Workload", icon: Gauge },
    { key: "automation", label: "Automation Health", icon: Workflow },
    { key: "events", label: "System Events", icon: History },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Hospital Operations Center</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Operations Command Workspace</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            The operational investigation and action surface — cross-cutting attention, SLA/workload, and automation health, all composed from the real Mission Control, Platform Health, Operations Queue, Smart Assignment, and Monitoring systems. For executive KPIs, revenue, and platform-wide decisions, see the{" "}
            <a href="/admin/dashboard" className="font-bold text-royal-600 underline">
              Executive Command Center
            </a>
            .
          </p>
        </div>
      </div>

      <StatusStrip />

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition ${
                active ? "bg-royal-600 text-white shadow-sm" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === "attention" && <OperationalAttentionPanel onInvestigate={setInvestigateKey} />}
      {tab === "queue" && <OperationsQueuePreview onInvestigate={setInvestigateKey} />}
      {tab === "sla" && <SlaWorkloadTab />}
      {tab === "automation" && <AutomationHealthTab />}
      {tab === "events" && <SystemEventsTab />}

      {investigateKey && (
        <OperationsWorkspaceDrawer
          operationKey={investigateKey}
          admins={admins}
          onClose={() => setInvestigateKey(null)}
          onChanged={() => {}}
        />
      )}
    </div>
  );
}

export default AdminOperationsCommandWorkspace;
