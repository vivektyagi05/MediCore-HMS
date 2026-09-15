import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Clock,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import { processGovernanceApi } from "../../api/processGovernanceApi";
import { getApiErrorMessage } from "../../api/axios";
import { useToast } from "../../context/ToastContext";
import { useRealtime } from "../../context/RealtimeContext";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import Loader from "../../components/ui/Loader";
import Badge from "../../components/ui/Badge";
import Modal from "../../components/ui/Modal";
import EmptyState from "../../components/shared/EmptyState";
import ErrorState from "../../components/shared/ErrorState";
import SettingsTabs from "../../components/settings/SettingsTabs";

// ─────────────────────────────────────────────────────────────────────────
// Phase A6.3.5 — Process Governance, Compliance & Enterprise Control
// Intelligence. One connected hub, same posture as every prior Process
// surface (Designer/Analytics/Orchestrator) — not ten separate routes.
// Every number/control status here comes from
// process-governance/processGovernanceEngine.js via processGovernanceApi;
// nothing here recomputes a policy decision client-side (Section 4/14:
// "Frontend should display backend decisions").
// ─────────────────────────────────────────────────────────────────────────

const HEALTH_TONE = { Healthy: "success", Attention: "warning", "At Risk": "danger", Critical: "danger" };
const RISK_TONE = { low: "neutral", medium: "info", high: "warning", critical: "danger" };
const CONTROL_TONE = { PASS: "success", FAIL: "danger", WARNING: "warning", NOT_CONFIGURED: "neutral", NOT_APPLICABLE: "neutral" };

function StatTile({ label, value, icon: Icon, tone = "neutral" }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white/60 p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p>
        {Icon && <Icon size={16} className="text-slate-400" />}
      </div>
      <p className={`mt-1 text-2xl font-black ${tone === "danger" ? "text-rose-600" : tone === "warning" ? "text-amber-600" : tone === "success" ? "text-emerald-600" : "text-slate-950"}`}>{value}</p>
    </div>
  );
}

function ControlRow({ control }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 py-2.5 last:border-0">
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm font-bold text-slate-950">{control.control}</p>
        <p className="break-words text-xs text-slate-500">{control.evidence}</p>
      </div>
      <Badge tone={CONTROL_TONE[control.status] || "neutral"}>{control.status.replace(/_/g, " ")}</Badge>
    </div>
  );
}

