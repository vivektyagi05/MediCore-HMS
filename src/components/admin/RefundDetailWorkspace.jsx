import { AlertTriangle, ExternalLink, FileWarning } from "lucide-react";
import { useEffect, useState } from "react";
import { adminApi } from "../../api/adminApi";
import { getApiErrorMessage } from "../../api/axios";
import ErrorState from "../shared/ErrorState";
import Button from "../ui/Button";
import Loader from "../ui/Loader";
import MetricCard from "../ui/MetricCard";
import StatusBadge from "../ui/StatusBadge";
import Tabs from "../ui/Tabs";
import RefundActionDialog from "./RefundActionDialog";
import {
  refundRequestStatusLabel,
  refundRequestStatusTone,
} from "../../utils/paymentTransactionStatusDisplay";

const formatCurrency = (amount, currency = "INR") =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: currency || "INR", maximumFractionDigits: 2 }).format(
    amount || 0,
  );

// Refund Detail Workspace (Phase UI-6). Composes the existing
// GET /api/admin/refunds/:id aggregate — never re-implements payment,
// patient, or appointment internals; "Open Payment Workspace" etc. link
// out to the workspaces that already own that data.
function RefundDetailWorkspace({ refundRequestId, onChanged, onViewPayment, onViewPatient, onViewAppointment }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dialogMode, setDialogMode] = useState(null); // "approve" | "reject" | "retry" | null

  const loadDetail = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.getRefundDetailAdmin(refundRequestId);
      setDetail(res.data);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDetail();
    setActiveTab("overview");
  }, [refundRequestId]);

  const handleDialogDone = async () => {
    setDialogMode(null);
    await loadDetail();
    onChanged?.();
  };

  if (loading) return <Loader label="Loading refund workspace" />;
  if (error) return <ErrorState description={error} onRetry={loadDetail} />;
  if (!detail) return null;

  const {
    refundRequest,
    payment,
    patient,
    doctor,
    appointment,
    invoice,
    otherRefundRequests,
    financialImpact,
    needsAttention,
    attentionReasons,
    timeline,
  } = detail;

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "payment", label: "Payment" },
    { id: "patient", label: "Patient" },
    { id: "appointment", label: "Appointment" },
    { id: "financial", label: "Financial Impact" },
    { id: "timeline", label: "Timeline" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold text-slate-950">
            {formatCurrency(refundRequest.amount, payment.currency)}
          </h3>
          <p className="text-sm text-slate-500">
            {patient?.name || "Unknown patient"} · {new Date(refundRequest.createdAt).toLocaleString()}
          </p>
        </div>
        <StatusBadge tone={refundRequestStatusTone(refundRequest.status)}>
          {refundRequestStatusLabel(refundRequest.status)}
        </StatusBadge>
      </div>

      {needsAttention && (
        <div className="rounded-card border border-amber-200 bg-amber-50 p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-amber-800">
            <AlertTriangle size={16} /> Requires operational attention
          </p>
          <ul className="mt-1.5 ml-6 list-disc text-xs text-amber-700">
            {attentionReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}

      {refundRequest.status === "failed" && refundRequest.failureReason && (
        <div className="rounded-card border border-rose-200 bg-rose-50 p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-rose-800">
            <FileWarning size={16} /> Refund not confirmed
          </p>
          <p className="mt-1 text-xs text-rose-700">
            Reason: {refundRequest.failureReason}
            <br />
            Impact: {formatCurrency(refundRequest.amount, payment.currency)} has NOT been confirmed as refunded.
          </p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {refundRequest.status === "pending" && (
          <>
            <Button variant="success" size="sm" onClick={() => setDialogMode("approve")}>
              Approve &amp; Process
            </Button>
            <Button variant="danger" size="sm" onClick={() => setDialogMode("reject")}>
              Reject
            </Button>
          </>
        )}
        {refundRequest.status === "failed" && (
          <Button variant="secondary" size="sm" onClick={() => setDialogMode("retry")}>
            Retry Refund
          </Button>
        )}
        {onViewPayment && (
          <Button variant="tertiary" size="sm" onClick={() => onViewPayment(payment.paymentId || payment._id)}>
            <ExternalLink size={14} /> Open Payment Workspace
          </Button>
        )}
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === "overview" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard label="Requested Amount" value={formatCurrency(refundRequest.amount, payment.currency)} />
          <MetricCard label="Status" value={refundRequestStatusLabel(refundRequest.status)} />
          <MetricCard label="Reason" value={refundRequest.reason || "—"} />
          <MetricCard label="Requested By" value={refundRequest.requestedBy?.name || "—"} />
          {refundRequest.processedBy && (
            <MetricCard label="Processed By" value={refundRequest.processedBy.name} />
          )}
          {refundRequest.razorpayRefundId && (
            <MetricCard label="Gateway Refund ID" value={refundRequest.razorpayRefundId} />
          )}
          {otherRefundRequests?.length > 0 && (
            <MetricCard
              label="Other Refunds On This Payment"
              value={otherRefundRequests.length}
              caption="See Payment Workspace for full history"
            />
          )}
        </div>
      )}

      {activeTab === "payment" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard label="Payment Status" value={payment.status} />
          <MetricCard label="Total Amount" value={formatCurrency(payment.totalAmount, payment.currency)} />
          <MetricCard label="Already Refunded" value={formatCurrency(payment.refundedAmount, payment.currency)} />
          <MetricCard label="Gateway Order ID" value={payment.razorpayOrderId || "—"} />
        </div>
      )}

      {activeTab === "patient" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard label="Name" value={patient?.name || "—"} />
          <MetricCard label="Email" value={patient?.email || "—"} />
          {onViewPatient && patient?._id && (
            <div className="flex items-end">
              <Button variant="secondary" size="sm" onClick={() => onViewPatient(patient._id)}>
                <ExternalLink size={14} /> Open Patient Workspace
              </Button>
            </div>
          )}
        </div>
      )}

      {activeTab === "appointment" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {appointment ? (
            <>
              <MetricCard label="Date" value={appointment.date ? new Date(appointment.date).toLocaleDateString() : "—"} />
              <MetricCard label="Time Slot" value={appointment.timeSlot || "—"} />
              <MetricCard label="Appointment Status" value={appointment.status || "—"} />
              {doctor?.userId?.name && <MetricCard label="Doctor" value={`Dr. ${doctor.userId.name}`} />}
              {onViewAppointment && (
                <div className="flex items-end">
                  <Button variant="secondary" size="sm" onClick={() => onViewAppointment(appointment._id, patient?._id)}>
                    <ExternalLink size={14} /> Open Appointment Workspace
                  </Button>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-500">No linked appointment.</p>
          )}
        </div>
      )}

      {activeTab === "financial" && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <MetricCard label="Payment Total" value={formatCurrency(financialImpact.paymentTotalAmount, financialImpact.currency)} />
            <MetricCard
              label="Already Refunded (Excl. This Request)"
              value={formatCurrency(financialImpact.alreadyRefundedBeforeThis, financialImpact.currency)}
            />
            <MetricCard label="This Refund" value={formatCurrency(financialImpact.thisRefundAmount, financialImpact.currency)} tone="info" />
            <MetricCard
              label="Remaining Refundable After This"
              value={formatCurrency(financialImpact.remainingRefundableAfterThis, financialImpact.currency)}
            />
          </div>
          <div className="rounded-card border border-slate-200 p-4 text-sm text-slate-600">
            {invoice ? (
              <>
                <p className="font-semibold text-slate-800">Invoice {invoice.invoiceNumber}</p>
                <p className="mt-1 text-xs text-slate-500">
                  This platform's invoices do not carry a separate refunded/partially-refunded status — the
                  payment record above (refundedAmount / refundStatus) is the authoritative source of the refund's
                  financial state. Credit note capability is not available.
                </p>
              </>
            ) : (
              <p>No invoice is linked to this payment.</p>
            )}
          </div>
        </div>
      )}

      {activeTab === "timeline" && (
        <ul className="space-y-2">
          {timeline.length > 0 ? (
            timeline.map((event) => (
              <li key={event.key} className="flex items-start gap-3 rounded-control border border-slate-200 p-3.5">
                <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-royal-500" />
                <div>
                  <p className="text-sm font-semibold text-slate-800">{event.label}</p>
                  <p className="text-xs text-slate-500">{event.at ? new Date(event.at).toLocaleString() : "—"}</p>
                </div>
              </li>
            ))
          ) : (
            <p className="text-sm text-slate-500">No recorded activity yet.</p>
          )}
        </ul>
      )}

      <RefundActionDialog
        refundRequest={dialogMode ? refundRequest : null}
        payment={payment}
        mode={dialogMode}
        onClose={() => setDialogMode(null)}
        onDone={handleDialogDone}
      />
    </div>
  );
}

export default RefundDetailWorkspace;
