import { useEffect, useMemo, useState } from "react";
import { Network, Search, ListTree, Workflow, Radar, Sparkles, RefreshCcw, GitBranch } from "lucide-react";
import { processApi } from "../../api/processApi";
import { getApiErrorMessage } from "../../api/axios";
import { useRealtime } from "../../context/RealtimeContext";
import { useToast } from "../../context/ToastContext";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import Loader from "../../components/ui/Loader";
import EmptyState from "../../components/shared/EmptyState";
import DependencyGraphSvg from "../../components/process/DependencyGraphSvg";

// ─────────────────────────────────────────────────────────────────────────
// Phase A6.3.1 — Enterprise Process Registry & Orchestration Core.
//
// One connected hub (same choice AdminMonitoringPlatform.jsx/
// AdminWorkflowIntelligence.jsx made) with internal tabs. Reuses
// dashboardSyncTick for realtime refresh — no new sockets. Every number
// shown here comes straight from backend/process/*.js's own real
// computation; this page renders it, it never re-derives anything.
// ─────────────────────────────────────────────────────────────────────────

const TABS = [
  { key: "registry", label: "Process Registry", icon: ListTree },
  { key: "graph", label: "Dependency Graph", icon: GitBranch },
  { key: "orchestration", label: "Orchestration", icon: Workflow },
  { key: "impact", label: "Impact & Trace", icon: Radar },
];

function HealthPill({ health }) {
  if (!health || typeof health.score !== "number") return <span className="text-xs font-bold text-slate-400">n/a</span>;
  const tone = health.score >= 80 ? "text-emerald-700" : health.score >= 50 ? "text-amber-700" : "text-rose-700";
  return <span className={`text-xs font-bold ${tone}`}>{health.score}/100</span>;
}

function CategoryBadge({ category }) {
  return <span className="rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-600">{category}</span>;
}

// ── Registry tab ─────────────────────────────────────────────────────────
function RegistryTab({ tick, onSelectProcess }) {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [detail, setDetail] = useState(null);
  const [aiExplain, setAiExplain] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const { showError } = useToast();

  useEffect(() => {
    let active = true;
    processApi
      .getRegistry()
      .then((res) => active && setData(res.data))
      .catch((err) => active && setError(getApiErrorMessage(err)))
      .finally(() => active && setIsLoading(false));
    return () => {
      active = false;
    };
  }, [tick]);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.processes.filter((p) => {
      if (category !== "all" && p.category !== category) return false;
      if (!search) return true;
      const q = search.toLowerCase();
      return p.label.toLowerCase().includes(q) || p.id.toLowerCase().includes(q);
    });
  }, [data, category, search]);

  const openDetail = async (proc) => {
    setDetail(proc);
    setAiExplain(null);
    onSelectProcess?.(proc.id);
  };

  const loadAiExplain = async () => {
    if (!detail) return;
    setAiLoading(true);
    try {
      const res = await processApi.explainProcess(detail.id);
      setAiExplain(res.data);
    } catch (err) {
      showError(getApiErrorMessage(err));
    } finally {
      setAiLoading(false);
    }
  };

  if (isLoading) return <Loader label="Loading process registry…" />;
  if (error) return <p className="text-sm font-semibold text-rose-700">{error}</p>;
  if (!data) return null;

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <Card title={`Process Registry (${data.total})`}>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search processes…"
              className="w-full rounded-xl border border-slate-200 py-2 pl-8 pr-3 text-sm font-semibold text-slate-800 outline-none focus:border-blue-500"
            />
          </div>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700"
          >
            <option value="all">All categories</option>
            {data.categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        {filtered.length === 0 ? (
          <EmptyState title="No matching processes" description="Try a different search term or category." />
        ) : (
          <div className="space-y-2">
            {filtered.map((p) => (
              <button
                key={p.id}
                onClick={() => openDetail(p)}
                className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition ${
                  detail?.id === p.id ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <div>
                  <p className="text-sm font-bold text-slate-900">{p.label}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <CategoryBadge category={p.category} />
                    {p.status === "composite" && <span className="text-[10px] font-bold uppercase text-slate-400">composite</span>}
                  </div>
                </div>
                <HealthPill health={p.health} />
              </button>
            ))}
          </div>
        )}
      </Card>

      <Card title={detail ? detail.label : "Select a process"}>
        {!detail ? (
          <p className="text-sm text-slate-500">Click a process on the left to inspect its real registry entry — entry points, dependencies, AI/automation/monitoring/assignment usage, rollback/retry support, and business rules.</p>
        ) : (
          <div className="space-y-4 text-sm">
            <p className="text-slate-600">{detail.documentation}</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs font-bold uppercase text-slate-400">Owner</p>
                <p className="font-semibold text-slate-800">{detail.owner}</p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase text-slate-400">Health</p>
                <HealthPill health={detail.health} />
              </div>
              <div>
                <p className="text-xs font-bold uppercase text-slate-400">Dependencies</p>
                <p className="font-semibold text-slate-800">{detail.dependencies?.join(", ") || "none"}</p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase text-slate-400">Child processes</p>
                <p className="font-semibold text-slate-800">{detail.childProcesses?.join(", ") || "none"}</p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase text-slate-400">Rollback support</p>
                <p className="font-semibold text-slate-800">{detail.rollbackSupport?.supported ? "Yes" : "No"} — {detail.rollbackSupport?.note}</p>
              </div>
              <div>
                <p className="text-xs font-bold uppercase text-slate-400">Retry support</p>
                <p className="font-semibold text-slate-800">{detail.retrySupport?.supported ? "Yes" : "No"} — {detail.retrySupport?.note}</p>
              </div>
            </div>
            {detail.aiUsage?.length > 0 && (
              <div>
                <p className="text-xs font-bold uppercase text-slate-400">AI usage</p>
                <p className="font-semibold text-slate-800">{detail.aiUsage.join(", ")}</p>
              </div>
            )}
            {detail.businessRules?.length > 0 && (
              <div>
                <p className="text-xs font-bold uppercase text-slate-400">Business rules</p>
                <ul className="mt-1 list-disc space-y-1 pl-4 text-slate-700">
                  {detail.businessRules.map((r) => <li key={r}>{r}</li>)}
                </ul>
              </div>
            )}
            <Button variant="secondary" isLoading={aiLoading} onClick={loadAiExplain} className="flex items-center gap-2">
              <Sparkles size={14} /> AI Explain
            </Button>
            {aiExplain && <p className="rounded-xl bg-blue-50 p-3 text-sm font-semibold text-blue-900">{aiExplain.content?.summary || aiExplain.content?.impactNote}</p>}
          </div>
        )}
      </Card>
    </div>
  );
}

