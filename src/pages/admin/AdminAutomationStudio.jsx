import { useEffect, useState } from "react";
import {
  Workflow,
  Plus,
  Play,
  History,
  Sparkles,
  Search as SearchIcon,
  Trash2,
  Copy,
  Archive,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Pin,
  ArrowUpCircle,
  ArrowDownCircle,
  BookTemplate,
} from "lucide-react";
import { automationStudioApi } from "../../api/automationStudioApi";
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
// Phase A6.2.3 — Enterprise Automation Studio.
//
// This is the one new page for the whole phase — a connected ecosystem
// (Home / Flows+Builder / Templates), not ten separate routes, per the
// brief's own "NOT pages... one connected ecosystem" instruction. The
// Visual Workflow Builder is a vertical connected step list (trigger ->
// condition -> ordered actions) with CSS connector lines rather than a
// full drag-drop canvas library — consistent with the brief's own "without
// introducing a new frontend framework unless absolutely necessary" note,
// and with this codebase's existing pattern of dependency-free custom
// visualizations (see FinanceCharts.jsx's SVG primitives).
//
// Every field this page can edit maps 1:1 to a real backend concept:
// triggerType must be one of the 14 real, wired triggers from
// triggerRegistry.js; every action type must be one of the 10 real actions
// actionExecutor.js implements. Nothing here can construct a flow the
// backend would reject.
// ─────────────────────────────────────────────────────────────────────────

const STATUS_TONE = { draft: "neutral", published: "success", archived: "danger" };
const RUN_STATUS_TONE = { success: "success", failed: "danger", skipped: "neutral" };
const CATEGORY_LABEL = {
  onboarding: "Onboarding",
  finance: "Finance",
  clinical: "Clinical",
  infrastructure: "Infrastructure",
  operations: "Operations",
  identity: "Identity",
  general: "General",
};

function newActionStep(type) {
  return { id: `a${Date.now()}${Math.random().toString(16).slice(2, 6)}`, type, config: {} };
}

function emptyDraft() {
  return {
    name: "",
    description: "",
    category: "general",
    triggerType: "",
    conditionLogic: "AND",
    conditionRules: [],
    actions: [],
  };
}

function flowToDraft(flow) {
  const group = flow.conditions && Array.isArray(flow.conditions.rules) ? flow.conditions : { logic: "AND", rules: [] };
  return {
    name: flow.name,
    description: flow.description || "",
    category: flow.category || "general",
    triggerType: flow.triggerType,
    conditionLogic: group.logic || "AND",
    conditionRules: group.rules || [],
    actions: flow.actions || [],
  };
}

function draftToPayload(draft) {
  return {
    name: draft.name,
    description: draft.description,
    category: draft.category,
    triggerType: draft.triggerType,
    conditions: draft.conditionRules.length ? { logic: draft.conditionLogic, rules: draft.conditionRules } : null,
    actions: draft.actions,
  };
}

// ─────────────────────────────────────── Home tab

