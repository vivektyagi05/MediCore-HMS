import { useEffect, useState } from "react";
import { X, Sparkles, CheckCircle2, XCircle, MinusCircle, Info } from "lucide-react";
import Button from "../ui/Button";
import Loader from "../ui/Loader";
import { monitoringApi } from "../../api/monitoringApi";
import { getApiErrorMessage } from "../../api/axios";

// ─────────────────────────────────────────────────────────────────────────
// Phase A6.2.4 — Enterprise Monitoring Platform.
// Execution Inspector (brief Step 3) + Execution Timeline (brief Step 4).
// Opened from the Execution Explorer on row click, same right-side-drawer
// pattern as OperationsWorkspaceDrawer.jsx — never navigates away from the
// explorer list.
// ─────────────────────────────────────────────────────────────────────────

const STEP_ICON = {
  success: <CheckCircle2 size={16} className="text-emerald-600" />,
  failed: <XCircle size={16} className="text-rose-600" />,
  skipped: <MinusCircle size={16} className="text-slate-400" />,
  info: <Info size={16} className="text-blue-500" />,
};

function fmtDuration(ms) {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function MonitoringExecutionDrawer({ executionId, source = "flow", onClose }) {
  const [detail, setDetail] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [explain, setExplain] = useState(null);
  const [explainLoading, setExplainLoading] = useState(false);
  const [explainError, setExplainError] = useState("");

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setError("");
    setExplain(null);
    monitoringApi
      .getExecutionDetail(executionId, source)
      .then((res) => {
        if (active) setDetail(res.data);
      })
      .catch((err) => {
        if (active) setError(getApiErrorMessage(err));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [executionId, source]);

  const loadExplain = async () => {
    setExplainLoading(true);
    setExplainError("");
    try {
      const res = await monitoringApi.explainExecution(executionId, source);
      setExplain(res.data);
    } catch (err) {
      setExplainError(getApiErrorMessage(err));
    } finally {
      setExplainLoading(false);
    }
  };

  const run = detail?.run;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/50 backdrop-blur-sm">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close inspector" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-white/60 bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white/95 p-6 backdrop-blur">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">Execution Inspector</p>
            <h2 className="mt-1 text-xl font-black text-slate-950">
              {source === "cron" ? run?.jobName : run?.flowId?.name || "Loading…"}
            </h2>
          </div>
          <Button variant="secondary" className="h-10 w-10 px-0" onClick={onClose} aria-label="Close">
            <X size={18} />
          </Button>
        </div>

        <div className="flex-1 space-y-6 p-6">
          {isLoading && <Loader label="Loading execution…" />}
          {error && <p className="rounded-lg bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</p>}

          {!isLoading && !error && run && (
            <>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Status</p>
                  <p className="font-semibold text-slate-800">{run.status}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Duration</p>
                  <p className="font-semibold text-slate-800">{fmtDuration(run.durationMs)}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Started</p>
                  <p className="font-semibold text-slate-800">{run.startedAt ? new Date(run.startedAt).toLocaleString() : "—"}</p>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
                    {source === "cron" ? "Triggered By" : "Trigger"}
                  </p>
                  <p className="font-semibold text-slate-800">
                    {source === "cron" ? run.triggeredBy : run.triggerType}
                  </p>
                </div>
              </div>

              {run.error && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                  <p className="font-bold">Error</p>
                  <p className="mt-1">{run.error}</p>
                </div>
              )}

              <div>
                <p className="text-xs font-black uppercase tracking-wide text-slate-500">Execution Timeline</p>
                <ol className="mt-3 space-y-2">
                  {(detail.timeline || []).map((step, idx) => (
                    <li key={idx} className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      <span className="mt-0.5">{STEP_ICON[step.status] || STEP_ICON.info}</span>
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-slate-800">{step.label}</p>
                        {step.message && <p className="mt-0.5 text-xs text-slate-500">{step.message}</p>}
                      </div>
                      {step.durationMs != null && (
                        <span className="text-xs font-semibold text-slate-400">{fmtDuration(step.durationMs)}</span>
                      )}
                    </li>
                  ))}
                </ol>
              </div>

              {source === "flow" && detail.relatedRuns?.length > 0 && (
                <div>
                  <p className="text-xs font-black uppercase tracking-wide text-slate-500">Recent Runs of This Flow</p>
                  <ul className="mt-2 space-y-1 text-sm text-slate-600">
                    {detail.relatedRuns.map((r) => (
                      <li key={r._id} className="flex justify-between">
                        <span>{new Date(r.startedAt).toLocaleString()}</span>
                        <span className="font-semibold">{r.status}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {source === "flow" && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                  <div className="flex items-center justify-between">
                    <p className="flex items-center gap-2 text-sm font-bold text-blue-800">
                      <Sparkles size={16} /> AI Explain
                    </p>
                    {!explain && (
                      <Button variant="secondary" onClick={loadExplain} disabled={explainLoading}>
                        {explainLoading ? "Explaining…" : "Explain This Run"}
                      </Button>
                    )}
                  </div>
                  {explainError && <p className="mt-2 text-sm text-rose-700">{explainError}</p>}
                  {explain && (
                    <div className="mt-3 space-y-2 text-sm text-blue-900">
                      <p>{explain.outcome}</p>
                      <p>{explain.conditionNote}</p>
                      <p>{explain.stepNote}</p>
                      <p>{explain.errorNote}</p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default MonitoringExecutionDrawer;