// ── Dependency Graph tab ─────────────────────────────────────────────────
function GraphTab({ tick, onSelectProcess }) {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    let active = true;
    processApi
      .getDependencyGraph()
      .then((res) => active && setData(res.data))
      .catch((err) => active && setError(getApiErrorMessage(err)))
      .finally(() => active && setIsLoading(false));
    return () => {
      active = false;
    };
  }, [tick]);

  if (isLoading) return <Loader label="Building process dependency graph…" />;
  if (error) return <p className="text-sm font-semibold text-rose-700">{error}</p>;
  if (!data) return null;

  return (
    <Card title="Process Dependency Graph">
      <p className="mb-4 text-sm text-slate-500">Generated live from the Process Registry — nodes are colored by real computed health. Click a node to inspect it in the Impact & Trace tab.</p>
      <DependencyGraphSvg
        nodes={data.nodes}
        edges={data.edges}
        selectedId={selectedId}
        onNodeClick={(n) => {
          setSelectedId(n.id);
          onSelectProcess?.(n.id);
        }}
      />
    </Card>
  );
}

// ── Orchestration tab ────────────────────────────────────────────────────
function OrchestrationTab({ selectedProcessId }) {
  const [rules, setRules] = useState(null);
  const [plan, setPlan] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [advisor, setAdvisor] = useState(null);
  const [advisorLoading, setAdvisorLoading] = useState(false);
  const { showError } = useToast();

  useEffect(() => {
    let active = true;
    processApi
      .getOrchestrationRules()
      .then((res) => active && setRules(res.data.rules))
      .catch((err) => active && setError(getApiErrorMessage(err)))
      .finally(() => active && setIsLoading(false));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedProcessId) return;
    let active = true;
    processApi.getOrchestrationPlan(selectedProcessId).then((res) => active && setPlan(res.data));
    return () => {
      active = false;
    };
  }, [selectedProcessId]);

  const loadAdvisor = async () => {
    setAdvisorLoading(true);
    try {
      const res = await processApi.getOrchestrationAiAdvisor(selectedProcessId);
      setAdvisor(res.data);
    } catch (err) {
      showError(getApiErrorMessage(err));
    } finally {
      setAdvisorLoading(false);
    }
  };

  if (isLoading) return <Loader label="Loading orchestration rules…" />;
  if (error) return <p className="text-sm font-semibold text-rose-700">{error}</p>;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <Card title="Orchestration Rules (who calls whom)">
        <div className="max-h-96 space-y-2 overflow-y-auto text-sm">
          {rules.map((r) => (
            <p key={r.processId} className="rounded-lg bg-slate-50 p-2 text-slate-700"><span className="font-bold text-slate-900">{r.label}:</span> {r.rule}</p>
          ))}
        </div>
      </Card>
      <Card title={selectedProcessId ? `Plan: ${selectedProcessId}` : "Select a process from the Registry or Graph tab"}>
        {plan ? (
          <div className="space-y-2 text-sm">
            <p><span className="font-bold text-slate-900">Executable:</span> {String(plan.executable)}</p>
            {plan.executable && (
              <>
                <p><span className="font-bold text-slate-900">Execution mode:</span> {plan.executionMode}</p>
                <p><span className="font-bold text-slate-900">Approval gate:</span> {plan.approvalGate ? "Yes" : "No"}</p>
                <p><span className="font-bold text-slate-900">Prerequisites:</span> {plan.prerequisites?.join(", ") || "none"}</p>
                <p><span className="font-bold text-slate-900">Downstream automation:</span> {plan.downstreamAutomation?.length ? plan.downstreamAutomation.map((f) => f.triggerLabel).join(", ") : "none"}</p>
              </>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No plan loaded yet.</p>
        )}
        <Button variant="secondary" isLoading={advisorLoading} onClick={loadAdvisor} className="mt-4 flex items-center gap-2">
          <Sparkles size={14} /> AI Orchestration Advisor
        </Button>
        {advisor && <p className="mt-3 rounded-xl bg-blue-50 p-3 text-sm font-semibold text-blue-900">{advisor.content?.summary}</p>}
      </Card>
    </div>
  );
}

