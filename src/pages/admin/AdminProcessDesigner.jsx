import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  GitBranch,
  Plus,
  Play,
  ShieldCheck,
  Sparkles,
  Search as SearchIcon,
  Trash2,
  Copy,
  Archive,
  CheckCircle2,
  XCircle,
  PauseCircle,
  Rocket,
  History,
  AlertTriangle,
} from "lucide-react";
import { processDesignerApi } from "../../api/processDesignerApi";
import { getApiErrorMessage } from "../../api/axios";
import { useToast } from "../../context/ToastContext";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import Loader from "../../components/ui/Loader";
import Input from "../../components/ui/Input";
import Badge from "../../components/ui/Badge";
import EmptyState from "../../components/shared/EmptyState";
import ErrorState from "../../components/shared/ErrorState";
import SettingsTabs from "../../components/settings/SettingsTabs";

// ─────────────────────────────────────────────────────────────────────────
// Phase A6.3.3 — Enterprise Process Designer + Process Simulation Engine.
//
// One connected page (Library / Designer / Validate / Simulate / Impact /
// Versions), same "not ten separate routes" posture as AdminAutomationStudio
// (A6.2.3). The Designer itself is a form-driven node/edge list editor with
// per-node config panels — deliberately NOT a drag-drop canvas library,
// consistent with this codebase's own precedent (Automation Studio's
// "vertical connected step list... rather than a drag-drop canvas" note)
// and the "no heavy dependency if the existing project can support the UI"
// instruction. Every dropdown here is populated from the backend's real
// node registry (/node-registry) — nothing in this file hardcodes a
// trigger or action type the backend doesn't actually support.
// ─────────────────────────────────────────────────────────────────────────

const STATUS_TONE = {
  draft: "neutral",
  validating: "info",
  valid: "sky",
  pending_approval: "warning",
  published: "violet",
  active: "success",
  paused: "warning",
  archived: "danger",
};

const RISK_TONE = { low: "success", medium: "warning", high: "danger", critical: "danger" };
const NODE_STATUS_TONE = { pass: "success", skipped: "neutral", blocked: "warning", warning: "warning", fail: "danger", unsupported: "danger" };

// PHASE UI-13 hardening (A8 — Unified Process Journey): a pure, real-state
// derivation of "what happens next" for a process, so the user is never
// left wondering. Deliberately NOT a rebuild of Governance/Orchestrator —
// it only names the next real stage and (where the next step lives in a
// different workspace, e.g. approval) deep-links there rather than
// duplicating that page's UI here, per Golden Rule #2.
function nextProcessStep(status) {
  switch (status) {
    case "draft":
      return { label: "Next: Validate the graph before publishing.", to: null };
    case "validating":
      return { label: "Validation in progress.", to: null };
    case "valid":
      return { label: "Next: Publish (or Submit for Review if it needs governance approval).", to: "/admin/process-governance" };
    case "pending_approval":
      return { label: "Waiting on a governance decision.", to: "/admin/process-governance" };
    case "published":
      return { label: "Next: Activate to start real execution.", to: null };
    case "active":
      return { label: "Live — monitor its health in Process Analytics.", to: "/admin/process-analytics" };
    case "paused":
      return { label: "Paused — Activate to resume, or Archive to retire it.", to: null };
    case "archived":
      return { label: "Archived — read-only. Clone it to start a new version.", to: null };
    default:
      return null;
  }
}

function newId(prefix) {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;
}

function emptyDraft() {
  return { name: "", description: "", category: "general", owner: "", nodes: [], edges: [] };
}

