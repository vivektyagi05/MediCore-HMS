import { useEffect, useState } from "react";
import {
  Bot,
  Cpu,
  Database,
  HardDrive,
  Mail,
  MessageSquareOff,
  RefreshCcw,
  Wifi,
  Zap,
} from "lucide-react";
import { adminApi } from "../../api/adminApi";
import { getApiErrorMessage } from "../../api/axios";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import Loader from "../../components/ui/Loader";
import { useRealtime } from "../../context/RealtimeContext";

const STATUS_STYLES = {
  healthy: "bg-emerald-100 text-emerald-700",
  warning: "bg-amber-100 text-amber-700",
  degraded: "bg-orange-100 text-orange-700",
  critical: "bg-rose-100 text-rose-700",
};

function ScoreRing({ score, status }) {
  const circumference = 2 * Math.PI * 54;
  const offset = circumference - (score / 100) * circumference;
  const colorClass = { healthy: "stroke-emerald-500", warning: "stroke-amber-500", degraded: "stroke-orange-500", critical: "stroke-rose-500" }[status] || "stroke-slate-400";
  return (
    <div className="relative flex h-36 w-36 items-center justify-center">
      <svg className="h-36 w-36 -rotate-90" viewBox="0 0 120 120">
        <circle cx="60" cy="60" r="54" fill="none" stroke="currentColor" strokeWidth="10" className="text-slate-100" />
        <circle
          cx="60"
          cy="60"
          r="54"
          fill="none"
          strokeWidth="10"
          strokeLinecap="round"
          className={colorClass}
          style={{ stroke: "currentColor" }}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-3xl font-black text-slate-950">{score}</span>
        <span className="text-xs font-bold uppercase tracking-wide text-slate-500">/ 100</span>
      </div>
    </div>
  );
}

function InfraRow({ icon: Icon, label, healthy, detail }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-200 p-4">
      <div className="flex items-center gap-3">
        <Icon className={healthy ? "text-emerald-600" : "text-rose-600"} size={20} />
        <div>
          <p className="text-xs font-bold uppercase text-slate-500">{label}</p>
          <p className="text-sm font-black text-slate-950">{detail}</p>
        </div>
      </div>
      <span className={`rounded-full px-3 py-1 text-xs font-black uppercase ${healthy ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>
        {healthy ? "Healthy" : "Attention"}
      </span>
    </div>
  );
}

function AdminPlatformHealth() {
  const { dashboardSyncTick } = useRealtime();
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setIsLoading(true);
    setError("");
    try {
      const response = await adminApi.getPlatformHealth();
      setData(response.data);
    } catch (loadError) {
      setError(getApiErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [dashboardSyncTick]);

  if (isLoading && !data) return <Loader label="Loading platform health" />;
  if (error && !data) return <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>;

  const infra = data?.infrastructure || {};
  const operational = data?.operational || {};
  const overall = data?.overallHealth || { score: 0, status: "unknown", breakdown: [] };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Platform Health Center</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Enterprise Health & Infrastructure</h1>
          <p className="mt-2 text-sm text-slate-600">Every score below is computed from real backend state — see the breakdown for exactly how.</p>
        </div>
        <Button onClick={load}>
          <RefreshCcw size={16} /> Refresh now
        </Button>
      </div>

      <Card>
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
          <ScoreRing score={overall.score} status={overall.status} />
          <div className="flex-1">
            <span className={`inline-block rounded-full px-3 py-1 text-xs font-black uppercase tracking-wide ${STATUS_STYLES[overall.status] || "bg-slate-100 text-slate-600"}`}>
              {overall.status}
            </span>
            <p className="mt-3 text-sm font-bold text-slate-500">How this score is calculated:</p>
            <ul className="mt-2 space-y-1 text-sm text-slate-600">
              {overall.breakdown?.length ? overall.breakdown.map((line) => <li key={line}>• {line}</li>) : <li>No deductions — every monitored signal is healthy.</li>}
            </ul>
          </div>
        </div>
      </Card>

      <Card title="Infrastructure Status">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <InfraRow icon={Database} label="Database" healthy={infra.database?.healthy} detail={infra.database?.state || "unknown"} />
          <InfraRow icon={Wifi} label="Realtime / Socket" healthy={infra.realtime?.healthy} detail={`${infra.realtime?.connectedClients ?? 0} clients`} />
          <InfraRow icon={HardDrive} label="Storage" healthy={infra.storage?.healthy} detail={infra.storage?.writable ? "Writable" : "Unavailable"} />
          <InfraRow icon={Mail} label="Email (SMTP)" healthy={infra.email?.healthy} detail={infra.email?.configured ? "Configured" : "Not configured"} />
          <InfraRow icon={MessageSquareOff} label="SMS" healthy={false} detail="Not integrated" />
          <InfraRow icon={Zap} label="Payment Provider" healthy={infra.paymentProvider?.healthy} detail={infra.paymentProvider?.configured ? "Razorpay configured" : "Not configured"} />
          <InfraRow icon={Bot} label="AI Provider" healthy={infra.aiProvider?.healthy} detail={infra.aiProvider?.activeProvider || "unresolved"} />
          <InfraRow
            icon={Cpu}
            label="Webhooks (24h)"
            healthy={infra.webhook?.healthy}
            detail={`${infra.webhook?.last24h?.received ?? 0} received, ${infra.webhook?.last24h?.failed ?? 0} failed`}
          />
        </div>

        <div className="mt-5">
          <p className="mb-3 text-sm font-bold text-slate-700">Scheduler / Cron Jobs</p>
          <p className="mb-3 text-xs font-semibold text-slate-500">{infra.scheduler?.model}</p>
          <div className="space-y-2">
            {infra.scheduler?.jobs?.length ? (
              infra.scheduler.jobs.map((job) => (
                <div key={job.jobName} className="flex items-center justify-between rounded-xl border border-slate-200 p-3 text-sm">
                  <span className="font-bold text-slate-800">{job.jobName}</span>
                  <span className="flex items-center gap-3 text-xs text-slate-500">
                    {job.durationMs != null && `${job.durationMs}ms · `}
                    {job.startedAt ? new Date(job.startedAt).toLocaleString() : "never run"}
                    <span className={`rounded-full px-2 py-0.5 font-black uppercase ${job.status === "success" ? "bg-emerald-100 text-emerald-700" : job.status === "failed" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>
                      {job.status}
                    </span>
                  </span>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">No cron job has run yet in this environment.</p>
            )}
          </div>
        </div>
      </Card>

      <Card title="Operational Health">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Failed payments today", value: operational.failedPaymentsToday },
            { label: "Refund delays (>7d)", value: operational.refundDelays },
            { label: "Insurance issues", value: operational.insuranceIssues },
            { label: "Critical reports pending", value: operational.criticalReportsPending },
            { label: "Delayed appointments", value: operational.delayedAppointments },
            { label: "Automation/cron failures", value: operational.automationFailures },
            { label: "AI activity today", value: operational.aiActivityToday },
            { label: "AI draft discard rate", value: `${operational.aiDraftDiscardRate ?? 0}%` },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-slate-200 p-4">
              <p className="text-xs font-bold uppercase text-slate-500">{item.label}</p>
              <p className="mt-2 text-2xl font-black text-slate-950">{item.value}</p>
            </div>
          ))}
        </div>
        {operational.automationFailureDetails?.length > 0 && (
          <div className="mt-4 space-y-2">
            {operational.automationFailureDetails.map((f) => (
              <div key={f.jobName} className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs">
                <span className="font-black text-rose-800">{f.jobName}</span>: {f.error}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

export default AdminPlatformHealth;