// ── Impact & Trace tab ───────────────────────────────────────────────────
function ImpactTraceTab({ selectedProcessId }) {
  const [impact, setImpact] = useState(null);
  const [sourceId, setSourceId] = useState("");
  const [trace, setTrace] = useState(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const [aiExplain, setAiExplain] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const { showError } = useToast();

  useEffect(() => {
    if (!selectedProcessId) return;
    let active = true;
    processApi.getImpact(selectedProcessId).then((res) => active && setImpact(res.data));
    return () => {
      active = false;
    };
  }, [selectedProcessId]);

  const loadTrace = async () => {
    if (!sourceId) return;
    setTraceLoading(true);
    try {
      const res = await processApi.getTrace(sourceId);
      setTrace(res.data.events);
    } catch (err) {
      showError(getApiErrorMessage(err));
    } finally {
      setTraceLoading(false);
    }
  };

  const loadAiExplain = async () => {
    if (!selectedProcessId) return;
    setAiLoading(true);
    try {
      const res = await processApi.explainImpact(selectedProcessId, sourceId || undefined);
      setAiExplain(res.data);
    } catch (err) {
      showError(getApiErrorMessage(err));
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <Card title="Impact Analysis">
        {!selectedProcessId ? (
          <p className="text-sm text-slate-500">Select a process from the Registry or Graph tab to see what would be impacted if it degraded.</p>
        ) : impact ? (
          <div className="space-y-2 text-sm">
            <p className="text-slate-600">{impact.note}</p>
            <p><span className="font-bold text-slate-900">Upstream:</span> {impact.upstream?.join(", ") || "none"}</p>
            <p><span className="font-bold text-slate-900">Downstream ({impact.impactedCount}):</span> {impact.downstream?.join(", ") || "none"}</p>
            <Button variant="secondary" isLoading={aiLoading} onClick={loadAiExplain} className="mt-2 flex items-center gap-2">
              <Sparkles size={14} /> AI Impact Explain
            </Button>
            {aiExplain && <p className="rounded-xl bg-blue-50 p-3 text-sm font-semibold text-blue-900">{aiExplain.content?.summary}</p>}
          </div>
        ) : (
          <Loader label="Computing impact graph…" />
        )}
      </Card>
      <Card title="Cross-System Event Trace">
        <p className="mb-3 text-sm text-slate-500">Enter a real record id (appointment, refund, insurance claim, payment, doctor, or user id) to trace every automation run, notification, AI draft, and workflow lifecycle event associated with it.</p>
        <div className="flex gap-2">
          <input
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
            placeholder="Source id…"
            className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold"
          />
          <Button variant="secondary" isLoading={traceLoading} onClick={loadTrace}>Trace</Button>
        </div>
        <div className="mt-4 max-h-72 space-y-2 overflow-y-auto">
          {trace?.length ? (
            trace.map((e, i) => (
              <div key={i} className="rounded-lg border border-slate-100 bg-slate-50 p-2 text-xs">
                <p className="font-bold text-slate-800">{e.kind}: {e.label}</p>
                <p className="text-slate-400">{new Date(e.at).toLocaleString()}{e.detail ? ` — ${e.detail}` : ""}</p>
              </div>
            ))
          ) : trace ? (
            <EmptyState title="No trace events found" description="This source id has no matching automation, notification, AI draft, or lifecycle events yet." />
          ) : null}
        </div>
      </Card>
    </div>
  );
}

export default function AdminProcessOrchestrator() {
  const [activeTab, setActiveTab] = useState("registry");
  const [selectedProcessId, setSelectedProcessId] = useState(null);
  const { dashboardSyncTick } = useRealtime();

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.18em] text-blue-600">
            <Network size={16} /> Enterprise Process Orchestrator
          </p>
          <h1 className="mt-2 text-2xl font-black text-slate-950">Process Registry & Orchestration</h1>
          <p className="mt-2 text-sm text-slate-600">Every real workflow, its dependencies, health, and orchestration plan — generated live from the codebase, never hand-maintained.</p>
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

      {activeTab === "registry" && <RegistryTab tick={dashboardSyncTick} onSelectProcess={setSelectedProcessId} />}
      {activeTab === "graph" && <GraphTab tick={dashboardSyncTick} onSelectProcess={setSelectedProcessId} />}
      {activeTab === "orchestration" && <OrchestrationTab selectedProcessId={selectedProcessId} />}
      {activeTab === "impact" && <ImpactTraceTab selectedProcessId={selectedProcessId} />}
    </div>
  );
}
