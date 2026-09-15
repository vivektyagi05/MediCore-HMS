import {
  Activity,
  AlertTriangle,
  Bot,
  Clock,
  CreditCard,
  Cpu,
  Database,
  HardDrive,
  Mail,
  MessageSquareOff,
  RefreshCcw,
  Stethoscope,
  UsersRound,
  Wifi,
} from "lucide-react";
import { useEffect, useState } from "react";

import { adminApi } from "../../api/adminApi";
import { getApiErrorMessage } from "../../api/axios";
import EmptyState from "../../components/shared/EmptyState";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Loader from "../../components/ui/Loader";
import { useRealtime } from "../../context/RealtimeContext";

const PRIORITY_STYLES = {
  critical: "bg-rose-50 text-rose-800 border-rose-200",
  high: "bg-amber-50 text-amber-800 border-amber-200",
  medium: "bg-blue-50 text-blue-800 border-blue-200",
  low: "bg-slate-50 text-slate-700 border-slate-200",
};

function timeAgo(dateString) {
  if (!dateString) return "never";
  const diffMs = Date.now() - new Date(dateString).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function StatusPill({ healthy, onLabel, offLabel }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-black uppercase tracking-wide ${
        healthy ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${healthy ? "bg-emerald-500" : "bg-rose-500"}`} />
      {healthy ? onLabel : offLabel}
    </span>
  );
}

function AdminMissionControl() {
  const { dashboardSyncTick } = useRealtime();
  const [live, setLive] = useState(null);
  const [alerts, setAlerts] = useState(null);
  const [infra, setInfra] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const loadAll = async () => {
    setIsLoading(true);
    setError("");
    try {
      const [liveResponse, alertsResponse, infraResponse] = await Promise.all([
        adminApi.getMissionControl(),
        adminApi.getSmartAlerts(),
        // Phase A5.2 — storage/webhook/scheduler status: signals A5.1's
        // `system` object above doesn't carry, fetched from the new
        // Platform Health Center endpoint rather than duplicating any of
        // this page's existing queries.
        adminApi.getInfrastructureStatus().catch(() => ({ data: null })),
      ]);
      setLive(liveResponse.data);
      setAlerts(alertsResponse.data);
      setInfra(infraResponse.data);
    } catch (loadError) {
      setError(getApiErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, [dashboardSyncTick]);

  // Live Platform is meant to feel like a real ops console — poll every 15s
  // on top of the realtime dashboard-sync tick, since presence/session
  // counts change without necessarily firing a dashboard:sync event.
  useEffect(() => {
    const interval = window.setInterval(loadAll, 15000);
    return () => window.clearInterval(interval);
  }, []);

  if (isLoading && !live) {
    return <Loader label="Loading mission control" />;
  }

  const presence = live?.presence || { doctorsOnline: 0, patientsOnline: 0, activeSessions: 0 };
  const system = live?.system || { database: {}, socket: {}, channels: {} };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Live Platform</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Mission Control</h1>
          <p className="mt-2 text-sm text-slate-600">
            Real-time system, session, and operational status — auto-refreshes every 15 seconds.
          </p>
        </div>
        <Button onClick={loadAll}>
          <RefreshCcw size={16} /> Refresh now
        </Button>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>
      )}

      {/* Presence + live activity */}
      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-bold text-slate-500">Doctors Online</p>
              <p className="mt-3 text-2xl font-black text-slate-950">{presence.doctorsOnline}</p>
            </div>
            <div className="rounded-xl bg-indigo-600 p-3 text-white shadow-lg"><Stethoscope size={20} /></div>
          </div>
        </Card>
        <Card>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-bold text-slate-500">Patients Online</p>
              <p className="mt-3 text-2xl font-black text-slate-950">{presence.patientsOnline}</p>
            </div>
            <div className="rounded-xl bg-blue-600 p-3 text-white shadow-lg"><UsersRound size={20} /></div>
          </div>
        </Card>
        <Card>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-bold text-slate-500">Active Sessions</p>
              <p className="mt-3 text-2xl font-black text-slate-950">{presence.activeSessions}</p>
            </div>
            <div className="rounded-xl bg-slate-950 p-3 text-white shadow-lg"><Activity size={20} /></div>
          </div>
        </Card>
        <Card>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-bold text-slate-500">Live Consultations</p>
              <p className="mt-3 text-2xl font-black text-slate-950">{live?.liveConsultations ?? 0}</p>
            </div>
            <div className="rounded-xl bg-purple-600 p-3 text-white shadow-lg"><Activity size={20} /></div>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-bold text-slate-500">Payments Captured (last hour)</p>
              <p className="mt-3 text-2xl font-black text-slate-950">{live?.livePaymentsLastHour ?? 0}</p>
            </div>
            <div className="rounded-xl bg-emerald-600 p-3 text-white shadow-lg"><CreditCard size={20} /></div>
          </div>
        </Card>
        <Card>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-bold text-slate-500">Pending Refunds</p>
              <p className="mt-3 text-2xl font-black text-slate-950">{live?.pendingRefunds ?? 0}</p>
            </div>
            <div className="rounded-xl bg-rose-600 p-3 text-white shadow-lg"><CreditCard size={20} /></div>
          </div>
        </Card>
        <Card>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-bold text-slate-500">AI Activity (last 15 min)</p>
              <p className="mt-3 text-2xl font-black text-slate-950">{live?.aiActivityLast15Min ?? 0}</p>
            </div>
            <div className="rounded-xl bg-cyan-600 p-3 text-white shadow-lg"><Bot size={20} /></div>
          </div>
        </Card>
        <Card>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-bold text-slate-500">Notifications (last 15 min)</p>
              <p className="mt-3 text-2xl font-black text-slate-950">{live?.notificationsLast15Min ?? 0}</p>
            </div>
            <div className="rounded-xl bg-amber-500 p-3 text-white shadow-lg"><Activity size={20} /></div>
          </div>
        </Card>
      </div>

      {/* System status */}
      <Card title="Platform Infrastructure Status">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="flex items-center justify-between rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-3">
              <Database className={system.database?.healthy ? "text-emerald-600" : "text-rose-600"} size={20} />
              <div>
                <p className="text-xs font-bold uppercase text-slate-500">Database</p>
                <p className="text-sm font-black capitalize text-slate-950">{system.database?.state || "unknown"}</p>
              </div>
            </div>
            <StatusPill healthy={system.database?.healthy} onLabel="Online" offLabel="Down" />
          </div>

          <div className="flex items-center justify-between rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-3">
              <Wifi className={system.socket?.healthy ? "text-emerald-600" : "text-rose-600"} size={20} />
              <div>
                <p className="text-xs font-bold uppercase text-slate-500">Socket Server</p>
                <p className="text-sm font-black text-slate-950">{system.socket?.connectedClients ?? 0} clients</p>
              </div>
            </div>
            <StatusPill healthy={system.socket?.healthy} onLabel="Online" offLabel="Down" />
          </div>

          <div className="flex items-center justify-between rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-3">
              <Mail className={system.channels?.email?.healthy ? "text-emerald-600" : "text-slate-400"} size={20} />
              <div>
                <p className="text-xs font-bold uppercase text-slate-500">Email</p>
                <p className="text-sm font-black text-slate-950">{system.channels?.email?.healthy ? "Configured" : "Not configured"}</p>
              </div>
            </div>
            <StatusPill healthy={system.channels?.email?.healthy} onLabel="Ready" offLabel="Not set up" />
          </div>

          <div className="flex items-center justify-between rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-3">
              <MessageSquareOff className="text-slate-400" size={20} />
              <div>
                <p className="text-xs font-bold uppercase text-slate-500">SMS</p>
                <p className="text-sm font-black text-slate-950">Not integrated</p>
              </div>
            </div>
            <StatusPill healthy={false} onLabel="Ready" offLabel="Not integrated" />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3 rounded-xl bg-slate-50 p-4">
          <Clock className="text-slate-500" size={18} />
          <p className="text-sm font-semibold text-slate-600">
            AI automation pipeline: <span className="font-black text-slate-900">{live?.automation?.triggerModel}</span>
            {" · "}last run {timeAgo(live?.automation?.lastRunAt)}
          </p>
        </div>
      </Card>

      {infra && (
        <Card title="Storage, Webhooks & Scheduler">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex items-center justify-between rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-3">
                <HardDrive className={infra.storage?.healthy ? "text-emerald-600" : "text-rose-600"} size={20} />
                <div>
                  <p className="text-xs font-bold uppercase text-slate-500">Storage</p>
                  <p className="text-sm font-black text-slate-950">{infra.storage?.writable ? "Writable" : "Unavailable"}</p>
                </div>
              </div>
              <StatusPill healthy={infra.storage?.healthy} onLabel="Ready" offLabel="Down" />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-slate-200 p-4">
              <div className="flex items-center gap-3">
                <Cpu className={infra.webhook?.healthy ? "text-emerald-600" : "text-rose-600"} size={20} />
                <div>
                  <p className="text-xs font-bold uppercase text-slate-500">Webhooks (24h)</p>
                  <p className="text-sm font-black text-slate-950">
                    {infra.webhook?.last24h?.received ?? 0} received, {infra.webhook?.last24h?.failed ?? 0} failed
                  </p>
                </div>
              </div>
              <StatusPill healthy={infra.webhook?.healthy} onLabel="Ready" offLabel="Failures" />
            </div>
            <div className="rounded-xl border border-slate-200 p-4">
              <p className="mb-2 text-xs font-bold uppercase text-slate-500">Cron / Scheduler jobs</p>
              <p className="text-sm font-black text-slate-950">
                {infra.scheduler?.jobs?.filter((j) => j.status === "success").length ?? 0} healthy /{" "}
                {infra.scheduler?.jobs?.length ?? 0} tracked
              </p>
              <Button to="/admin/platform-health" variant="secondary" className="mt-2 !px-3 !py-1.5 text-xs">
                View details
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* Alert queue */}
      <Card title="Priority Alert Queue" action={<AlertTriangle size={20} className="text-amber-600" />}>
        {alerts?.alerts?.length ? (
          <div className="space-y-2">
            {alerts.alerts.map((alert) => (
              <div key={alert.key} className={`flex items-center justify-between rounded-xl border p-3 ${PRIORITY_STYLES[alert.priority]}`}>
                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide">{alert.priority}</span>
                  <p className="text-sm font-bold">{alert.title}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-black">{alert.count}</span>
                  {alert.link && <Button to={alert.link} variant="secondary">View</Button>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="All clear" description="No active operational alerts right now." />
        )}
      </Card>
    </div>
  );
}

export default AdminMissionControl;
