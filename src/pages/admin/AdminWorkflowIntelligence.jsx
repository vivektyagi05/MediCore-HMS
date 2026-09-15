import { useEffect, useState } from "react";
import { Brain, AlertTriangle, TrendingUp, Wrench, HeartPulse, Sparkles, RefreshCcw } from "lucide-react";
import { intelligenceApi } from "../../api/intelligenceApi";
import { getApiErrorMessage } from "../../api/axios";
import { useRealtime } from "../../context/RealtimeContext";
import { useToast } from "../../context/ToastContext";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import Loader from "../../components/ui/Loader";
import EmptyState from "../../components/shared/EmptyState";

// ─────────────────────────────────────────────────────────────────────────
// Phase A6.2.5 — Autonomous Workflow Intelligence & Self-Healing Platform.
//
// One connected hub (same choice AdminMonitoringPlatform.jsx/
// AdminAutomationStudio.jsx made) with internal tabs. Reuses
// dashboardSyncTick for realtime refresh — no new sockets. Every number
// shown here comes straight from the Intelligence Engine's own real
// computation (backend/workflow/intelligence/*); this page renders it, it
// never re-derives anything.
//
// Self-Healing tab is deliberately the only tab with a write action, and
// every write requires an explicit two-step approve click — there is no
// "run all" or auto-approve control anywhere on this page, matching the
// backend's own "nothing executes without approval" guarantee.
// ─────────────────────────────────────────────────────────────────────────

const TABS = [
  { key: "overview", label: "Intelligence Score", icon: Brain },
  { key: "predictions", label: "Predictions", icon: TrendingUp },
  { key: "anomalies", label: "Anomalies", icon: AlertTriangle },
  { key: "capacity", label: "Capacity Forecast", icon: Sparkles },
  { key: "optimization", label: "Optimization", icon: Wrench },
  { key: "healing", label: "Self-Healing Queue", icon: HeartPulse },
];

