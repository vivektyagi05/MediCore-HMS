import { useCallback, useEffect, useState } from "react";
import { useFinancialSync } from "../../hooks/useFinancialSync";

import { withdrawalAdminApi } from "../../api/withdrawalApi";
import { getApiErrorMessage } from "../../api/axios";
import Card from "../../components/ui/Card";
import SectionHeader from "../../components/ui/SectionHeader";
import Button from "../../components/ui/Button";
import Badge from "../../components/ui/Badge";
import Select from "../../components/ui/Select";
import Skeleton from "../../components/shared/Skeleton";
import EmptyState from "../../components/shared/EmptyState";
import ErrorState from "../../components/shared/ErrorState";
import ReasonDialog from "../../components/ui/ReasonDialog";
import { useToast } from "../../context/ToastContext";

import { useLatestRequest } from "../../hooks/useLatestRequest";
const money = (value) => `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const STATUS_TONE = {
  requested: "info",
  reserved: "info",
  processing: "warning",
  manual_pending: "warning",
  manual_completed: "success",
  completed: "success",
  failed: "danger",
  retry_required: "warning",
  reconciliation_required: "warning",
  cancelled: "neutral",
};

const STATUS_LABEL = {
  requested: "Requested",
  reserved: "Reserved",
  processing: "Processing",
  manual_pending: "Manual settlement pending",
  manual_completed: "Manually settled (not a verified bank transfer)",
  completed: "Completed (legacy record)",
  failed: "Failed",
  retry_required: "Retry required",
  reconciliation_required: "Reconciliation required",
  cancelled: "Cancelled",
};

// P23 Section 28 — "No arbitrary status dropdown. Use valid state
// transitions only." Mirrors backend/payments/withdrawalStateMachine.js's
// WITHDRAWAL_TRANSITIONS exactly (duplicated here only as a UI-gating
// list, never as a second source of truth for what the backend actually
// allows — every button still calls a specific transition endpoint that
// re-validates server-side).
const ACTIONS_BY_STATUS = {
  reserved: [{ label: "Approve for manual settlement", to: "manual_pending", api: "markProcessing" }],
  manual_pending: [
    { label: "Record manual settlement", to: "manual_completed", api: "complete", needsSettlement: true },
    { label: "Mark failed", to: "failed", api: "fail", needsReason: true },
  ],
  processing: [
    { label: "Record manual settlement", to: "manual_completed", api: "complete", needsSettlement: true },
    { label: "Mark failed", to: "failed", api: "fail", needsReason: true },
  ],
  failed: [{ label: "Flag for retry", to: "retry_required", api: "retry" }],
  retry_required: [{ label: "Approve for manual settlement", to: "manual_pending", api: "markProcessing" }],
  reconciliation_required: [
    { label: "Record manual settlement", to: "manual_completed", api: "complete", needsSettlement: true },
    { label: "Mark failed", to: "failed", api: "fail", needsReason: true },
  ],
  requested: [{ label: "Cancel", to: "cancelled", api: "cancel" }],
};

function AdminWithdrawals() {
  const toast = useToast();
  const [withdrawals, setWithdrawals] = useState([]);
  const [pagination, setPagination] = useState(null);
  const [status, setStatus] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actingId, setActingId] = useState(null);
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(null); // { withdrawal, action }

  const begin = useLatestRequest();
  const load = useCallback(async () => {
    const isCurrent = begin(); // status filter / page changed again while this was in flight: drop the stale response
    setIsLoading(true);
    setLoadError("");
    try {
      const params = { pageSize: 25, page };
      if (status) params.status = status;
      const res = await withdrawalAdminApi.list(params);
      if (!isCurrent()) return;
      setWithdrawals(res.data?.withdrawals || []);
      setPagination(res.data?.pagination || null);
    } catch (error) {
      if (isCurrent()) setLoadError(getApiErrorMessage(error));
    } finally {
      if (isCurrent()) setIsLoading(false);
    }
  }, [begin, status, page]);

  useFinancialSync(load);
  useEffect(() => { load(); }, [load]);

  // Actions that need an external reference or a reason open a validated dialog (no window.prompt: it cannot validate,
  // cannot show the server's error, and a cancelled prompt silently looked like success). Others run directly.
  const perform = async (withdrawal, action, payload = {}) => {
    setActingId(withdrawal._id);
    try {
      await withdrawalAdminApi[action.api](withdrawal._id, payload);
      toast.success(`Withdrawal recorded as: ${STATUS_LABEL[action.to] || action.to}.`);
      load();
    } finally {
      setActingId(null);
    }
  };
  const runAction = (withdrawal, action) => {
    if (action.needsSettlement || action.needsReason) { setDialog({ withdrawal, action }); return; }
    perform(withdrawal, action).catch((error) => { toast.error(getApiErrorMessage(error)); load(); });
  };
  const dialogFields = dialog?.action.needsSettlement
    ? [
        { name: "settlementReference", label: "Settlement reference (bank / UTR)", min: 4, max: 120, helperText: "This records that you moved the money outside MediCore." },
        { name: "reason", label: "Reason / note for the audit trail", min: 5, max: 300, multiline: true },
      ]
    : [{ name: "reason", label: "Reason for marking this withdrawal failed", min: 5, max: 300, multiline: true }];

  return (
    <div className="space-y-6">
      <SectionHeader title="Withdrawals" description="Doctor withdrawal requests — every action here is a real, valid state transition." />

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <Select label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            {Object.keys(STATUS_LABEL).map((key) => (
              <option key={key} value={key}>{STATUS_LABEL[key]}</option>
            ))}
          </Select>
        </div>
      </Card>

      <Card>
        {isLoading ? (
          <Skeleton rows={4} />
        ) : loadError ? (
          <ErrorState title="Couldn't load withdrawals" description={loadError} onRetry={load} />
        ) : !withdrawals.length ? (
          <EmptyState title="No withdrawals" description="No doctor withdrawal requests match this filter." />
        ) : (
          <div className="divide-y divide-slate-100">
            {withdrawals.map((w) => (
              <div key={w._id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="text-sm font-bold text-slate-900">
                    {w.doctorId?.userId?.name || "Doctor"} · {money(w.requestedAmount)}
                  </p>
                  <p className="text-xs text-slate-500">
                    {w.destinationLabel} · Requested {new Date(w.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
                  </p>
                  {w.status === "manual_completed" && (
                    <p className="mt-1 text-xs text-slate-500">Manual settlement ref: {w.settlementReference} — recorded by an admin; not a provider-confirmed transfer.</p>
                  )}
                  {w.failureReason && <p className="mt-1 text-xs font-semibold text-rose-600">{w.failureReason}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={STATUS_TONE[w.status] || "neutral"}>{STATUS_LABEL[w.status] || w.status}</Badge>
                  {(ACTIONS_BY_STATUS[w.status] || []).map((action) => (
                    <Button
                      key={action.to}
                      size="sm"
                      variant="secondary"
                      isLoading={actingId === w._id}
                      onClick={() => runAction(w, action)}
                    >
                      {action.label}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {pagination && pagination.total > 0 && (
          <div className="mt-3 flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>{pagination.total} total withdrawal request(s) · page {pagination.page || page} of {pagination.totalPages || pagination.pages || 1}</span>
            <span className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={page <= 1 || isLoading} onClick={() => setPage((p) => Math.max(p - 1, 1))}>Previous</Button>
              <Button size="sm" variant="secondary" disabled={isLoading || page >= (pagination.totalPages || pagination.pages || 1)} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </span>
          </div>
        )}
      </Card>

      <ReasonDialog
        isOpen={Boolean(dialog)}
        title={dialog?.action.label}
        description={dialog ? `${dialog.withdrawal.doctorId?.userId?.name || "Doctor"} · ${money(dialog.withdrawal.requestedAmount)}. This is recorded in the audit trail.` : ""}
        fields={dialogFields}
        confirmLabel={dialog?.action.label || "Confirm"}
        tone={dialog?.action.needsReason ? "danger" : "primary"}
        onClose={() => setDialog(null)}
        onSubmit={async (values) => {
          try {
            await perform(dialog.withdrawal, dialog.action, values);
            setDialog(null);
          } catch (error) {
            load(); // the row may have changed under us (409): show the truth behind the dialog
            throw error;
          }
        }}
      />
    </div>
  );
}

export default AdminWithdrawals;
