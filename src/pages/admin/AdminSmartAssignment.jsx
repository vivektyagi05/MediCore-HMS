import { useEffect, useState } from "react";
import {
  RefreshCcw,
  Sparkles,
  Gauge,
  Users,
  AlertTriangle,
  BarChart3,
  ShieldCheck,
  Play,
} from "lucide-react";
import { adminApi } from "../../api/adminApi";
import { getApiErrorMessage } from "../../api/axios";
import { useRealtime } from "../../context/RealtimeContext";
import { useToast } from "../../context/ToastContext";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import Loader from "../../components/ui/Loader";
import EmptyState from "../../components/shared/EmptyState";
import { MiniBarChart, MiniDonut } from "../../components/finance/FinanceCharts";

// ─────────────────────────────────────────────────────────────────────────
// Phase A6.2.2 — Smart Assignment Engine (Enterprise AI Workload
// Intelligence). New hub page (does not replace/duplicate the existing
// Operations Center or Workflow Engine pages) covering:
//   - Workload Intelligence (Step 3): a real card per admin, every figure
//     computed server-side by backend/workflow/assignment/*.
//   - Conflict Detection (Step 9)
//   - Assignment Analytics (Step 10), charted with the same dependency-free
//     SVG chart primitives already built for the Patient Financial
//     Ecosystem — no new charting library added.
//   - Business Rules / transparent scoring formula (Step 14/5)
//   - AI Assignment Advisor panels (Step 12)
// Per-item recommendations/reassignment live in OperationsWorkspaceDrawer
// (extended in place) since that is where an admin is already looking at
// one specific item — this hub is the platform-wide view.
// ─────────────────────────────────────────────────────────────────────────

const UTILIZATION_STYLES = {
  available: "bg-emerald-50 text-emerald-800 border-emerald-200",
  near_capacity: "bg-amber-50 text-amber-800 border-amber-200",
  at_capacity: "bg-rose-50 text-rose-800 border-rose-200",
};

const BURNOUT_STYLES = {
  low: "text-emerald-700",
  medium: "text-amber-700",
  high: "text-rose-700",
};

const CONFLICT_SEVERITY_STYLES = {
  critical: "border-rose-300 bg-rose-50 text-rose-900",
  high: "border-amber-300 bg-amber-50 text-amber-900",
  medium: "border-blue-300 bg-blue-50 text-blue-900",
};

