import { useEffect, useMemo, useState } from "react";
import { RefreshCcw, Sparkles, Workflow as WorkflowIcon, GitBranch, ShieldCheck } from "lucide-react";
import { adminApi } from "../../api/adminApi";
import { getApiErrorMessage } from "../../api/axios";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import Loader from "../../components/ui/Loader";
import EmptyState from "../../components/shared/EmptyState";

// ─────────────────────────────────────────────────────────────────────────
// Phase A6.2.1 — Enterprise Workflow Automation Core.
// Workflow Engine Inspector (brief Step 9).
//
// This is deliberately NOT an Automation Studio — the brief is explicit
// that this phase is engine visualization only. It has three real,
// backend-driven views (Registry, Lifecycle, Business Rules) plus an
// AI Workflow Explain panel scoped to one operation key, reusing the
// Unified Operations Queue's own operationKey format so a user can jump
// here from an Operations Inbox row (via ?operationKey=) or paste one in.
// Nothing here is decorative sample data — every value rendered comes from
// backend/workflow/workflowRegistry.js, workflowStateMachine.js, or a live
// operation, via the three read-only endpoints added in this phase.
// ─────────────────────────────────────────────────────────────────────────

function useQueryParam(name) {
  return useMemo(() => new URLSearchParams(window.location.search).get(name) || "", [name]);
}

