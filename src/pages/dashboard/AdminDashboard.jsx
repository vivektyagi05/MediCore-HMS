// PHASE UI-9 — Executive Admin Command Center.
//
// This page is the transformed Admin Dashboard, not a new page. It fetches
// one composed payload from GET /admin/command-center
// (backend/services/commandCenter/commandCenterAggregates.js), which itself
// reuses every existing aggregate builder in the admin platform — nothing
// here recalculates a metric. Every metric card/section deep-links into the
// specialized workspace that actually owns that data (Finance/Reviews/
// Operations/Assignment/Monitoring/Process Governance), per Section 11
// ("Dashboard = overview + decision surface, detailed pages = execution
// surfaces"). See CHANGELOG-PHASE-UI-9-EXECUTIVE-COMMAND-CENTER.md.
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  Bot,
  CalendarClock,
  Database,
  IndianRupee,
  RefreshCcw,
  ShieldCheck,
  Star,
  Stethoscope,
  TrendingDown,
  TrendingUp,
  UsersRound,
  Wifi,
  Workflow,
} from "lucide-react";
import { useEffect, useState } from "react";

import { adminApi } from "../../api/adminApi";
import { getApiErrorMessage } from "../../api/axios";
import EmptyState from "../../components/shared/EmptyState";
import ErrorState from "../../components/shared/ErrorState";
import Skeleton from "../../components/shared/Skeleton";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Loader from "../../components/ui/Loader";
import MetricCard from "../../components/ui/MetricCard";
import SectionHeader from "../../components/ui/SectionHeader";
import StatusBadge from "../../components/ui/StatusBadge";
import { useRealtime } from "../../context/RealtimeContext";
import { useI18n } from "../../i18n/I18nContext";
import AIDraftPanel from "../../components/ai/AIDraftPanel";
import SmartSearchBar from "../../components/ai/SmartSearchBar";

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