function fmtDuration(ms) {
  if (ms == null) return "—";
  const hours = Math.round(ms / (60 * 60 * 1000));
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function WorkloadCard({ snapshot }) {
  const { admin, isOnline, utilization, openCount, pending, working, critical, overdue, resolvedToday, idle, burnoutRisk } = snapshot;
  return (
    <div className="rounded-xl border border-slate-200 bg-white/70 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-black text-slate-950">{admin.name}</p>
          <p className="text-xs text-slate-500">{admin.role.replace("_", " ")}</p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${isOnline ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
          {isOnline ? "Online" : "Offline"}
        </span>
      </div>

      <div className={`mt-3 rounded-lg border px-3 py-2 text-xs font-bold ${UTILIZATION_STYLES[utilization.state]}`}>
        {utilization.pct}% utilized ({openCount}/{utilization.max} open){idle ? " — idle" : ""}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div><span className="font-bold text-slate-400">Pending</span><p className="font-black text-slate-800">{pending}</p></div>
        <div><span className="font-bold text-slate-400">Working</span><p className="font-black text-slate-800">{working}</p></div>
        <div><span className="font-bold text-slate-400">Critical</span><p className="font-black text-rose-600">{critical}</p></div>
        <div><span className="font-bold text-slate-400">Overdue</span><p className="font-black text-rose-600">{overdue}</p></div>
        <div><span className="font-bold text-slate-400">Resolved Today</span><p className="font-black text-emerald-700">{resolvedToday}</p></div>
        <div>
          <span className="font-bold text-slate-400">Burnout Risk</span>
          <p className={`font-black capitalize ${BURNOUT_STYLES[burnoutRisk]}`}>{burnoutRisk}</p>
        </div>
      </div>
    </div>
  );
}

function ConflictList({ conflicts }) {
  if (!conflicts?.length) return <EmptyState title="No conflicts detected" description="The queue is healthy — no duplicate, circular, starved, or blocked operations right now." />;
  return (
    <div className="space-y-2">
      {conflicts.map((c, idx) => (
        <div key={idx} className={`rounded-xl border p-3 text-sm ${CONFLICT_SEVERITY_STYLES[c.severity] || CONFLICT_SEVERITY_STYLES.medium}`}>
          <p className="text-[10px] font-black uppercase tracking-wide">{c.type.replace(/_/g, " ")} — {c.severity}</p>
          <p className="mt-1 font-semibold">{c.description}</p>
        </div>
      ))}
    </div>
  );
}

function AiAdvisorPanel({ title, loader, icon }) {
  const toast = useToast();
  const [result, setResult] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const run = async () => {
    setIsLoading(true);
    try {
      const response = await loader();
      setResult(response.data);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-purple-200 bg-purple-50/60 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.15em] text-purple-600">
          {icon} {title}
        </p>
        <Button variant="secondary" onClick={run} isLoading={isLoading}>Generate</Button>
      </div>
      {result?.content && (
        <div className="mt-3 space-y-1.5 text-sm text-purple-950">
          {Object.entries(result.content).map(([key, value]) => (
            <p key={key}>{typeof value === "string" ? value : JSON.stringify(value)}</p>
          ))}
          <p className="text-xs text-purple-500">{result.disclaimer}</p>
        </div>
      )}
    </div>
  );
}

function AdminSmartAssignment() {
  const { dashboardSyncTick } = useRealtime();
  const toast = useToast();
  const [workload, setWorkload] = useState(null);
  const [conflicts, setConflicts] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [rules, setRules] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [sweepLoading, setSweepLoading] = useState(false);

  const load = async () => {
    setIsLoading(true);
    setError("");
    try {
      const [workloadRes, conflictsRes, analyticsRes, rulesRes] = await Promise.all([
        adminApi.getWorkloadIntelligence(),
        adminApi.getAssignmentConflicts(),
        adminApi.getAssignmentAnalytics(),
        adminApi.getAssignmentBusinessRules(),
      ]);
      setWorkload(workloadRes.data);
      setConflicts(conflictsRes.data);
      setAnalytics(analyticsRes.data);
      setRules(rulesRes.data);
    } catch (loadError) {
      setError(getApiErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [dashboardSyncTick]);

  const runSweep = async () => {
    setSweepLoading(true);
    try {
      const response = await adminApi.runAssignmentSweep();
      toast.success(`Sweep complete — ${response.data.autoAssignedCount} auto-assigned, ${response.data.autoEscalatedCount} auto-escalated`);
      await load();
    } catch (sweepError) {
      toast.error(getApiErrorMessage(sweepError));
    } finally {
      setSweepLoading(false);
    }
  };

  const heatmapData = (analytics?.workloadHeatmap || []).map((h) => ({ name: h.admin.name, openCount: h.openCount }));
  const distributionSegments = Object.entries(analytics?.operationDistribution || {}).map(([type, value], i) => ({
    label: type.replace(/_/g, " "),
    value,
    color: ["#2563eb", "#059669", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#db2777"][i % 7],
  }));
  const slaSegments = [
    { label: "On track", value: analytics?.slaDistribution?.on_track || 0, color: "#059669" },
    { label: "At risk", value: analytics?.slaDistribution?.at_risk || 0, color: "#d97706" },
    { label: "Overdue", value: analytics?.slaDistribution?.overdue || 0, color: "#dc2626" },
  ];
  const trendData = Object.entries(analytics?.queueTrend?.byDay || {})
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([day, count]) => ({ day: day.slice(5), count }));

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Enterprise AI Workload Intelligence</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Smart Assignment Engine</h1>
          <p className="mt-2 text-sm text-slate-600">
            Real-time workload, transparent scoring, conflict detection, and assignment analytics — built on the
            Workflow Engine's own lifecycle and SLA policies. Nothing shown here is simulated.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={runSweep} isLoading={sweepLoading}>
            <Play size={16} /> Run Sweep Now
          </Button>
          <Button onClick={load}>
            <RefreshCcw size={16} /> Refresh
          </Button>
        </div>
      </div>

      {isLoading && <Loader label="Loading smart assignment engine" />}
      {error && !isLoading && <EmptyState title="Couldn't load the assignment engine" description={error} />}

      {!isLoading && !error && (
        <>
          <Card title={`Workload Intelligence (${workload?.snapshots?.length || 0} admins)`} action={<Users size={18} className="text-blue-600" />}>
            {workload?.snapshots?.length ? (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {workload.snapshots.map((s) => (
                  <WorkloadCard key={s.admin.id} snapshot={s} />
                ))}
              </div>
            ) : (
              <EmptyState title="No admin accounts found" />
            )}
          </Card>

          <Card title="Conflict Detection" action={<AlertTriangle size={18} className="text-amber-600" />}>
            <ConflictList conflicts={conflicts?.conflicts} />
          </Card>

          <Card title="Assignment Analytics" action={<BarChart3 size={18} className="text-blue-600" />}>
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Avg Assignment Time</p>
                <p className="text-2xl font-black text-slate-950">{fmtDuration(analytics?.avgAssignmentTimeMs)}</p>
              </div>
              <div>
                <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Avg Acceptance Time</p>
                <p className="text-2xl font-black text-slate-950">{fmtDuration(analytics?.avgAcceptanceTimeMs)}</p>
              </div>
              <div>
                <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Avg Resolution Time</p>
                <p className="text-2xl font-black text-slate-950">{fmtDuration(analytics?.avgResolutionTimeMs)}</p>
              </div>
              <div>
                <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Reassignment Rate</p>
                <p className="text-2xl font-black text-slate-950">{analytics?.reassignmentRate ?? "—"}{analytics?.reassignmentRate != null ? "%" : ""}</p>
              </div>
              <div>
                <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Assignment Success Rate</p>
                <p className="text-2xl font-black text-slate-950">{analytics?.assignmentSuccessRate ?? "—"}{analytics?.assignmentSuccessRate != null ? "%" : ""}</p>
              </div>
              <div>
                <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Top Performers</p>
                {analytics?.topPerformers?.length ? (
                  <ul className="space-y-1 text-sm">
                    {analytics.topPerformers.slice(0, 5).map((p) => (
                      <li key={p.admin.id} className="font-semibold text-slate-800">
                        {p.admin.name} — {p.resolvedTotal} resolved{p.slaSuccessRate != null ? `, ${p.slaSuccessRate}% SLA` : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500">No resolved history yet.</p>
                )}
              </div>
            </div>

            <div className="mt-6 grid gap-6 md:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Workload Heatmap</p>
                <MiniBarChart data={heatmapData} valueKey="openCount" labelKey="name" />
              </div>
              <div>
                <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Operation Distribution</p>
                <MiniDonut segments={distributionSegments} />
              </div>
              <div>
                <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">SLA Distribution</p>
                <MiniDonut segments={slaSegments} />
              </div>
              <div>
                <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">Queue Trend (14d)</p>
                <MiniBarChart data={trendData} valueKey="count" labelKey="day" />
                <p className="mt-2 text-[11px] text-slate-400">{analytics?.queueTrend?.trendNote}</p>
              </div>
            </div>
          </Card>

          <Card title="Business Rules — Scoring Formula" action={<ShieldCheck size={18} className="text-blue-600" />}>
            {rules && (
              <div className="space-y-4 text-sm">
                <div>
                  <p className="text-xs font-black uppercase tracking-wide text-slate-500">Scoring Weights</p>
                  <ul className="mt-2 grid gap-2 sm:grid-cols-3">
                    {Object.entries(rules.scoringWeights || {}).map(([key, weight]) => (
                      <li key={key} className="rounded-lg border border-slate-200 bg-white/60 px-3 py-2">
                        <span className="font-bold capitalize text-slate-800">{key}:</span>{" "}
                        <span className="text-slate-600">{Math.round(weight * 100)}%</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-wide text-slate-500">Capacity Policy</p>
                  <p className="mt-1 text-slate-600">
                    {rules.capacityPolicy?.maxOpenItemsPerAdmin} open items max per admin, near-capacity flag at{" "}
                    {rules.capacityPolicy?.overloadThresholdPct}% utilization.
                  </p>
                </div>
                {Object.entries(rules.rules || {}).map(([key, text]) => (
                  <p key={key} className="text-slate-600"><span className="font-bold capitalize text-slate-800">{key}: </span>{text}</p>
                ))}
              </div>
            )}
          </Card>

          <Card title="AI Assignment Advisor" action={<Sparkles size={18} className="text-purple-600" />}>
            <div className="grid gap-4 md:grid-cols-3">
              <AiAdvisorPanel title="Workload Advisor" icon={<Gauge size={14} />} loader={() => adminApi.getWorkloadAdvisor()} />
              <AiAdvisorPanel title="SLA Advisor" icon={<AlertTriangle size={14} />} loader={() => adminApi.getSlaAdvisor()} />
              <AiAdvisorPanel title="Engine Explain" icon={<ShieldCheck size={14} />} loader={() => adminApi.getAssignmentEngineExplain()} />
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

export default AdminSmartAssignment;
