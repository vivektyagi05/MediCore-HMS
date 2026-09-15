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

  if (!refundRequest || !mode) return null;

  const currency = payment?.currency || "INR";
  const remainingAfterApproval = payment
    ? Number((payment.totalAmount - payment.refundedAmount - refundRequest.amount).toFixed(2))
    : null;

  const handleConfirm = async () => {
    if (mode === "reject" && !note.trim()) {
      toast.error("A rejection reason is required");
      return;
    }
    setLoading(true);
    try {
      let res;
      if (mode === "approve") res = await refundApi.approveRequest(refundRequest._id, note ? { note } : {});
      else if (mode === "reject") res = await refundApi.rejectRequest(refundRequest._id, { note: note.trim() });
      else res = await refundApi.retryRequest(refundRequest._id);

      toast.success(
        res?.message ||
          (mode === "approve" ? "Refund processed successfully" : mode === "reject" ? "Refund request rejected" : "Refund retried"),
      );
      setNote("");
      onDone?.();
    } catch (err) {
      toast.error(
        getApiErrorMessage(err) ||
          (mode === "approve"
            ? "Refund could not be processed. No refund was recorded."
            : mode === "retry"
              ? "Refund retry failed. No refund was recorded."
              : "Refund request could not be rejected."),
      );
    } finally {
      setLoading(false);
    }
  };

  const title =
    mode === "approve" ? "Approve refund" : mode === "reject" ? "Reject refund request" : "Retry refund";

  return (
    <Modal
      isOpen
      title={title}
      onClose={() => {
        setNote("");
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
            {remainingAfterApproval != null && (
              <p className="mt-2 text-xs font-semibold text-slate-500">
                Remaining refundable amount after approval: {formatCurrency(remainingAfterApproval, currency)}
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

        {mode === "reject" && (
          <p className="text-sm text-slate-600">
            Rejecting {formatCurrency(refundRequest.amount, currency)}. The patient will be notified with the reason
            below.
          </p>
        )}

        {(mode === "reject" || mode === "approve") && (
          <Textarea
            label={mode === "reject" ? "Rejection reason" : "Note (optional)"}
            required={mode === "reject"}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={mode === "reject" ? "Explain why this refund is being rejected..." : "Add a note for the audit trail..."}
          />
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button
            variant="secondary"
            disabled={loading}
            onClick={() => {
              setNote("");
              onClose();
            }}
          >
            Back
          </Button>
          <Button variant={mode === "reject" ? "danger" : "success"} isLoading={loading} onClick={handleConfirm}>
            {mode === "approve" ? "Approve Refund" : mode === "reject" ? "Reject Refund" : "Retry Refund"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export default RefundActionDialog;
