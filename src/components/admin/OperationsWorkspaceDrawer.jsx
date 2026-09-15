import { useEffect, useState } from "react";
import { X, Sparkles, UserPlus, ArrowUpRight, CheckCircle2, XCircle, Flag, Clock, Target, Repeat, AlertOctagon, GitBranch, Lock, ShieldCheck } from "lucide-react";
import Button from "../ui/Button";
import Loader from "../ui/Loader";
import { adminApi } from "../../api/adminApi";
import { monitoringApi } from "../../api/monitoringApi";
import { getApiErrorMessage } from "../../api/axios";
import { useToast } from "../../context/ToastContext";

const SLA_STYLES = {
  overdue: "bg-rose-50 text-rose-800 border-rose-200",
  at_risk: "bg-amber-50 text-amber-800 border-amber-200",
  on_track: "bg-emerald-50 text-emerald-800 border-emerald-200",
  completed: "bg-slate-50 text-slate-700 border-slate-200",
};

const PRIORITY_STYLES = {
  critical: "bg-rose-50 text-rose-800 border-rose-200",
  high: "bg-amber-50 text-amber-800 border-amber-200",
  medium: "bg-blue-50 text-blue-800 border-blue-200",
  low: "bg-slate-50 text-slate-700 border-slate-200",
};

const ACTION_LABELS = {
  claim: "Claim",
  release: "Release",
  assign: "Assign",
  escalate: "Escalate",
  resolve: "Resolve",
  cancel: "Cancel",
};