function timeAgo(dateString) {
  if (!dateString) return "";
  const diffMs = Date.now() - new Date(dateString).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const PRIORITY_TONE = { critical: "danger", high: "warning", medium: "info", low: "neutral" };
const SEVERITY_DOT = { info: "bg-blue-500", warning: "bg-amber-500", critical: "bg-rose-500", high: "bg-amber-500" };

function GrowthBadge({ value }) {
  if (value === null || value === undefined) {
    return <span className="text-xs font-semibold text-slate-400">No prior-week data</span>;
  }
  const isUp = value >= 0;
  const Icon = isUp ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-bold ${isUp ? "text-emerald-600" : "text-rose-600"}`}>
      <Icon size={14} /> {isUp ? "+" : ""}
      {value}% vs last week
    </span>
  );
}

// Section 13 — Error Handling: a small inline card for one failed data
// source, never a fabricated zero and never a raw stack trace/error code.
function SectionUnavailable({ label, onRetry }) {
  return (
    <div className="rounded-card border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-800">
      <div className="flex items-center justify-between gap-3">
        <span>{label} is unavailable right now.</span>
        {onRetry && (
          <Button size="sm" variant="secondary" onClick={onRetry}>
            Retry
          </Button>
        )}
      </div>
    </div>
  );
}

function AdminDashboard() {
  const { t } = useI18n();
  const { dashboardSyncTick } = useRealtime();

  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const loadAll = async () => {
    setIsLoading(true);
    setError("");
    try {
      const response = await adminApi.getCommandCenter();
      setData(response.data);
    } catch (loadError) {
      setError(getApiErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, [dashboardSyncTick]);

  if (isLoading && !data) {
    return <Loader label={t("page.loadingAdminDashboard") || "Loading executive command center"} />;
  }

  if (error && !data) {
    return <ErrorState title="Command center unavailable" description={error} onRetry={loadAll} />;
  }

  const executive = data?.executive || {};
  const revenue = executive.revenue || { today: 0, week: 0, month: 0 };
  const appointments = executive.appointments || { today: 0, pending: 0, completedToday: 0, cancelledToday: 0 };
  const doctors = executive.doctors || { total: 0, active: 0, online: 0 };
  const patients = executive.patients || { total: 0, active: 0 };
  const growth = executive.growth || { patientsWeekOverWeek: null, doctorsWeekOverWeek: null };
  const platformHealth = executive.platformHealth || { score: null, breakdown: [] };
  const system = executive.system || { database: {}, socket: {}, channels: {} };

  const needsAttention = data?.needsAttention;
  const activity = data?.activity || [];
  const reputation = data?.reputation;
  const finance = data?.finance;
  const workflow = data?.workflow;
  const governance = data?.governance;

  const quickActions = [
    { label: "Operations Queue", to: "/admin/operations-center" },
    { label: "Doctor Verifications", to: "/admin/doctors" },
    { label: "Pending Refunds", to: "/admin/refunds" },
    { label: "Failed Payments", to: "/admin/payments" },
    { label: "Critical Reports", to: "/admin/patients" },
    { label: "Negative Reviews", to: "/admin/reviews" },
    ...(finance ? [{ label: "Finance Command Center", to: "/admin/finance" }] : []),
    ...(workflow ? [{ label: "Smart Assignment", to: "/admin/assignment" }] : []),
    ...(workflow ? [{ label: "Monitoring Platform", to: "/admin/monitoring" }] : []),
    ...(governance ? [{ label: "Process Governance", to: "/admin/process-governance" }] : []),
  ];

  return (
    <div className="space-y-6">
      {/* 1. Executive Header */}
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-royal-600">Executive Command Center</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">
            {new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-600">
            <StatusBadge tone={system.database?.healthy ? "success" : "danger"}>
              {system.database?.healthy ? "Platform operational" : `Database ${system.database?.state || "unknown"}`}
            </StatusBadge>
            <span className="text-xs font-semibold text-slate-400">Last synchronized {timeAgo(data?.fetchedAt)}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="rounded-2xl border border-slate-200 bg-white/70 px-4 py-2 text-right shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Platform Health</p>
            <p
              className={`text-2xl font-black ${
                platformHealth.score == null
                  ? "text-slate-400"
                  : platformHealth.score >= 80
                    ? "text-emerald-600"
                    : platformHealth.score >= 50
                      ? "text-amber-600"
                      : "text-rose-600"
              }`}
            >
              {platformHealth.score ?? "N/A"}
              {platformHealth.score != null && <span className="text-sm font-bold text-slate-400">/100</span>}
            </p>
          </div>
          <Button onClick={loadAll} isLoading={isLoading}>
            <RefreshCcw size={16} /> Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>
      )}

      <SmartSearchBar />

      {!data?.executive && <SectionUnavailable label="Platform overview" onRetry={loadAll} />}

      {/* 2. Executive Health Strip */}
      {data?.executive && (
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Revenue Today" value={formatCurrency(revenue.today)} icon={IndianRupee} tone="premium" caption={`${formatCurrency(revenue.week)} this week`} />
          <MetricCard label="Appointment Health" value={`${appointments.today} today`} icon={CalendarClock} caption={`${appointments.pending} pending approval`} />
          <MetricCard label="Doctor Operations" value={`${doctors.online} / ${doctors.total}`} icon={Stethoscope} caption="Doctors online / total" />
          <MetricCard label="Patient Operations" value={patients.active} icon={UsersRound} caption={`${patients.total} total patients`} />
          <MetricCard
            label="Reputation Health"
            value={reputation?.averageRating != null ? `${reputation.averageRating} / 5` : "No ratings yet"}
            icon={Star}
            tone="premium"
            caption={reputation ? `${reputation.totalReviews} review(s)` : data?.reputationError ? "Unavailable" : undefined}
          />
          <MetricCard
            label="Workflow Health"
            value={workflow ? `${workflow.cronHealthyCount} / ${workflow.cronTotalCount}` : "Restricted"}
            icon={Workflow}
            caption={workflow ? "Scheduled jobs healthy" : "Requires settings permission"}
          />
          <MetricCard
            label="Financial Health"
            value={finance?.health?.score != null ? `${finance.health.score}/100` : finance ? "N/A" : "Restricted"}
            icon={IndianRupee}
            tone="success"
            caption={finance ? "See Finance Command Center" : "Requires payments permission"}
          />
          <MetricCard
            label="Critical Alerts"
            value={needsAttention?.counts?.critical ?? "N/A"}
            icon={AlertTriangle}
            tone="danger"
            caption={needsAttention ? `${needsAttention.counts.total} open item(s)` : undefined}
          />
        </div>
      )}

      {/* 3. Needs Attention */}
      <Card title="Needs Attention" action={<Button to="/admin/operations-center" variant="secondary">Open Operations Queue</Button>}>
        {!needsAttention ? (
          <SectionUnavailable label="Needs Attention" onRetry={loadAll} />
        ) : (
          <>
            {needsAttention.systemAlert && (
              <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">
                {needsAttention.systemAlert.title}
              </div>
            )}
            {needsAttention.items.length ? (
              <div className="space-y-2">
                {needsAttention.items.slice(0, 8).map((item) => (
                  <div key={item.id} className="rounded-xl border border-slate-200 bg-white/60 p-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge tone={PRIORITY_TONE[item.priority] || "neutral"}>{item.priority}</StatusBadge>
                          <p className="text-sm font-bold text-slate-900">{item.typeLabel}</p>
                        </div>
                        <p className="mt-1 text-sm text-slate-600">{item.reason}</p>
                        {item.recommendedAction && (
                          <p className="mt-1 text-xs font-semibold text-royal-600">Recommended: {item.recommendedAction}</p>
                        )}
                        <p className="mt-1 text-xs text-slate-400">
                          {item.owner ? `Owner: ${item.owner} · ` : "Unassigned · "}
                          {timeAgo(item.createdAt)}
                          {item.sla?.state === "overdue" && " · Past SLA"}
                        </p>
                      </div>
                      {item.resolutionRoute && (
                        <Button to={item.resolutionRoute} variant="secondary" size="sm">
                          Open <ArrowUpRight size={14} />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="All clear" description="No open operational items need attention right now." />
            )}
          </>
        )}
      </Card>

      {/* 5 + 6 + 7. Financial Snapshot / Clinical Operations / Reputation */}
      <div className="grid gap-6 lg:grid-cols-3">
        {finance ? (
          <Card title="Financial Snapshot" action={<Button to="/admin/finance" variant="secondary" size="sm">Open</Button>}>
            <div className="space-y-2 text-sm">
              <p className="flex justify-between"><span className="text-slate-500">Net revenue</span><span className="font-bold text-slate-900">{formatCurrency(finance.overview.netRevenue)}</span></p>
              <p className="flex justify-between"><span className="text-slate-500">Refunded</span><span className="font-bold text-slate-900">{formatCurrency(finance.overview.refundedAmount)}</span></p>
              <p className="flex justify-between"><span className="text-slate-500">Outstanding</span><span className="font-bold text-amber-600">{formatCurrency(finance.overview.outstandingAmount)}</span></p>
              <p className="flex justify-between"><span className="text-slate-500">Failed payments</span><span className="font-bold text-rose-600">{finance.overview.failedCount}</span></p>
            </div>
          </Card>
        ) : (
          !data?.financePermissionDenied && <SectionUnavailable label="Financial Snapshot" onRetry={loadAll} />
        )}

        <Card title="Clinical / Patient Operations">
          <div className="space-y-2 text-sm">
            <p className="flex justify-between"><span className="text-slate-500">Pending appointments</span><span className="font-bold text-slate-900">{appointments.pending}</span></p>
            <p className="flex justify-between"><span className="text-slate-500">Critical reports awaiting review</span><span className="font-bold text-rose-600">{executive.criticalReportsPending ?? 0}</span></p>
            <p className="flex justify-between"><span className="text-slate-500">Insurance claims in queue</span><span className="font-bold text-slate-900">{executive.insuranceQueue ?? 0}</span></p>
            {executive.emergencyToday > 0 && (
              <p className="rounded-lg bg-rose-50 p-2 text-xs font-bold text-rose-700">
                {executive.emergencyToday} of today&apos;s appointments mention urgent/emergency symptoms.
              </p>
            )}
          </div>
        </Card>

        {reputation ? (
          <Card title="Reputation" action={<Button to="/admin/reviews" variant="secondary" size="sm">Open</Button>}>
            <div className="space-y-2 text-sm">
              <p className="flex justify-between"><span className="text-slate-500">Average rating</span><span className="font-bold text-slate-900">{reputation.averageRating ?? "N/A"} / 5</span></p>
              <p className="flex justify-between"><span className="text-slate-500">Negative reviews</span><span className="font-bold text-rose-600">{reputation.negativeCount}</span></p>
              <p className="flex justify-between"><span className="text-slate-500">Unreplied reviews</span><span className="font-bold text-amber-600">{reputation.unrepliedCount}</span></p>
              {reputation.doctorsNeedingAttention.length > 0 && (
                <p className="text-xs font-semibold text-royal-600">{reputation.doctorsNeedingAttention.length} doctor(s) need reputation attention</p>
              )}
            </div>
          </Card>
        ) : (
          <SectionUnavailable label="Reputation" onRetry={loadAll} />
        )}
      </div>

      {/* 8. Workflow / Automation Health + Governance */}
      {(workflow || governance || !data?.workflowPermissionDenied) && (
        <div className="grid gap-6 lg:grid-cols-2">
          {workflow ? (
            <Card title="Workflow / Automation Health" action={<Button to="/admin/monitoring" variant="secondary" size="sm">Open</Button>}>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <p className="flex flex-col"><span className="text-slate-500">Failed executions today</span><span className="font-bold text-rose-600">{workflow.failedExecutionsToday}</span></p>
                <p className="flex flex-col"><span className="text-slate-500">Past SLA</span><span className="font-bold text-amber-600">{workflow.slaBreaches}</span></p>
                <p className="flex flex-col"><span className="text-slate-500">Assignment conflicts</span><span className="font-bold text-slate-900">{workflow.assignmentConflicts}</span></p>
                <p className="flex flex-col"><span className="text-slate-500">Published flows</span><span className="font-bold text-slate-900">{workflow.publishedFlows} / {workflow.totalFlows}</span></p>
              </div>
            </Card>
          ) : (
            !data?.workflowPermissionDenied && <SectionUnavailable label="Workflow / Automation Health" onRetry={loadAll} />
          )}

          {governance ? (
            <Card title="Process Governance" action={<Button to="/admin/process-governance" variant="secondary" size="sm">Open</Button>}>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <p className="flex flex-col"><span className="text-slate-500">Governance status</span><span className="font-bold text-slate-900">{governance.governanceHealth}</span></p>
                <p className="flex flex-col"><span className="text-slate-500">Pending approval</span><span className="font-bold text-amber-600">{governance.kpis.pendingApproval}</span></p>
                <p className="flex flex-col"><span className="text-slate-500">Violations</span><span className="font-bold text-rose-600">{governance.kpis.governanceViolations}</span></p>
                <p className="flex flex-col"><span className="text-slate-500">Governed processes</span><span className="font-bold text-slate-900">{governance.kpis.governedProcesses}</span></p>
              </div>
            </Card>
          ) : (
            !data?.governancePermissionDenied && <SectionUnavailable label="Process Governance" onRetry={loadAll} />
          )}
        </div>
      )}

      {/* 9. Executive AI Summary */}
      <AIDraftPanel
        title="AI: Executive Command Summary"
        actionLabel="Generate summary"
        onGenerate={() => adminApi.getCommandCenterExecutiveSummary()}
      />

      {/* 10 + 4. Quick Actions + Live Platform Activity */}
      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card title="Quick Actions">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {quickActions.map((action) => (
              <Button key={action.to} to={action.to} variant="secondary" className="justify-start">
                {action.label}
              </Button>
            ))}
          </div>
        </Card>

        <Card title="Live Platform Activity" action={<Activity size={20} className="text-royal-600" />}>
          {isLoading ? (
            <Skeleton rows={5} />
          ) : activity.length ? (
            <div className="space-y-3">
              {activity.map((event, index) => (
                <div key={`${event.type}-${event.at}-${index}`} className="flex items-start gap-3 rounded-xl bg-white/60 p-3 shadow-sm">
                  <span className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full ${SEVERITY_DOT[event.severity] || "bg-slate-400"}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-slate-900">
                      {event.type} <span className="font-normal text-slate-500">— {event.label}</span>
                    </p>
                    <p className="text-xs text-slate-500">{timeAgo(event.at)}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No recent activity" description="Platform activity across appointments, payments, refunds, reviews, and workflows will appear here." />
          )}
        </Card>
      </div>

      {/* System Status strip */}
      <div className="grid gap-6 sm:grid-cols-3">
        <Card>
          <div className="flex items-center gap-3">
            <Database className={system.database?.healthy ? "text-emerald-600" : "text-rose-600"} size={22} />
            <div>
              <p className="text-xs font-bold uppercase text-slate-500">Database</p>
              <p className="text-lg font-black capitalize text-slate-950">{system.database?.state || "unknown"}</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <Wifi className={system.socket?.healthy ? "text-emerald-600" : "text-rose-600"} size={22} />
            <div>
              <p className="text-xs font-bold uppercase text-slate-500">Realtime Sockets</p>
              <p className="text-lg font-black text-slate-950">{system.socket?.connectedClients ?? 0} connected</p>
            </div>
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-3">
            <ShieldCheck className="text-emerald-600" size={22} />
            <div>
              <p className="text-xs font-bold uppercase text-slate-500">Active Doctors</p>
              <p className="text-lg font-black text-slate-950">{doctors.active} / {doctors.total}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Growth strip */}
      <div className="grid gap-6 sm:grid-cols-3">
        <Card title="Patient Growth">
          <p className="text-2xl font-black text-slate-950">{executive.today?.newPatients ?? 0} <span className="text-sm font-bold text-slate-400">new today</span></p>
          <div className="mt-2"><GrowthBadge value={growth.patientsWeekOverWeek} /></div>
        </Card>
        <Card title="Doctor Growth">
          <p className="text-2xl font-black text-slate-950">{executive.today?.newDoctors ?? 0} <span className="text-sm font-bold text-slate-400">new today</span></p>
          <div className="mt-2"><GrowthBadge value={growth.doctorsWeekOverWeek} /></div>
        </Card>
        <Card title="AI Requests Today">
          <p className="inline-flex items-center gap-2 text-2xl font-black text-slate-950"><Bot size={20} className="text-cyan-600" />{executive.aiRequestsToday ?? 0}</p>
        </Card>
      </div>

      <SectionHeader
        eyebrow="Command Center"
        title="Need the specialized view?"
        description="Every metric above deep-links into the workspace that owns it — nothing here duplicates those systems."
        className="mt-2"
      />
    </div>
  );
}

export default AdminDashboard;
