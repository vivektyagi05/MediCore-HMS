import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, RefreshCcw } from "lucide-react";
import { adminApi } from "../../api/adminApi";
import { monitoringApi } from "../../api/monitoringApi";
import Card from "../../components/ui/Card";
import Button from "../../components/ui/Button";
import Loader from "../../components/ui/Loader";
import EmptyState from "../../components/shared/EmptyState";

// ─────────────────────────────────────────────────────────────────────────
// Phase UI-10, Section 7 — Operational Attention.
//
// This is the one piece of Section 7 that genuinely did not exist anywhere
// on the platform: Smart Alerts (missionControlAdminController.buildSmartAlerts),
// Assignment Conflicts (assignmentEngine.detectConflicts), and Monitoring's
// automation Failures + Payment Retry/Dead-Letter queue
// (monitoringAggregates.buildFailureIntelligence / buildPaymentRetryQueue)
// live on four separate pages today with no shared view. Nothing here
// recalculates any of them — this component only fetches all four (in
// parallel, partial-failure safe) and renders them as one severity-ranked
// list. Every item links to the real page/record that produced it; nothing
// is clickable unless it is backed by a real destination.
// ─────────────────────────────────────────────────────────────────────────

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, warning: 2, low: 3 };
const SEVERITY_STYLES = {
  critical: "border-rose-200 bg-rose-50 text-rose-800",
  high: "border-amber-200 bg-amber-50 text-amber-800",
  medium: "border-blue-200 bg-blue-50 text-blue-800",
  warning: "border-blue-200 bg-blue-50 text-blue-800",
  low: "border-slate-200 bg-slate-50 text-slate-700",
};

function normalizeSeverity(raw) {
  const s = (raw || "").toLowerCase();
  if (s === "warning") return "medium";
  if (SEVERITY_ORDER[s] !== undefined) return s;
  return "low";
}