function fmtDuration(ms) {
  if (ms == null) return "—";
  const abs = Math.abs(ms);
  const hours = Math.floor(abs / (60 * 60 * 1000));
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function OperationsWorkspaceDrawer({ operationKey, admins, onClose, onChanged }) {
  const toast = useToast();
  const [detail, setDetail] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState("");
  const [aiSummary, setAiSummary] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [assigneeId, setAssigneeId] = useState("");
  const [note, setNote] = useState("");
  const [recommendations, setRecommendations] = useState(null);
  const [recLoading, setRecLoading] = useState(true);
  const [reassignment, setReassignment] = useState(null);
  const [assignmentExplain, setAssignmentExplain] = useState(null);
  const [assignmentExplainLoading, setAssignmentExplainLoading] = useState(false);

  // Phase UI-10, Section 11 — Incident/Investigation Workspace. A
  // payment_failure operation's sourceId IS the underlying Payment._id, the
  // exact same id monitoringAggregates.buildPaymentRetryQueue() keys its
  // dead-letter/in-retry-window lists by. This is a real, existing
  // relationship in the data — not a new correlation engine — so a
  // payment_failure operation can be matched against the retry queue
  // client-side with no new backend endpoint.
  const [retryMatch, setRetryMatch] = useState(undefined); // undefined = not applicable/not loaded, null = checked, no match
  const [retryLoading, setRetryLoading] = useState(false);
  const [retryResolveLoading, setRetryResolveLoading] = useState(false);

  const load = async () => {
    setIsLoading(true);
    setError("");
    try {
      const response = await adminApi.getOperationDetail(operationKey);
      setDetail(response.data);
    } catch (loadError) {
      setError(getApiErrorMessage(loadError));
    } finally {
      setIsLoading(false);
    }
  };

  // Phase A6.2.2 — Smart Assignment Engine: recommendations load alongside
  // the detail itself (not gated behind a click) since "who should get
  // this" is core to what the workspace is for. A failure here never blocks
  // the rest of the drawer.
  const loadRecommendations = async () => {
    setRecLoading(true);
    try {
      const [recResponse, reassignResponse] = await Promise.all([
        adminApi.getAssignmentRecommendations(operationKey),
        adminApi.getReassignmentRecommendation(operationKey),
      ]);
      setRecommendations(recResponse.data);
      setReassignment(reassignResponse.data);
    } catch {
      setRecommendations(null);
      setReassignment(null);
    } finally {
      setRecLoading(false);
    }
  };

  const loadRetryMatch = async (item) => {
    if (!item || item.type !== "payment_failure") {
      setRetryMatch(undefined);
      return;
    }
    setRetryLoading(true);
    try {
      const response = await monitoringApi.getRetryQueue();
      const data = response.data;
      const deadLetterEntry = data?.deadLetter?.find((p) => String(p._id) === item.sourceId);
      const inWindowEntry = data?.inRetryWindow?.find((p) => String(p._id) === item.sourceId);
      if (deadLetterEntry) setRetryMatch({ kind: "deadLetter", entry: deadLetterEntry, maxRetries: data.maxRetries });
      else if (inWindowEntry) setRetryMatch({ kind: "inRetryWindow", entry: inWindowEntry, maxRetries: data.maxRetries });
      else setRetryMatch(null);
    } catch {
      setRetryMatch(null);
    } finally {
      setRetryLoading(false);
    }
  };

  const resolveDeadLetter = async () => {
    if (!retryMatch?.entry?._id) return;
    setRetryResolveLoading(true);
    try {
      await monitoringApi.resolveDeadLetterPayment(retryMatch.entry._id);
      toast.success("Payment marked reviewed. It will no longer appear in the dead-letter queue.");
      await loadRetryMatch(detail);
    } catch (resolveError) {
      toast.error(getApiErrorMessage(resolveError));
    } finally {
      setRetryResolveLoading(false);
    }
  };

  useEffect(() => {
    setAiSummary(null);
    setAssignmentExplain(null);
    setNote("");
    setAssigneeId("");
    setRetryMatch(undefined);
    load();
    loadRecommendations();
  }, [operationKey]);

  // Runs once the operation's real type/sourceId are known.
  useEffect(() => {
    if (detail) loadRetryMatch(detail);
  }, [detail?.id]);

  const loadAssignmentExplain = async () => {
    setAssignmentExplainLoading(true);
    try {
      const response = await adminApi.getAssignmentRecommendationExplain(operationKey);
      setAssignmentExplain(response.data);
    } catch (aiError) {
      toast.error(getApiErrorMessage(aiError));
    } finally {
      setAssignmentExplainLoading(false);
    }
  };

  const runAction = async (label, fn) => {
    setActionLoading(label);
    try {
      const response = await fn();
      if (response?.data?.notification?.delivered === false) {
        toast.warning(response?.message || "Action completed, but a notification could not be delivered.");
      } else {
        toast.success(response?.message || "Done");
      }
      await Promise.all([load(), loadRecommendations()]);
      onChanged?.();
    } catch (actionError) {
      toast.error(getApiErrorMessage(actionError));
    } finally {
      setActionLoading("");
    }
  };

  const loadAiSummary = async () => {
    setAiLoading(true);
    try {
      const response = await adminApi.getOperationAiSummary(operationKey);
      setAiSummary(response.data);
    } catch (aiError) {
      toast.error(getApiErrorMessage(aiError));
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/50 backdrop-blur-sm">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close workspace"
        onClick={onClose}
      />
      <div className="relative flex h-full w-full max-w-xl flex-col overflow-y-auto border-l border-white/60 bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white/95 p-6 backdrop-blur">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-600">Operations Workspace</p>
            <h2 className="mt-1 text-xl font-black text-slate-950">{detail?.typeLabel || "Loading…"}</h2>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" to={`/admin/workflow-engine?operationKey=${encodeURIComponent(operationKey)}`}>
              Inspect in Workflow Engine
            </Button>
            <Button variant="secondary" className="h-10 w-10 px-0" onClick={onClose} aria-label="Close">
              <X size={18} />
            </Button>
          </div>
        </div>

        <div className="flex-1 space-y-6 p-6">
          {isLoading && !detail && <Loader label="Loading operation" />}
          {error && !detail && (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</div>
          )}

          {detail && (
            <>
              {/* Summary */}
              <section className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-3 py-1 text-xs font-black uppercase ${PRIORITY_STYLES[detail.priority] || PRIORITY_STYLES.low}`}>
                    {detail.priority}
                  </span>
                  <span className={`rounded-full border px-3 py-1 text-xs font-black uppercase ${SLA_STYLES[detail.sla?.state] || SLA_STYLES.on_track}`}>
                    SLA: {detail.sla?.state?.replace("_", " ")}
                  </span>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-600">
                    {detail.status}
                  </span>
                  {detail.pinned && (
                    <span className="rounded-full border border-purple-200 bg-purple-50 px-3 py-1 text-xs font-bold text-purple-700">Pinned</span>
                  )}
                </div>

                <p className="text-sm leading-6 text-slate-700">{detail.reason}</p>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs font-bold uppercase text-slate-400">Owner</p>
                    <p className="font-semibold text-slate-900">{detail.owner}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase text-slate-400">Department</p>
                    <p className="font-semibold text-slate-900">{detail.department}</p>
                  </div>
                  {detail.patient && (
                    <div>
                      <p className="text-xs font-bold uppercase text-slate-400">Patient</p>
                      <p className="font-semibold text-slate-900">{detail.patient.name}</p>
                    </div>
                  )}
                  {detail.doctor && (
                    <div>
                      <p className="text-xs font-bold uppercase text-slate-400">Doctor</p>
                      <p className="font-semibold text-slate-900">{detail.doctor.name}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs font-bold uppercase text-slate-400">Elapsed</p>
                    <p className="font-semibold text-slate-900">{fmtDuration(detail.sla?.elapsedMs)}</p>
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase text-slate-400">Remaining</p>
                    <p className="font-semibold text-slate-900">{fmtDuration(detail.sla?.remainingMs)}</p>
                  </div>
                  {detail.assignedTo && (
                    <div>
                      <p className="text-xs font-bold uppercase text-slate-400">Assigned To</p>
                      <p className="font-semibold text-slate-900">{detail.assignedTo.name}</p>
                    </div>
                  )}
                  {detail.escalatedTo && (
                    <div>
                      <p className="text-xs font-bold uppercase text-slate-400">Escalated To</p>
                      <p className="font-semibold text-slate-900">{detail.escalatedTo.name}</p>
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-bold uppercase text-slate-400">Business Impact</p>
                  <p className="mt-1 text-sm text-slate-700">{detail.businessImpact}</p>
                </div>

                <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                  <p className="text-xs font-bold uppercase text-blue-500">Recommended Action</p>
                  <p className="mt-1 text-sm text-blue-900">{detail.recommendedAction}</p>
                </div>
              </section>

              {/* Workflow State (Phase UI-11, Part C) — reuses the same
                  state-machine graph executeWorkflowTransition() enforces
                  server-side; every action/reason shown here is exactly
                  what the API will accept or reject. */}
              {detail.stateMachine && (
                <section className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-[0.15em] text-slate-500">
                    <GitBranch size={14} /> Workflow State
                  </p>
                  <div className="mb-3">
                    <p className="text-xs font-bold uppercase text-slate-400">Current</p>
                    <p className="font-semibold text-slate-900">{detail.stateMachine.current}</p>
                  </div>
                  <div className="mb-3">
                    <p className="text-xs font-bold uppercase text-slate-400">Allowed Next</p>
                    {detail.stateMachine.allowedActions?.length ? (
                      <div className="mt-1 flex flex-wrap gap-2">
                        {detail.stateMachine.allowedActions.map((action) => (
                          <span
                            key={action}
                            className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-800"
                          >
                            {ACTION_LABELS[action] || action}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-slate-500">No further transitions available.</p>
                    )}
                  </div>
                  {detail.stateMachine.blockedTransitions?.length > 0 && (
                    <div>
                      <p className="flex items-center gap-1 text-xs font-bold uppercase text-slate-400">
                        <Lock size={12} /> Blocked
                      </p>
                      <div className="mt-1 space-y-1">
                        {detail.stateMachine.blockedTransitions.map((b) => (
                          <p key={b.action} className="text-xs text-slate-500">
                            <span className="font-bold text-slate-600">{ACTION_LABELS[b.action] || b.action}:</span> {b.reason}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                </section>
              )}

              {/* Related Operations */}
              {detail.relatedOperations?.length > 0 && (
                <section>
                  <p className="mb-2 text-xs font-black uppercase tracking-[0.15em] text-slate-500">Related Operations</p>
                  <div className="space-y-2">
                    {detail.relatedOperations.map((r) => (
                      <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
                        <span className={`mr-2 rounded-full border px-2 py-0.5 text-xs font-black uppercase ${PRIORITY_STYLES[r.priority] || PRIORITY_STYLES.low}`}>
                          {r.priority}
                        </span>
                        <span className="font-semibold text-slate-800">{r.typeLabel}:</span> <span className="text-slate-600">{r.reason}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Phase A6.2.2 — Smart Assignment Engine: Smart Recommendations */}
              <section className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
                <p className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-[0.15em] text-emerald-700">
                  <Target size={14} /> Smart Recommendations
                </p>
                {recLoading && <p className="text-sm text-emerald-700">Scoring candidates…</p>}
                {!recLoading && !recommendations?.candidates?.length && (
                  <p className="text-sm text-emerald-800">No eligible candidate is currently under capacity for this item.</p>
                )}
                {!recLoading && recommendations?.candidates?.length > 0 && (
                  <div className="space-y-2">
                    {recommendations.candidates.map((c) => (
                      <div key={c.admin.id} className="rounded-xl border border-emerald-200 bg-white p-3 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-black text-slate-900">
                              {c.admin.name} <span className="ml-1 text-xs font-bold text-emerald-700">Score {c.score}/100</span>
                              {c.isOnline && <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black uppercase text-emerald-700">Online</span>}
                              {!c.assignable && <span className="ml-2 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-black uppercase text-rose-700">At capacity</span>}
                            </p>
                            <p className="mt-1 text-xs text-slate-600">{c.reason}</p>
                          </div>
                          <Button
                            variant="secondary"
                            disabled={!c.assignable}
                            isLoading={actionLoading === `assign-rec-${c.admin.id}`}
                            onClick={() =>
                              runAction(`assign-rec-${c.admin.id}`, () =>
                                adminApi.assignOperation(operationKey, c.admin.id, `Recommended — ${c.reason}`),
                              )
                            }
                          >
                            Assign
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-3 flex items-center justify-between gap-3 border-t border-emerald-200 pt-3">
                  <p className="flex items-center gap-2 text-xs font-black uppercase text-emerald-700">
                    <Sparkles size={12} /> AI Explain
                  </p>
                  <Button variant="secondary" onClick={loadAssignmentExplain} isLoading={assignmentExplainLoading}>
                    Explain
                  </Button>
                </div>
                {assignmentExplain && (
                  <p className="mt-2 text-sm text-emerald-950">{assignmentExplain.content?.recommendation}</p>
                )}

                {reassignment?.shouldReassign && (
                  <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3">
                    <p className="flex items-center gap-2 text-xs font-black uppercase text-amber-700">
                      <Repeat size={14} /> Reassignment Suggested
                    </p>
                    <p className="mt-1 text-sm text-amber-900">
                      {reassignment.current?.reasonsToReassign?.join(", ") || "Current assignee may not be the best fit."}
                    </p>
                    {reassignment.alternates?.[0] && (
                      <Button
                        className="mt-2"
                        variant="secondary"
                        isLoading={actionLoading === "reassign"}
                        onClick={() =>
                          runAction("reassign", () =>
                            adminApi.assignOperation(
                              operationKey,
                              reassignment.alternates[0].admin.id,
                              `Reassigned — ${reassignment.alternates[0].reason}`,
                            ),
                          )
                        }
                      >
                        Reassign to {reassignment.alternates[0].admin.name} ({reassignment.alternates[0].score}/100)
                      </Button>
                    )}
                  </div>
                )}
              </section>

              {/* Payment Retry / Dead-Letter Correlation (Phase UI-10, Section 11) */}
              {retryMatch !== undefined && (
                <section
                  className={`rounded-xl border p-4 ${
                    retryMatch?.kind === "deadLetter"
                      ? "border-rose-200 bg-rose-50"
                      : retryMatch?.kind === "inRetryWindow"
                      ? "border-amber-200 bg-amber-50"
                      : "border-slate-200 bg-slate-50"
                  }`}
                >
                  <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.15em] text-slate-600">
                    <AlertOctagon size={14} /> Payment Retry Status
                  </p>
                  {retryLoading ? (
                    <p className="mt-2 text-sm text-slate-500">Checking retry queue…</p>
                  ) : retryMatch === null ? (
                    <p className="mt-2 text-sm text-slate-600">
                      Not currently in the automatic retry queue or the dead-letter queue. It may have already been resolved or has not yet been picked up.
                    </p>
                  ) : retryMatch.kind === "deadLetter" ? (
                    <div className="mt-2 space-y-2 text-sm text-rose-900">
                      <p className="font-bold">
                        This payment exhausted all {retryMatch.maxRetries} automatic retry attempts and is sitting in the dead-letter queue — it will not retry again on its own.
                      </p>
                      <p>
                        Retry count: {retryMatch.entry.retryCount} · Amount: {retryMatch.entry.amount ?? "Not available"} · Failed at:{" "}
                        {retryMatch.entry.failedAt ? new Date(retryMatch.entry.failedAt).toLocaleString() : "Not available"}
                      </p>
                      <Button variant="danger" isLoading={retryResolveLoading} onClick={resolveDeadLetter}>
                        Mark reviewed
                      </Button>
                    </div>
                  ) : (
                    <div className="mt-2 space-y-1 text-sm text-amber-900">
                      <p className="font-bold">Still inside its automatic retry window — no manual action needed unless it reaches dead-letter.</p>
                      <p>
                        Retry count: {retryMatch.entry.retryCount} of {retryMatch.maxRetries} · Next retry:{" "}
                        {retryMatch.entry.nextRetryAt ? new Date(retryMatch.entry.nextRetryAt).toLocaleString() : "Not available"}
                      </p>
                    </div>
                  )}
                </section>
              )}

              {/* AI Operation Summary */}
              <section className="rounded-xl border border-purple-200 bg-purple-50/60 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.15em] text-purple-600">
                    <Sparkles size={14} /> AI Operation Summary
                  </p>
                  <Button variant="secondary" onClick={loadAiSummary} isLoading={aiLoading}>
                    Generate
                  </Button>
                </div>
                {aiSummary && (
                  <div className="mt-3 space-y-2 text-sm text-purple-950">
                    <p>{aiSummary.content?.summary}</p>
                    <p className="font-semibold">{aiSummary.content?.riskNote}</p>
                    <p className="italic">{aiSummary.content?.resolutionSuggestion}</p>
                    <p className="text-xs text-purple-500">{aiSummary.disclaimer}</p>
                  </div>
                )}
              </section>

              {/* Quick Operations */}
              <section className="space-y-3">
                <p className="text-xs font-black uppercase tracking-[0.15em] text-slate-500">Quick Operations</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    isLoading={actionLoading === "claim"}
                    onClick={() => runAction("claim", () => adminApi.claimOperation(operationKey))}
                  >
                    <UserPlus size={16} /> Claim
                  </Button>
                  <Button
                    variant="secondary"
                    isLoading={actionLoading === "release"}
                    onClick={() => runAction("release", () => adminApi.releaseOperation(operationKey))}
                  >
                    Release
                  </Button>
                  <Button
                    variant="secondary"
                    isLoading={actionLoading === "pin"}
                    onClick={() => runAction("pin", () => adminApi.pinOperation(operationKey, !detail.pinned))}
                  >
                    <Flag size={16} /> {detail.pinned ? "Unpin" : "Pin"}
                  </Button>
                  <Button to={detail.resolutionRoute} variant="dark">
                    <ArrowUpRight size={16} /> {detail.resolutionLabel}
                  </Button>
                </div>

                <div className="flex flex-wrap items-end gap-2">
                  <div>
                    <label className="text-xs font-bold uppercase text-slate-400" htmlFor="assignee-select">
                      Assign / Escalate to
                    </label>
                    <select
                      id="assignee-select"
                      className="mt-1 block rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                      value={assigneeId}
                      onChange={(e) => setAssigneeId(e.target.value)}
                    >
                      <option value="">Select admin…</option>
                      {admins.map((a) => (
                        <option key={a._id} value={a._id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button
                    variant="secondary"
                    disabled={!assigneeId}
                    isLoading={actionLoading === "assign"}
                    onClick={() => runAction("assign", () => adminApi.assignOperation(operationKey, assigneeId))}
                  >
                    Assign
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={!assigneeId}
                    isLoading={actionLoading === "escalate"}
                    onClick={() => runAction("escalate", () => adminApi.escalateOperation(operationKey, assigneeId, note))}
                  >
                    Escalate
                  </Button>
                </div>

                <div>
                  <label className="text-xs font-bold uppercase text-slate-400" htmlFor="resolution-note">
                    Note
                  </label>
                  <textarea
                    id="resolution-note"
                    className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm"
                    rows={2}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Optional note for resolve/cancel/escalate"
                  />
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    isLoading={actionLoading === "resolve"}
                    onClick={() => runAction("resolve", () => adminApi.resolveOperation(operationKey, note))}
                  >
                    <CheckCircle2 size={16} /> Mark Resolved
                  </Button>
                  <Button
                    variant="secondary"
                    isLoading={actionLoading === "cancel"}
                    onClick={() => runAction("cancel", () => adminApi.cancelOperation(operationKey, note))}
                  >
                    <XCircle size={16} /> Cancel
                  </Button>
                </div>
              </section>

              {/* Timeline */}
              <section>
                <p className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-[0.15em] text-slate-500">
                  <Clock size={14} /> Timeline
                </p>
                {detail.timeline?.length ? (
                  <ol className="space-y-2 border-l-2 border-slate-200 pl-4">
                    {[...detail.timeline].reverse().map((event, idx) => (
                      <li key={idx} className="text-sm">
                        <p className="font-semibold text-slate-800">
                          {event.action}
                          {event.actorId?.name ? ` — ${event.actorId.name}` : ""}
                        </p>
                        {event.note && <p className="text-slate-600">{event.note}</p>}
                        <p className="text-xs text-slate-400">{new Date(event.at).toLocaleString()}</p>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-slate-500">No lifecycle events yet — this item is still open and unassigned.</p>
                )}
              </section>

              {/* Audit (Phase UI-11, Part B/U) — AdminActivityLog is the
                  platform's real, existing audit system (writeAdminLog);
                  getOperationDetail already fetches the last 20 entries
                  scoped to this record's sourceId, but no page ever
                  rendered them. This is distinct from Timeline above:
                  Timeline is the OperationAssignment lifecycle (claim/
                  assign/escalate/resolve on the queue overlay), Audit is
                  the platform-wide admin-action log for the underlying
                  record. No new audit system, no duplicate query — same
                  data the controller already returns. */}
              <section>
                <p className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-[0.15em] text-slate-500">
                  <ShieldCheck size={14} /> Audit
                </p>
                {detail.activityLog?.length ? (
                  <ol className="space-y-2 border-l-2 border-slate-200 pl-4">
                    {detail.activityLog.map((entry, idx) => (
                      <li key={entry._id || idx} className="text-sm">
                        <p className="font-semibold text-slate-800">
                          {entry.action}
                          {entry.severity && (
                            <span
                              className={`ml-2 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase ${
                                entry.severity === "critical" || entry.severity === "high"
                                  ? "border-rose-200 bg-rose-50 text-rose-700"
                                  : "border-slate-200 bg-slate-50 text-slate-500"
                              }`}
                            >
                              {entry.severity}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-slate-400">{new Date(entry.createdAt).toLocaleString()}</p>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-slate-500">No platform audit entries recorded against this record yet.</p>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default OperationsWorkspaceDrawer;