function SeverityBadge({ severity }) {
  const toneClass = {
    critical: "bg-rose-100 text-rose-700 border-rose-200",
    high: "bg-amber-100 text-amber-700 border-amber-200",
    medium: "bg-blue-100 text-blue-700 border-blue-200",
    low: "bg-slate-100 text-slate-600 border-slate-200",
  }[severity] || "bg-slate-100 text-slate-600 border-slate-200";
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-bold uppercase ${toneClass}`}>{severity}</span>;
}

function ConfidencePill({ score, level }) {
  const toneClass = { high: "text-emerald-700", medium: "text-amber-700", low: "text-slate-500" }[level] || "text-slate-500";
  return <span className={`text-xs font-bold ${toneClass}`}>{score}% confidence</span>;
}

// ── Intelligence Score tab ──────────────────────────────────────────────
function OverviewTab({ tick }) {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [aiSummary, setAiSummary] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    let active = true;
    intelligenceApi
      .getOverview()
      .then((res) => active && setData(res.data))
      .catch((err) => active && setError(getApiErrorMessage(err)))
      .finally(() => active && setIsLoading(false));
    return () => {
      active = false;
    };
  }, [tick]);

  const loadAiSummary = async () => {
    setAiLoading(true);
    try {
      const res = await intelligenceApi.getOverviewAiSummary();
      setAiSummary(res.data);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setAiLoading(false);
    }
  };

  if (isLoading) return <Loader label="Computing platform intelligence…" />;
  if (error) return <p className="text-sm font-semibold text-rose-700">{error}</p>;
  if (!data) return null;

  const { intelligenceScore, scoreBreakdown } = data;
  const scoreTone = intelligenceScore >= 80 ? "text-emerald-700" : intelligenceScore >= 50 ? "text-amber-700" : "text-rose-700";

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white/60 p-6 text-center">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Platform Intelligence Score</p>
        <p className={`mt-2 text-5xl font-black ${scoreTone}`}>{intelligenceScore}</p>
        <p className="mt-1 text-xs text-slate-500">Deterministic — starts at 100, subtracts disclosed penalties per critical/high signal.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Object.entries(scoreBreakdown).map(([key, value]) => (
          <div key={key} className="rounded-xl border border-slate-200 bg-white/60 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{key.replace(/([A-Z])/g, " $1")}</p>
            <p className="mt-1 text-2xl font-black text-slate-950">{value}</p>
          </div>
        ))}
      </div>

      <Card title="AI Platform Summary" action={<Button variant="secondary" isLoading={aiLoading} onClick={loadAiSummary}>Generate</Button>}>
        {aiSummary ? (
          <div className="space-y-1 text-sm text-slate-700">
            <p>{aiSummary.summary}</p>
            <p className="text-xs italic text-slate-400">{aiSummary.disclaimer}</p>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Grounded strictly in the score breakdown above — click Generate for a plain-language read.</p>
        )}
      </Card>
    </div>
  );
}

// ── Predictions tab ──────────────────────────────────────────────────────
function PredictionsTab({ tick }) {
  const [predictions, setPredictions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [explains, setExplains] = useState({});

  useEffect(() => {
    let active = true;
    intelligenceApi
      .getPredictions()
      .then((res) => active && setPredictions(res.data.predictions))
      .catch((err) => active && setError(getApiErrorMessage(err)))
      .finally(() => active && setIsLoading(false));
    return () => {
      active = false;
    };
  }, [tick]);

  const explain = async (id) => {
    try {
      const res = await intelligenceApi.explainPrediction(id);
      setExplains((prev) => ({ ...prev, [id]: res.data }));
    } catch (err) {
      setError(getApiErrorMessage(err));
    }
  };

  if (isLoading) return <Loader label="Scanning for real prediction signals…" />;
  if (error) return <p className="text-sm font-semibold text-rose-700">{error}</p>;
  if (!predictions.length) return <EmptyState title="No active predictions" description="No signal has crossed a real threshold right now." />;

  return (
    <div className="space-y-3">
      {predictions.map((p) => (
        <Card key={p.id}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <SeverityBadge severity={p.severity} />
                <ConfidencePill score={p.confidence} level={p.confidenceLevel} />
              </div>
              <p className="mt-2 text-sm font-semibold text-slate-900">{p.prediction}</p>
              <p className="mt-1 text-xs text-slate-500">{p.reason}</p>
              <p className="mt-1 text-xs font-semibold text-blue-700">→ {p.recommendedAction}</p>
            </div>
            <Button variant="secondary" onClick={() => explain(p.id)}>Explain</Button>
          </div>
          {explains[p.id] && (
            <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
              <p>{explains[p.id].whatIsPredicted}</p>
              <p className="mt-1 text-slate-500">{explains[p.id].supportingData}</p>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

// ── Anomalies tab ─────────────────────────────────────────────────────────
function AnomaliesTab({ tick }) {
  const [anomalies, setAnomalies] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    intelligenceApi
      .getAnomalies()
      .then((res) => active && setAnomalies(res.data.anomalies))
      .catch((err) => active && setError(getApiErrorMessage(err)))
      .finally(() => active && setIsLoading(false));
    return () => {
      active = false;
    };
  }, [tick]);

  if (isLoading) return <Loader label="Checking real metrics against their own trailing history…" />;
  if (error) return <p className="text-sm font-semibold text-rose-700">{error}</p>;
  if (!anomalies.length) return <EmptyState title="No anomalies detected" description="Every checked metric is within its normal statistical range." />;

  return (
    <div className="space-y-3">
      {anomalies.map((a) => (
        <Card key={a.id}>
          <div className="flex items-center gap-2">
            <SeverityBadge severity={a.severity} />
            <ConfidencePill score={a.confidence} level={a.confidenceLevel} />
            <span className="text-xs font-semibold text-slate-500">z={a.zScore}</span>
          </div>
          <p className="mt-2 text-sm font-semibold text-slate-900">{a.rootCause}</p>
          <p className="mt-1 text-xs text-slate-500">{a.evidence}</p>
          <p className="mt-1 text-xs text-slate-600">{a.impact}</p>
          <p className="mt-1 text-xs font-semibold text-blue-700">→ {a.recommendedAction}</p>
        </Card>
      ))}
    </div>
  );
}

// ── Capacity Forecast tab ─────────────────────────────────────────────────
function CapacityTab({ tick }) {
  const [forecast, setForecast] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    intelligenceApi
      .getCapacityForecast()
      .then((res) => active && setForecast(res.data))
      .catch((err) => active && setError(getApiErrorMessage(err)))
      .finally(() => active && setIsLoading(false));
    return () => {
      active = false;
    };
  }, [tick]);

  if (isLoading) return <Loader label="Projecting real historical trends forward…" />;
  if (error) return <p className="text-sm font-semibold text-rose-700">{error}</p>;
  if (!forecast) return null;

  const metrics = Object.entries(forecast).filter(([, v]) => v && typeof v === "object" && "trendConfidenceR2" in v);

  return (
    <div className="space-y-4">
      {metrics.map(([key, m]) => (
        <Card key={key} title={key.replace(/([A-Z])/g, " $1")}>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div><p className="text-xs text-slate-400">Next hour</p><p className="text-lg font-black">{m.oneHour}</p></div>
            <div><p className="text-xs text-slate-400">Next 24h</p><p className="text-lg font-black">{m.twentyFourHour}</p></div>
            <div><p className="text-xs text-slate-400">Next 7d</p><p className="text-lg font-black">{m.sevenDay}</p></div>
            <div><p className="text-xs text-slate-400">Next 30d</p><p className="text-lg font-black">{m.thirtyDay}</p></div>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Trend confidence r²={m.trendConfidenceR2} over {m.historyDays} days ({m.sampleSize} data points).
            {m.trendConfidenceR2 < 0.15 && <span className="ml-1 font-semibold text-amber-700">Trend is too noisy to act on with confidence.</span>}
          </p>
        </Card>
      ))}
      {forecast.deferredMetrics?.length > 0 && (
        <Card title="Not forecast (documented, not fabricated)">
          <ul className="list-disc space-y-1 pl-5 text-xs text-slate-500">
            {forecast.deferredMetrics.map((d) => <li key={d}>{d}</li>)}
          </ul>
        </Card>
      )}
    </div>
  );
}

// ── Optimization tab ──────────────────────────────────────────────────────
function OptimizationTab({ tick }) {
  const [optimization, setOptimization] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    intelligenceApi
      .getOptimization()
      .then((res) => active && setOptimization(res.data))
      .catch((err) => active && setError(getApiErrorMessage(err)))
      .finally(() => active && setIsLoading(false));
    return () => {
      active = false;
    };
  }, [tick]);

  if (isLoading) return <Loader label="Analyzing automation flow structure…" />;
  if (error) return <p className="text-sm font-semibold text-rose-700">{error}</p>;
  if (!optimization?.suggestions?.length) return <EmptyState title="No optimization suggestions" description="No unused, duplicate, expensive, slow, or noisy flow was found." />;

  return (
    <div className="space-y-3">
      {optimization.suggestions.map((s) => (
        <Card key={s.id}>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-bold uppercase text-slate-600">{s.action}</span>
            <span className="text-sm font-semibold text-slate-900">{s.target?.name || s.target?.names?.join(", ")}</span>
          </div>
          <p className="mt-1 text-xs text-slate-500">{s.why}</p>
        </Card>
      ))}
    </div>
  );
}

// ── Self-Healing Queue tab ────────────────────────────────────────────────
function HealingTab({ tick }) {
  const toast = useToast();
  const [allowed, setAllowed] = useState([]);
  const [queue, setQueue] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedAction, setSelectedAction] = useState("");
  const [busyId, setBusyId] = useState(null);

  const load = () => {
    setIsLoading(true);
    Promise.all([intelligenceApi.getAllowedHealingActions(), intelligenceApi.getHealingQueue()])
      .then(([a, q]) => {
        setAllowed(a.data);
        setQueue(q.data);
      })
      .catch((err) => setError(getApiErrorMessage(err)))
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    load();
  }, [tick]);

  const queueAction = async () => {
    if (!selectedAction) return;
    try {
      await intelligenceApi.queueHealingAction({ actionKey: selectedAction, trigger: "manual" });
      toast.success("Action queued — awaiting approval.");
      load();
    } catch (err) {
      setError(getApiErrorMessage(err));
    }
  };

  const approve = async (id) => {
    setBusyId(id);
    try {
      const res = await intelligenceApi.approveHealingAction(id);
      res.data.status === "failed" ? toast.error(`Action ${res.data.status}.`) : toast.success(`Action ${res.data.status}.`);
      load();
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (id) => {
    setBusyId(id);
    try {
      await intelligenceApi.rejectHealingAction(id, "Rejected by admin");
      toast.info("Action rejected.");
      load();
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  if (isLoading) return <Loader label="Loading self-healing queue…" />;

  return (
    <div className="space-y-6">
      {error && <p className="text-sm font-semibold text-rose-700">{error}</p>}

      <Card title="Queue a healing action">
        <p className="mb-3 text-xs text-slate-500">
          Every action below is on a fixed allowlist mapped to a real, pre-existing mechanism — nothing executes until an admin explicitly approves it.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <select
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={selectedAction}
            onChange={(e) => setSelectedAction(e.target.value)}
          >
            <option value="">Select an action…</option>
            {allowed.map((a) => (
              <option key={a.key} value={a.key}>{a.label}</option>
            ))}
          </select>
          <Button variant="secondary" onClick={queueAction} disabled={!selectedAction}>Queue for approval</Button>
        </div>
        {selectedAction && (
          <p className="mt-2 text-xs text-slate-500">{allowed.find((a) => a.key === selectedAction)?.safetyPolicy}</p>
        )}
      </Card>

      <Card title="Queue">
        {!queue.length ? (
          <EmptyState title="Queue is empty" description="No healing actions have been queued yet." />
        ) : (
          <div className="space-y-3">
            {queue.map((q) => (
              <div key={q._id} className="rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{q.actionKey}</p>
                    <p className="text-xs text-slate-500">Triggered by: {q.trigger}</p>
                    <p className="mt-1 text-xs text-slate-500">{q.safetyPolicy}</p>
                    <p className="mt-1 text-xs">
                      Rollback possible: <span className="font-semibold">{q.rollbackPossible ? "Yes" : "No"}</span> — {q.rollbackNote}
                    </p>
                    {q.errorMessage && <p className="mt-1 text-xs font-semibold text-rose-700">{q.errorMessage}</p>}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-bold uppercase text-slate-600">{q.status}</span>
                    {q.status === "pending_approval" && (
                      <div className="flex gap-2">
                        <Button variant="primary" isLoading={busyId === q._id} onClick={() => approve(q._id)}>Approve & Run</Button>
                        <Button variant="secondary" isLoading={busyId === q._id} onClick={() => reject(q._id)}>Reject</Button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

export default function AdminWorkflowIntelligence() {
  const { dashboardSyncTick } = useRealtime();
  const [activeTab, setActiveTab] = useState("overview");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-950">Workflow Intelligence</h1>
          <p className="text-sm text-slate-500">Predictions, anomalies, capacity forecasting, optimization, and an approval-gated self-healing queue.</p>
        </div>
        <RefreshCcw className="h-4 w-4 text-slate-400" />
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${
                activeTab === tab.key ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "overview" && <OverviewTab tick={dashboardSyncTick} />}
      {activeTab === "predictions" && <PredictionsTab tick={dashboardSyncTick} />}
      {activeTab === "anomalies" && <AnomaliesTab tick={dashboardSyncTick} />}
      {activeTab === "capacity" && <CapacityTab tick={dashboardSyncTick} />}
      {activeTab === "optimization" && <OptimizationTab tick={dashboardSyncTick} />}
      {activeTab === "healing" && <HealingTab tick={dashboardSyncTick} />}
    </div>
  );
}