function OperationalAttentionPanel({ onInvestigate }) {
  const [state, setState] = useState({ isLoading: true, items: [], sourceErrors: [] });

  const load = async () => {
    setState((s) => ({ ...s, isLoading: true }));

    const [alertsRes, conflictsRes, failuresRes, retryRes] = await Promise.allSettled([
      adminApi.getSmartAlerts(),
      adminApi.getAssignmentConflicts(),
      monitoringApi.getFailures(),
      monitoringApi.getRetryQueue(),
    ]);

    const items = [];
    const sourceErrors = [];

    // Smart Alerts — real, condition-based platform alerts.
    if (alertsRes.status === "fulfilled") {
      for (const a of alertsRes.value.data?.alerts || []) {
        items.push({
          id: `alert:${a.key}`,
          source: "Platform Alert",
          severity: normalizeSeverity(a.priority),
          title: a.title,
          detail: `${a.count} affected`,
          link: a.link,
          investigable: false,
        });
      }
    } else {
      sourceErrors.push("Platform Alerts");
    }

    // Assignment Conflicts — real scheduling/workload conflicts.
    if (conflictsRes.status === "fulfilled") {
      const conflicts = conflictsRes.value.data?.conflicts || conflictsRes.value.data || [];
      for (const c of Array.isArray(conflicts) ? conflicts : []) {
        const opKey = c.operationKey || (Array.isArray(c.operationKeys) ? c.operationKeys[0] : null);
        items.push({
          id: `conflict:${c.type}:${opKey || c.description}`,
          source: "Assignment Conflict",
          severity: normalizeSeverity(c.severity),
          title: c.description || c.type,
          detail: c.type,
          link: "/admin/smart-assignment",
          operationKey: opKey || null,
          investigable: Boolean(opKey),
        });
      }
    } else {
      sourceErrors.push("Assignment Conflicts");
    }

    // Automation Failures — real AutomationRunLog aggregates.
    if (failuresRes.status === "fulfilled") {
      const f = failuresRes.value.data;
      if (f?.totalFailures > 0) {
        items.push({
          id: "monitoring:failures",
          source: "Automation Health",
          severity: f.totalFailures >= 10 ? "critical" : f.totalFailures >= 3 ? "high" : "medium",
          title: `${f.totalFailures} automation failure(s) in the last ${f.rangeDays} days`,
          detail: f.byTriggerType?.[0]?.triggerLabel ? `Most common: ${f.byTriggerType[0].triggerLabel}` : undefined,
          link: "/admin/monitoring",
          investigable: false,
        });
      }
    } else {
      sourceErrors.push("Automation Failures");
    }

    // Payment Retry / Dead-Letter Queue — real, keyed by Payment._id, which
    // is the same sourceId the payment_failure operation type uses — this
    // is what makes the Incident Investigation correlation possible below.
    if (retryRes.status === "fulfilled") {
      const r = retryRes.value.data;
      if (r?.deadLetterCount > 0) {
        items.push({
          id: "monitoring:dead-letter",
          source: "Payment Retry Queue",
          severity: "critical",
          title: `${r.deadLetterCount} payment(s) exhausted all retries (dead-letter)`,
          detail: "Needs manual review — link to the matching operation to investigate",
          link: "/admin/monitoring",
          operationKey: r.deadLetter[0] ? `payment_failure:${r.deadLetter[0]._id}` : null,
          investigable: Boolean(r.deadLetter[0]),
        });
      }
      if (r?.inRetryWindowCount > 0) {
        items.push({
          id: "monitoring:in-retry",
          source: "Payment Retry Queue",
          severity: "medium",
          title: `${r.inRetryWindowCount} payment(s) currently retrying`,
          detail: "Automatic — no action needed unless they reach dead-letter",
          link: "/admin/monitoring",
          investigable: false,
        });
      }
    } else {
      sourceErrors.push("Payment Retry Queue");
    }

    items.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));

    setState({ isLoading: false, items, sourceErrors });
  };

  useEffect(() => {
    load();
  }, []);

  if (state.isLoading) return <Loader label="Loading operational attention" />;

  return (
    <div className="space-y-4">
      {state.sourceErrors.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800">
          {state.sourceErrors.join(", ")} unavailable right now — showing the rest of the feed.{" "}
          <button type="button" className="underline" onClick={load}>
            Retry
          </button>
        </div>
      )}

      <div className="flex items-center justify-end">
        <Button variant="secondary" size="sm" onClick={load}>
          <RefreshCcw size={14} /> Refresh
        </Button>
      </div>

      {state.items.length === 0 ? (
        <EmptyState title="No attention items" description="Platform alerts, assignment conflicts, automation failures, and the payment retry queue are all clear." />
      ) : (
        <Card title={`Operational Attention (${state.items.length})`}>
          <div className="space-y-2">
            {state.items.map((item) => (
              <div key={item.id} className={`flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-start sm:justify-between ${SEVERITY_STYLES[item.severity]}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={14} className="shrink-0" />
                    <span className="rounded-full border border-current/20 bg-white/60 px-2 py-0.5 text-[11px] font-black uppercase tracking-wide">
                      {item.severity}
                    </span>
                    <span className="text-[11px] font-bold uppercase tracking-wide opacity-70">{item.source}</span>
                  </div>
                  <p className="mt-1.5 break-words text-sm font-bold">{item.title}</p>
                  {item.detail && <p className="mt-0.5 break-words text-xs opacity-80">{item.detail}</p>}
                </div>
                <div className="flex shrink-0 flex-row gap-2 sm:flex-col sm:items-end">
                  {item.investigable && item.operationKey && (
                    <Button size="sm" variant="dark" onClick={() => onInvestigate(item.operationKey)}>
                      Investigate <ArrowRight size={14} />
                    </Button>
                  )}
                  {item.link && (
                    <Button size="sm" variant="secondary" to={item.link}>
                      Open
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

export default OperationalAttentionPanel;