function LifecycleGraphViewer({ graph }) {
  if (!graph) return null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {graph.states.map((state) => (
          <span
            key={state}
            className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-bold uppercase tracking-wide text-slate-700"
          >
            {state}
          </span>
        ))}
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs font-black uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">From</th>
              <th className="px-4 py-2">Action</th>
              <th className="px-4 py-2">To</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {graph.transitions.flatMap((row) =>
              row.edges.map((edge) => (
                <tr key={`${row.from}-${edge.action}-${edge.to}`}>
                  <td className="px-4 py-2 font-semibold text-slate-800">{row.from}</td>
                  <td className="px-4 py-2 text-blue-700">{edge.action}</td>
                  <td className="px-4 py-2 text-slate-600">{edge.to}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        {graph.actions.includes("pin") &&
          '"pin" is exempt from this graph — it is a display flag, not a lifecycle state, and is legal from any status.'}
      </p>
    </div>
  );
}

function RegistryViewer({ workflows }) {
  if (!workflows?.length) return <EmptyState title="No workflow types registered" />;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {workflows.map((wf) => (
        <div key={wf.key} className="rounded-xl border border-slate-200 bg-white/60 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-black text-slate-950">{wf.label}</h3>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold uppercase text-slate-500">
              {wf.category}
            </span>
          </div>
          <p className="mt-1 text-xs font-semibold text-blue-700">{wf.department}</p>
          <dl className="mt-3 space-y-1.5 text-xs text-slate-600">
            <div>
              <dt className="font-bold uppercase tracking-wide text-slate-400">Priority Policy</dt>
              <dd>{wf.priorityRule}</dd>
            </div>
            <div>
              <dt className="font-bold uppercase tracking-wide text-slate-400">SLA Policy</dt>
              <dd>{wf.slaRule}</dd>
            </div>
            <div>
              <dt className="font-bold uppercase tracking-wide text-slate-400">Dependencies</dt>
              <dd>{wf.dependencies?.join(", ") || "—"}</dd>
            </div>
            <div>
              <dt className="font-bold uppercase tracking-wide text-slate-400">Supported Actions</dt>
              <dd>{wf.supportedActions?.join(", ") || "—"}</dd>
            </div>
          </dl>
        </div>
      ))}
    </div>
  );
}

function BusinessRulesViewer({ rules }) {
  if (!rules) return null;
  return (
    <div className="space-y-4 text-sm">
      <div>
        <h3 className="text-xs font-black uppercase tracking-wide text-slate-500">SLA Targets</h3>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {Object.entries(rules.slaTargets || {}).map(([priority, text]) => (
            <li key={priority} className="rounded-lg border border-slate-200 bg-white/60 px-3 py-2">
              <span className="font-bold capitalize text-slate-800">{priority}:</span>{" "}
              <span className="text-slate-600">{text}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="text-xs font-black uppercase tracking-wide text-slate-500">Assignment Model</h3>
        <p className="mt-2 text-slate-600">{rules.assignmentModel}</p>
      </div>
    </div>
  );
}

function WorkflowExplainPanel({ operationKey, setOperationKey }) {
  const [result, setResult] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const explain = async () => {
    if (!operationKey.trim()) return;
    setIsLoading(true);
    setError("");
    setResult(null);
    try {
      const response = await adminApi.getWorkflowExplain(operationKey.trim());
      setResult(response.data);
    } catch (explainError) {
      setError(getApiErrorMessage(explainError));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[260px] flex-1">
          <label className="text-xs font-bold uppercase text-slate-400" htmlFor="wf-explain-key">
            Operation Key
          </label>
          <input
            id="wf-explain-key"
            className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
            placeholder="e.g. doctor_verification:64f...  (from the Operations Inbox)"
            value={operationKey}
            onChange={(e) => setOperationKey(e.target.value)}
          />
        </div>
        <Button onClick={explain} isLoading={isLoading} disabled={!operationKey.trim()}>
          <Sparkles size={16} /> Explain
        </Button>
      </div>
      {error && <p className="text-sm font-semibold text-rose-600">{error}</p>}
      {result && (
        <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50/60 p-4 text-sm text-slate-700">
          <p><span className="font-black text-slate-950">What it is: </span>{result.whatItIs}</p>
          <p><span className="font-black text-slate-950">Why this state: </span>{result.whyThisState}</p>
          <p><span className="font-black text-slate-950">Dependencies: </span>{result.dependencies}</p>
          <p><span className="font-black text-slate-950">Next actions: </span>{result.nextActions}</p>
          <p><span className="font-black text-slate-950">Risk: </span>{result.risk}</p>
          <p><span className="font-black text-slate-950">Related: </span>{result.relatedNote}</p>
        </div>
      )}
    </div>
  );
}

function AdminWorkflowEngine() {
  const initialKey = useQueryParam("operationKey");
  const [registry, setRegistry] = useState(null);
  const [lifecycle, setLifecycle] = useState(null);
  const [rules, setRules] = useState(null);
  const [operationKey, setOperationKey] = useState(initialKey);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setIsLoading(true);
    setError("");
    try {
      const [registryRes, lifecycleRes, rulesRes] = await Promise.all([
        adminApi.getWorkflowRegistry(),
        adminApi.getWorkflowLifecycle(),
        adminApi.getOperationsBusinessRules(),
      ]);
      setRegistry(registryRes.data?.workflows || []);
      setLifecycle(lifecycleRes.data || null);
      setRules(rulesRes.data || null);
    } catch (loadError) {
      setError(getApiErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-blue-600">Enterprise Workflow Automation Core</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Workflow Engine Inspector</h1>
          <p className="mt-2 text-sm text-slate-600">
            The Workflow Registry, shared Lifecycle graph, and Policy rules every operation in the
            Unified Operations Queue now executes through — read-only visualization, not an automation builder.
          </p>
        </div>
        <div className="flex gap-2">
          <Button to="/admin/automation-studio" variant="secondary">
            Open Automation Studio →
          </Button>
          <Button to="/admin/process-orchestrator" variant="secondary">
            Open Process Orchestrator →
          </Button>
          <Button to="/admin/process-designer" variant="secondary">
            Open Process Designer →
          </Button>
          <Button onClick={load}>
            <RefreshCcw size={16} /> Refresh
          </Button>
        </div>
      </div>

      {isLoading && <Loader label="Loading workflow engine" />}
      {error && !isLoading && <EmptyState title="Couldn't load the workflow engine" description={error} />}

      {!isLoading && !error && (
        <>
          <Card title="AI Workflow Explain" action={<Sparkles size={18} className="text-blue-600" />}>
            <WorkflowExplainPanel operationKey={operationKey} setOperationKey={setOperationKey} />
          </Card>

          <Card
            title={`Workflow Registry (${registry?.length || 0} types)`}
            action={<WorkflowIcon size={18} className="text-blue-600" />}
          >
            <RegistryViewer workflows={registry} />
          </Card>

          <Card title="Shared Lifecycle Graph" action={<GitBranch size={18} className="text-blue-600" />}>
            <LifecycleGraphViewer graph={lifecycle} />
          </Card>

          <Card title="Policy Engine — Business Rules" action={<ShieldCheck size={18} className="text-blue-600" />}>
            <BusinessRulesViewer rules={rules} />
          </Card>
        </>
      )}
    </div>
  );
}

export default AdminWorkflowEngine;
