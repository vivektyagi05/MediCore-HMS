import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  GitCompare,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wrench,
  XCircle,
} from "lucide-react";
import { processAnalyticsApi } from "../../api/processAnalyticsApi";
import { getApiErrorMessage } from "../../api/axios";
import { useToast } from "../../context/ToastContext";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import Loader from "../../components/ui/Loader";
import Badge from "../../components/ui/Badge";
import EmptyState from "../../components/shared/EmptyState";
import ErrorState from "../../components/shared/ErrorState";
import SettingsTabs from "../../components/settings/SettingsTabs";
import { MiniBarChart, MiniLineChart } from "../../components/finance/FinanceCharts";

// ─────────────────────────────────────────────────────────────────────────
// Phase A6.3.4 — Process Analytics & Optimization Intelligence.
//
// One connected hub (Overview / Process Detail / Optimization Center),
// same "not ten separate routes" posture Process Designer (A6.3.3) and
// Automation Studio (A6.2.3) already established for this codebase.
// Every number on this page comes from process-analytics/
// processAnalyticsAggregates.js via processAnalyticsApi — nothing here
// recomputes an average, a rate, or a percentile client-side.
// ─────────────────────────────────────────────────────────────────────────

const HEALTH_TONE = { Healthy: "success", "Needs Attention": "warning", Degraded: "danger" };
const SEVERITY_TONE = { low: "neutral", medium: "info", high: "warning", critical: "danger" };
const STATUS_TONE = { detected: "info", reviewed: "sky", simulation_ready: "violet", approved: "success", rejected: "danger", implemented: "neutral" };
const RANGE_OPTIONS = [7, 30, 90];

function StatTile({ label, value, hint, icon: Icon, tone = "neutral" }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/60 p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p>
        {Icon && <Icon size={16} className="text-slate-400" />}
      </div>
      <p className={`mt-1 text-2xl font-black ${tone === "danger" ? "text-rose-600" : tone === "success" ? "text-emerald-600" : "text-slate-950"}`}>{value}</p>
      {hint && <p className="mt-1 text-xs font-semibold text-slate-400">{hint}</p>}
    </div>
  );
}

