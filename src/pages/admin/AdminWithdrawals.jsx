import { useCallback, useEffect, useState } from "react";

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
import { useToast } from "../../context/ToastContext";

const money = (value) => `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const STATUS_TONE = {
  requested: "info",
  reserved: "info",
  processing: "warning",
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
  completed: "Completed",
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
  reserved: [{ label: "Mark processing", to: "processing", api: "markProcessing" }],
  processing: [
    { label: "Mark completed", to: "completed", api: "complete" },
    { label: "Mark failed", to: "failed", api: "fail" },
  ],
  failed: [{ label: "Flag for retry", to: "retry_required", api: "retry" }],
  retry_required: [{ label: "Reserve again", to: "processing", api: "markProcessing" }],
  reconciliation_required: [
    { label: "Mark completed", to: "completed", api: "complete" },
    { label: "Mark failed", to: "failed", api: "fail" },
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

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError("");
    try {
      const params = { pageSize: 25 };
      if (status) params.status = status;
      const res = await withdrawalAdminApi.list(params);
      setWithdrawals(res.data?.withdrawals || []);
      setPagination(res.data?.pagination || null);
    } catch (error) {
      setLoadError(getApiErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, [status]);

  useEffect(() => { load(); }, [load]);

  const runAction = async (withdrawal, action) => {
    setActingId(withdrawal._id);
    try {
      await withdrawalAdminApi[action.api](withdrawal._id, {});
      toast.success(`Withdrawal moved to ${STATUS_LABEL[action.to] || action.to}.`);
      load();
    } catch (error) {
      toast.error(getApiErrorMessage(error));
    } finally {
      setActingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader title="Withdrawals" description="Doctor withdrawal requests — every action here is a real, valid state transition." />

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
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
          <p className="mt-3 text-xs font-semibold text-slate-400">{pagination.total} total withdrawal request(s)</p>
        )}
      </Card>
    </div>
  );
}

export default AdminWithdrawals;