function StudioHome({ home, onNewFlow, onOpenFlow, onBrowseTemplates }) {
  if (!home) return <Loader label="Loading Automation Studio" />;
  const { cards, categoryCounts, recentExecutions, topFlows } = home;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { label: "Published", value: cards.published },
          { label: "Draft", value: cards.draft },
          { label: "Archived", value: cards.archived },
          { label: "Failed (7d)", value: cards.failedLast7d },
          { label: "Executions Today", value: cards.executionsToday },
          { label: "Success Rate (7d)", value: cards.successRate7d == null ? "—" : `${cards.successRate7d}%` },
          { label: "Health Score", value: `${cards.healthScore}/100` },
        ].map((c) => (
          <Card key={c.label} className="text-center">
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{c.label}</p>
            <p className="mt-2 text-3xl font-black text-slate-950">{c.value}</p>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={onNewFlow}><Plus size={16} /> New Automation</Button>
        <Button variant="secondary" onClick={onBrowseTemplates}><BookTemplate size={16} /> Browse Templates</Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Categories">
          {categoryCounts.length === 0 ? (
            <p className="text-sm text-slate-500">No flows yet.</p>
          ) : (
            <div className="space-y-2">
              {categoryCounts.map((row) => (
                <div key={row.category} className="flex items-center justify-between text-sm">
                  <span className="font-semibold text-slate-700">{CATEGORY_LABEL[row.category] || row.category}</span>
                  <Badge tone="info">{row.count}</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Top Flows by Executions">
          {topFlows.length === 0 ? (
            <p className="text-sm text-slate-500">No published automations have run yet.</p>
          ) : (
            <div className="space-y-2">
              {topFlows.map((f) => (
                <button key={f._id} onClick={() => onOpenFlow(f._id)} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm hover:bg-slate-50">
                  <span className="font-semibold text-slate-800">{f.name}</span>
                  <span className="text-xs text-slate-500">{f.stats?.totalRuns || 0} runs</span>
                </button>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title="Execution Timeline (recent)">
        {recentExecutions.length === 0 ? (
          <EmptyState title="No executions yet" description="Publish an automation to start seeing real execution history here." />
        ) : (
          <div className="space-y-2">
            {recentExecutions.map((run) => (
              <div key={run.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  {run.status === "success" ? <CheckCircle2 size={16} className="text-emerald-600" /> : run.status === "failed" ? <XCircle size={16} className="text-rose-600" /> : <Workflow size={16} className="text-slate-400" />}
                  <span className="font-semibold text-slate-800">{run.flowName}</span>
                  <Badge tone={RUN_STATUS_TONE[run.status]}>{run.status}</Badge>
                </div>
                <span className="text-xs text-slate-500">{new Date(run.createdAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ─────────────────────────────────────── Flows list tab

function FlowsList({ flows, loading, error, onRetry, pagination, onPageChange, onOpenFlow, onNewFlow, search, setSearch, statusFilter, setStatusFilter }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="relative">
            <SearchIcon size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search automations..."
              className="rounded-xl border border-slate-200 bg-white/70 py-2 pl-9 pr-4 text-sm outline-none focus:border-blue-600"
            />
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-xl border border-slate-200 bg-white/70 px-3 py-2 text-sm outline-none">
            <option value="">All statuses</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
        </div>
        <Button onClick={onNewFlow}><Plus size={16} /> New Automation</Button>
      </div>

      {loading ? (
        <Loader label="Loading automations" />
      ) : error ? (
        <ErrorState description="We couldn't load automations." onRetry={onRetry} />
      ) : flows.length === 0 ? (
        <EmptyState title="No automations yet" description="Create your first automation or start from a template." />
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            {flows.map((flow) => (
              <button key={flow._id} onClick={() => onOpenFlow(flow._id)} className="glass-card min-w-0 rounded-2xl p-4 text-left transition hover:-translate-y-0.5 hover:shadow-xl">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-slate-950">{flow.name}</p>
                    <p className="mt-1 truncate text-xs text-slate-500">{flow.triggerLabel}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {flow.isPinned && <Pin size={14} className="text-blue-600" />}
                    <Badge tone={STATUS_TONE[flow.status]}>{flow.status}</Badge>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-4 text-xs text-slate-500">
                  <span>{flow.stats?.totalRuns || 0} runs</span>
                  <span>{flow.stats?.successCount || 0} success</span>
                  <span>{flow.stats?.failureCount || 0} failed</span>
                </div>
              </button>
            ))}
          </div>

          {pagination && pagination.totalPages > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <p className="text-xs text-slate-500">
                Page {pagination.page} of {pagination.totalPages} · {pagination.total} automation{pagination.total === 1 ? "" : "s"}
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

// ─────────────────────────────────────── Templates tab

function TemplatesTab({ templates, onUseTemplate }) {
  if (!templates) return <Loader label="Loading templates" />;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {templates.map((t) => (
        <Card key={t.key} title={t.name}>
          <p className="text-sm text-slate-600">{t.description}</p>
          <div className="mt-3 flex items-center justify-between">
            <Badge tone="info">{CATEGORY_LABEL[t.category] || t.category}</Badge>
            <Button variant="secondary" onClick={() => onUseTemplate(t.key)}>Use Template</Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ─────────────────────────────────────── Condition rule row

const OPERATORS = ["equals", "not_equals", "contains", "starts_with", "ends_with", "greater_than", "less_than", "between", "empty", "not_empty"];

function ConditionRuleRow({ rule, onChange, onRemove }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white/60 p-2">
      <input className="w-36 rounded-lg border border-slate-200 px-2 py-1.5 text-sm" placeholder="field (e.g. amount)" value={rule.field || ""} onChange={(e) => onChange({ ...rule, field: e.target.value })} />
      <select className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm" value={rule.operator || "equals"} onChange={(e) => onChange({ ...rule, operator: e.target.value })}>
        {OPERATORS.map((op) => <option key={op} value={op}>{op}</option>)}
      </select>
      {!["empty", "not_empty"].includes(rule.operator) && (
        <input className="w-32 rounded-lg border border-slate-200 px-2 py-1.5 text-sm" placeholder="value" value={rule.value ?? ""} onChange={(e) => onChange({ ...rule, value: e.target.value })} />
      )}
      {rule.operator === "between" && (
        <input className="w-32 rounded-lg border border-slate-200 px-2 py-1.5 text-sm" placeholder="to value" value={rule.valueTo ?? ""} onChange={(e) => onChange({ ...rule, valueTo: e.target.value })} />
      )}
      <button onClick={onRemove} className="ml-auto text-slate-400 hover:text-rose-600"><Trash2 size={15} /></button>
    </div>
  );
}

// ─────────────────────────────────────── Action step card

function ActionStepCard({ step, index, total, actionDefs, onChange, onRemove, onMove }) {
  const def = actionDefs.find((a) => a.type === step.type);
  return (
    <div className="relative rounded-xl border border-slate-200 bg-white/70 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">{index + 1}</span>
          <select className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-semibold" value={step.type} onChange={(e) => onChange({ ...step, type: e.target.value, config: {} })}>
            {actionDefs.map((a) => <option key={a.type} value={a.type}>{a.label}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-1">
          <button disabled={index === 0} onClick={() => onMove(-1)} className="text-slate-400 hover:text-blue-600 disabled:opacity-30"><ArrowUpCircle size={16} /></button>
          <button disabled={index === total - 1} onClick={() => onMove(1)} className="text-slate-400 hover:text-blue-600 disabled:opacity-30"><ArrowDownCircle size={16} /></button>
          <button onClick={onRemove} className="text-slate-400 hover:text-rose-600"><Trash2 size={15} /></button>
        </div>
      </div>
      {def && <p className="mt-1 text-xs text-slate-500">{def.description}</p>}
      {def?.configFields?.length > 0 && (
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {def.configFields.map((field) => (
            <label key={field.key} className="text-xs">
              <span className="mb-1 block font-semibold text-slate-600">{field.label}</span>
              {field.type === "select" ? (
                <select className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" value={step.config?.[field.key] || ""} onChange={(e) => onChange({ ...step, config: { ...step.config, [field.key]: e.target.value } })}>
                  <option value="">—</option>
                  {field.options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                </select>
              ) : field.type === "boolean" ? (
                <select className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" value={String(step.config?.[field.key] ?? "")} onChange={(e) => onChange({ ...step, config: { ...step.config, [field.key]: e.target.value === "true" } })}>
                  <option value="">—</option>
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              ) : field.type === "textarea" ? (
                <textarea className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" rows={2} placeholder={field.placeholder} value={step.config?.[field.key] || ""} onChange={(e) => onChange({ ...step, config: { ...step.config, [field.key]: e.target.value } })} />
              ) : (
                <input type={field.type === "number" ? "number" : "text"} className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm" placeholder={field.placeholder} value={step.config?.[field.key] ?? ""} onChange={(e) => onChange({ ...step, config: { ...step.config, [field.key]: field.type === "number" ? Number(e.target.value) : e.target.value } })} />
              )}
            </label>
          ))}
        </div>
      )}
      {index < total - 1 && <div className="absolute left-3 top-full h-3 w-px bg-slate-300" />}
    </div>
  );
}

// ─────────────────────────────────────── Builder

function Builder({ flowId, triggers, actionDefs, onSaved, onClosed, toast }) {
  const [draft, setDraft] = useState(emptyDraft());
  const [flow, setFlow] = useState(null);
  const [loading, setLoading] = useState(Boolean(flowId));
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState("builder");
  const [samplePayload, setSamplePayload] = useState("{}");
  const [simResult, setSimResult] = useState(null);
  const [inspector, setInspector] = useState(null);
  const [runs, setRuns] = useState([]);
  const [aiText, setAiText] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    if (!flowId) {
      setDraft(emptyDraft());
      setFlow(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    automationStudioApi
      .getFlow(flowId)
      .then((res) => {
        setFlow(res.data);
        setDraft(flowToDraft(res.data));
      })
      .catch((err) => toast.error(getApiErrorMessage(err)))
      .finally(() => setLoading(false));
  }, [flowId]);  

  const loadInspectorAndRuns = () => {
    if (!flowId) return;
    automationStudioApi.getInspector(flowId).then((res) => setInspector(res.data)).catch(() => {});
    automationStudioApi.getRunHistory(flowId).then((res) => setRuns(res.data)).catch(() => {});
  };

  useEffect(() => {
    if (tab === "inspector" || tab === "versions") loadInspectorAndRuns();
  }, [tab, flowId]);  

  const updateRule = (idx, next) => {
    const rules = [...draft.conditionRules];
    rules[idx] = next;
    setDraft({ ...draft, conditionRules: rules });
  };

  const save = async () => {
    if (!draft.name) return toast.error("Name is required.");
    if (!draft.triggerType) return toast.error("A trigger is required.");
    setSaving(true);
    try {
      const payload = draftToPayload(draft);
      const res = flowId ? await automationStudioApi.updateFlow(flowId, payload) : await automationStudioApi.createFlow(payload);
      toast.success("Automation saved.");
      setFlow(res.data);
      onSaved(res.data);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    if (!flow?._id) return toast.error("Save the automation before publishing.");
    try {
      const res = await automationStudioApi.publishFlow(flow._id);
      setFlow(res.data);
      toast.success(`Published as version ${res.data.version}.`);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    }
  };

  const archive = async () => {
    if (!flow?._id) return;
    try {
      const res = await automationStudioApi.archiveFlow(flow._id);
      setFlow(res.data);
      toast.success("Archived.");
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    }
  };

  const restore = async () => {
    if (!flow?._id) return;
    try {
      const res = await automationStudioApi.restoreFlow(flow._id);
      setFlow(res.data);
      toast.success("Restored to draft.");
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    }
  };

  const clone = async () => {
    if (!flow?._id) return;
    try {
      const res = await automationStudioApi.cloneFlow(flow._id);
      toast.success("Cloned.");
      onSaved(res.data);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    }
  };

  const rollback = async (version) => {
    if (!flow?._id) return;
    try {
      const res = await automationStudioApi.rollbackFlow(flow._id, version);
      setFlow(res.data);
      setDraft(flowToDraft(res.data));
      toast.success(`Rolled back to version ${version} (as a new draft).`);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    }
  };

  const runSimulation = async () => {
    if (!flow?._id) return toast.error("Save the automation first.");
    let parsed;
    try {
      parsed = JSON.parse(samplePayload || "{}");
    } catch {
      return toast.error("Sample payload must be valid JSON.");
    }
    try {
      const res = await automationStudioApi.simulateFlow(flow._id, parsed);
      setSimResult(res.data);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    }
  };

    const runAi = async (kind) => {
      if (!flow?._id) {
        return toast.error("Save the automation first.");
      }

      setAiLoading(true);
      setAiText(null);

      try {
        const data =
          kind === "explain"
            ? await automationStudioApi.explainFlow(flow._id)
            : await automationStudioApi.advisorFlow(flow._id);

        console.log("AI RESPONSE:", data);

        setAiText(data.data.content);
      } catch (err) {
        console.error("AI ERROR:", err);
        toast.error(getApiErrorMessage(err));
      } finally {
        setAiLoading(false);
      }
    };

  if (loading) return <Loader label="Loading automation" />;

  const selectedTrigger = triggers.find((t) => t.key === draft.triggerType);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="secondary" onClick={onClosed}>← Back</Button>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" isLoading={saving} onClick={save}>Save Draft</Button>
          {flow?.status !== "archived" && <Button onClick={publish}>Publish</Button>}
          {flow?.status === "archived" ? (
            <Button variant="secondary" onClick={restore}><RotateCcw size={15} /> Restore</Button>
          ) : (
            flow && <Button variant="secondary" onClick={archive}><Archive size={15} /> Archive</Button>
          )}
          {flow && <Button variant="secondary" onClick={clone}><Copy size={15} /> Clone</Button>}
        </div>
      </div>

      {flow && (
        <div className="flex items-center gap-2">
          <Badge tone={STATUS_TONE[flow.status]}>{flow.status}</Badge>
          <span className="text-xs text-slate-500">v{flow.version} · {flow.stats?.totalRuns || 0} runs · {flow.stats?.successCount || 0} success / {flow.stats?.failureCount || 0} failed</span>
        </div>
      )}

      <SettingsTabs
        activeTab={tab}
        onChange={setTab}
        tabs={[
          { id: "builder", label: "Builder" },
          { id: "simulator", label: "Simulator" },
          { id: "versions", label: "Versions" },
          { id: "inspector", label: "Inspector" },
          { id: "ai", label: "AI Assist" },
        ]}
      />

      {tab === "builder" && (
        <div className="space-y-5">
          <Card title="Details">
            <div className="grid gap-3 md:grid-cols-2">
              <Input label="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">Category</span>
                <select className="w-full rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
                  {Object.keys(CATEGORY_LABEL).map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
                </select>
              </label>
            </div>
            <div className="mt-3">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-700">Description</span>
                <textarea className="w-full rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm" rows={2} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              </label>
            </div>
          </Card>

          <Card title="1. Trigger">
            <select className="w-full rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-sm" value={draft.triggerType} onChange={(e) => setDraft({ ...draft, triggerType: e.target.value })}>
              <option value="">Select a real trigger...</option>
              {triggers.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
            {selectedTrigger && <p className="mt-2 text-xs text-slate-500">{selectedTrigger.description}</p>}
          </Card>

          <Card
            title="2. Conditions"
            action={
              <div className="flex items-center gap-2">
                <select className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm" value={draft.conditionLogic} onChange={(e) => setDraft({ ...draft, conditionLogic: e.target.value })}>
                  <option value="AND">Match ALL (AND)</option>
                  <option value="OR">Match ANY (OR)</option>
                </select>
                <Button variant="secondary" onClick={() => setDraft({ ...draft, conditionRules: [...draft.conditionRules, { field: "", operator: "equals", value: "" }] })}><Plus size={14} /> Rule</Button>
              </div>
            }
          >
            {draft.conditionRules.length === 0 ? (
              <p className="text-sm text-slate-500">No conditions — this automation always runs when the trigger fires.</p>
            ) : (
              <div className="space-y-2">
                {draft.conditionRules.map((rule, idx) => (
                  <ConditionRuleRow key={idx} rule={rule} onChange={(next) => updateRule(idx, next)} onRemove={() => setDraft({ ...draft, conditionRules: draft.conditionRules.filter((_, i) => i !== idx) })} />
                ))}
              </div>
            )}
          </Card>

          <Card
            title="3. Actions"
            action={
              <select className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm" onChange={(e) => { if (e.target.value) { setDraft({ ...draft, actions: [...draft.actions, newActionStep(e.target.value)] }); e.target.value = ""; } }}>
                <option value="">+ Add action...</option>
                {actionDefs.map((a) => <option key={a.type} value={a.type}>{a.label}</option>)}
              </select>
            }
          >
            {draft.actions.length === 0 ? (
              <p className="text-sm text-slate-500">Add at least one action before publishing.</p>
            ) : (
              <div className="space-y-4">
                {draft.actions.map((step, idx) => (
                  <ActionStepCard
                    key={step.id}
                    step={step}
                    index={idx}
                    total={draft.actions.length}
                    actionDefs={actionDefs}
                    onChange={(next) => { const actions = [...draft.actions]; actions[idx] = next; setDraft({ ...draft, actions }); }}
                    onRemove={() => setDraft({ ...draft, actions: draft.actions.filter((_, i) => i !== idx) })}
                    onMove={(dir) => {
                      const actions = [...draft.actions];
                      const swap = idx + dir;
                      if (swap < 0 || swap >= actions.length) return;
                      [actions[idx], actions[swap]] = [actions[swap], actions[idx]];
                      setDraft({ ...draft, actions });
                    }}
                  />
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === "simulator" && (
        <Card title="Execution Simulator (dry run — zero production impact)">
          <p className="text-xs text-slate-500">Side-effecting actions (notifications, webhooks, feature toggles) are skipped and reported as "would run"; read-only actions (AI insight, assignment recommendation) execute for real since they mutate nothing.</p>
          <label className="mt-3 block">
            <span className="mb-2 block text-sm font-semibold text-slate-700">Sample trigger payload (JSON)</span>
            <textarea className="w-full rounded-xl border border-slate-200 bg-white/70 px-4 py-3 font-mono text-xs" rows={6} value={samplePayload} onChange={(e) => setSamplePayload(e.target.value)} />
          </label>
          <Button className="mt-3" onClick={runSimulation}><Play size={15} /> Run Simulation</Button>
          {simResult && (
            <div className="mt-4 space-y-2">
              <Badge tone={RUN_STATUS_TONE[simResult.status] || "neutral"}>{simResult.status}</Badge>
              {simResult.conditionTrace?.length > 0 && (
                <div className="rounded-lg border border-slate-200 p-2 text-xs">
                  <p className="mb-1 font-bold text-slate-700">Condition trace</p>
                  {simResult.conditionTrace.map((t, i) => (
                    <p key={i} className={`break-words ${t.result ? "text-emerald-700" : "text-rose-700"}`}>{t.field} {t.operator} {String(t.value)} → {String(t.result)}</p>
                  ))}
                </div>
              )}
              {simResult.stepResults?.map((s, i) => (
                <div key={i} className="min-w-0 rounded-lg border border-slate-200 p-2 text-sm">
                  <p className="break-words font-semibold text-slate-800">{i + 1}. {s.actionType} {s.skipped && <Badge tone="neutral" className="ml-1">skipped</Badge>}</p>
                  <p className="break-words text-xs text-slate-500">{s.message}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === "versions" && (
        <Card title="Version History">
          {!flow?.versionHistory?.length ? (
            <p className="text-sm text-slate-500">No published versions yet.</p>
          ) : (
            <div className="space-y-2">
              {[...flow.versionHistory].reverse().map((v) => (
                <div key={v.version} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 p-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-bold text-slate-800">Version {v.version}</p>
                    <p className="truncate text-xs text-slate-500">{new Date(v.publishedAt).toLocaleString()} {v.changeNote && `· ${v.changeNote}`}</p>
                  </div>
                  <Button variant="secondary" onClick={() => rollback(v.version)}><History size={14} /> Rollback</Button>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {tab === "inspector" && (
        <Card title="Inspector">
          {!inspector ? (
            <Loader label="Loading inspector" />
          ) : (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div><p className="text-xs text-slate-500">Success rate</p><p className="font-bold">{inspector.successPct == null ? "—" : `${inspector.successPct}%`}</p></div>
                <div><p className="text-xs text-slate-500">Failure rate</p><p className="font-bold">{inspector.failurePct == null ? "—" : `${inspector.failurePct}%`}</p></div>
                <div className="min-w-0"><p className="text-xs text-slate-500">Used actions</p><p className="truncate font-bold">{inspector.usedActionTypes.join(", ") || "—"}</p></div>
              </div>
              <div>
                <p className="mb-1 font-bold text-slate-700">Related flows (same trigger)</p>
                {inspector.relatedFlows.length === 0 ? <p className="text-slate-500">None.</p> : inspector.relatedFlows.map((r) => <p key={r._id} className="truncate">{r.name} — {r.status}</p>)}
              </div>
              <div>
                <p className="mb-1 font-bold text-slate-700">Recent runs</p>
                {runs.length === 0 ? <p className="text-slate-500">No runs yet.</p> : runs.slice(0, 10).map((r) => (
                  <div key={r._id} className="flex items-center justify-between gap-2 border-b border-slate-100 py-1">
                    <span className="truncate">{new Date(r.createdAt).toLocaleString()}</span>
                    <Badge tone={RUN_STATUS_TONE[r.status]}>{r.status}</Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {tab === "ai" && (
        <Card title="AI Workflow Builder">
          <div className="flex gap-2">
            <Button
              variant="secondary"
              isLoading={aiLoading}
              onClick={() => runAi("explain")}
            >
              <Sparkles size={15} />
              Explain Flow
            </Button>

            <Button
              variant="secondary"
              isLoading={aiLoading}
              onClick={() => runAi("advisor")}
            >
              <Sparkles size={15} />
              Advise (risks / gaps)
            </Button>
          </div>

          {aiText && (
            <div className="mt-4 rounded-xl bg-blue-50 p-4 text-sm text-slate-800">
              <div>
                <p className="font-bold">What it does</p>
                <p className="mt-1">{aiText.whatItDoes}</p>
              </div>

              <div className="mt-3">
                <p className="font-bold">Condition summary</p>
                <p className="mt-1">{aiText.conditionSummary}</p>
              </div>

              <div className="mt-3">
                <p className="font-bold">Action summary</p>
                <p className="mt-1">{aiText.actionSummary}</p>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

// ─────────────────────────────────────── Page shell

function AdminAutomationStudio() {
  const toast = useToast();
  const [tab, setTab] = useState("home");
  const [home, setHome] = useState(null);
  const [triggers, setTriggers] = useState([]);
  const [actionDefs, setActionDefs] = useState([]);
  const [templates, setTemplates] = useState(null);
  const [flows, setFlows] = useState([]);
  const [flowsLoading, setFlowsLoading] = useState(false);
  const [flowsError, setFlowsError] = useState(false);
  const [flowsPagination, setFlowsPagination] = useState(null);
  const [flowsPage, setFlowsPage] = useState(1);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [openFlowId, setOpenFlowId] = useState(undefined); // undefined = list view, null = new flow, id = editing

  // Any filter change invalidates the current page — go back to page 1
  // (same pattern as AdminOperationsCenter.jsx, UI-10).
  useEffect(() => {
    setFlowsPage(1);
  }, [search, statusFilter]);

  useEffect(() => {
    automationStudioApi.getTriggers().then((res) => setTriggers(res.data)).catch(() => {});
    automationStudioApi.getActions().then((res) => setActionDefs(res.data)).catch(() => {});
  }, []);

  const loadHome = () => automationStudioApi.getHome().then((res) => setHome(res.data)).catch((err) => toast.error(getApiErrorMessage(err)));

  const loadFlows = () => {
    setFlowsLoading(true);
    setFlowsError(false);
    const params = { page: flowsPage, pageSize: 20 };
    if (search) params.search = search;
    if (statusFilter) params.status = statusFilter;
    automationStudioApi
      .listFlows(params)
      .then((res) => {
        setFlows(res.data);
        setFlowsPagination(res.meta || null);
      })
      .catch((err) => {
        setFlowsError(true);
        toast.error(getApiErrorMessage(err));
      })
      .finally(() => setFlowsLoading(false));
  };

  useEffect(() => {
    if (tab === "home") loadHome();
    if (tab === "flows" && openFlowId === undefined) loadFlows();
    if (tab === "templates" && !templates) automationStudioApi.getTemplates().then((res) => setTemplates(res.data)).catch(() => {});
  }, [tab, openFlowId, search, statusFilter, flowsPage]);  

  const useTemplate = async (key) => {
    try {
      const res = await automationStudioApi.useTemplate(key);
      toast.success("Automation created from template — edit and publish it in the Builder.");
      setTab("flows");
      setOpenFlowId(res.data._id);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-white shadow-lg"><Workflow size={20} /></span>
          <div>
            <h1 className="text-2xl font-black text-slate-950">Automation Studio</h1>
            <p className="text-sm text-slate-500">No-code automation builder — real triggers, real conditions, real actions.</p>
          </div>
        </div>
        <Button to="/admin/monitoring" variant="secondary">
          Open Monitoring Platform →
        </Button>
      </div>

      <SettingsTabs
        activeTab={tab}
        onChange={(t) => { setTab(t); setOpenFlowId(undefined); }}
        tabs={[
          { id: "home", label: "Home" },
          { id: "flows", label: "Flows" },
          { id: "templates", label: "Templates" },
        ]}
      />

      {tab === "home" && (
        <StudioHome
          home={home}
          onNewFlow={() => { setTab("flows"); setOpenFlowId(null); }}
          onOpenFlow={(id) => { setTab("flows"); setOpenFlowId(id); }}
          onBrowseTemplates={() => setTab("templates")}
        />
      )}

      {tab === "flows" && (
        openFlowId !== undefined ? (
          <Builder
            flowId={openFlowId}
            triggers={triggers}
            actionDefs={actionDefs}
            toast={toast}
            onClosed={() => { setOpenFlowId(undefined); loadFlows(); }}
            onSaved={(savedFlow) => setOpenFlowId(savedFlow._id)}
          />
        ) : (
          <FlowsList
            flows={flows}
            loading={flowsLoading}
            error={flowsError}
            onRetry={loadFlows}
            pagination={flowsPagination}
            onPageChange={setFlowsPage}
            onOpenFlow={setOpenFlowId}
            onNewFlow={() => setOpenFlowId(null)}
            search={search}
            setSearch={setSearch}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
          />
        )
      )}

      {tab === "templates" && <TemplatesTab templates={templates} onUseTemplate={useTemplate} />}
    </div>
  );
}

export default AdminAutomationStudio;