function AdminProcessAnalytics() {
  const toast = useToast();
  const [tab, setTab] = useState("overview");
  const [rangeDays, setRangeDays] = useState(30);

  // Overview
  const [overview, setOverview] = useState(null);
  const [crossProcess, setCrossProcess] = useState(null);
  const [loadingOverview, setLoadingOverview] = useState(true);

  // Process list + detail
  const [processes, setProcesses] = useState([]);
  const [selectedKey, setSelectedKey] = useState(null);
  const [detailTab, setDetailTab] = useState("performance");
  const [performance, setPerformance] = useState(null);
  const [health, setHealth] = useState(null);
  const [bottlenecks, setBottlenecks] = useState(null);
  const [failures, setFailures] = useState(null);
  const [sla, setSla] = useState(null);
  const [versionIntel, setVersionIntel] = useState(null);
  const [compareVersions, setCompareVersions] = useState({ a: "", b: "" });
  const [compareResult, setCompareResult] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [aiExplain, setAiExplain] = useState(null);
  const [slaInput, setSlaInput] = useState("");

  // Optimization Center
  const [recommendations, setRecommendations] = useState([]);
  const [loadingRecs, setLoadingRecs] = useState(true);
  const [recsError, setRecsError] = useState(null);
  const [recsPage, setRecsPage] = useState(1);
  const [recsPagination, setRecsPagination] = useState(null);
  const [recStatusFilter, setRecStatusFilter] = useState("");
  const [recSeverityFilter, setRecSeverityFilter] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    loadOverview();
  }, [rangeDays]);

  useEffect(() => {
    processAnalyticsApi.listProcesses().then((res) => setProcesses(res.data || [])).catch(() => {});
  }, []);

  // Filter changes must reset to page 1 — the server, not the client,
  // owns pagination, so a stale page number combined with a new filter
  // could silently request a page that no longer exists.
  useEffect(() => {
    setRecsPage(1);
  }, [recStatusFilter, recSeverityFilter]);

  useEffect(() => {
    loadRecommendations(recsPage);
  }, [recsPage, recStatusFilter, recSeverityFilter]);

  useEffect(() => {
    if (selectedKey) loadDetail(selectedKey);
  }, [selectedKey, rangeDays]);

  async function loadOverview() {
    setLoadingOverview(true);
    try {
      const [ov, cp] = await Promise.all([
        processAnalyticsApi.getOverview({ rangeDays }),
        processAnalyticsApi.getCrossProcess({ rangeDays }),
      ]);
      setOverview(ov.data);
      setCrossProcess(cp.data);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setLoadingOverview(false);
    }
  }

  async function loadRecommendations(page = 1) {
    setLoadingRecs(true);
    setRecsError(null);
    try {
      const params = { page, pageSize: 20 };
      if (recStatusFilter) params.status = recStatusFilter;
      if (recSeverityFilter) params.severity = recSeverityFilter;
      const res = await processAnalyticsApi.listRecommendations(params);
      setRecommendations(res.data || []);
      setRecsPagination(res.meta || null);
    } catch (err) {
      setRecsError(getApiErrorMessage(err));
    } finally {
      setLoadingRecs(false);
    }
  }

  async function loadDetail(key) {
    setLoadingDetail(true);
    setAiExplain(null);
    setCompareResult(null);
    try {
      const [perf, hlt, bot, fail, slaRes, ver] = await Promise.all([
        processAnalyticsApi.getPerformance(key, { rangeDays }),
        processAnalyticsApi.getHealth(key, { rangeDays }),
        processAnalyticsApi.getBottlenecks(key, { rangeDays }),
        processAnalyticsApi.getFailures(key, { rangeDays }),
        processAnalyticsApi.getSla(key, { rangeDays }),
        processAnalyticsApi.getVersions(key, { rangeDays: 90 }),
      ]);
      setPerformance(perf.data);
      setHealth(hlt.data);
      setBottlenecks(bot.data);
      setFailures(fail.data);
      setSla(slaRes.data);
      setVersionIntel(ver.data);
      setSlaInput(slaRes.data?.slaTargetMs ?? "");
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setLoadingDetail(false);
    }
  }

  async function handleSetSla() {
    if (!selectedKey || !performance?.activeVersion) return;
    setBusy(true);
    try {
      const value = slaInput === "" ? null : Number(slaInput);
      await processAnalyticsApi.setSlaTarget(selectedKey, { version: performance.activeVersion.version, slaTargetMs: value });
      toast.success("SLA target updated.");
      loadDetail(selectedKey);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleCompare() {
    if (!compareVersions.a || !compareVersions.b) return;
    setBusy(true);
    try {
      const res = await processAnalyticsApi.compareVersions(selectedKey, Number(compareVersions.a), Number(compareVersions.b));
      setCompareResult(res.data);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleExplain(kind) {
    setBusy(true);
    try {
      let res;
      if (kind === "analytics") res = await processAnalyticsApi.explainAnalytics(selectedKey, { rangeDays });
      else if (kind === "bottleneck") res = await processAnalyticsApi.explainBottlenecks(selectedKey, { rangeDays });
      else if (kind === "optimization") res = await processAnalyticsApi.explainOptimization(selectedKey);
      setAiExplain({ kind, ...res.data });
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRunDetection(key) {
    setBusy(true);
    try {
      const res = await processAnalyticsApi.runDetection(key ? { key, rangeDays } : { rangeDays });
      toast.success(`Detection complete — ${res.data.candidatesDetected ?? res.data.processed ?? 0} candidate(s) processed.`);
      loadRecommendations(recsPage);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRecAction(rec, action) {
    setBusy(true);
    try {
      if (action === "review") await processAnalyticsApi.reviewRecommendation(rec._id);
      else if (action === "propose") await processAnalyticsApi.proposeVersion(rec._id);
      else if (action === "simulate") await processAnalyticsApi.simulateProposal(rec._id);
      else if (action === "approve") await processAnalyticsApi.decideRecommendation(rec._id, "approve");
      else if (action === "reject") await processAnalyticsApi.decideRecommendation(rec._id, "reject");
      else if (action === "implemented") await processAnalyticsApi.markImplemented(rec._id);
      toast.success("Updated.");
      loadRecommendations(recsPage);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const selectedProcess = useMemo(() => processes.find((p) => p.key === selectedKey), [processes, selectedKey]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-950">Process Analytics &amp; Optimization</h1>
          <p className="text-sm font-semibold text-slate-500">Measure, understand, and improve every real process running through Process Designer.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" to="/admin/process-governance">
            Process Governance →
          </Button>
          {RANGE_OPTIONS.map((d) => (
            <button
              key={d}
              onClick={() => setRangeDays(d)}
              className={`rounded-xl px-3 py-2 text-xs font-bold transition ${rangeDays === d ? "bg-blue-600 text-white shadow-lg" : "bg-white/60 text-slate-600 hover:bg-white"}`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      <SettingsTabs
        activeTab={tab}
        onChange={setTab}
        tabs={[
          { id: "overview", label: "Executive Overview" },
          { id: "detail", label: "Process Detail" },
          { id: "optimization", label: "Optimization Center" },
        ]}
      />

      {tab === "overview" && (
        <OverviewTab
          loading={loadingOverview}
          overview={overview}
          crossProcess={crossProcess}
          onOpenProcess={(key) => {
            setSelectedKey(key);
            setTab("detail");
          }}
        />
      )}

      {tab === "detail" && (
        <ProcessDetailTab
          processes={processes}
          selectedKey={selectedKey}
          setSelectedKey={setSelectedKey}
          selectedProcess={selectedProcess}
          detailTab={detailTab}
          setDetailTab={setDetailTab}
          loading={loadingDetail}
          performance={performance}
          health={health}
          bottlenecks={bottlenecks}
          failures={failures}
          sla={sla}
          slaInput={slaInput}
          setSlaInput={setSlaInput}
          onSetSla={handleSetSla}
          versionIntel={versionIntel}
          compareVersions={compareVersions}
          setCompareVersions={setCompareVersions}
          compareResult={compareResult}
          onCompare={handleCompare}
          aiExplain={aiExplain}
          onExplain={handleExplain}
          onRunDetection={() => handleRunDetection(selectedKey)}
          busy={busy}
        />
      )}

      {tab === "optimization" && (
        <OptimizationTab
          loading={loadingRecs}
          error={recsError}
          onRetry={() => loadRecommendations(recsPage)}
          recommendations={recommendations}
          pagination={recsPagination}
          onPageChange={setRecsPage}
          statusFilter={recStatusFilter}
          setStatusFilter={setRecStatusFilter}
          severityFilter={recSeverityFilter}
          setSeverityFilter={setRecSeverityFilter}
          onRunDetection={() => handleRunDetection(null)}
          onAction={handleRecAction}
          busy={busy}
        />
      )}
    </div>
  );
}

function OverviewTab({ loading, overview, crossProcess, onOpenProcess }) {
  if (loading) return <Loader />;
  if (!overview) return <EmptyState title="No analytics yet" description="Executions will appear here once processes start running." />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile label="Active Processes" value={overview.activeProcesses} icon={Activity} />
        <StatTile label="Executions" value={overview.totalExecutions} icon={BarChart3} />
        <StatTile label="Success Rate" value={overview.overallSuccessRate !== null ? `${overview.overallSuccessRate}%` : "No data"} icon={CheckCircle2} tone={overview.overallSuccessRate !== null && overview.overallSuccessRate < 80 ? "danger" : "success"} />
        <StatTile label="Optimization Opportunities" value={overview.openOptimizationOpportunities} icon={Wrench} tone={overview.openOptimizationOpportunities > 0 ? "danger" : "neutral"} />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <StatTile label="SLA-Configured Processes" value={overview.processesWithSlaConfigured} hint={overview.slaConfiguredNote} icon={AlertTriangle} />
        <StatTile label="Failure Rate" value={overview.overallFailureRate !== null ? `${overview.overallFailureRate}%` : "No data"} icon={XCircle} tone={overview.overallFailureRate > 20 ? "danger" : "neutral"} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card title="Highest Volume">
          {overview.highestVolume.length ? (
            <ul className="space-y-2">
              {overview.highestVolume.map((p) => (
                <li key={p.key}>
                  <button onClick={() => onOpenProcess(p.key)} className="flex w-full items-center justify-between rounded-xl px-2 py-1.5 text-left text-sm font-bold text-slate-700 hover:bg-slate-100">
                    {p.key} <span className="text-slate-400">{p.totalExecutions}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm font-semibold text-slate-400">No historical data.</p>
          )}
        </Card>
        <Card title="Top Failing">
          {overview.highestFailure.length ? (
            <ul className="space-y-2">
              {overview.highestFailure.map((p) => (
                <li key={p.key}>
                  <button onClick={() => onOpenProcess(p.key)} className="flex w-full items-center justify-between rounded-xl px-2 py-1.5 text-left text-sm font-bold text-slate-700 hover:bg-slate-100">
                    {p.key} <Badge tone="danger">{p.failureRate}%</Badge>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm font-semibold text-slate-400">No historical data.</p>
          )}
        </Card>
        <Card title="Slowest Processes">
          {overview.slowest.length ? (
            <ul className="space-y-2">
              {overview.slowest.map((p) => (
                <li key={p.key}>
                  <button onClick={() => onOpenProcess(p.key)} className="flex w-full items-center justify-between rounded-xl px-2 py-1.5 text-left text-sm font-bold text-slate-700 hover:bg-slate-100">
                    {p.key} <span className="text-slate-400">{p.avgDurationMs}ms</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm font-semibold text-slate-400">No historical data.</p>
          )}
        </Card>
      </div>

      {crossProcess?.matrix?.length > 0 && (
        <Card title="Volume x Reliability x Speed">
          <MiniBarChart data={crossProcess.matrix} valueKey="volume" labelKey="key" formatValue={(v) => `${v} runs`} />
        </Card>
      )}
    </div>
  );
}

function ProcessDetailTab({
  processes,
  selectedKey,
  setSelectedKey,
  selectedProcess,
  detailTab,
  setDetailTab,
  loading,
  performance,
  health,
  bottlenecks,
  failures,
  sla,
  slaInput,
  setSlaInput,
  onSetSla,
  versionIntel,
  compareVersions,
  setCompareVersions,
  compareResult,
  onCompare,
  aiExplain,
  onExplain,
  onRunDetection,
  busy,
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_1fr]">
      <Card title="Processes">
        <div className="space-y-1">
          {processes.map((p) => (
            <button
              key={p.key}
              onClick={() => setSelectedKey(p.key)}
              className={`block w-full rounded-xl px-3 py-2 text-left text-sm font-bold ${selectedKey === p.key ? "bg-blue-600 text-white" : "text-slate-700 hover:bg-slate-100"}`}
            >
              {p.name}
              <span className="ml-1 block text-xs font-semibold opacity-70">v{p.activeVersion ?? "—"} active · {p.versionCount} version(s)</span>
            </button>
          ))}
          {!processes.length && <p className="text-sm font-semibold text-slate-400">No processes yet.</p>}
        </div>
      </Card>

      <div className="space-y-4">
        {!selectedKey && <EmptyState title="Select a process" description="Choose a process on the left to see its performance, bottlenecks, failures, SLA, and version intelligence." />}
        {selectedKey && loading && <Loader />}
        {selectedKey && !loading && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-black text-slate-950">{selectedProcess?.name || selectedKey}</h2>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={onRunDetection} isLoading={busy}>
                  <Wrench size={15} /> Run Optimization Detection
                </Button>
              </div>
            </div>

            <SettingsTabs
              activeTab={detailTab}
              onChange={setDetailTab}
              tabs={[
                { id: "performance", label: "Performance" },
                { id: "bottlenecks", label: "Bottlenecks" },
                { id: "failures", label: "Failures" },
                { id: "sla", label: "SLA" },
                { id: "versions", label: "Versions" },
                { id: "ai", label: "AI Explain" },
              ]}
            />

            {detailTab === "performance" && <PerformanceView performance={performance} health={health} />}
            {detailTab === "bottlenecks" && <BottlenecksView bottlenecks={bottlenecks} />}
            {detailTab === "failures" && <FailuresView failures={failures} />}
            {detailTab === "sla" && <SlaView sla={sla} slaInput={slaInput} setSlaInput={setSlaInput} onSetSla={onSetSla} busy={busy} />}
            {detailTab === "versions" && (
              <VersionsView
                versionIntel={versionIntel}
                compareVersions={compareVersions}
                setCompareVersions={setCompareVersions}
                compareResult={compareResult}
                onCompare={onCompare}
                busy={busy}
              />
            )}
            {detailTab === "ai" && <AiExplainView aiExplain={aiExplain} onExplain={onExplain} busy={busy} />}
          </>
        )}
      </div>
    </div>
  );
}

function PerformanceView({ performance, health }) {
  if (!performance?.hasData) return <EmptyState title="No historical data" description="This process has not executed in the selected window." />;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatTile label="Executions" value={performance.totalExecutions} icon={Activity} />
        <StatTile label="Success Rate" value={`${performance.successRate}%`} icon={CheckCircle2} tone={performance.successRate < 80 ? "danger" : "success"} />
        <StatTile label="Avg Duration" value={`${performance.avgDurationMs}ms`} icon={BarChart3} />
        <StatTile label="P95 Duration" value={`${performance.p95DurationMs}ms`} icon={TrendingUp} />
      </div>
      {health && (
        <Card title="Process Health Score">
          {health.score === null ? (
            <p className="text-sm font-semibold text-slate-400">{health.note}</p>
          ) : (
            <div>
              <div className="flex items-center gap-3">
                <p className="text-3xl font-black text-slate-950">{health.score}</p>
                <Badge tone={HEALTH_TONE[health.grade] || "neutral"}>{health.grade}</Badge>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                {health.factors.map((f) => (
                  <div key={f.name} className="rounded-xl border border-slate-200 p-2 text-xs font-semibold text-slate-600">
                    <span className="font-bold text-slate-800">{f.name}</span> — {f.contribution}/{f.weight}: {f.detail}
                  </div>
                ))}
              </div>
              {health.negativeFactors?.length > 0 && (
                <p className="mt-3 text-sm font-bold text-rose-600">Negative: {health.negativeFactors.join("; ")}</p>
              )}
              {health.positiveFactors?.length > 0 && (
                <p className="mt-1 text-sm font-bold text-emerald-600">Positive: {health.positiveFactors.join("; ")}</p>
              )}
            </div>
          )}
        </Card>
      )}
      {performance.dailyExecutions?.length > 0 && (
        <Card title="Executions Over Time">
          <MiniBarChart data={performance.dailyExecutions} valueKey="count" labelKey="date" />
        </Card>
      )}
    </div>
  );
}

function BottlenecksView({ bottlenecks }) {
  if (!bottlenecks || !bottlenecks.nodes?.length) return <EmptyState title="No node data" description="No executions have run through this process's nodes yet." />;
  return (
    <div className="space-y-4">
      <Card title="Slowest Nodes">
        {bottlenecks.slowestNodes.length ? (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs font-bold uppercase text-slate-400"><th>Node</th><th>Avg</th><th>P95</th><th>Runs</th><th>Confidence</th></tr></thead>
            <tbody>
              {bottlenecks.slowestNodes.map((n) => (
                <tr key={n.nodeId} className="border-t border-slate-100">
                  <td className="py-2 font-bold">{n.nodeId} <span className="text-slate-400">({n.nodeType})</span></td>
                  <td>{n.avgDurationMs}ms</td>
                  <td>{n.p95DurationMs ?? "—"}</td>
                  <td>{n.executionCount}</td>
                  <td><Badge tone={n.confidence === "high" ? "success" : n.confidence === "moderate" ? "warning" : "neutral"}>{n.confidence}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="text-sm font-semibold text-slate-400">No meaningfully slow node yet.</p>}
      </Card>
      <Card title="Highest Failure Nodes">
        {bottlenecks.highestFailureNodes.length ? (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs font-bold uppercase text-slate-400"><th>Node</th><th>Failure Rate</th><th>Failures</th><th>Runs</th><th>Confidence</th></tr></thead>
            <tbody>
              {bottlenecks.highestFailureNodes.map((n) => (
                <tr key={n.nodeId} className="border-t border-slate-100">
                  <td className="py-2 font-bold">{n.nodeId} <span className="text-slate-400">({n.nodeType})</span></td>
                  <td><Badge tone="danger">{n.failureRate}%</Badge></td>
                  <td>{n.failureCount}</td>
                  <td>{n.executionCount}</td>
                  <td><Badge tone={n.confidence === "high" ? "success" : n.confidence === "moderate" ? "warning" : "neutral"}>{n.confidence}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="text-sm font-semibold text-slate-400">No node has a meaningfully elevated failure rate.</p>}
      </Card>
      {bottlenecks.insufficientSampleNodes.length > 0 && (
        <p className="text-xs font-semibold text-slate-400">Insufficient execution history for: {bottlenecks.insufficientSampleNodes.join(", ")}</p>
      )}
    </div>
  );
}

function FailuresView({ failures }) {
  if (!failures?.hasData) return <EmptyState title="No failures recorded" description="No failed executions in the selected window." />;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <StatTile label="Total Failures" value={failures.totalFailures} icon={XCircle} tone="danger" />
      </div>
      <Card title="Failure Categories">
        {Object.keys(failures.categoryCounts).length ? (
          <div className="flex flex-wrap gap-2">
            {Object.entries(failures.categoryCounts).map(([cat, count]) => (
              <Badge key={cat} tone="warning">{cat}: {count}</Badge>
            ))}
          </div>
        ) : <p className="text-sm font-semibold text-slate-400">No categorized error messages available.</p>}
      </Card>
      <Card title="Failure Trend">
        {failures.trend.length ? <MiniLineChart data={failures.trend.map((t) => ({ month: t.date, credit: t.count, debit: 0 }))} /> : <p className="text-sm font-semibold text-slate-400">No trend data.</p>}
      </Card>
      <Card title="Recent Failures">
        <ul className="space-y-2 text-sm">
          {failures.recentSamples.map((s, i) => (
            <li key={i} className="rounded-xl border border-slate-100 p-2">
              <span className="font-bold">{new Date(s.startedAt).toLocaleString()}</span> (v{s.version}) — {s.error || "No error message recorded"}
              {s.failedNodes.length > 0 && <span className="ml-1 text-rose-600">[{s.failedNodes.join(", ")}]</span>}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function SlaView({ sla, slaInput, setSlaInput, onSetSla, busy }) {
  return (
    <div className="space-y-4">
      <Card title="SLA Target">
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="text-xs font-bold uppercase text-slate-400">Target duration (ms)</label>
            <input
              type="number"
              value={slaInput}
              onChange={(e) => setSlaInput(e.target.value)}
              placeholder="No SLA configured"
              className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold"
            />
          </div>
          <Button onClick={onSetSla} isLoading={busy}>Save</Button>
        </div>
      </Card>
      {sla?.slaConfigured && sla.hasData ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <StatTile label="Compliance" value={`${sla.complianceRate}%`} tone={sla.complianceRate < 90 ? "danger" : "success"} icon={CheckCircle2} />
          <StatTile label="Breaches" value={sla.breachCount} icon={AlertTriangle} tone={sla.breachCount > 0 ? "danger" : "neutral"} />
          <StatTile label="Target" value={`${sla.slaTargetMs}ms`} icon={BarChart3} />
        </div>
      ) : (
        <p className="text-sm font-semibold text-slate-400">{sla?.note || "No SLA configured for this process."}</p>
      )}
    </div>
  );
}

function VersionsView({ versionIntel, compareVersions, setCompareVersions, compareResult, onCompare, busy }) {
  if (!versionIntel?.versions?.length) return <EmptyState title="No versions" />;
  return (
    <div className="space-y-4">
      <Card title="Version Performance">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs font-bold uppercase text-slate-400"><th>Version</th><th>Status</th><th>Runs</th><th>Success</th><th>Avg Duration</th></tr></thead>
          <tbody>
            {versionIntel.versions.map((v) => (
              <tr key={v.version} className="border-t border-slate-100">
                <td className="py-2 font-bold">v{v.version} {v.active && <Badge tone="success">active</Badge>}</td>
                <td><Badge tone="neutral">{v.status}</Badge></td>
                <td>{v.totalExecutions}</td>
                <td>{v.successRate !== null ? `${v.successRate}%` : "—"}</td>
                <td>{v.avgDurationMs !== null ? `${v.avgDurationMs}ms` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="Compare Two Versions">
        <div className="flex flex-wrap items-end gap-3">
          <input type="number" placeholder="Version A" value={compareVersions.a} onChange={(e) => setCompareVersions({ ...compareVersions, a: e.target.value })} className="w-32 rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold" />
          <GitCompare size={16} className="text-slate-400" />
          <input type="number" placeholder="Version B" value={compareVersions.b} onChange={(e) => setCompareVersions({ ...compareVersions, b: e.target.value })} className="w-32 rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold" />
          <Button onClick={onCompare} isLoading={busy}>Compare</Button>
        </div>
        {compareResult && (
          <div className="mt-4">
            {!compareResult.comparable ? (
              <p className="text-sm font-semibold text-amber-600">Insufficient data for version(s): {compareResult.insufficientDataVersions.join(", ")}</p>
            ) : (
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <StatTile label="Success Rate Δ" value={`${compareResult.delta.successRate >= 0 ? "+" : ""}${compareResult.delta.successRate}%`} tone={compareResult.delta.successRate < 0 ? "danger" : "success"} icon={compareResult.delta.successRate >= 0 ? TrendingUp : TrendingDown} />
                <StatTile label="Duration Δ" value={`${compareResult.delta.avgDurationMs >= 0 ? "+" : ""}${compareResult.delta.avgDurationMs}ms`} tone={compareResult.delta.avgDurationMs > 0 ? "danger" : "success"} />
                <StatTile label="Nodes Added" value={compareResult.nodeChanges.added.length} />
                <StatTile label="Nodes Removed" value={compareResult.nodeChanges.removed.length} />
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

function AiExplainView({ aiExplain, onExplain, busy }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => onExplain("analytics")} isLoading={busy}><Sparkles size={15} /> Explain Analytics</Button>
        <Button variant="secondary" onClick={() => onExplain("bottleneck")} isLoading={busy}><Sparkles size={15} /> Explain Bottlenecks</Button>
        <Button variant="secondary" onClick={() => onExplain("optimization")} isLoading={busy}><Sparkles size={15} /> Explain Optimization</Button>
      </div>
      {aiExplain && (
        <Card title="AI Explanation">
          <p className="text-sm leading-6 text-slate-700">{aiExplain.content?.summary || JSON.stringify(aiExplain.content)}</p>
          <p className="mt-3 text-xs font-semibold text-slate-400">{aiExplain.disclaimer}</p>
        </Card>
      )}
    </div>
  );
}

function OptimizationTab({
  loading,
  error,
  onRetry,
  recommendations,
  pagination,
  onPageChange,
  statusFilter,
  setStatusFilter,
  severityFilter,
  setSeverityFilter,
  onRunDetection,
  onAction,
  busy,
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="rounded-control border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            {Object.keys(STATUS_TONE).map((s) => (
              <option key={s} value={s}>{s.replace("_", " ")}</option>
            ))}
          </select>
          <select
            className="rounded-control border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600"
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
          >
            <option value="">All severities</option>
            {Object.keys(SEVERITY_TONE).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <Button onClick={onRunDetection} isLoading={busy}><Wrench size={15} /> Run Detection (All Active)</Button>
      </div>

      {loading ? (
        <Loader />
      ) : error ? (
        <ErrorState description={error} onRetry={onRetry} />
      ) : !recommendations.length ? (
        <EmptyState title="No optimization opportunities detected" description="Run detection to scan every active process for real, evidence-backed optimization candidates." />
      ) : (
        <>
          <div className="space-y-3">
            {recommendations.map((rec) => (
              <Card key={rec._id} className="min-w-0 overflow-hidden">
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={SEVERITY_TONE[rec.severity]}>{rec.severity}</Badge>
                      <Badge tone={STATUS_TONE[rec.status]}>{rec.status.replace("_", " ")}</Badge>
                      <span className="truncate text-xs font-bold text-slate-400">{rec.processKey} · v{rec.processVersion}</span>
                    </div>
                    <p className="mt-2 line-clamp-2 break-words text-sm font-bold text-slate-800">{rec.issue}</p>
                    <p className="mt-1 line-clamp-3 break-words text-sm text-slate-600">{rec.recommendedChange}</p>
                    <p className="mt-1 line-clamp-2 break-words text-xs font-semibold text-slate-400">{rec.expectedBenefit}</p>
                  </div>
                  <div className="flex flex-shrink-0 flex-wrap gap-2">
                    {rec.status === "detected" && <Button variant="secondary" onClick={() => onAction(rec, "review")} isLoading={busy}>Review</Button>}
                    {["reviewed", "detected"].includes(rec.status) && <Button variant="secondary" onClick={() => onAction(rec, "propose")} isLoading={busy}>Generate Proposed Version</Button>}
                    {rec.status === "simulation_ready" && !rec.simulationRunId && <Button variant="secondary" onClick={() => onAction(rec, "simulate")} isLoading={busy}>Simulate</Button>}
                    {["simulation_ready", "reviewed", "detected"].includes(rec.status) && (
                      <>
                        <Button onClick={() => onAction(rec, "approve")} isLoading={busy}>Approve</Button>
                        <Button variant="secondary" onClick={() => onAction(rec, "reject")} isLoading={busy}>Reject</Button>
                      </>
                    )}
                    {rec.status === "approved" && <Button onClick={() => onAction(rec, "implemented")} isLoading={busy}>Mark Implemented</Button>}
                  </div>
                </div>
              </Card>
            ))}
          </div>
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-100 pt-3">
              <p className="text-xs font-semibold text-slate-400">
                Page {pagination.page} of {pagination.totalPages} · {pagination.total} recommendation{pagination.total === 1 ? "" : "s"}
              </p>
              <div className="flex gap-2">
                <Button variant="secondary" disabled={!pagination.hasPrevious} onClick={() => onPageChange(pagination.page - 1)}>
                  ← Prev
                </Button>
                <Button variant="secondary" disabled={!pagination.hasNext} onClick={() => onPageChange(pagination.page + 1)}>
                  Next →
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default AdminProcessAnalytics;
