import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Bot,
  Gauge,
  GitBranch,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import { processApi } from "../../api/processApi";
import { getApiErrorMessage } from "../../api/axios";
import { useRealtime } from "../../context/RealtimeContext";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import Loader from "../../components/ui/Loader";
import MetricCard from "../../components/ui/MetricCard";
import EmptyState from "../../components/shared/EmptyState";

// ─────────────────────────────────────────────────────────────────────────
// PHASE UI-13 — Process, Automation & Governance Intelligence Workspace.
//
// AUDIT FINDING: Process Designer, Process Orchestrator, Process Analytics
// & Optimization, Process Governance, Automation Studio, Workflow Engine,
// and Workflow Intelligence were already REAL, CONNECTED, and non-fake
// across 7 existing admin pages (A6.2.x/A6.3.x). Nothing there is
// rebuilt. The one genuine gap this page closes: those 7 pages had no
// single cross-domain view, unlike Finance/Reviews/Ops (UI-9) or
// Mission Control/Assignment/Monitoring (UI-10). This page is that
// composition surface — same shape as AdminOperationsCommandWorkspace.jsx
// — and deep-links to the existing dedicated pages for full depth/actions
// rather than re-implementing any of them.
// ─────────────────────────────────────────────────────────────────────────

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

function fmtDate(value) {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleString();
}