function AdminProcessGovernance() {
  const toast = useToast();
  const { dashboardSyncTick } = useRealtime();
  const [tab, setTab] = useState("overview");

  const [overview, setOverview] = useState(null);
  const [loadingOverview, setLoadingOverview] = useState(true);

  const [queue, setQueue] = useState([]);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [queueError, setQueueError] = useState(false);
  const [queuePagination, setQueuePagination] = useState(null);
  const [queuePage, setQueuePage] = useState(1);

  const [complianceFilter, setComplianceFilter] = useState("all");
  const [complianceRows, setComplianceRows] = useState([]);
  const [loadingCompliance, setLoadingCompliance] = useState(true);
  const [complianceError, setComplianceError] = useState(false);
  const [compliancePagination, setCompliancePagination] = useState(null);
  const [compliancePage, setCompliancePage] = useState(1);

  const [exceptions, setExceptions] = useState(null);
  const [loadingExceptions, setLoadingExceptions] = useState(true);

  const [detail, setDetail] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [decisionModal, setDecisionModal] = useState(null); // { id, action }
  const [decisionNote, setDecisionNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiExplain, setAiExplain] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);

  useEffect(() => {
    loadOverview();
    loadQueue();
    loadExceptions();
  }, [dashboardSyncTick, queuePage]);

  // A filter change invalidates the current compliance page — back to page 1
  // (same reset-on-filter-change pattern as AdminOperationsCenter.jsx, UI-10).
  useEffect(() => {
    setCompliancePage(1);
  }, [complianceFilter]);

  useEffect(() => {
    loadCompliance(complianceFilter);
  }, [complianceFilter, compliancePage, dashboardSyncTick]);

  async function loadOverview() {
    try {
      const res = await processGovernanceApi.getOverview();
      setOverview(res.data);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setLoadingOverview(false);
    }
  }

  async function loadQueue() {
    setLoadingQueue(true);
    setQueueError(false);
    try {
      const res = await processGovernanceApi.getApprovalQueue({ page: queuePage, pageSize: 20 });
      setQueue(res.data || []);
      setQueuePagination(res.meta || null);
    } catch (err) {
      setQueueError(true);
      toast.error(getApiErrorMessage(err));
    } finally {
      setLoadingQueue(false);
    }
  }

  async function loadCompliance(filter) {
    setLoadingCompliance(true);
    setComplianceError(false);
    try {
      const res = await processGovernanceApi.getComplianceMatrix(filter, { page: compliancePage, pageSize: 20 });
      setComplianceRows(res.data || []);
      setCompliancePagination(res.meta || null);
    } catch (err) {
      setComplianceError(true);
      toast.error(getApiErrorMessage(err));
    } finally {
      setLoadingCompliance(false);
    }
  }

  async function loadExceptions() {
    try {
      const res = await processGovernanceApi.getExceptions();
      setExceptions(res.data);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setLoadingExceptions(false);
    }
  }

  async function openDetail(id) {
    setLoadingDetail(true);
    setAiExplain(null);
    setTab("detail");
    try {
      const [gov, tl] = await Promise.all([
        processGovernanceApi.getProcessGovernance(id),
        processGovernanceApi.getAuditTimeline(id),
      ]);
      setDetail(gov.data);
      setTimeline(tl.data || []);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setLoadingDetail(false);
    }
  }

  async function refreshDetail() {
    if (detail?.process?._id) await openDetail(detail.process._id);
  }

  async function runAction(fn, successMsg) {
    setBusy(true);
    try {
      await fn();
      toast.success(successMsg);
      await Promise.all([loadOverview(), loadQueue(), refreshDetail()]);
      setDecisionModal(null);
      setDecisionNote("");
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function loadAiExplain() {
    if (!detail?.process?._id) return;
    setAiLoading(true);
    try {
      const res = await processGovernanceApi.explainGovernance(detail.process._id);
      setAiExplain(res.data);
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setAiLoading(false);
    }
  }

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "queue", label: `Approval Queue${queuePagination?.total ? ` (${queuePagination.total})` : ""}` },
    { id: "compliance", label: "Compliance Matrix" },
    { id: "exceptions", label: "Exceptions" },
    { id: "detail", label: "Process Detail" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-950">Process Governance</h1>
          <p className="text-sm text-slate-500">Approval, compliance, and audit control across the process lifecycle.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" to="/admin/process-designer">Process Designer</Button>
          <Button variant="secondary" to="/admin/process-analytics">Process Analytics</Button>
        </div>
      </div>

      <SettingsTabs activeTab={tab} onChange={setTab} tabs={tabs} />

      {tab === "overview" && (
        loadingOverview ? <Loader label="Loading governance overview" /> : overview && (
          <div className="space-y-4">
            <Card title="Governance Health" action={<Badge tone={HEALTH_TONE[overview.governanceHealth] || "neutral"}>{overview.governanceHealth}</Badge>}>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatTile label="Governed Processes" value={overview.kpis.governedProcesses} icon={ShieldCheck} />
                <StatTile label="Pending Approval" value={overview.kpis.pendingApproval} icon={Clock} tone={overview.kpis.pendingApproval ? "warning" : "neutral"} />
                <StatTile label="High Risk" value={overview.kpis.highRiskProcesses} icon={AlertTriangle} tone={overview.kpis.highRiskProcesses ? "warning" : "neutral"} />
                <StatTile label="Violations" value={overview.kpis.governanceViolations} icon={XCircle} tone={overview.kpis.governanceViolations ? "danger" : "neutral"} />
                <StatTile label="Review Due" value={overview.kpis.reviewDue} icon={Clock} />
                <StatTile label="Active Exceptions" value={overview.kpis.activeExceptions} icon={ShieldAlert} tone={overview.kpis.activeExceptions ? "warning" : "neutral"} />
                <StatTile label="Total Processes" value={overview.kpis.totalProcesses} />
              </div>
            </Card>
          </div>
        )
      )}

      {tab === "queue" && (
        loadingQueue ? <Loader label="Loading approval queue" /> : queueError ? (
          <ErrorState description="We couldn't load the approval queue." onRetry={loadQueue} />
        ) : (
          queue.length === 0 ? (
            <EmptyState title="Nothing pending approval" description="No process is currently waiting on a governance decision." />
          ) : (
            <Card title="Approval Queue">
              <div className="space-y-3">
                {queue.map((item) => (
                  <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white/60 p-4">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-950">{item.name} <span className="text-slate-400">v{item.version}</span></p>
                      <p className="mt-0.5 line-clamp-2 break-words text-xs text-slate-500">{item.submittedReason || "No reason given"}</p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {item.requiredControls.map((c) => <Badge key={c} tone="neutral">{c}</Badge>)}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge tone={RISK_TONE[item.riskLevel] || "neutral"}>{item.riskLevel} risk</Badge>
                      <Button variant="secondary" onClick={() => openDetail(item.id)}>Review</Button>
                    </div>
                  </div>
                ))}
              </div>
              {queuePagination && queuePagination.totalPages > 1 && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
                  <p className="text-xs text-slate-500">
                    Page {queuePagination.page} of {queuePagination.totalPages} · {queuePagination.total} pending
                  </p>
                  <div className="flex gap-2">
                    <Button variant="secondary" disabled={!queuePagination.hasPrevious} onClick={() => setQueuePage((p) => p - 1)}>← Prev</Button>
                    <Button variant="secondary" disabled={!queuePagination.hasNext} onClick={() => setQueuePage((p) => p + 1)}>Next →</Button>
                  </div>
                </div>
              )}
            </Card>
          )
        )
      )}

      {tab === "compliance" && (
        <Card
          title="Compliance Matrix"
          action={
            <select
              value={complianceFilter}
              onChange={(e) => setComplianceFilter(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-semibold"
            >
              <option value="all">All</option>
              <option value="compliant">Compliant</option>
              <option value="attention">Attention</option>
              <option value="failed">Failed</option>
              <option value="high_risk">High Risk</option>
            </select>
          }
        >
          {loadingCompliance ? (
            <Loader label="Loading compliance matrix" />
          ) : complianceError ? (
            <ErrorState description="We couldn't load the compliance matrix." onRetry={() => loadCompliance(complianceFilter)} />
          ) : complianceRows.length === 0 ? (
            <EmptyState title="No processes match this filter" />
          ) : (
            <>
              <div className="space-y-3">
                {complianceRows.map((row) => (
                  <div key={row.id} className="rounded-xl border border-slate-200 bg-white/60 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-sm font-bold text-slate-950">{row.name} <span className="text-slate-400">v{row.version}</span></p>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge tone={RISK_TONE[row.riskLevel] || "neutral"}>{row.riskLevel} risk</Badge>
                        <Badge tone={row.complianceState === "compliant" ? "success" : row.complianceState === "failed" ? "danger" : "warning"}>{row.complianceState}</Badge>
                        <Button variant="secondary" onClick={() => openDetail(row.id)}>Detail</Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {compliancePagination && compliancePagination.totalPages > 1 && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
                  <p className="text-xs text-slate-500">
                    Page {compliancePagination.page} of {compliancePagination.totalPages} · {compliancePagination.total} process{compliancePagination.total === 1 ? "" : "es"}
                  </p>
                  <div className="flex gap-2">
                    <Button variant="secondary" disabled={!compliancePagination.hasPrevious} onClick={() => setCompliancePage((p) => p - 1)}>← Prev</Button>
                    <Button variant="secondary" disabled={!compliancePagination.hasNext} onClick={() => setCompliancePage((p) => p + 1)}>Next →</Button>
                  </div>
                </div>
              )}
            </>
          )}
        </Card>
      )}

      {tab === "exceptions" && (
        loadingExceptions ? <Loader label="Loading exceptions" /> : exceptions && (
          <div className="space-y-4">
            <Card title="Governance Violations">
              {exceptions.violations.length === 0 ? (
                <EmptyState title="No live governance violations" description="Nothing currently fails a governance control." />
              ) : (
                <div className="space-y-2">
                  {exceptions.violations.map((v, i) => (
                    <div key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3">
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm font-bold text-slate-950">{v.processName}</p>
                        <p className="break-words text-xs text-slate-600">{v.detail}</p>
                      </div>
                      <Button variant="secondary" onClick={() => openDetail(v.processId)}>Review</Button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <Card title="Emergency Overrides">
              {exceptions.emergencyOverrides.length === 0 ? (
                <EmptyState title="No emergency overrides on record" />
              ) : (
                <div className="space-y-2">
                  {exceptions.emergencyOverrides.map((e, i) => (
                    <div key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm font-bold text-slate-950">{e.processName}</p>
                        <p className="break-words text-xs text-slate-600">{e.reason}</p>
                      </div>
                      <Badge tone={e.reviewedAt ? "success" : "warning"}>{e.reviewedAt ? "Reviewed" : "Review required"}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        )
      )}

      {tab === "detail" && (
        loadingDetail ? <Loader label="Loading process governance detail" /> : !detail ? (
          <EmptyState title="Select a process" description="Open a process from the Approval Queue or Compliance Matrix to see its governance detail." />
        ) : (
          <div className="space-y-4">
            <Card title={`${detail.process.name} — v${detail.process.version}`} action={<Badge tone={HEALTH_TONE[detail.health] || "neutral"}>{detail.health}</Badge>}>
              <div className="flex flex-wrap gap-2 text-sm">
                <Badge tone="neutral">{detail.process.status}</Badge>
                <Badge tone={RISK_TONE[detail.governance.riskLevel] || "neutral"}>{detail.governance.riskLevel} risk</Badge>
                {detail.governance.approvalRequired && <Badge tone="info">Approval required</Badge>}
                {detail.governance.segregationRequired && <Badge tone="violet">Segregation required</Badge>}
              </div>

              {detail.governance.blockers.length > 0 && (
                <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 p-3">
                  <p className="text-sm font-bold text-rose-700">Blocking issues</p>
                  <ul className="mt-1 list-disc pl-5 text-sm text-rose-700">
                    {detail.governance.blockers.map((b, i) => <li key={i}>{b}</li>)}
                  </ul>
                </div>
              )}

              <div className="mt-4 flex flex-wrap gap-2">
                {detail.process.status === "valid" && detail.governance.approvalRequired && (
                  <Button onClick={() => setDecisionModal({ id: detail.process._id, action: "submit-review" })}>Submit for Review</Button>
                )}
                {detail.process.status === "pending_approval" && (
                  <>
                    <Button onClick={() => runAction(() => processGovernanceApi.approve(detail.process._id, {}), "Process approved and published")} disabled={busy}>
                      Approve
                    </Button>
                    <Button variant="secondary" onClick={() => setDecisionModal({ id: detail.process._id, action: "reject" })}>Reject</Button>
                    <Button variant="secondary" onClick={() => setDecisionModal({ id: detail.process._id, action: "request-changes" })}>Request Changes</Button>
                  </>
                )}
                <Button variant="secondary" onClick={loadAiExplain} isLoading={aiLoading}>
                  <Sparkles size={15} /> AI Explain
                </Button>
              </div>

              {aiExplain && (
                <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-slate-700 break-words">{aiExplain.content?.summary}</div>
              )}
            </Card>

            <Card title="Compliance Control Matrix">
              {detail.governance.controls.map((c, i) => <ControlRow key={i} control={c} />)}
            </Card>

            <Card title="Audit Timeline">
              {timeline.length === 0 ? (
                <EmptyState title="No audit events yet" />
              ) : (
                <div className="space-y-2">
                  {timeline.map((e, i) => (
                    <div key={i} className="flex items-center justify-between border-b border-slate-100 py-2 text-sm last:border-0">
                      <span className="font-semibold text-slate-800">{e.action}</span>
                      <span className="text-xs text-slate-400">{new Date(e.timestamp).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        )
      )}

      <Modal isOpen={Boolean(decisionModal)} title={decisionModal?.action === "submit-review" ? "Submit for Review" : decisionModal?.action === "reject" ? "Reject" : "Request Changes"} onClose={() => setDecisionModal(null)}>
        <div className="space-y-3">
          <textarea
            className="w-full rounded-xl border border-slate-300 p-3 text-sm"
            rows={4}
            placeholder={decisionModal?.action === "submit-review" ? "Why is this ready for review?" : "Reason (required)"}
            value={decisionNote}
            onChange={(e) => setDecisionNote(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDecisionModal(null)}>Cancel</Button>
            <Button
              disabled={busy || (decisionModal?.action !== "submit-review" && !decisionNote.trim())}
              onClick={() => {
                if (!decisionModal) return;
                if (decisionModal.action === "submit-review") {
                  runAction(() => processGovernanceApi.submitForReview(decisionModal.id, decisionNote), "Submitted for governance review");
                } else if (decisionModal.action === "reject") {
                  runAction(() => processGovernanceApi.reject(decisionModal.id, decisionNote), "Process rejected");
                } else {
                  runAction(() => processGovernanceApi.requestChanges(decisionModal.id, decisionNote), "Changes requested");
                }
              }}
            >
              Confirm
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default AdminProcessGovernance;
