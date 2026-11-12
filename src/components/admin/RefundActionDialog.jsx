import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { refundApi } from "../../api/refundApi";
import { getApiErrorMessage } from "../../api/axios";
import Button from "../ui/Button";
import Modal from "../ui/Modal";
import Textarea from "../ui/Textarea";
import { useToast } from "../../context/ToastContext";

const formatCurrency = (amount, currency = "INR") =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: currency || "INR", maximumFractionDigits: 2 }).format(
    amount || 0,
  );

// One shared dialog for all three real refund mutations (approve, reject,
// retry) — brief section 13 requires the approval confirmation to state
// the actual amount and the real remaining-refundable balance rather than
// a generic "Are you sure?"; section 14 requires a real rejection reason
// to be captured, not just a status flip.
//
// `payment` needs totalAmount/refundedAmount/currency — callers pass
// whatever payment snapshot they already have (PaymentDetailWorkspace's
// `payment`, a registry row's populated `paymentId`, or RefundDetailWorkspace's
// `financialImpact`-bearing `payment`). Nothing here computes an amount
// that wasn't already sourced from the backend.
function RefundActionDialog({ refundRequest, payment, mode, onClose, onDone }) {
  const toast = useToast();
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(""); // shown inside the dialog: a toast vanishes, and the admin needs to read why a money action failed
  const [touched, setTouched] = useState(false);

  if (!refundRequest || !mode) return null;

  // Reason rules (same wording the patient sees later): required and meaningful when rejecting, optional when approving.
  const trimmedNote = note.trim();
  const noteProblem = mode === "reject"
    ? (!trimmedNote ? "A rejection reason is required" : trimmedNote.length < 5 ? `Give a reason of at least 5 characters (now ${trimmedNote.length})` : note.length > 500 ? "Keep the reason to 500 characters or fewer" : "")
    : mode === "approve" && note.length > 500 ? "Keep the note to 500 characters or fewer" : "";

  const currency = payment?.currency || "INR";
  const remainingAfterApproval = payment
    ? Number((payment.totalAmount - payment.refundedAmount - refundRequest.amount).toFixed(2))
    : null;

  const handleConfirm = async () => {
    setTouched(true);
    if (noteProblem || loading) return; // loading: a double click must never send a second money action
    setLoading(true);
    setError("");
    try {
      let res;
      if (mode === "approve") res = await refundApi.approveRequest(refundRequest._id, note ? { note } : {});
      else if (mode === "reject") res = await refundApi.rejectRequest(refundRequest._id, { note: note.trim() });
      else if (mode === "reconcile") res = await refundApi.reconcileRequest(refundRequest._id);
      else res = await refundApi.retryRequest(refundRequest._id);

      toast.success(
        res?.message ||
          (mode === "approve" ? "Refund processed successfully" : mode === "reject" ? "Refund request rejected" : mode === "reconcile" ? "Refund checked with the payment provider" : "Refund retried"),
      );
      setNote("");
      onDone?.();
    } catch (err) {
      const message = getApiErrorMessage(err) ||
        (mode === "approve"
          ? "Refund could not be processed. No refund was recorded."
          : mode === "reconcile"
            ? "The payment provider could not be queried. Try again shortly."
            : mode === "retry"
              ? "Refund retry failed. No refund was recorded."
              : "Refund request could not be rejected.");
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const title =
    mode === "approve" ? "Approve refund" : mode === "reject" ? "Reject refund request" : mode === "reconcile" ? "Check refund with provider" : "Retry refund";

  return (
    <Modal
      isOpen
      title={title}
      onClose={loading ? undefined : () => {
        setNote("");
        setError("");
        onClose();
      }}
    >
      <div className="space-y-3">
        {mode === "approve" && (
          <div className="rounded-card border border-slate-200 bg-slate-50 p-3 text-sm">
            <p className="font-bold text-slate-900">
              Approve refund of {formatCurrency(refundRequest.amount, currency)}?
            </p>
            <p className="mt-1 text-slate-600">
              This will be sent to the payment gateway immediately upon approval.
            </p>
            {remainingAfterApproval != null && remainingAfterApproval >= 0 && (
              <p className="mt-2 text-xs font-semibold text-slate-500">
                Remaining refundable amount after approval: {formatCurrency(remainingAfterApproval, currency)}
              </p>
            )}
            {remainingAfterApproval != null && remainingAfterApproval < 0 && (
              <p className="mt-2 text-xs font-semibold text-amber-700" role="status">
                This amount is more than what is left to refund on the payment we have on screen. The server will refuse it if so; refresh to see the latest figures.
              </p>
            )}
          </div>
        )}

        {mode === "retry" && (
          <div className="rounded-card border border-amber-200 bg-amber-50 p-3 text-sm">
            <p className="flex items-start gap-2 font-bold text-amber-900">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              Retry refund of {formatCurrency(refundRequest.amount, currency)}?
            </p>
            {refundRequest.failureReason && (
              <p className="mt-1 text-amber-800">Previous attempt failed: {refundRequest.failureReason}</p>
            )}
            <p className="mt-2 text-xs text-amber-700">
              This will be sent to the payment gateway again. No refund has been confirmed yet.
            </p>
          </div>
        )}

        {mode === "reconcile" && (
          <div className="rounded-card border border-amber-200 bg-amber-50 p-3 text-sm">
            <p className="flex items-start gap-2 font-bold text-amber-900">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              Confirm refund of {formatCurrency(refundRequest.amount, currency)} with the payment provider?
            </p>
            <p className="mt-2 text-xs text-amber-700">
              The provider is asked for the real status. Nothing is retried, so there is no risk of refunding twice.
            </p>
          </div>
        )}

        {mode === "reject" && (
          <p className="text-sm text-slate-600">
            Rejecting {formatCurrency(refundRequest.amount, currency)}. The patient will be notified with the reason
            below.
          </p>
        )}

        {(mode === "reject" || mode === "approve") && (
          <div>
            <Textarea
              label={mode === "reject" ? "Rejection reason" : "Note (optional)"}
              name="refund-action-note"
              required={mode === "reject"}
              value={note}
              disabled={loading}
              error={touched || note ? noteProblem : ""}
              onChange={(e) => { setNote(e.target.value); setError(""); }}
              onBlur={() => setTouched(true)}
              placeholder={mode === "reject" ? "Explain why this refund is being rejected..." : "Add a note for the audit trail..."}
            />
            <p className="mt-1 text-right text-xs text-slate-400">{note.length} / 500</p>
          </div>
        )}

        {error && <p role="alert" className="rounded-control border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">{error}</p>}

        <div className="flex justify-end gap-3 pt-2">
          <Button
            variant="secondary"
            disabled={loading}
            onClick={() => {
              setNote("");
              setError("");
              onClose();
            }}
          >
            Back
          </Button>
          <Button variant={mode === "reject" ? "danger" : "success"} isLoading={loading} disabled={Boolean(noteProblem) && (touched || Boolean(note))} onClick={handleConfirm}>
            {mode === "approve" ? "Approve Refund" : mode === "reject" ? "Reject Refund" : mode === "reconcile" ? "Check With Provider" : "Retry Refund"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default RefundActionDialog;