export default function AdminProcessCommandCenter() {
  const { dashboardSyncTick } = useRealtime();
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setIsLoading(true);
    try {
      const res = await processApi.getCommandCenter();
      setData(res.data);
      setError("");
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [dashboardSyncTick]);

  const registry = data?.registry;
  const analytics = data?.analytics;
  const automation = data?.automation;
  const governance = data?.governance;
  const optimization = data?.optimization;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-950">Process &amp; Automation Command Center</h1>
          <p className="text-sm text-slate-500">
            One connected view across Process Designer, Orchestration, Analytics, Automation Studio and
            Governance. Every number below is pulled live from those existing systems — nothing is
            recalculated here.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={load}>
          <RefreshCcw size={14} /> Refresh
        </Button>
      </div>

      {isLoading && !data ? (
        <Loader label="Loading command center" />
      ) : error && !data ? (
        <SectionState isLoading={false} error={error} onRetry={load} />
      ) : (
        <>
          {/* Registry / Analytics KPI strip */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label="Total Processes"
              value={registry?.available ? registry.data.totalProcesses : "—"}
              caption={registry?.available ? `${registry.data.categories} categories` : registry?.error}
              icon={GitBranch}
            />
            <MetricCard
              label="Active Processes (30d)"
              value={analytics?.available ? analytics.data.activeProcesses : "—"}
              caption={analytics?.available ? `${analytics.data.totalExecutions} executions tracked` : analytics?.error}
              icon={Gauge}
              tone={analytics?.available ? "success" : "neutral"}
            />
            <MetricCard
              label="Automation Health"
              value={automation?.available ? `${automation.data.cards.healthScore}/100` : "—"}
              caption={automation?.available ? `${automation.data.cards.executionsToday} runs today` : automation?.error}
              icon={Bot}
              tone={automation?.available && automation.data.cards.healthScore < 70 ? "danger" : "success"}
            />
            <MetricCard
              label="Governance Health"
              value={governance?.available ? governance.data.governanceHealth : "—"}
              caption={governance?.available ? `${governance.data.kpis.pendingApproval} pending approval` : governance?.error}
              icon={ShieldCheck}
              tone={governance?.available && governance.data.governanceHealth !== "Healthy" ? "danger" : "success"}
            />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Processes needing attention */}
            <Card className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">Processes Needing Attention</h2>
                <Link to="/admin/process-orchestrator" className="flex items-center gap-1 text-xs font-bold text-royal-600 hover:underline">
                  Open Orchestrator <ArrowRight size={12} />
                </Link>
              </div>
              <SectionState
                isLoading={false}
                error={registry?.available ? null : registry?.error}
                onRetry={load}
                isEmpty={registry?.available && registry.data.needsAttention.length === 0}
                emptyProps={{ title: "All processes healthy", description: "No process is currently below the health threshold." }}
              >
                <ul className="space-y-2">
                  {registry?.available &&
                    registry.data.needsAttention.map((p) => (
                      <li key={p.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                        <span className="font-semibold text-slate-800">{p.label}</span>
                        <span className={`text-xs font-bold ${p.score != null && p.score < 50 ? "text-rose-700" : "text-amber-700"}`}>
                          {p.score != null ? `${p.score}/100` : "n/a"}
                        </span>
                      </li>
                    ))}
                </ul>
              </SectionState>
            </Card>

            {/* Governance approval queue preview */}
            <Card className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">Approval Queue</h2>
                <Link to="/admin/process-governance" className="flex items-center gap-1 text-xs font-bold text-royal-600 hover:underline">
                  Open Governance <ArrowRight size={12} />
                </Link>
              </div>
              <SectionState
                isLoading={false}
                error={governance?.available ? null : governance?.error}
                onRetry={load}
                isEmpty={governance?.available && governance.data.approvalQueuePreview.length === 0}
                emptyProps={{ title: "No pending approvals", description: "Nothing is currently waiting on governance review." }}
              >
                <ul className="space-y-2">
                  {governance?.available &&
                    governance.data.approvalQueuePreview.map((q) => (
                      <li key={q.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                        <div>
                          <p className="font-semibold text-slate-800">{q.name}</p>
                          <p className="text-xs text-slate-500">Submitted {fmtDate(q.submittedAt)} by {q.requestedBy || "unknown"}</p>
                        </div>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                            ["high", "critical"].includes(q.riskLevel) ? "bg-rose-100 text-rose-700" : "bg-slate-200 text-slate-700"
                          }`}
                        >
                          {q.riskLevel}
                        </span>
                      </li>
                    ))}
                </ul>
              </SectionState>
            </Card>

            {/* Automation Studio snapshot */}
            <Card className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">Automation Studio</h2>
                <Link to="/admin/automation-studio" className="flex items-center gap-1 text-xs font-bold text-royal-600 hover:underline">
                  Open Studio <ArrowRight size={12} />
                </Link>
              </div>
              <SectionState isLoading={false} error={automation?.available ? null : automation?.error} onRetry={load} isEmpty={false}>
                {automation?.available && (
                  <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                    <div>
                      <p className="text-xs text-slate-500">Published</p>
                      <p className="font-bold text-slate-800">{automation.data.cards.published}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Draft</p>
                      <p className="font-bold text-slate-800">{automation.data.cards.draft}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Failed (7d)</p>
                      <p className="font-bold text-slate-800">{automation.data.cards.failedLast7d}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Success rate (7d)</p>
                      <p className="font-bold text-slate-800">
                        {automation.data.cards.successRate7d != null ? `${automation.data.cards.successRate7d}%` : "Not enough recorded data"}
                      </p>
                    </div>
                  </div>
                )}
              </SectionState>
            </Card>

            {/* Optimization recommendations */}
            <Card className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">Optimization Recommendations</h2>
                <Link to="/admin/process-analytics" className="flex items-center gap-1 text-xs font-bold text-royal-600 hover:underline">
                  Open Analytics <ArrowRight size={12} />
                </Link>
              </div>
              <SectionState
                isLoading={false}
                error={optimization?.available ? null : optimization?.error}
                onRetry={load}
                isEmpty={optimization?.available && optimization.data.openTotal === 0}
                emptyProps={{ title: "No open recommendations", description: "The optimization engine has no unreviewed suggestions right now." }}
              >
                {optimization?.available && (
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-slate-500">Detected</p>
                      <p className="font-bold text-slate-800">{optimization.data.detected}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Reviewed</p>
                      <p className="font-bold text-slate-800">{optimization.data.reviewed}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500">Approved</p>
                      <p className="font-bold text-slate-800">{optimization.data.approved}</p>
                    </div>
                  </div>
                )}
              </SectionState>
            </Card>
          </div>

          {/* Deep-link strip to the full existing pages — this workspace never
              duplicates their detail views. */}
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-700">Full Workspaces</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { to: "/admin/process-orchestrator", label: "Process Orchestrator", icon: GitBranch },
                { to: "/admin/process-designer", label: "Process Designer", icon: Workflow },
                { to: "/admin/process-analytics", label: "Process Analytics", icon: Gauge },
                { to: "/admin/process-governance", label: "Process Governance", icon: ShieldCheck },
                { to: "/admin/automation-studio", label: "Automation Studio", icon: Bot },
                { to: "/admin/workflow-engine", label: "Workflow Engine", icon: Workflow },
                { to: "/admin/workflow-intelligence", label: "Workflow Intelligence", icon: Sparkles },
              ].map(({ to, label, icon: Icon }) => (
                <Link
                  key={to}
                  to={to}
                  className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 hover:border-royal-300 hover:bg-royal-50 hover:text-royal-700"
                >
                  <Icon size={14} /> {label}
                </Link>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
