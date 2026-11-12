import { useCallback, useEffect, useState } from "react";
import { adminApi } from "../../api/adminApi";
import { getApiErrorMessage } from "../../api/axios";
import EmptyState from "../shared/EmptyState";
import ErrorState from "../shared/ErrorState";
import Button from "../ui/Button";
import Card from "../ui/Card";
import ReasonDialog from "../ui/ReasonDialog";
import Loader from "../ui/Loader";
import Select from "../ui/Select";
import StatusBadge from "../ui/StatusBadge";
import { useToast } from "../../context/ToastContext";

const TONE = { open: "warning", acknowledged: "info", resolved: "success", dismissed: "neutral" };
const inr = (v) => `₹${Number(v || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

// Doctors can ASK for a review of a refund that reduced their earning. This list is that queue. A decision here is
// recorded and audited; it never refunds, reverses or pays anything (use the refund workspace for that).
function DoctorRefundReviews({ onViewPayment }) {
  const toast = useToast();
  const [status, setStatus] = useState("open");
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [decision, setDecision] = useState(null); // { id, action }

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError("");
    try {
      const res = await adminApi.getDoctorRefundReviewsAdmin({ page, limit: 10, ...(status ? { status } : {}) });
      setData(res.data);
    } catch (error) {
      setLoadError(getApiErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  }, [status, page]);
  useEffect(() => { load(); }, [load]);

  const submit = async ({ note }) => {
    try {
      await adminApi.resolveDoctorRefundReviewAdmin(decision.id, { action: decision.action, note });
      toast.success("Review updated");
      setDecision(null);
      await load();
    } catch (error) {
      await load(); // a 409 means someone else already answered: show the current state behind the dialog
      throw new Error(getApiErrorMessage(error), { cause: error });
    }
  };

  const pages = data?.pagination?.pages || 1;
  return (
    <Card title="Doctor review requests">
      <p className="mb-3 text-xs font-semibold text-slate-500">Doctors asking an administrator to look at a refund that reduced their earning. Deciding here records an answer only; it moves no money.</p>
      <div className="mb-3 w-full max-w-xs">
        <Select label="Status" name="review-status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All</option><option value="open">Open</option><option value="acknowledged">Acknowledged</option>
          <option value="resolved">Resolved</option><option value="dismissed">Dismissed</option>
        </Select>
      </div>
      {isLoading ? <Loader label="Loading review requests" /> : loadError ? <ErrorState description={loadError} onRetry={load} /> : !data?.reviews.length ? (
        <EmptyState title="No review requests" description={status ? `No ${status} requests.` : "Doctors have not raised any."} />
      ) : (
        <div className="space-y-2">
          {data.reviews.map((r) => (
            <div key={r._id} className="rounded-card border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-bold text-slate-900">{r.reason}</p>
                <StatusBadge tone={TONE[r.status] || "neutral"}>{r.status}</StatusBadge>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Refunded {inr(r.snapshot?.refundedAmount)} · doctor earning reduced by {inr(r.snapshot?.doctorAdjustment)} · payout {r.snapshot?.payoutStatus || "—"} · {new Date(r.createdAt).toLocaleString()}
              </p>
              {r.adminNote && <p className="mt-1 text-xs font-semibold text-slate-600">Note: {r.adminNote}</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                {onViewPayment && <Button variant="tertiary" size="sm" onClick={() => onViewPayment(r.paymentId)}>Open payment</Button>}
                {r.status === "open" && <Button variant="secondary" size="sm" onClick={() => setDecision({ id: r._id, action: "acknowledge" })}>Acknowledge</Button>}
                {["open", "acknowledged"].includes(r.status) && (
                  <>
                    <Button variant="secondary" size="sm" onClick={() => setDecision({ id: r._id, action: "resolve" })}>Resolve</Button>
                    <Button variant="tertiary" size="sm" onClick={() => setDecision({ id: r._id, action: "dismiss" })}>Dismiss</Button>
                  </>
                )}
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between pt-2 text-sm">
            <span className="text-slate-500">Page {page} of {pages} · {data.pagination.total} requests</span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
              <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
            </div>
          </div>
        </div>
      )}
      <ReasonDialog
        isOpen={Boolean(decision)}
        title={decision ? `${decision.action[0].toUpperCase()}${decision.action.slice(1)} this request` : ""}
        description="The doctor sees your note. This records an answer only; no refund, reversal or payout changes."
        fields={[{ name: "note", label: "Note to the doctor", min: 5, max: 500, multiline: true }]}
        confirmLabel="Confirm"
        tone={decision?.action === "dismiss" ? "danger" : "primary"}
        onClose={() => setDecision(null)}
        onSubmit={submit}
      />
    </Card>
  );
}

export default DoctorRefundReviews;
