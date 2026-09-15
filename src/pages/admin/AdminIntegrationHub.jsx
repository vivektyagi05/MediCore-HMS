import { useEffect, useMemo, useState } from "react";
import { Share2, Activity, Unlink2, RefreshCcw, Sparkles, AlertTriangle } from "lucide-react";
import { integrationHubApi } from "../../api/integrationHubApi";
import { getApiErrorMessage } from "../../api/axios";
import { useRealtime } from "../../context/RealtimeContext";
import { useToast } from "../../context/ToastContext";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import Loader from "../../components/ui/Loader";
import EmptyState from "../../components/shared/EmptyState";
import DependencyGraphSvg from "../../components/process/DependencyGraphSvg";

// ─────────────────────────────────────────────────────────────────────────
// Phase A6.3.2 — Cross-System Integration Hub.
//
// Every edge shown here is auto-discovered from the Process Registry's own
// dependency data (backend/process/integrationHub.js) — nothing here is a
// static list. Health/latency/failure figures reuse the exact same real
// signals processHealth.js already computes; this page never recomputes
// anything.
// ─────────────────────────────────────────────────────────────────────────

const STATUS_TONE = { healthy: "text-emerald-700 bg-emerald-50", degraded: "text-amber-700 bg-amber-50", at_risk: "text-rose-700 bg-rose-50", unknown: "text-slate-500 bg-slate-100" };