function AdminProcessDesigner() {
  const toast = useToast();
  const [registry, setRegistry] = useState(null);
  const [processes, setProcesses] = useState([]);
  const [loadingLibrary, setLoadingLibrary] = useState(true);
  const [libraryError, setLibraryError] = useState(false);
  const [libraryPagination, setLibraryPagination] = useState(null);
  const [libraryPage, setLibraryPage] = useState(1);
  const [filters, setFilters] = useState({ status: "", category: "", search: "" });

  const [selected, setSelected] = useState(null);
  const [draft, setDraft] = useState(emptyDraft());
  const [tab, setTab] = useState("designer");
  const [busy, setBusy] = useState(false);

  const [validation, setValidation] = useState(null);
  const [risk, setRisk] = useState(null);
  const [impact, setImpact] = useState(null);
  const [versions, setVersions] = useState([]);
  const [compareResult, setCompareResult] = useState(null);
  const [runHistory, setRunHistory] = useState([]);
  const [simulationResult, setSimulationResult] = useState(null);
  const [scenarioPayload, setScenarioPayload] = useState("{}");
  const [aiExplain, setAiExplain] = useState(null);

  const isDraft = selected?.status === "draft";
  const isEditable = isDraft; // published/active/paused/archived are immutable — editing forks a new draft (server-enforced too)

  async function refreshLibrary() {
    setLoadingLibrary(true);
    setLibraryError(false);
    try {
      const params = { page: libraryPage, pageSize: 20 };
      if (filters.status) params.status = filters.status;
      if (filters.category) params.category = filters.category;
      if (filters.search) params.search = filters.search;
      const res = await processDesignerApi.listProcesses(params);
      setProcesses(res.data);
      setLibraryPagination(res.meta || null);
    } catch (error) {
      setLibraryError(true);
      toast.error(getApiErrorMessage(error));
    } finally {
      setLoadingLibrary(false);
    }
  }

  useEffect(() => {
    processDesignerApi.getNodeRegistry().then((res) => setRegistry(res.data)).catch((error) => toast.error(getApiErrorMessage(error)));
  }, []);

  // A filter change invalidates the current library page — back to page 1
  // (same reset-on-filter-change pattern as AdminOperationsCenter.jsx, UI-10).
  useEffect(() => {
    setLibraryPage(1);
  }, [filters.status, filters.category, filters.search]);

  useEffect(() => {
    refreshLibrary();
  }, [filters.status, filters.category, libraryPage]);

  function selectProcess(proc) {
    setSelected(proc);
    setDraft({ name: proc.name, description: proc.description || "", category: proc.category, owner: proc.owner || "", nodes: proc.nodes || [], edges: proc.edges || [] });
    setValidation(proc.lastValidation?.computedAt ? { valid: proc.lastValidation.valid, errors: proc.lastValidation.errors, warnings: proc.lastValidation.warnings, info: proc.lastValidation.info } : null);
    setRisk(proc.lastRisk?.computedAt ? { level: proc.lastRisk.level, factors: proc.lastRisk.factors } : null);
    setImpact(null);
    setCompareResult(null);
    setSimulationResult(null);
    setAiExplain(null);
    setTab("designer");
    loadVersions(proc._id);
    loadRunHistory(proc._id);
  }

  async function loadVersions(id) {
    try {
      const res = await processDesignerApi.getVersions(id);
      setVersions(res.data);
    } catch {
      setVersions([]);
    }
  }

  async function loadRunHistory(id) {
    try {
      const res = await processDesignerApi.getRunHistory(id);
      setRunHistory(res.data);
    } catch {
      setRunHistory([]);
    }
  }

  async function handleCreate() {
    if (!draft.name.trim()) return toast.error("Name is required.");
    setBusy(true);
    try {
      const res = await processDesignerApi.createProcess(draft);
      toast.success("Draft process created.");
      await refreshLibrary();
      selectProcess(res.data);
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await processDesignerApi.updateProcess(selected._id, draft);
      toast.success(res.message || "Draft saved.");
      await refreshLibrary();
      selectProcess(res.data);
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleValidate() {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await processDesignerApi.validate(selected._id);
      setValidation(res.data.validation);
      setRisk(res.data.risk);
      setTab("validate");
      if (res.data.validation.valid) toast.success("Process is valid.");
      else toast.error(`${res.data.validation.errors.length} validation error(s) found.`);
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleSimulate() {
    if (!selected) return;
    let parsedPayload;
    try {
      parsedPayload = scenarioPayload.trim() ? JSON.parse(scenarioPayload) : {};
    } catch {
      toast.error("Scenario payload must be valid JSON.");
      return;
    }
    setBusy(true);
    try {
      const res = await processDesignerApi.simulate(selected._id, { scenarioPayload: parsedPayload });
      setSimulationResult(res.data);
      setTab("simulate");
      await loadRunHistory(selected._id);
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleImpact() {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await processDesignerApi.getImpact(selected._id);
      setImpact(res.data);
      setTab("impact");
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handlePublish() {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await processDesignerApi.publish(selected._id);
      toast.success(`Published version ${res.data.version}.`);
      await refreshLibrary();
      selectProcess(res.data);
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleActivate() {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await processDesignerApi.activate(selected._id);
      toast.success("Process activated — now live against real events.");
      await refreshLibrary();
      selectProcess(res.data);
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handlePause() {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await processDesignerApi.pause(selected._id);
      toast.success("Process paused.");
      await refreshLibrary();
      selectProcess(res.data);
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleArchive() {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await processDesignerApi.archive(selected._id);
      toast.success("Process archived.");
      await refreshLibrary();
      selectProcess(res.data);
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleClone() {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await processDesignerApi.cloneProcess(selected._id);
      toast.success("Cloned into a new draft.");
      await refreshLibrary();
      selectProcess(res.data);
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!selected) return;
    if (!window.confirm(`Delete draft "${selected.name}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await processDesignerApi.deleteProcess(selected._id);
      toast.success("Draft deleted.");
      setSelected(null);
      setDraft(emptyDraft());
      await refreshLibrary();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleCompare(withVersion) {
    if (!selected || !withVersion) return;
    try {
      const res = await processDesignerApi.compareVersions(selected._id, withVersion);
      setCompareResult(res.data);
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    }
  }

  async function handleAiExplain() {
    if (!selected) return;
    setBusy(true);
    try {
      const res = await processDesignerApi.explain(selected._id);
      setAiExplain(res.data);
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleAiExplainSimulation() {
    if (!selected) return;
    try {
      const res = await processDesignerApi.explainSimulation(selected._id);
      setAiExplain(res.data);
      setTab("ai");
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    }
  }

  // ── Node/edge editing (draft only) ─────────────────────────────────────
  function addNode(type) {
    const node = { id: newId("n"), type, label: "", config: {}, position: { x: 0, y: 0 } };
    setDraft((d) => ({ ...d, nodes: [...d.nodes, node] }));
  }

  function updateNode(nodeId, patch) {
    setDraft((d) => ({ ...d, nodes: d.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch, config: { ...n.config, ...(patch.config || {}) } } : n)) }));
  }

  function removeNode(nodeId) {
    setDraft((d) => ({
      ...d,
      nodes: d.nodes.filter((n) => n.id !== nodeId),
      edges: d.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
    }));
  }

  function addEdge() {
    if (draft.nodes.length < 2) { toast.error("Add at least two nodes before connecting an edge."); return; }
    const edge = { id: newId("e"), source: draft.nodes[0].id, target: draft.nodes[1].id, branch: null, label: "" };
    setDraft((d) => ({ ...d, edges: [...d.edges, edge] }));
  }

  function updateEdge(edgeId, patch) {
    setDraft((d) => ({ ...d, edges: d.edges.map((e) => (e.id === edgeId ? { ...e, ...patch } : e)) }));
  }

  function removeEdge(edgeId) {
    setDraft((d) => ({ ...d, edges: d.edges.filter((e) => e.id !== edgeId) }));
  }

  const actionNodeTypeOptions = useMemo(
    () => (registry ? registry.nodeTypes.filter((t) => !["trigger", "condition", "decision", "end"].includes(t.type)) : []),
    [registry],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="text-2xl font-black text-slate-950">Process Designer</h1>
          <p className="text-sm font-medium text-slate-600">
            Build, validate, simulate, and publish real multi-step processes on top of the existing Workflow Engine, Automation Studio, and Smart Assignment Engine.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="secondary" to="/admin/process-analytics">
            Process Analytics &amp; Optimization →
          </Button>
          <Button variant="secondary" to="/admin/process-governance">
            Process Governance →
          </Button>
          <Button onClick={() => { setSelected(null); setDraft(emptyDraft()); setTab("designer"); }}>
            <Plus size={16} /> New Process
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        {/* ── Process Library ─────────────────────────────────────────── */}
        <Card title="Process Library">
          <div className="mb-4 flex flex-col gap-2">
            <div className="relative">
              <SearchIcon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={filters.search}
                onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && refreshLibrary()}
                placeholder="Search processes…"
                className="w-full rounded-xl border border-slate-200 bg-white/70 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-blue-600"
              />
            </div>
            <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))} className="w-full rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-xs font-semibold">
              <option value="">All statuses</option>
              {Object.keys(STATUS_TONE).map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          {loadingLibrary ? (
            <Loader label="Loading processes" />
          ) : libraryError ? (
            <ErrorState description="We couldn't load the process library." onRetry={refreshLibrary} />
          ) : !processes.length ? (
            <EmptyState title="No processes yet" description="Create your first process definition to get started." />
          ) : (
            <>
              <div className="space-y-2">
                {processes.map((proc) => (
                  <button
                    key={proc._id}
                    onClick={() => selectProcess(proc)}
                    className={`w-full min-w-0 rounded-xl border p-3 text-left transition ${selected?._id === proc._id ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white/60 hover:border-slate-400"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-bold text-slate-950">{proc.name}</span>
                      <Badge tone={STATUS_TONE[proc.status]}>{proc.status}</Badge>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                      <span>v{proc.version}</span>
                      {proc.lastRisk?.level && <Badge tone={RISK_TONE[proc.lastRisk.level]}>{proc.lastRisk.level} risk</Badge>}
                    </div>
                  </button>
                ))}
              </div>
              {libraryPagination && libraryPagination.totalPages > 1 && (
                <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
                  <p className="text-xs text-slate-500">
                    {libraryPagination.page}/{libraryPagination.totalPages} · {libraryPagination.total}
                  </p>
                  <div className="flex gap-2">
                    <Button variant="secondary" disabled={!libraryPagination.hasPrevious} onClick={() => setLibraryPage((p) => p - 1)}>← Prev</Button>
                    <Button variant="secondary" disabled={!libraryPagination.hasNext} onClick={() => setLibraryPage((p) => p + 1)}>Next →</Button>
                  </div>
                </div>
              )}
            </>
          )}
        </Card>

        {/* ── Designer workspace ──────────────────────────────────────── */}
        <div className="space-y-4">
          {!registry ? (
            <Loader label="Loading node registry" />
          ) : (
            <>
              <Card>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <GitBranch className="text-blue-600" />
                    <div>
                      <h2 className="text-lg font-bold text-slate-950">{selected ? selected.name : "New Process"}</h2>
                      {selected && (
                        <div className="mt-1 flex items-center gap-2">
                          <Badge tone={STATUS_TONE[selected.status]}>{selected.status.replace(/_/g, " ")}</Badge>
                          <span className="text-xs font-semibold text-slate-500">v{selected.version} · key: {selected.key}</span>
                        </div>
                      )}
                      {selected && nextProcessStep(selected.status) && (
                        <p className="mt-1 text-xs text-slate-500">
                          {nextProcessStep(selected.status).label}
                          {nextProcessStep(selected.status).to && (
                            <>
                              {" "}
                              <Link to={nextProcessStep(selected.status).to} className="font-semibold text-blue-600 hover:underline">
                                Open →
                              </Link>
                            </>
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {!selected && <Button onClick={handleCreate} isLoading={busy}>Create Draft</Button>}
                    {selected && isEditable && <Button onClick={handleSave} isLoading={busy}>Save Draft</Button>}
                    {selected && <Button variant="secondary" onClick={handleValidate} isLoading={busy}><ShieldCheck size={15} /> Validate</Button>}
                    {selected && <Button variant="secondary" onClick={handleSimulate} isLoading={busy}><Play size={15} /> Simulate</Button>}
                    {selected && <Button variant="secondary" onClick={handleImpact} isLoading={busy}>Impact</Button>}
                    {selected && ["draft", "valid"].includes(selected.status) && <Button variant="dark" onClick={handlePublish} isLoading={busy}><Rocket size={15} /> Publish</Button>}
                    {selected && ["published", "paused"].includes(selected.status) && <Button variant="dark" onClick={handleActivate} isLoading={busy}>Activate</Button>}
                    {selected && selected.status === "active" && <Button variant="secondary" onClick={handlePause} isLoading={busy}><PauseCircle size={15} /> Pause</Button>}
                    {selected && selected.status !== "archived" && <Button variant="secondary" onClick={handleArchive} isLoading={busy}><Archive size={15} /> Archive</Button>}
                    {selected && <Button variant="secondary" onClick={handleClone} isLoading={busy}><Copy size={15} /> Clone</Button>}
                    {selected && selected.status === "draft" && <Button variant="secondary" onClick={handleDelete} isLoading={busy}><Trash2 size={15} /></Button>}
                  </div>
                </div>
              </Card>

              <SettingsTabs
                activeTab={tab}
                onChange={setTab}
                tabs={[
                  { id: "designer", label: "Designer" },
                  { id: "validate", label: "Validation" },
                  { id: "simulate", label: "Simulation" },
                  { id: "impact", label: "Impact" },
                  { id: "versions", label: "Versions" },
                  { id: "ai", label: "AI Explain" },
                ]}
              />

              {tab === "designer" && (
                <Card title="Process metadata">
                  <div className="grid gap-3 md:grid-cols-2">
                    <Input label="Name" value={draft.name} disabled={!isEditable && Boolean(selected)} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
                    <Input label="Owner" value={draft.owner} disabled={!isEditable && Boolean(selected)} onChange={(e) => setDraft((d) => ({ ...d, owner: e.target.value }))} />
                    <label className="block md:col-span-2">
                      <span className="mb-2 block text-sm font-semibold text-slate-700">Description</span>
                      <textarea
                        className="w-full rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm outline-none focus:border-blue-600"
                        rows={2}
                        value={draft.description}
                        disabled={!isEditable && Boolean(selected)}
                        onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                      />
                    </label>
                  </div>

                  {selected && !isEditable && (
                    <p className="mt-3 flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-700">
                      <AlertTriangle size={14} /> This version is {selected.status} and immutable. Saving will create a new draft version instead of changing this one.
                    </p>
                  )}

                  <div className="mt-6 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-950">Nodes ({draft.nodes.length})</h3>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" onClick={() => addNode("trigger")}>+ Trigger</Button>
                      <Button variant="secondary" onClick={() => addNode("condition")}>+ Condition</Button>
                      <Button variant="secondary" onClick={() => addNode("decision")}>+ Decision</Button>
                      {actionNodeTypeOptions.map((t) => (
                        <Button key={t.type} variant="secondary" onClick={() => addNode(t.type)} disabled={t.unsupported}>
                          + {t.label}{t.unsupported ? " (unsupported)" : ""}
                        </Button>
                      ))}
                      <Button variant="secondary" onClick={() => addNode("end")}>+ End</Button>
                    </div>
                  </div>

                  <div className="mt-3 space-y-2">
                    {draft.nodes.map((node) => (
                      <NodeEditor key={node.id} node={node} registry={registry} onChange={(patch) => updateNode(node.id, patch)} onRemove={() => removeNode(node.id)} disabled={!isEditable && Boolean(selected)} />
                    ))}
                  </div>

                  <div className="mt-6 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-950">Edges ({draft.edges.length})</h3>
                    <Button variant="secondary" onClick={addEdge}>+ Edge</Button>
                  </div>
                  <div className="mt-3 space-y-2">
                    {draft.edges.map((edge) => (
                      <EdgeEditor key={edge.id} edge={edge} nodes={draft.nodes} onChange={(patch) => updateEdge(edge.id, patch)} onRemove={() => removeEdge(edge.id)} disabled={!isEditable && Boolean(selected)} />
                    ))}
                  </div>
                </Card>
              )}

              {tab === "validate" && (
                <Card title="Validation & Risk">
                  {!validation ? (
                    <EmptyState title="Not validated yet" description="Click Validate above to run the server-side Validation Engine." />
                  ) : (
                    <div className="space-y-4">
                      <div className={`flex items-center gap-2 rounded-xl p-3 text-sm font-bold ${validation.valid ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
                        {validation.valid ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
                        {validation.valid ? "Valid — safe to publish." : `${validation.errors.length} error(s) block publish.`}
                      </div>
                      {risk && (
                        <div>
                          <Badge tone={RISK_TONE[risk.level]}>{risk.level} risk</Badge>
                          <ul className="mt-2 space-y-1 text-xs text-slate-600">
                            {risk.factors.map((f, i) => <li key={i}>• {f}</li>)}
                          </ul>
                        </div>
                      )}
                      {["errors", "warnings", "info"].map((key) => (
                        validation[key]?.length > 0 && (
                          <div key={key}>
                            <h4 className="text-xs font-black uppercase text-slate-500">{key}</h4>
                            <ul className="mt-1 space-y-1 text-sm text-slate-700">
                              {validation[key].map((m, i) => <li key={i} className="rounded-lg bg-slate-50 px-3 py-2">{m}</li>)}
                            </ul>
                          </div>
                        )
                      ))}
                    </div>
                  )}
                </Card>
              )}

              {tab === "simulate" && (
                <Card title="Process Simulation Engine">
                  <label className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-700">Scenario payload (JSON)</span>
                    <textarea
                      className="w-full rounded-xl border border-slate-200 bg-white/70 px-4 py-3 font-mono text-xs outline-none focus:border-blue-600"
                      rows={3}
                      value={scenarioPayload}
                      onChange={(e) => setScenarioPayload(e.target.value)}
                    />
                  </label>
                  <Button className="mt-3" onClick={handleSimulate} isLoading={busy}><Play size={15} /> Run Simulation</Button>

                  {simulationResult && (
                    <div className="mt-5 space-y-3">
                      <p className="rounded-xl bg-slate-950 px-3 py-2 text-center text-xs font-black uppercase tracking-wide text-white">
                        {simulationResult.banner}
                      </p>
                      <Badge tone={simulationResult.status === "success" ? "success" : simulationResult.status === "blocked" ? "warning" : "danger"}>
                        Overall: {simulationResult.status}
                      </Badge>
                      <div className="space-y-1">
                        {simulationResult.nodeTrace.map((n, i) => (
                          <div key={i} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs">
                            <Badge tone={NODE_STATUS_TONE[n.status]}>{n.status}</Badge>
                            <span className="font-bold">{n.nodeId}</span>
                            <span className="text-slate-500">({n.nodeType})</span>
                            <span className="ml-auto text-slate-600">{n.message}</span>
                          </div>
                        ))}
                      </div>
                      <Button variant="secondary" onClick={handleAiExplainSimulation}>
                        <Sparkles size={14} /> AI Explain This Run
                      </Button>
                    </div>
                  )}

                  {runHistory.length > 0 && (
                    <div className="mt-6">
                      <h4 className="mb-2 flex items-center gap-2 text-xs font-black uppercase text-slate-500"><History size={13} /> Run History</h4>
                      <div className="space-y-1">
                        {runHistory.slice(0, 10).map((run) => (
                          <div key={run._id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs">
                            <span>{new Date(run.createdAt).toLocaleString()}</span>
                            <Badge tone={run.dryRun ? "info" : "neutral"}>{run.dryRun ? "simulation" : "live"}</Badge>
                            <Badge tone={run.status === "success" ? "success" : run.status === "blocked" ? "warning" : "danger"}>{run.status}</Badge>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </Card>
              )}

              {tab === "impact" && (
                <Card title="Impact Analysis">
                  {!impact ? (
                    <EmptyState title="No impact computed yet" description="Click Impact above to analyze real dependencies." />
                  ) : (
                    <div className="space-y-3 text-sm">
                      <div>
                        <h4 className="text-xs font-black uppercase text-slate-500">Affected existing processes</h4>
                        {impact.affectedProcesses.length ? (
                          <ul className="mt-1 space-y-1">{impact.affectedProcesses.map((p) => <li key={p.id}>• {p.label} ({p.category})</li>)}</ul>
                        ) : <p className="text-slate-500">None — no existing process shares a trigger with this one.</p>}
                      </div>
                      <div>
                        <h4 className="text-xs font-black uppercase text-slate-500">Affected roles</h4>
                        <p>{impact.affectedRoles.join(", ") || "None"}</p>
                      </div>
                      <div>
                        <h4 className="text-xs font-black uppercase text-slate-500">Automation touchpoints</h4>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(impact.expectedAutomationTouchpoints).map(([k, v]) => <Badge key={k} tone={v ? "success" : "neutral"}>{k}: {v ? "yes" : "no"}</Badge>)}
                        </div>
                      </div>
                      <p className="text-xs text-slate-500">{impact.expectedWorkloadImpact}</p>
                      <p className="text-xs text-slate-500">{impact.slaImpact}</p>
                    </div>
                  )}
                </Card>
              )}

              {tab === "versions" && (
                <Card title="Version History & Compare">
                  {!versions.length ? (
                    <EmptyState title="No versions yet" description="Publish this process to start a version history." />
                  ) : (
                    <div className="space-y-2">
                      {versions.map((v) => (
                        <div key={v._id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs">
                          <span className="font-bold">v{v.version}</span>
                          <Badge tone={STATUS_TONE[v.status]}>{v.status}</Badge>
                          {v._id !== selected?._id && <Button variant="secondary" onClick={() => handleCompare(v.version)}>Compare to this</Button>}
                        </div>
                      ))}
                      {compareResult && (
                        <div className="mt-4 rounded-xl bg-slate-950 p-4 text-xs text-white">
                          <p>Added nodes: {compareResult.diff.addedNodes.join(", ") || "none"}</p>
                          <p>Removed nodes: {compareResult.diff.removedNodes.join(", ") || "none"}</p>
                          <p>Changed nodes: {compareResult.diff.changedNodes.join(", ") || "none"}</p>
                          <p>Risk: {compareResult.diff.riskChange.from || "n/a"} → {compareResult.diff.riskChange.to || "n/a"}</p>
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              )}

              {tab === "ai" && (
                <Card title="AI Process Explain">
                  <Button onClick={handleAiExplain} isLoading={busy}><Sparkles size={15} /> Explain This Process</Button>
                  {aiExplain && (
                    <div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
                      <p className="font-bold">{aiExplain.content?.summary}</p>
                      {aiExplain.content?.riskLevel && <p className="mt-2">Risk: {aiExplain.content.riskLevel}</p>}
                      {aiExplain.disclaimer && <p className="mt-3 text-xs text-slate-400">{aiExplain.disclaimer}</p>}
                    </div>
                  )}
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function NodeEditor({ node, registry, onChange, onRemove, disabled }) {
  const nodeTypeMeta = registry.nodeTypes.find((t) => t.type === node.type);
  return (
    <div className="rounded-xl border border-slate-200 bg-white/60 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-black uppercase text-slate-500">{node.type}</span>
        <input className="flex-1 rounded-lg border border-slate-200 px-2 py-1 text-sm" placeholder="Node ID" value={node.id} disabled />
        {!disabled && <Button variant="secondary" onClick={onRemove}><Trash2 size={13} /></Button>}
      </div>

      {node.type === "trigger" && (
        <select
          className="mt-2 w-full rounded-lg border border-slate-200 px-2 py-2 text-sm"
          value={node.config?.triggerType || ""}
          disabled={disabled}
          onChange={(e) => onChange({ config: { triggerType: e.target.value } })}
        >
          <option value="">Select trigger…</option>
          {nodeTypeMeta.options.map((opt) => <option key={opt.key} value={opt.key}>{opt.label}</option>)}
        </select>
      )}

      {(node.type === "condition" || node.type === "decision") && (
        <div className="mt-2 grid grid-cols-3 gap-2">
          <input className="rounded-lg border border-slate-200 px-2 py-1 text-xs" placeholder="field" disabled={disabled}
            value={node.config?.conditionTree?.field || ""}
            onChange={(e) => onChange({ config: { conditionTree: { ...node.config?.conditionTree, field: e.target.value } } })} />
          <select className="rounded-lg border border-slate-200 px-2 py-1 text-xs" disabled={disabled}
            value={node.config?.conditionTree?.operator || ""}
            onChange={(e) => onChange({ config: { conditionTree: { ...node.config?.conditionTree, operator: e.target.value } } })}>
            <option value="">operator</option>
            {["equals", "not_equals", "contains", "starts_with", "ends_with", "greater_than", "less_than", "empty", "not_empty"].map((op) => <option key={op} value={op}>{op}</option>)}
          </select>
          <input className="rounded-lg border border-slate-200 px-2 py-1 text-xs" placeholder="value" disabled={disabled}
            value={node.config?.conditionTree?.value ?? ""}
            onChange={(e) => onChange({ config: { conditionTree: { ...node.config?.conditionTree, value: e.target.value } } })} />
        </div>
      )}

      {["action", "approval", "assignment", "notification", "integration"].includes(node.type) && (
        <div className="mt-2 space-y-2">
          <select
            className="w-full rounded-lg border border-slate-200 px-2 py-2 text-sm"
            value={node.config?.actionType || ""}
            disabled={disabled}
            onChange={(e) => onChange({ config: { actionType: e.target.value } })}
          >
            <option value="">Select action…</option>
            {nodeTypeMeta.options.map((opt) => <option key={opt.type} value={opt.type}>{opt.label}</option>)}
          </select>
          {node.config?.actionType && (
            <div className="grid grid-cols-2 gap-2">
              {(nodeTypeMeta.options.find((o) => o.type === node.config.actionType)?.configFields || []).map((field) => (
                <input
                  key={field.key}
                  className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
                  placeholder={field.label}
                  disabled={disabled}
                  value={node.config?.[field.key] || ""}
                  onChange={(e) => onChange({ config: { [field.key]: e.target.value } })}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {node.type === "delay" && (
        <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-700">{nodeTypeMeta.unsupportedReason}</p>
      )}
    </div>
  );
}

function EdgeEditor({ edge, nodes, onChange, onRemove, disabled }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white/60 p-2 text-xs">
      <select className="rounded-lg border border-slate-200 px-2 py-1" value={edge.source} disabled={disabled} onChange={(e) => onChange({ source: e.target.value })}>
        {nodes.map((n) => <option key={n.id} value={n.id}>{n.id} ({n.type})</option>)}
      </select>
      <span>→</span>
      <select className="rounded-lg border border-slate-200 px-2 py-1" value={edge.target} disabled={disabled} onChange={(e) => onChange({ target: e.target.value })}>
        {nodes.map((n) => <option key={n.id} value={n.id}>{n.id} ({n.type})</option>)}
      </select>
      <select className="rounded-lg border border-slate-200 px-2 py-1" value={edge.branch || ""} disabled={disabled} onChange={(e) => onChange({ branch: e.target.value || null })}>
        <option value="">no branch</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
      {!disabled && <Button variant="secondary" onClick={onRemove}><Trash2 size={13} /></Button>}
    </div>
  );
}

export default AdminProcessDesigner;
