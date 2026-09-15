import { AlertTriangle, CheckCircle2, Download, ExternalLink, Info, Lock } from "lucide-react";
import { useEffect, useState } from "react";
import { adminApi } from "../../api/adminApi";
import { invoiceApi } from "../../api/invoiceApi";
import { monitoringApi } from "../../api/monitoringApi";
import { getApiErrorMessage } from "../../api/axios";
import ErrorState from "../shared/ErrorState";
import Button from "../ui/Button";
import ConfirmDialog from "../ui/ConfirmDialog";
import Loader from "../ui/Loader";
import MetricCard from "../ui/MetricCard";
import StatusBadge from "../ui/StatusBadge";
import Tabs from "../ui/Tabs";
import RefundActionDialog from "./RefundActionDialog";
import { useToast } from "../../context/ToastContext";
import {
  paymentTxStatusLabel,
  paymentTxStatusTone,
  refundStatusLabel,
  refundStatusTone,
  refundRequestStatusTone,
  refundRequestStatusLabel,
} from "../../utils/paymentTransactionStatusDisplay";

const formatCurrency = (amount, currency = "INR") =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: currency || "INR", maximumFractionDigits: 2 }).format(
    amount || 0,
  );

const downloadBlob = (blob, name) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
};

function PaymentDetailWorkspace({ paymentId, onChanged, onViewPatient, onViewAppointment, onViewDoctor }) {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState("overview");
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [confirmResolve, setConfirmResolve] = useState(false);
  const [refundDialog, setRefundDialog] = useState(null); // { request, mode } | null

  const loadDetail = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminApi.getPaymentDetailAdmin(paymentId);
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
  }, [paymentId]);

  const handleDownloadInvoice = async () => {
    if (!detail?.invoice?._id) return;
    setDownloading(true);
    try {
      const blob = await invoiceApi.downloadInvoice(detail.invoice._id);
      downloadBlob(blob, `${detail.invoice.invoiceNumber}.pdf`);
    } catch (err) {
      toast.error(getApiErrorMessage(err) || "Invoice PDF is not available.");
    } finally {
      setDownloading(false);
    }
  };

  // Reuses the existing Monitoring Platform's retry-queue resolve action
  // (POST /api/admin/monitoring/retry-queue/:paymentId/resolve) — this
  // workspace does not add a second dead-letter resolution path.
  const handleResolveRetry = async () => {
    setResolving(true);
    try {
      await monitoringApi.resolveDeadLetterPayment(paymentId);
      toast.success("Payment marked as reviewed");
      setConfirmResolve(false);
      await loadDetail();
      onChanged?.();
    } catch (err) {
      toast.error(getApiErrorMessage(err) || "Could not mark this payment as reviewed.");
    } finally {
      setResolving(false);
    }
  };

  // Reuses the existing refund engine (refundApi -> refundController.js)
  // through the shared RefundActionDialog (same dialog used by
  // RefundDetailWorkspace and AdminRefunds) — this workspace never
  // mutates refund state itself, and there is exactly one confirmation UI
  // for approve/reject/retry across the whole app.
  const handleRefundDialogDone = async () => {
    setRefundDialog(null);
    await loadDetail();
    onChanged?.();
  };

  if (loading) return <Loader label="Loading payment workspace" />;
  if (error) return <ErrorState description={error} onRetry={loadDetail} />;
  if (!detail) return null;

  const { payment, patient, doctor, appointment, invoice, refundRequests, needsAttention, attentionReasons } = detail;
  const isDeadLetter = payment.status === "failed" && payment.retryCount >= payment.maxRetries && !payment.retryResolvedAt;
  const isRetryable = payment.status === "failed" && payment.retryCount < payment.maxRetries && !payment.retryResolvedAt;

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "patient", label: "Patient" },
    { id: "appointment", label: "Appointment" },
    { id: "transaction", label: "Transaction" },
    { id: "refunds", label: "Refunds", badge: refundRequests.length },
    { id: "invoice", label: "Invoice" },
    { id: "timeline", label: "Timeline" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-xl font-bold text-slate-950">{formatCurrency(payment.totalAmount, payment.currency)}</h3>
          <p className="text-sm text-slate-500">
            {patient?.name || "Unknown patient"} · {new Date(payment.createdAt).toLocaleString()}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge tone={paymentTxStatusTone(payment.status)}>{paymentTxStatusLabel(payment.status)}</StatusBadge>
          {payment.refundStatus !== "none" && (
            <StatusBadge tone={refundStatusTone(payment.refundStatus)}>{refundStatusLabel(payment.refundStatus)}</StatusBadge>
          )}
        </div>
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

      <div className="flex flex-wrap gap-2">
        {isDeadLetter && (
          <Button variant="danger" size="sm" onClick={() => setConfirmResolve(true)}>
            <CheckCircle2 size={14} /> Mark Reviewed (Retry Exhausted)
          </Button>
        )}
        {isRetryable && (
          <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
            <Info size={13} /> Next automatic retry:{" "}
            {payment.nextRetryAt ? new Date(payment.nextRetryAt).toLocaleString() : "not scheduled"} — no manual
            retry exists for this payment; the scheduler handles it.
          </p>
        )}
        {invoice?._id && (
          <Button variant="secondary" size="sm" isLoading={downloading} onClick={handleDownloadInvoice}>
            <Download size={14} /> Download Invoice
          </Button>
        )}
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === "overview" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard label="Status" value={paymentTxStatusLabel(payment.status)} tone={paymentTxStatusTone(payment.status) === "danger" ? "danger" : "neutral"} />
          <MetricCard label="Total Amount" value={formatCurrency(payment.totalAmount, payment.currency)} />
          <MetricCard label="Gateway Amount" value={formatCurrency(payment.gatewayAmount, payment.currency)} caption="Charged to Razorpay" />
          {payment.walletAmount > 0 && (
            <MetricCard label="Wallet Contribution" value={formatCurrency(payment.walletAmount, payment.currency)} />
          )}
          {payment.discountAmount > 0 && (
            <MetricCard label="Discount Applied" value={formatCurrency(payment.discountAmount, payment.currency)} />
          )}
          <MetricCard label="Tax" value={formatCurrency(payment.taxAmount, payment.currency)} />
          {payment.paidAt && <MetricCard label="Paid At" value={new Date(payment.paidAt).toLocaleString()} />}
          {payment.failedAt && <MetricCard label="Failed At" value={new Date(payment.failedAt).toLocaleString()} tone="danger" />}
          {payment.refundedAmount > 0 && (
            <MetricCard label="Refunded So Far" value={formatCurrency(payment.refundedAmount, payment.currency)} tone="info" />
          )}
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
              <MetricCard label="Date" value={new Date(appointment.date).toLocaleDateString()} />
              <MetricCard label="Time Slot" value={appointment.timeSlot || "—"} />
              <MetricCard label="Appointment Status" value={appointment.status} />
              <MetricCard label="Payment Status (Appointment)" value={appointment.paymentStatus || "—"} />
              {appointment.reason && <MetricCard label="Reason for Visit" value={appointment.reason} />}
              {doctor?.userId?.name && <MetricCard label="Doctor" value={`Dr. ${doctor.userId.name}`} />}
              {doctor?.specialization && <MetricCard label="Specialization" value={doctor.specialization} />}
              {(onViewAppointment || onViewDoctor) && (
                <div className="col-span-full flex flex-wrap gap-2">
                  {onViewAppointment && (
                    <Button variant="secondary" size="sm" onClick={() => onViewAppointment(appointment._id, patient?._id)}>
                      <ExternalLink size={14} /> Open Appointment Operations
                    </Button>
                  )}
                  {onViewDoctor && doctor?._id && (
                    <Button variant="secondary" size="sm" onClick={() => onViewDoctor(doctor._id)}>
                      <ExternalLink size={14} /> Open Doctor Workspace
                    </Button>
                  )}
                </div>
              )}
            </>
          ) : (
            <p className="col-span-full text-sm text-slate-500">No appointment is linked to this payment.</p>
          )}
        </div>
      )}

      {activeTab === "transaction" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <MetricCard label="Gateway" value={payment.gateway || "—"} />
          <MetricCard label="Razorpay Order ID" value={payment.razorpayOrderId || "—"} />
          <MetricCard label="Gateway Payment ID" value={payment.paymentId || "Not captured yet"} />
          <MetricCard label="Retry Count" value={`${payment.retryCount} / ${payment.maxRetries}`} />
          {payment.status === "failed" && (
            <div className="col-span-full rounded-card border border-slate-200 p-4">
              <p className="flex items-center gap-2 text-sm font-bold text-slate-800">
                <AlertTriangle size={15} className="text-rose-500" /> Why did it fail?
              </p>
              <p className="mt-1.5 text-sm text-slate-600">Failure reason unavailable from gateway response.</p>
              <p className="mt-1 text-xs text-slate-500">
                Impact: payment not collected.{" "}
                {isDeadLetter
                  ? "Retries exhausted — requires manual review."
                  : isRetryable
                    ? "Automatic retry still scheduled."
                    : "Already marked reviewed."}
              </p>
            </div>
          )}
        </div>
      )}

      {activeTab === "refunds" && (
        <div className="space-y-3">
          {refundRequests.length === 0 ? (
            <p className="text-sm text-slate-500">No refund record for this payment.</p>
          ) : (
            refundRequests.map((request) => (
              <div key={request._id} className="rounded-card border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-slate-900">{formatCurrency(request.amount, payment.currency)}</p>
                    <p className="text-xs text-slate-500">{request.reason}</p>
                  </div>
                  <StatusBadge tone={refundRequestStatusTone(request.status)}>
                    {refundRequestStatusLabel(request.status)}
                  </StatusBadge>
                </div>
                <p className="mt-1.5 text-xs text-slate-400">
                  Requested by {request.requestedBy?.name || "—"} · {new Date(request.createdAt).toLocaleString()}
                </p>
                {request.status === "failed" && request.failureReason && (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-rose-600">
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                    {request.failureReason}. ₹{request.amount} has NOT been confirmed as refunded.
                  </p>
                )}
                {request.status === "pending" && (
                  <div className="mt-3 flex gap-2">
                    <Button variant="success" size="sm" onClick={() => setRefundDialog({ request, mode: "approve" })}>
                      Approve &amp; Process
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => setRefundDialog({ request, mode: "reject" })}>
                      Reject
                    </Button>
                  </div>
                )}
                {request.status === "failed" && (
                  <div className="mt-3">
                    <Button variant="secondary" size="sm" onClick={() => setRefundDialog({ request, mode: "retry" })}>
                      Retry Refund
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === "invoice" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {invoice ? (
            <>
              <MetricCard label="Invoice Number" value={invoice.invoiceNumber} />
              <MetricCard label="Total Amount" value={formatCurrency(invoice.totalAmount, payment.currency)} />
              {invoice.issuedAt && <MetricCard label="Issued" value={new Date(invoice.issuedAt).toLocaleString()} />}
              <div className="flex items-end">
                <Button variant="secondary" size="sm" isLoading={downloading} onClick={handleDownloadInvoice}>
                  <Download size={14} /> Download PDF
                </Button>
              </div>
            </>
          ) : (
            <p className="col-span-full text-sm text-slate-500">
              No invoice has been generated for this payment yet — invoices are only issued once a payment is
              captured.
            </p>
          )}
        </div>
      )}

      {activeTab === "timeline" && (
        <ul className="space-y-3">
          {detail.timeline?.length ? (
            detail.timeline.map((event) => (
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

      <ConfirmDialog
        isOpen={confirmResolve}
        title="Mark payment as reviewed?"
        description="This payment has exhausted its automatic retry attempts. Marking it reviewed removes it from the Retry Queue's dead-letter list — it does not attempt any further gateway retry or refund."
        confirmLabel="Mark Reviewed"
        tone="danger"
        isLoading={resolving}
        onConfirm={handleResolveRetry}
        onClose={() => setConfirmResolve(false)}
      />

      <RefundActionDialog
        refundRequest={refundDialog?.request}
        payment={payment}
        mode={refundDialog?.mode}
        onClose={() => setRefundDialog(null)}
        onDone={handleRefundDialogDone}
      />
    </div>
  );
}

export default PaymentDetailWorkspace;