function StatusPill({ status }) {
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${STATUS_TONE[status] || STATUS_TONE.unknown}`}>{status}</span>;
}

function HealthList({ tick }) {
  const [edges, setEdges] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [explain, setExplain] = useState(null);
  const [explainLoading, setExplainLoading] = useState(false);
  const { showError } = useToast();

  useEffect(() => {
    let active = true;
    integrationHubApi
      .getHealth()
      .then((res) => active && setEdges(res.data.edges))
      .catch((err) => active && setError(getApiErrorMessage(err)))
      .finally(() => active && setIsLoading(false));
    return () => {
      active = false;
    };
  }, [tick]);

  const loadExplain = async (edge) => {
    setSelected(edge);
    setExplain(null);
    setExplainLoading(true);
    try {
      const res = await integrationHubApi.explainEdge(edge.id);
      setExplain(res.data);
    } catch (err) {
      showError(getApiErrorMessage(err));
    } finally {
      setExplainLoading(false);
    }
  };

  if (isLoading) return <Loader label="Discovering integrations…" />;
  if (error) return <p className="text-sm font-semibold text-rose-700">{error}</p>;
  if (!edges) return null;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
      <Card title={`Integrations (${edges.length})`}>
        {edges.length === 0 ? (
          <EmptyState title="No integrations discovered" description="Add a dependency to a Process Registry entry to see it appear here automatically." />
        ) : (
          <div className="space-y-2">
            {edges.map((edge) => (
              <button
                key={edge.id}
                onClick={() => loadExplain(edge)}
                className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition ${
                  selected?.id === edge.id ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <div>
                  <p className="text-sm font-bold text-slate-900">{edge.fromLabel} <span className="text-slate-400">→</span> {edge.toLabel}</p>
                  <p className="mt-1 text-[11px] text-slate-400">{edge.verifiedVia}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-600">{edge.edgeHealthScore ?? "n/a"}</span>
                  <StatusPill status={edge.status} />
                </div>
              </button>
            ))}
          </div>
        )}
      </Card>
      <Card title={selected ? `${selected.fromLabel} → ${selected.toLabel}` : "Select an integration"}>
        {!selected ? (
          <p className="text-sm text-slate-500">Click an integration on the left to see its real health breakdown and an AI explanation.</p>
        ) : (
          <div className="space-y-3 text-sm">
            <p><span className="font-bold text-slate-900">From health:</span> {selected.fromHealth?.score ?? "n/a"} — {selected.fromHealth?.note}</p>
            <p><span className="font-bold text-slate-900">To health:</span> {selected.toHealth?.score ?? "n/a"} — {selected.toHealth?.note}</p>
            {explainLoading ? (
              <Loader label="Asking AI Integration Explain…" />
            ) : explain ? (
              <p className="rounded-xl bg-blue-50 p-3 font-semibold text-blue-900">{explain.content?.summary}</p>
            ) : null}
          </div>
        )}
      </Card>
    </div>
  );
}

function GraphView({ tick }) {
  const [edges, setEdges] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    integrationHubApi.getEdges().then((res) => active && setEdges(res.data.edges)).finally(() => active && setIsLoading(false));
    return () => {
      active = false;
    };
  }, [tick]);

  const graph = useMemo(() => {
    if (!edges) return { nodes: [], edges: [] };
    const nodeMap = new Map();
    edges.forEach((e) => {
      nodeMap.set(e.from, { id: e.from, label: e.fromLabel });
      nodeMap.set(e.to, { id: e.to, label: e.toLabel });
    });
    return { nodes: [...nodeMap.values()], edges: edges.map((e) => ({ from: e.from, to: e.to })) };
  }, [edges]);

  if (isLoading) return <Loader label="Building integration graph…" />;

  return (
    <Card title="Integration Graph">
      <p className="mb-4 text-sm text-slate-500">Patient → Appointment → Doctor → Prescription → Medical Report → Insurance → Finance → Payments → Notifications → Automation → Workflow → Assignment → Monitoring → Intelligence → Admin — auto-discovered, not a static pipeline.</p>
      <DependencyGraphSvg nodes={graph.nodes} edges={graph.edges} />
    </Card>
  );
}

function ConnectivityView({ tick }) {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let active = true;
    integrationHubApi.getConnectedDisconnected().then((res) => active && setData(res.data)).finally(() => active && setIsLoading(false));
    return () => {
      active = false;
    };
  }, [tick]);

  if (isLoading) return <Loader label="Checking connected modules…" />;
  if (!data) return null;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title={`Connected Modules (${data.connected.length})`}>
        <div className="space-y-2">
          {data.connected.map((m) => (
            <div key={m.processId} className="flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2 text-sm">
              <span className="font-bold text-slate-800">{m.label}</span>
              <span className="text-[11px] text-emerald-700">{m.via}</span>
            </div>
          ))}
        </div>
      </Card>
      <Card title={`Disconnected Modules (${data.disconnected.length})`}>
        {data.disconnected.length === 0 ? (
          <EmptyState title="Nothing disconnected" description="Every process in the registry has at least one real dependency or automation edge." />
        ) : (
          <div className="space-y-2">
            {data.disconnected.map((m) => (
              <div key={m.processId} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                <span className="flex items-center gap-2 font-bold text-slate-700"><Unlink2 size={12} /> {m.label}</span>
                <span className="text-[11px] text-slate-400">{m.reason}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function DeadEventsView() {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    integrationHubApi.getDeadEvents(7).then((res) => setData(res.data)).finally(() => setIsLoading(false));
  }, []);

  if (isLoading) return <Loader label="Scanning for dead & failed events…" />;
  if (!data) return null;

  const groups = [
    { key: "failedAutomationRuns", label: "Failed Automation Runs" },
    { key: "failedCronJobs", label: "Failed Cron Jobs" },
    { key: "failedWebhooks", label: "Failed Webhooks" },
    { key: "deadLetterPayments", label: "Dead-Letter Payments" },
  ];

  return (
    <Card title={`Dead & Failed Events — last 7 days (${data.totalCount})`}>
      {data.totalCount === 0 ? (
        <EmptyState title="Nothing failed recently" description="No failed automation runs, cron jobs, webhooks, or dead-letter payments in the last 7 days." />
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            data[g.key]?.length > 0 && (
              <div key={g.key}>
                <p className="mb-2 flex items-center gap-2 text-xs font-black uppercase text-slate-500"><AlertTriangle size={12} /> {g.label} ({data[g.key].length})</p>
                <div className="space-y-1">
                  {data[g.key].slice(0, 10).map((item, i) => (
                    <div key={i} className="rounded-lg bg-rose-50 px-3 py-2 text-xs">
                      <p className="font-bold text-rose-800">{item.triggerType || item.jobName || item.eventType || "payment"}</p>
                      <p className="text-rose-500">{item.replayVia}</p>
                    </div>
                  ))}
                </div>
              </div>
            )
          ))}
        </div>
      )}
    </Card>
  );
}

const TABS = [
  { key: "health", label: "Integration Health", icon: Activity },
  { key: "graph", label: "Integration Graph", icon: Share2 },
  { key: "connectivity", label: "Connected / Disconnected", icon: Unlink2 },
  { key: "dead", label: "Dead & Failed Events", icon: AlertTriangle },
];

export default function AdminIntegrationHub() {
  const [activeTab, setActiveTab] = useState("health");
  const { dashboardSyncTick } = useRealtime();

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.18em] text-blue-600">
            <Share2 size={16} /> Cross-System Integration Hub
          </p>
          <h1 className="mt-2 text-2xl font-black text-slate-950">Integration Hub</h1>
          <p className="mt-2 text-sm text-slate-600">Every module-to-module integration, auto-discovered from the Process Registry — health, connectivity, and dead events, all real.</p>
        </div>
        <span className="flex items-center gap-1 text-xs font-semibold text-slate-400"><RefreshCcw size={12} /> live</span>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition ${
                activeTab === tab.key ? "bg-slate-950 text-white" : "text-slate-500 hover:bg-slate-100"
              }`}
            >
              <Icon size={14} /> {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "health" && <HealthList tick={dashboardSyncTick} />}
      {activeTab === "graph" && <GraphView tick={dashboardSyncTick} />}
      {activeTab === "connectivity" && <ConnectivityView tick={dashboardSyncTick} />}
      {activeTab === "dead" && <DeadEventsView />}
    </div>
  );
}
